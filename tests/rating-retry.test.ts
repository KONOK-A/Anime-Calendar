import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CacheStore } from '../server/cache.js';
import { MultiRatingService } from '../server/multi-ratings.js';
import { UpstreamClient } from '../server/upstream.js';
import { summarizeRatings, validRatingSummary } from '../shared/scores.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks(); });
const item = { id: 'bgm:1', bangumiId: 1, externalIds: { mal: 123 } };
const bgm = { rating: { score: 7, total: 10, rank: null }, fetchedAt: '2026-10-31T00:00:00Z' };
const page = (id: number, score = '8', votes = '20') => new Response(`<link rel="canonical" href="https://myanimelist.net/anime/${id}"><div itemprop="aggregateRating" itemscope itemtype="http://schema.org/AggregateRating"><span itemprop="ratingValue">${score}</span><span itemprop="ratingCount">${votes}</span></div>`);
async function setup(fetcher: (url: string) => Promise<Response>, filmarks = false) {
  const dir = await mkdtemp(join(tmpdir(), 'rating-retry-'));
  const store = new CacheStore(dir), upstream = new UpstreamClient(fetcher);
  const service = new MultiRatingService({ store, upstream, now: () => new Date(Date.now()), aniListEnabled: false, ...(filmarks ? { filmarksLink: () => ({ seriesId: 1, seasonId: 2 }) } : {}) });
  cleanups.push(async () => { service.close(); upstream.close(); await service.drain(); await rm(dir, { recursive: true, force: true }); });
  return { service, store, upstream };
}

describe('评分暂态重试提示', () => {
  it('兼容旧摘要，重试等待仅接受正安全整数', () => {
    const value = summarizeRatings([]);
    expect(validRatingSummary(value)).toBe(true);
    for (const retryAfterMs of [1, 1000, Number.MAX_SAFE_INTEGER]) expect(validRatingSummary({ ...value, retryAfterMs })).toBe(true);
    for (const retryAfterMs of [0, -1, 1.5, NaN, Infinity, '1000', true, Number.MAX_SAFE_INTEGER + 1]) expect(validRatingSummary({ ...value, retryAfterMs })).toBe(false);
  });
  it('96资源队列满返回短暂重试提示，而不伪造实际更新任务', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { service, store, upstream } = await setup(async url => { await gate; return page(Number(new URL(url).pathname.split('/').at(-1))); });
    cleanups.unshift(async () => { release(); });
    const values = await Promise.all(Array.from({ length: 97 }, (_, index) => service.get({ ...item, id: `bgm:${index + 1}`, externalIds: { mal: index + 1 } }, bgm)));
    const blocked = values.find(value => value.sources.some(source => source.error?.includes('任务较多')))!;
    expect(blocked).toBeDefined(); expect(blocked.revalidating).not.toBe(true); expect(blocked.retryAfterMs).toBe(1000);
    const id = Number(blocked.sources.find(source => source.provider === 'mal')!.url!.split('/').at(-1));
    const read = vi.spyOn(store, 'read'), revision = service.revision;
    expect(service.peekKnown({ ...item, externalIds: { mal: id } }, bgm)).toMatchObject({ retryAfterMs: 1000 });
    expect(read).not.toHaveBeenCalled(); expect(service.revision).toBe(revision); expect(upstream.stats().background).toBe(1);
  });
  it('单资源解析失败返回真实一分钟冷却，不为新调用提前抓取', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(bgm.fetchedAt)); let calls = 0;
    const { service } = await setup(async () => { calls++; return page(999); });
    expect(await service.get(item, bgm, true)).toMatchObject({ retryAfterMs: 60_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await service.get(item, bgm, true)).toMatchObject({ retryAfterMs: 50_000 }); expect(calls).toBe(1);
    expect(service.peekKnown(item, bgm)).toMatchObject({ retryAfterMs: 50_000 });
  });
  it('摘要采用最早可重试来源，其他来源仍遵守更长Retry-After', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(bgm.fetchedAt)); let limited = true, malCalls = 0, filmCalls = 0;
    const film = () => new Response('<link rel="canonical" href="https://filmarks.com/animes/1/2"><script type="application/ld+json">{"@type":"TVSeason","url":"https://filmarks.com/animes/1/2","aggregateRating":{"ratingValue":"4","bestRating":"5"}}</script>');
    const { service, store } = await setup(async url => {
      if (url.startsWith('https://myanimelist.net/')) { malCalls++; return limited ? new Response('', { status: 429, headers: { 'retry-after': '120' } }) : page(123); }
      filmCalls++; return limited ? new Response('invalid') : film();
    }, true);
    const first = await service.get(item, bgm, true);
    expect(first.retryAfterMs).toBe(60_000); expect(first.revalidating).not.toBe(true);
    await vi.advanceTimersByTimeAsync(61_000); limited = false;
    const after = await service.get(item, bgm, true);
    expect(after.retryAfterMs).toBe(59_000); expect(malCalls).toBe(1); expect(filmCalls).toBe(2);
    const read = vi.spyOn(store, 'read'), revision = service.revision;
    expect(service.peekKnown(item, bgm).retryAfterMs).toBe(59_000); expect(read).not.toHaveBeenCalled(); expect(service.revision).toBe(revision);
    await vi.advanceTimersByTimeAsync(60_000);
    const recovered = await service.get(item, bgm, true);
    expect(recovered.count).toBe(3); expect(recovered.retryAfterMs).toBeUndefined(); expect(malCalls).toBe(2);
  });
  it('真实未开分、未关联和停用来源不产生重试提示', async () => {
    const { service } = await setup(async () => page(123, 'N/A', '0'));
    const value = await service.get(item, bgm, true);
    expect(value.sources.map(source => source.status)).toEqual(['ready', 'unrated', 'unlinked', 'disabled']);
    expect(value.retryAfterMs).toBeUndefined(); expect(service.peekKnown(item, bgm).retryAfterMs).toBeUndefined();
  });
  it('已经在处理的资源只标记revalidating，不新增重试倒计时', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { service } = await setup(async () => { await gate; return page(123); });
    cleanups.unshift(async () => { release(); });
    const value = await service.get(item, bgm);
    expect(value.revalidating).toBe(true); expect(value.retryAfterMs).toBeUndefined();
    expect(service.peekKnown(item, bgm).retryAfterMs).toBeUndefined();
  });
});

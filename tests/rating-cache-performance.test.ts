import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CacheStore } from '../server/cache.js';
import { MultiRatingService, ratingCacheKey } from '../server/multi-ratings.js';
import { UpstreamClient } from '../server/upstream.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks(); });
const item = { id: 'bgm:1', bangumiId: 1, externalIds: { mal: 123 } };
const bgm = { rating: { score: 7, total: 10, rank: null }, fetchedAt: '2026-10-31T00:00:00Z' };
const page = (id = 123) => new Response(`<link rel="canonical" href="https://myanimelist.net/anime/${id}"><div itemprop="aggregateRating" itemscope itemtype="http://schema.org/AggregateRating"><span itemprop="ratingValue">8</span><span itemprop="ratingCount">20</span></div>`);
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'rating-cache-performance-'));
  let now = Date.parse(bgm.fetchedAt), requests = 0, release!: () => void;
  const network = new Promise<void>(resolve => { release = resolve; });
  const store = new CacheStore(dir), upstream = new UpstreamClient(async url => { requests++; await network; return page(Number(new URL(url).pathname.split('/').at(-1))); });
  const service = new MultiRatingService({ store, upstream, now: () => new Date(now), aniListEnabled: false });
  cleanups.push(async () => { release(); service.close(); await service.drain(); await rm(dir, { recursive: true, force: true }); });
  return { store, service, release, requests: () => requests, advance: (ms: number) => { now += ms; } };
}

describe('评分缓存访问开销与任务生命周期', () => {
  it('同步已知快照不读取磁盘或启动任务，未知资源提供正常占位', async () => {
    const { service, store, requests } = await setup(), read = vi.spyOn(store, 'read');
    await store.write(ratingCacheKey('mal', 'https://myanimelist.net/anime/123'), { provider: 'mal', score: 8, maxScore: 10, votes: 20, url: 'https://myanimelist.net/anime/123', fetchedAt: bgm.fetchedAt, status: 'ready' }, bgm.fetchedAt);
    expect(service.peekKnown(item, bgm)).toMatchObject({ score: 7, count: 1, sources: expect.arrayContaining([
      expect.objectContaining({ provider: 'mal', status: 'unavailable', url: 'https://myanimelist.net/anime/123' }),
      expect.objectContaining({ provider: 'filmarks', status: 'unlinked' }),
      expect.objectContaining({ provider: 'anilist', status: 'disabled' })
    ]) });
    expect(read).not.toHaveBeenCalled(); expect(requests()).toBe(0); expect(service.revision).toBe(0);
    await service.peek(item, bgm); const revision = service.revision;
    expect(service.peekKnown(item, bgm)).toMatchObject({ score: 7.5, count: 2 });
    expect(read).toHaveBeenCalledTimes(1); expect(requests()).toBe(0); expect(service.revision).toBe(revision);
  });
  it('同步快照按来源key识别共享pending，任务完成后立即看见评分', async () => {
    const { service, store, release } = await setup(), read = vi.spyOn(store, 'read');
    await service.get(item, bgm); const pendingRevision = service.revision;
    const alias = { ...item, id: 'bgm:2', bangumiId: 2 };
    expect(service.peekKnown(alias, bgm)).toMatchObject({ score: 7, revalidating: true });
    expect(read).toHaveBeenCalledTimes(1); expect(service.revision).toBe(pendingRevision);
    release(); await service.drain(); const readyRevision = service.revision;
    expect(service.peekKnown(alias, bgm)).toMatchObject({ score: 7.5, count: 2 });
    expect(service.peekKnown(alias, bgm).revalidating).not.toBe(true);
    expect(service.revision).toBe(readyRevision); expect(read).toHaveBeenCalledTimes(1);
  });
  it('同资源冷读合并，进行中任务的摘要轮询不再次读取缺失文件', async () => {
    const { service, store, requests, advance } = await setup(), read = vi.spyOn(store, 'read');
    await Promise.all(Array.from({ length: 40 }, (_, index) => index % 2 ? service.peek(item, bgm) : service.get(item, bgm)));
    expect(read).toHaveBeenCalledTimes(1);
    for (let round = 0; round < 10; round++) await Promise.all([service.get(item, bgm), service.peek(item, bgm)]);
    advance(60_001); await service.peek(item, bgm);
    expect(read).toHaveBeenCalledTimes(1); expect(requests()).toBe(1);
  });
  it('短时缺失缓存抑制只读轮询，并在一分钟后发现后来写入的评分文件', async () => {
    const { service, store, advance, requests } = await setup(), read = vi.spyOn(store, 'read');
    await service.peek(item, bgm);
    for (let round = 0; round < 10; round++) await service.peek(item, bgm);
    expect(read).toHaveBeenCalledTimes(1); expect(requests()).toBe(0);
    await store.write(ratingCacheKey('mal', 'https://myanimelist.net/anime/123'), { provider: 'mal', score: 8, maxScore: 10, votes: 20, url: 'https://myanimelist.net/anime/123', fetchedAt: bgm.fetchedAt, status: 'ready' }, bgm.fetchedAt);
    advance(60_001);
    expect((await service.peek(item, bgm)).sources.find(source => source.provider === 'mal')).toMatchObject({ score: 8, status: 'ready' });
    expect(read).toHaveBeenCalledTimes(2); expect(requests()).toBe(0);
  });
  it('缺失缓存有界，超过256个资源后最早资源可重新检查文件', async () => {
    const { service, store } = await setup(), read = vi.spyOn(store, 'read');
    for (let id = 1; id <= 257; id++) await service.peek({ ...item, externalIds: { mal: id } }, bgm);
    await service.peek({ ...item, externalIds: { mal: 257 } }, bgm);
    expect(read).toHaveBeenCalledTimes(257);
    await service.peek({ ...item, externalIds: { mal: 1 } }, bgm);
    expect(read).toHaveBeenCalledTimes(258);
  });
  it('任务完成及容量释放推进revision，热get与peek不制造状态变动', async () => {
    const { service, release } = await setup();
    expect(service.revision).toBe(0);
    await service.get(item, bgm); const pendingRevision = service.revision;
    expect(pendingRevision).toBeGreaterThan(0);
    for (let round = 0; round < 10; round++) await Promise.all([service.get(item, bgm), service.peek(item, bgm)]);
    expect(service.revision).toBe(pendingRevision);
    release(); await service.drain(); expect(service.revision).toBeGreaterThan(pendingRevision);
    const readyRevision = service.revision;
    for (let round = 0; round < 10; round++) await Promise.all([service.get(item, bgm), service.peek(item, bgm)]);
    expect(service.revision).toBe(readyRevision);
    expect((await service.peek(item, bgm)).sources.find(source => source.provider === 'mal')).toMatchObject({ score: 8, status: 'ready' });
  });
  it('自定义等待预算到期只结束调用者等待，共享任务随后仍更新缓存', async () => {
    vi.useFakeTimers(); const { service, release, requests } = await setup();
    await service.get(item, bgm);
    const waiting = service.get(item, bgm, true, 100);
    await vi.advanceTimersByTimeAsync(100);
    expect(await waiting).toMatchObject({ score: 7, revalidating: true });
    expect(requests()).toBe(1); release(); await service.drain();
    expect((await service.peek(item, bgm)).sources.find(source => source.provider === 'mal')).toMatchObject({ score: 8, status: 'ready' });
  });
  it('等待预算从调用入口计时，冷缓存读取耗时会扣除', async () => {
    vi.useFakeTimers(); const { service, store } = await setup();
    let releaseRead!: () => void, readStarted!: () => void;
    const gate = new Promise<void>(resolve => { releaseRead = resolve; }), started = new Promise<void>(resolve => { readStarted = resolve; });
    const originalRead = store.read.bind(store);
    vi.spyOn(store, 'read').mockImplementation(async (key, validate) => { const value = await originalRead(key, validate); readStarted(); await gate; return value; });
    let settled = false;
    const waiting = service.get(item, bgm, true, 100).then(result => { settled = true; return result; });
    await started; await vi.advanceTimersByTimeAsync(75); releaseRead();
    await vi.advanceTimersByTimeAsync(24); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await waiting).toMatchObject({ score: 7, revalidating: true });
  });
});

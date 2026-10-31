import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CacheStore } from '../server/cache.js';
import { UpstreamClient } from '../server/upstream.js';
import { MultiRatingService, ratingCacheKey, type MultiRatingOptions } from '../server/multi-ratings.js';

const dirs: string[] = [], services: MultiRatingService[] = [];
afterEach(async () => { for (const service of services.splice(0)) service.close(); vi.useRealTimers(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const item = { id: 'bgm:1', bangumiId: 1, externalIds: { mal: 123, aniList: 200 } };
const bgm = { rating: { score: 7.7, total: 100, rank: null }, fetchedAt: '2026-10-31T00:00:00Z' };
const malPage = (id: number, score: number, votes: number) => new Response(`<html><head><link rel="canonical" href="https://myanimelist.net/anime/${id}"></head><body><div itemprop="aggregateRating" itemscope itemtype="http://schema.org/AggregateRating"><span itemprop="ratingValue">${score}</span><span itemprop="ratingCount">${votes}</span></div></body></html>`, { headers: { 'content-type': 'text/html' } });
async function setup(fetcher: (url: string, init?: RequestInit) => Promise<Response>, options: Partial<MultiRatingOptions> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'multi-ratings-')); dirs.push(dir);
  let now = new Date('2026-10-31T00:00:00Z');
  const store = new CacheStore(dir), upstream = new UpstreamClient(fetcher);
  const service = new MultiRatingService({ store, upstream, now: () => now, aniListEnabled: false, ...options }); services.push(service);
  return { service, store, upstream, dir, advance: () => { now = new Date('2026-11-02T00:00:00Z'); } };
}
describe('跨站评分缓存服务', () => {
  it('AniList默认启用并以POST读取公开评分和评分人数', async () => {
    const calls: { url: string; method?: string; body?: BodyInit | null }[] = [];
    const { service } = await setup(async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      return Response.json({ data: { Media: { id: 200, type: 'ANIME', averageScore: 81, stats: { scoreDistribution: [{ score: 80, amount: 7 }] } } } });
    }, { aniListEnabled: undefined });
    const result = await service.get({ ...item, externalIds: { aniList: 200 } }, bgm, true);
    expect(result.sources.find(source => source.provider === 'anilist')).toMatchObject({ status: 'ready', score: 81, votes: 7 });
    expect(result).toMatchObject({ score: 7.9, count: 2 });
    expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({ url: 'https://graphql.anilist.co/', method: 'POST' });
    expect(JSON.parse(calls[0].body as string).query).toContain('Media(id:200');
  });
  it('无MAL密钥使用公开作品评分，显式关闭AniList且未知Filmarks关联不请求', async () => {
    const urls: string[] = [];
    const { service } = await setup(async url => { urls.push(url); return malPage(123, 8.21, 111); });
    const result = await service.get(item, bgm, true);
    expect(result).toMatchObject({ score: 8, count: 2 });
    expect(result.sources).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'mal', score: 8.21, maxScore: 10, votes: 111, status: 'ready' }), expect.objectContaining({ provider: 'anilist', status: 'disabled', error: expect.any(String) }), expect.objectContaining({ provider: 'filmarks', status: 'unlinked' })]));
    expect(urls).toEqual(['https://myanimelist.net/anime/123']);
  });
  it('官方MAL仅使用显式传入的客户端ID，缓存重启与相同来源复用请求', async () => {
    const calls: { url: string; headers?: HeadersInit }[] = [];
    const fetcher = async (url: string, init?: RequestInit) => { calls.push({ url, headers: init?.headers }); return Response.json({ id: 123, mean: 8, num_scoring_users: 23 }); };
    const { service, dir, store, upstream } = await setup(fetcher, { malClientId: 'test-local-client' });
    await Promise.all([service.get(item, bgm, true), service.get({ ...item, id: 'bgm:2' }, bgm, true)]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.myanimelist.net/v2/anime/123?fields=mean,num_scoring_users');
    expect(new Headers(calls[0].headers).get('X-MAL-CLIENT-ID')).toBe('test-local-client');
    await store.drain();
    const restarted = new MultiRatingService({ store: new CacheStore(dir), upstream, now: () => new Date('2026-10-31T01:00:00Z'), malClientId: 'test-local-client', aniListEnabled: false }); services.push(restarted);
    expect(await restarted.get(item, bgm, true)).toMatchObject({ score: 7.9, count: 2 });
    expect(calls).toHaveLength(1);
  });
  it('首次摘要不等待新来源，过期缓存立即返回且失败保留旧评分并冷却', async () => {
    let fail = false, calls = 0, release!: () => void;
    const { service, advance } = await setup(async () => { calls++; if (fail) return new Response('', { status: 500 }); await new Promise<void>(resolve => { release = resolve; }); return malPage(123, 8.2, 10); });
    expect(await service.get(item, bgm)).toMatchObject({ score: 7.7, count: 1, revalidating: true });
    const waiting = service.get(item, bgm, true);
    await vi.waitFor(() => expect(calls).toBe(1)); release();
    expect(await waiting).toMatchObject({ score: 8, count: 2 });
    advance(); fail = true;
    expect(await service.get(item, bgm)).toMatchObject({ score: 8, count: 2, revalidating: true });
    const failed = await service.get(item, bgm, true);
    expect(failed.sources.find(source => source.provider === 'mal')).toMatchObject({ score: 8.2, status: 'ready', error: expect.any(String) });
    await service.get(item, bgm, true); expect(calls).toBe(2);
  });
  it('peek不触发请求；上游错误不阻塞Bangumi，错误响应身份不可缓存', async () => {
    let calls = 0; const { service } = await setup(async () => { calls++; return malPage(999, 9, 100); });
    expect(await service.peek(item, bgm)).toMatchObject({ score: 7.7, count: 1 }); expect(calls).toBe(0);
    const result = await service.get(item, bgm, true);
    expect(result).toMatchObject({ score: 7.7, count: 1 });
    expect(result.sources.find(source => source.provider === 'mal')).toMatchObject({ score: null, status: 'unavailable', error: expect.any(String) });
  });
  it('公开POST读取AniList评分，Filmarks精确映射只返回评分数据', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const { service } = await setup(async (url, init) => {
      calls.push({ url, init });
      if (url.startsWith('https://filmarks.com/')) return new Response('<link rel="canonical" href="https://filmarks.com/animes/4998/6805"><script type="application/ld+json">{"@type":"TVSeason","url":"https://filmarks.com/animes/4998/6805","aggregateRating":{"ratingValue":"3.6","bestRating":"5","reviewCount":"23"}}</script>');
      if (url.startsWith('https://graphql.anilist.co/')) return Response.json({ data: { Media: { id: 200, type: 'ANIME', averageScore: 79, stats: { scoreDistribution: [{ score: 80, amount: 5 }] } } } });
      return malPage(123, 8.21, 111);
    }, { aniListEnabled: true, filmarksLink: () => ({ seriesId: 4998, seasonId: 6805 }) });
    const result = await service.get(item, bgm, true);
    expect(result).toMatchObject({ score: 7.8, count: 4 });
    expect(result.sources.find(source => source.provider === 'filmarks')).toMatchObject({ score: 3.6, votes: null, maxScore: 5 });
    const aniListCall = calls.find(call => call.url === 'https://graphql.anilist.co/')!;
    expect(aniListCall.init?.method).toBe('POST');
    const query = JSON.parse(aniListCall.init?.body as string).query;
    expect(query).toContain('Media(id:200,type:ANIME)'); expect(query).toContain('averageScore');
  });
  it('AniList不同作品的POST请求及持久缓存分别隔离且都参与综合分', async () => {
    vi.useFakeTimers(); const ids: number[] = [];
    const { service, store, dir, upstream } = await setup(async (url, init) => {
      expect(url).toBe('https://graphql.anilist.co/'); expect(init?.method).toBe('POST');
      const query = JSON.parse(init?.body as string).query as string;
      const id = Number(query.match(/Media\(id:(\d+),type:ANIME\)/)?.[1]); ids.push(id);
      return Response.json({ data: { Media: { id, type: 'ANIME', averageScore: id === 200 ? 80 : 60, stats: { scoreDistribution: [{ score: id === 200 ? 80 : 60, amount: id === 200 ? 7 : 3 }] } } } });
    }, { aniListEnabled: true });
    const firstItem = { ...item, externalIds: { aniList: 200 } }, secondItem = { ...item, id: 'bgm:2', externalIds: { aniList: 201 } };
    const first = service.get(firstItem, bgm, true);
    // Cold file reads may finish in either order; establish the first start before checking the provider interval.
    await vi.waitFor(() => expect(ids).toEqual([200]));
    const second = service.get(secondItem, bgm, true); await vi.advanceTimersByTimeAsync(2200);
    const [initial, changed] = await Promise.all([first, second]);
    expect(initial).toMatchObject({ score: 7.9, count: 2 });
    expect(initial.sources.find(source => source.provider === 'anilist')).toMatchObject({ score: 80, votes: 7, url: 'https://anilist.co/anime/200', status: 'ready' });
    expect(changed).toMatchObject({ score: 6.9, count: 2 });
    expect(changed.sources.find(source => source.provider === 'anilist')).toMatchObject({ score: 60, votes: 3, url: 'https://anilist.co/anime/201', status: 'ready' });
    await store.drain();
    const restarted = new MultiRatingService({ store: new CacheStore(dir), upstream, now: () => new Date('2026-10-31T01:00:00Z'), aniListEnabled: true }); services.push(restarted);
    const [cachedFirst, cachedSecond] = await Promise.all([restarted.get(firstItem, bgm, true), restarted.get(secondItem, bgm, true)]);
    expect(cachedFirst).toMatchObject({ score: 7.9, count: 2 });
    expect(cachedFirst.sources.find(source => source.provider === 'anilist')).toMatchObject({ score: 80, votes: 7, url: 'https://anilist.co/anime/200' });
    expect(cachedSecond).toMatchObject({ score: 6.9, count: 2 });
    expect(cachedSecond.sources.find(source => source.provider === 'anilist')).toMatchObject({ score: 60, votes: 3, url: 'https://anilist.co/anime/201' });
    expect(ids).toEqual([200, 201]);
  });
  it('批量工作遵守每站请求间隔且不占据全部共享上游并发', async () => {
    vi.useFakeTimers(); const starts: number[] = [];
    const { service, upstream } = await setup(async url => { starts.push(Date.now()); const id = Number(new URL(url).pathname.split('/').at(-1)); return malPage(id, 8, 10); });
    const first = service.get(item, bgm, true), second = service.get({ ...item, externalIds: { mal: 124 } }, bgm, true);
    await vi.waitFor(() => expect(starts).toHaveLength(1));
    expect(upstream.stats().background).toBeLessThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(1200);
    await Promise.all([first, second]); expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1100);
  });
  it('关联ID改变不会串用旧来源评分，缓存身份不匹配时重新读取', async () => {
    const ids: number[] = [];
    const { service, store } = await setup(async url => { const id = Number(new URL(url).pathname.split('/').at(-1)); ids.push(id); return malPage(id, id === 123 ? 8 : 6, 10); });
    await store.write(ratingCacheKey('mal', 'https://myanimelist.net/anime/123'), { provider: 'mal', score: 10, maxScore: 10, votes: 500, url: 'https://myanimelist.net/anime/124', fetchedAt: bgm.fetchedAt, status: 'ready' }, bgm.fetchedAt);
    const initial = await service.get(item, bgm, true);
    expect(initial.sources.find(source => source.provider === 'mal')?.score).toBe(8);
    const changed = await service.get({ ...item, externalIds: { mal: 124 } }, bgm, true);
    expect(changed.sources.find(source => source.provider === 'mal')).toMatchObject({ score: 6, url: 'https://myanimelist.net/anime/124' });
    expect(ids).toEqual([123, 124]);
  });
  it('wait请求只等待有界时间，尚未完成的队列仍可后台继续', async () => {
    vi.useFakeTimers(); const releases: (() => void)[] = []; let calls = 0;
    const { service } = await setup(async url => {
      calls++;
      if (!url.startsWith('https://myanimelist.net/')) await new Promise<void>(resolve => { releases.push(resolve); });
      if (url.startsWith('https://filmarks.com/')) return new Response('');
      if (url.startsWith('https://graphql.anilist.co/')) return Response.json({ data: { Media: { id: 200, type: 'ANIME', averageScore: 79 } } });
      const id = Number(new URL(url).pathname.split('/').at(-1));
      return malPage(id, 8, 10);
    }, { aniListEnabled: true, filmarksLink: anime => anime.id === 'bgm:1' ? { seriesId: 4998, seasonId: 6805 } : null });
    await service.get({ ...item, externalIds: {} }, bgm);
    await vi.waitFor(() => expect(calls).toBe(1));
    await service.get({ ...item, id: 'bgm:2', externalIds: { aniList: 200 } }, bgm);
    const waiting = service.get({ ...item, id: 'bgm:3', externalIds: { mal: 125 } }, bgm, true);
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThanOrEqual(2));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await waiting).toMatchObject({ score: 7.7, count: 1, revalidating: true });
    for (const release of releases) release(); await vi.waitFor(() => expect(calls).toBe(3)); await service.drain();
  });
  it.each(['transport', '503'])('MAL %s故障快速冷却已排队和新作品，Filmarks继续且冷却后可恢复', async failure => {
    vi.useFakeTimers(); let offline = true, release!: () => void, filmarksCalls = 0;
    const malIds: number[] = [];
    const { service, store } = await setup(async url => {
      if (url.startsWith('https://filmarks.com/')) { filmarksCalls++; return new Response('<link rel="canonical" href="https://filmarks.com/animes/4998/6805"><script type="application/ld+json">{"@type":"TVSeason","url":"https://filmarks.com/animes/4998/6805","aggregateRating":{"ratingValue":"3.6","bestRating":"5"}}</script>'); }
      const id = Number(new URL(url).pathname.split('/').at(-1)); malIds.push(id);
      if (malIds.length === 1) await new Promise<void>(resolve => { release = resolve; });
      if (offline) { if (failure === '503') return new Response('', { status: 503 }); throw Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' }); }
      return malPage(id, 8.6, 20);
    }, { now: () => new Date(Date.now()), filmarksLink: anime => anime.id === 'bgm:2' ? { seriesId: 4998, seasonId: 6805 } : null });
    const second = { ...item, id: 'bgm:2', externalIds: { mal: 124 } }, oldAt = new Date(Date.now() - 25 * 3_600_000).toISOString();
    await store.write(ratingCacheKey('mal', 'https://myanimelist.net/anime/124'), { provider: 'mal', score: 8.2, maxScore: 10, votes: 30, url: 'https://myanimelist.net/anime/124', fetchedAt: oldAt, status: 'ready' }, oldAt);
    await service.get(item, bgm); await vi.waitFor(() => expect(malIds).toEqual([123]));
    await service.get(second, bgm); release();
    await vi.waitFor(() => expect(filmarksCalls).toBe(1)); await vi.advanceTimersByTimeAsync(2000);
    expect(malIds).toEqual([123, 123]);
    await service.drain();
    const failed = await service.get(second, bgm, true);
    expect(failed.sources.find(source => source.provider === 'mal')).toMatchObject({ score: 8.2, status: 'ready', error: expect.any(String) });
    expect(failed.sources.find(source => source.provider === 'filmarks')).toMatchObject({ score: 3.6, status: 'ready' }); expect(failed.revalidating).not.toBe(true);
    const another = await service.get({ ...item, externalIds: { mal: 125 } }, bgm, true);
    expect(another.sources.find(source => source.provider === 'mal')).toMatchObject({ score: null, status: 'unavailable', error: expect.any(String) }); expect(another.revalidating).not.toBe(true);
    expect(malIds).toEqual([123, 123]);
    offline = false; await vi.advanceTimersByTimeAsync(61_000);
    const recovered = await service.get(second, bgm, true);
    expect(recovered.sources.find(source => source.provider === 'mal')).toMatchObject({ score: 8.6, status: 'ready' }); expect(malIds).toEqual([123, 123, 124]);
  });
  it.each(['identity', '404'])('单作品%s失败不封整个MAL来源', async failure => {
    vi.useFakeTimers(); const ids: number[] = [];
    const { service } = await setup(async url => { const id = Number(new URL(url).pathname.split('/').at(-1)); ids.push(id); return id === 123 && failure === '404' ? new Response('', { status: 404 }) : malPage(id === 123 ? 999 : id, 8, 10); }, { now: () => new Date(Date.now()) });
    const first = service.get(item, bgm, true);
    await vi.waitFor(() => expect(ids).toEqual([123])); await first;
    const second = service.get({ ...item, externalIds: { mal: 124 } }, bgm, true);
    await vi.advanceTimersByTimeAsync(1200);
    expect((await second).sources.find(source => source.provider === 'mal')).toMatchObject({ score: 8, status: 'ready' }); expect(ids).toEqual([123, 124]);
  });
  it('提供方冷却遵守上游较长Retry-After，不为每个ID重新请求', async () => {
    vi.useFakeTimers(); const ids: number[] = []; let limited = true;
    const { service } = await setup(async url => { const id = Number(new URL(url).pathname.split('/').at(-1)); ids.push(id); return limited ? new Response('', { status: 429, headers: { 'retry-after': '120' } }) : malPage(id, 8, 10); }, { now: () => new Date(Date.now()) });
    await service.get(item, bgm, true);
    await vi.advanceTimersByTimeAsync(61_000);
    expect((await service.get({ ...item, externalIds: { mal: 124 } }, bgm, true)).revalidating).not.toBe(true); expect(ids).toEqual([123]);
    limited = false; await vi.advanceTimersByTimeAsync(60_000);
    expect((await service.get({ ...item, externalIds: { mal: 124 } }, bgm, true)).sources.find(source => source.provider === 'mal')).toMatchObject({ score: 8, status: 'ready' }); expect(ids).toEqual([123, 124]);
  });
});

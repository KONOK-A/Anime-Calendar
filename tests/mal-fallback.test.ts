import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MultiRatingService, ratingCacheKey } from '../server/multi-ratings';
import { CacheStore } from '../server/cache';
import { UpstreamClient } from '../server/upstream';
const directories: string[] = [], services: MultiRatingService[] = [];
afterEach(async () => { for (const service of services.splice(0)) { await service.drain(); service.close(); } for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
it('没有官方客户端凭据时直接读取MAL作品聚合分，不调用已停运的Jikan公共接口', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mal-public-rating-')); directories.push(directory);
  const calls: string[] = [], upstream = new UpstreamClient(async url => {
    calls.push(url);
    if (url !== 'https://myanimelist.net/anime/59787') throw new Error('Unexpected score source');
    return new Response('<html><head><link rel="canonical" href="https://myanimelist.net/anime/59787/Romelia_Senki"></head><body><div itemprop="aggregateRating" itemscope itemtype="http://schema.org/AggregateRating"><span itemprop="ratingValue">7.26</span><span itemprop="ratingCount">3717</span></div></body></html>');
  });
  const service = new MultiRatingService({ store: new CacheStore(directory), upstream, now: () => new Date('2026-10-31T00:00:00Z') }); services.push(service);
  const result = await service.get({ id: 'bgm:511936', bangumiId: 511936, externalIds: { mal: 59787 } }, { rating: { score: 6.5, total: 355, rank: null }, fetchedAt: '2026-10-31T00:00:00Z' }, true);
  expect(result.sources.find(source => source.provider === 'mal')).toMatchObject({ score: 7.26, votes: 3717, status: 'ready' });
  expect(calls).toEqual(['https://myanimelist.net/anime/59787']);
  expect(result).toMatchObject({ count: 2, score: 6.9 });
});
it('MAL返回只有canonical的页面壳时保留旧分，不将结构缺失缓存成未评分', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mal-partial-page-')); directories.push(directory);
  const store = new CacheStore(directory), url = 'https://myanimelist.net/anime/59787', fetchedAt = '2026-10-29T00:00:00Z';
  await store.write(ratingCacheKey('mal', url), { provider: 'mal', score: 7.26, maxScore: 10, votes: 3717, url, fetchedAt, status: 'ready' }, fetchedAt);
  const upstream = new UpstreamClient(async () => new Response('<html><head><link rel="canonical" href="https://myanimelist.net/anime/59787/Romelia_Senki"></head></html>'));
  const service = new MultiRatingService({ store, upstream, now: () => new Date('2026-10-31T00:00:00Z') }); services.push(service);
  const result = await service.get({ id: 'bgm:511936', bangumiId: 511936, externalIds: { mal: 59787 } }, { rating: null, fetchedAt: null }, true);
  expect(result.sources.find(source => source.provider === 'mal')).toMatchObject({ score: 7.26, votes: 3717, fetchedAt, status: 'ready', error: expect.any(String) });
  const stored = await store.read(ratingCacheKey('mal', url), value => value as { score: number });
  expect(stored).toMatchObject({ fetchedAt, data: { score: 7.26 } });
});

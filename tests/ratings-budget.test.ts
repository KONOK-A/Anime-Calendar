import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnimeService } from '../server/service';
import type { AnimeDetail } from '../shared/types';
import { MultiRatingService } from '../server/multi-ratings';
import { summarizeRatings } from '../shared/scores';
import { rawCalendar, rawCatalog } from './fixtures';
const directories: string[] = [], services: AnimeService[] = [], releases: (() => void)[] = [];
afterEach(async () => {
  releases.splice(0).forEach(release => release()); await Promise.resolve();
  for (const service of services.splice(0)) { service.close(); await service.drain(); }
  vi.restoreAllMocks(); vi.useRealTimers();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function setup(withMal = false) {
  const directory = await mkdtemp(join(tmpdir(), 'rating-budget-')); directories.push(directory);
  const catalog = structuredClone(rawCatalog); if (withMal) catalog.items[0]!.sites.push({ site: 'mal', id: '123' });
  let now = new Date('2026-10-31T00:00:00Z');
  const service = new AnimeService({ directory, now: () => now, fetcher: async url => Response.json(url.includes('/subjects/') ? { id: 1, name: '星旅', rating: { score: 8, total: 50 } } : url.includes('/calendar') ? rawCalendar : catalog) });
  services.push(service); await service.initialize(); await service.refresh();
  const detail: AnimeDetail = { ...service.item('bgm:1')!, summary: '', image: null, episodes: null, tags: [], staff: [], rating: { score: 8, total: 50, rank: null }, detailFetchedAt: '2026-10-31T00:00:00Z', detailError: null };
  return { service, detail, advance: () => { now = new Date('2026-11-02T00:00:00Z'); } };
}
describe('评分服务完整等待预算', () => {
  it('保留get返回的队列满临时提示，不被内存快照丢弃', async () => {
    const { service } = await setup(true); const detail = await service.detail('bgm:1');
    const sources = (service as unknown as { ratingSources: MultiRatingService }).ratingSources;
    const value = sources.peekKnown(service.item('bgm:1')!, { rating: detail!.rating, fetchedAt: detail!.detailFetchedAt });
    const full = { ...summarizeRatings(value.sources.map(source => source.provider === 'mal' ? { ...source, error: '评分更新任务较多，请稍后重试。' } : source)), retryAfterMs: 1000 };
    vi.spyOn(sources, 'get').mockResolvedValue(full);
    const result = await service.ratings('bgm:1', true);
    expect(result?.sources.find(source => source.provider === 'mal')).toMatchObject({ status: 'unavailable', error: '评分更新任务较多，请稍后重试。' });
    expect(result?.retryAfterMs).toBe(1000);
  });
  it('成功确认无分但仅保存失败时不复活旧分，仍复用新元数据', async () => {
    const { service, detail, advance } = await setup(); await service.detail('bgm:1'); advance();
    const latest = { ...detail, rating: null, detailFetchedAt: '2026-11-02T00:00:00Z', detailError: '资料已更新，但缓存未保存。', detailFetchFailed: false };
    const read = vi.spyOn(service, 'detail').mockResolvedValue(latest);
    const result = await service.ratings('bgm:1', true);
    expect(result).toMatchObject({ score: null, count: 0 });
    expect(result?.sources.find(source => source.provider === 'bangumi')).toMatchObject({ status: 'unrated', fetchedAt: latest.detailFetchedAt });
    await service.ratings('bgm:1', true); expect(read).toHaveBeenCalledTimes(1);
  });
  it('非等待请求不被冷元数据阻塞，完成后复用同一结果', async () => {
    const { service, detail } = await setup(); vi.useFakeTimers();
    const metadata = new Promise<AnimeDetail>(resolve => releases.push(() => resolve(detail)));
    const read = vi.spyOn(service, 'detail').mockReturnValue(metadata);
    let answered = false;
    const first = service.ratings('bgm:1').then(value => { answered = true; return value; });
    await vi.advanceTimersByTimeAsync(1);
    expect(answered).toBe(true); expect(await first).toMatchObject({ revalidating: true });
    releases.splice(0).forEach(release => release()); await metadata; await vi.advanceTimersByTimeAsync(1);
    expect(await service.ratings('bgm:1', true)).toMatchObject({ score: 8, count: 1 });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('整体15秒到期返回可用状态，不取消共享元数据任务', async () => {
    const { service, detail } = await setup(); vi.useFakeTimers();
    const metadata = new Promise<AnimeDetail>(resolve => releases.push(() => resolve(detail)));
    const read = vi.spyOn(service, 'detail').mockReturnValue(metadata);
    let answer: unknown;
    const request = service.ratings('bgm:1', true).then(value => { answer = value; });
    await vi.advanceTimersByTimeAsync(15_001);
    expect(answer).toMatchObject({ revalidating: true });
    releases.splice(0).forEach(release => release()); await metadata; await vi.advanceTimersByTimeAsync(1); await request;
    expect(await service.ratings('bgm:1', true)).toMatchObject({ score: 8 }); expect(read).toHaveBeenCalledTimes(1);
  });
  it('元数据与外站确认并行，不叠加为两段等待', async () => {
    const { service, detail } = await setup(); vi.useFakeTimers();
    vi.spyOn(service, 'detail').mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(detail), 10_000)));
    const sources = (service as unknown as { ratingSources: MultiRatingService }).ratingSources, get = sources.get.bind(sources);
    vi.spyOn(sources, 'get').mockImplementation(async (...args) => { await new Promise(resolve => setTimeout(resolve, 10_000)); return get(...args); });
    let answer: unknown;
    const request = service.ratings('bgm:1', true).then(value => { answer = value; });
    await vi.advanceTimersByTimeAsync(10_001);
    expect(answer).toMatchObject({ score: 8, count: 1 });
    await vi.advanceTimersByTimeAsync(20_000); await request;
  });
  it('热评分请求复用已经解析的元数据，并隔离调用者修改', async () => {
    const { service } = await setup();
    const detail = await service.detail('bgm:1'); detail!.rating!.score = 1;
    const read = vi.spyOn(service, 'detail');
    for (let i = 0; i < 10; i++) expect(await service.ratings('bgm:1', true)).toMatchObject({ score: 8, count: 1 });
    expect(read).not.toHaveBeenCalled();
  });
});

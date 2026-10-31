import { afterEach, describe, expect, it, vi } from 'vitest';
import { SeasonRatingService } from '../server/season-ratings.js';
import type { Anime, AnimeDetail } from '../shared/types';
import { summarizeRatings, type RatingSummary } from '../shared/scores';

const items = Array.from({ length: 3 }, (_, index) => ({ id: `bgm:${index + 1}`, bangumiId: index + 1 }) as Anime);
const detail = (id: string): AnimeDetail => ({ id, rating: { score: 7, total: 10, rank: null }, detailFetchedAt: new Date().toISOString(), detailError: null, revalidating: false }) as AnimeDetail;
const summary = (revalidating = false, error?: string): RatingSummary => summarizeRatings([{ provider: 'mal', score: error ? null : 8, maxScore: 10, votes: null, url: null, fetchedAt: error ? null : new Date().toISOString(), status: error ? 'unavailable' : 'ready', ...(error ? { error } : {}) }], undefined, revalidating);
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

describe('季度评分快照窗口继续复用进度', () => {
  it('首次摘要尚未返回的metadata不提前算入完整可发布快照', async () => {
    vi.useFakeTimers(); let release!: () => void;
    const service = new SeasonRatingService(async id => detail(id), () => new Date(), { summary: async id => {
      if (id === 'bgm:2') await new Promise<void>(resolve => { release = resolve; });
      return summary();
    } });
    service.get('season', items.slice(0, 2)); await flush();
    const loading = service.get('season', items.slice(0, 2));
    expect(loading).toMatchObject({ status: 'loading', processed: 1, entries: [expect.objectContaining({ id: 'bgm:1', summary: expect.objectContaining({ score: 8 }) })] });
    release(); await service.drain();
    expect(service.get('season', items.slice(0, 2))).toMatchObject({ status: 'ready', processed: 2 });
  });

  it('首次详情的小状态传给摘要，revision静默期间不重查详情或摘要', async () => {
    vi.useFakeTimers(); let revision = 0, reads = 0, details = 0;
    const received: unknown[] = [];
    const service = new SeasonRatingService(async id => { details++; return { ...detail(id), detailFetchFailed: false }; }, () => new Date(), {
      revision: () => revision,
      summary: async (_id, state) => { reads++; received.push(state); return summary(revision === 0); },
    });
    service.get('season', items.slice(0, 1)); await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect({ reads, details }).toEqual({ reads: 1, details: 1 });
    expect(received[0]).toMatchObject({ rating: { score: 7 }, detailError: null, detailFetchFailed: false, revalidating: false });
    revision++; await vi.advanceTimersByTimeAsync(1000); await service.drain();
    expect(service.get('season', items.slice(0, 1))).toMatchObject({ status: 'ready', entries: [expect.objectContaining({ summary: expect.objectContaining({ score: 8 }) })] });
    expect({ reads, details }).toEqual({ reads: 2, details: 1 });
  });

  it('partial冷却后复用已完成详情和来源任务，第二个窗口取得后台结果', async () => {
    vi.useFakeTimers(); let revision = 0, details = 0;
    const service = new SeasonRatingService(async id => { details++; return detail(id); }, () => new Date(), { budgetMs: 20, revision: () => revision, summary: async () => summary(revision === 0) });
    service.get('season', items.slice(0, 1)); await flush(); await vi.advanceTimersByTimeAsync(20);
    expect(service.get('season', items.slice(0, 1)).status).toBe('partial');
    revision++; await vi.advanceTimersByTimeAsync(60_001);
    const resumed = service.get('season', items.slice(0, 1));
    expect(resumed).toMatchObject({ status: 'loading', processed: 1, entries: [expect.objectContaining({ rating: expect.objectContaining({ score: 7 }) })] });
    await service.drain();
    expect(service.get('season', items.slice(0, 1)).status).toBe('ready');
    expect(details).toBe(1);
  });

  it('partial冷却内来源revision有进度立即复用新窗口，无进度仍保留冷却', async () => {
    vi.useFakeTimers(); let revision = 0, details = 0, reads = 0;
    const service = new SeasonRatingService(async id => { details++; return detail(id); }, () => new Date(), { budgetMs: 20, revision: () => revision, summary: async () => { reads++; return summary(revision === 0); } });
    service.get('season', items.slice(0, 1)); await flush(); await vi.advanceTimersByTimeAsync(20);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(service.get('season', items.slice(0, 1)).status).toBe('partial'); expect(reads).toBe(1);
    revision++;
    expect(service.get('season', items.slice(0, 1)).status).toBe('loading');
    service.get('season', items.slice(0, 1)); await service.drain();
    expect(service.get('season', items.slice(0, 1))).toMatchObject({ status: 'ready', entries: [expect.objectContaining({ summary: expect.objectContaining({ score: 8 }) })] });
    expect({ details, reads }).toEqual({ details: 1, reads: 2 });
  });

  it('没有外源revision时迟到的metadata也可在partial冷却内立即复用', async () => {
    vi.useFakeTimers(); let release!: () => void, details = 0;
    const service = new SeasonRatingService(async id => { details++; await new Promise<void>(resolve => { release = resolve; }); return detail(id); }, () => new Date(), { budgetMs: 20 });
    service.get('season', items.slice(0, 1)); await vi.advanceTimersByTimeAsync(20);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(service.get('season', items.slice(0, 1)).status).toBe('partial');
    release(); await service.drain();
    expect(service.get('season', items.slice(0, 1)).status).toBe('loading'); await service.drain();
    expect(service.get('season', items.slice(0, 1))).toMatchObject({ status: 'ready', entries: [expect.objectContaining({ rating: expect.objectContaining({ score: 7 }) })] });
    expect(details).toBe(1);
  });

  it('有新来源进度重开窗口时，其他真实失败仍遵守原60秒冷却', async () => {
    vi.useFakeTimers(); let revision = 0; const reads = new Map<string, number>();
    const service = new SeasonRatingService(async id => detail(id), () => new Date(), { budgetMs: 20, revision: () => revision, summary: async id => {
      reads.set(id, (reads.get(id) ?? 0) + 1);
      return id === 'bgm:1' ? summary(false, '评分更新失败，可稍后重试。') : summary(revision === 0);
    } });
    service.get('season', items.slice(0, 2)); await flush(); await vi.advanceTimersByTimeAsync(20);
    await vi.advanceTimersByTimeAsync(30_000); revision++;
    service.get('season', items.slice(0, 2)); await service.drain();
    expect(service.get('season', items.slice(0, 2)).status).toBe('partial');
    expect([...reads.values()]).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(30_001); service.get('season', items.slice(0, 2)); await service.drain();
    expect([...reads.values()]).toEqual([2, 2]);
  });

  it('窗口超时的metadata继续占容量，新窗口复用进行中的两部且不覆盖新快照', async () => {
    vi.useFakeTimers(); let details = 0; const releases: (() => void)[] = [];
    const service = new SeasonRatingService(async id => { details++; await new Promise<void>(resolve => releases.push(resolve)); return detail(id); }, () => new Date(), { budgetMs: 20 });
    for (let index = 0; index < 8; index++) service.get(`season-${index}`, items.slice(0, 2));
    await vi.advanceTimersByTimeAsync(60_021);
    expect(() => service.get('ninth', items)).toThrow();
    expect(service.get('season-0', items.slice(0, 2)).status).toBe('loading'); await flush();
    expect(details).toBe(16);
    releases.forEach(release => release()); await service.drain();
    expect(service.get('season-0', items.slice(0, 2))).toMatchObject({ status: 'ready', processed: 2 });
    expect(details).toBe(16);
  });

  it('超时前已取得的metadata结果留给新窗口，不重取已完成或进行中的作品', async () => {
    vi.useFakeTimers(); const calls: string[] = []; let release!: () => void;
    const service = new SeasonRatingService(async id => { calls.push(id); if (id === 'bgm:2' && !release) await new Promise<void>(resolve => { release = resolve; }); return detail(id); }, () => new Date(), { budgetMs: 20 });
    service.get('season', items); await flush(); await vi.advanceTimersByTimeAsync(20);
    release(); await service.drain();
    await vi.advanceTimersByTimeAsync(60_001); service.get('season', items); await service.drain();
    expect(calls).toEqual(['bgm:1', 'bgm:2', 'bgm:3']);
    expect(service.get('season', items)).toMatchObject({ status: 'ready', processed: 3 });
  });

  it('队列满的未提交来源在revision释放后继续尝试，真实失败不会跟着无穷重试', async () => {
    vi.useFakeTimers(); let revision = 0; const reads = new Map<string, number>();
    const service = new SeasonRatingService(async id => detail(id), () => new Date(), { revision: () => revision, summary: async id => {
      reads.set(id, (reads.get(id) ?? 0) + 1);
      return id === 'bgm:1' ? summary(false, '评分更新失败，可稍后重试。') : revision === 0 ? summary(false, '评分更新任务较多，请稍后重试。') : summary();
    } });
    service.get('season', items.slice(0, 2)); await flush();
    expect(service.get('season', items.slice(0, 2)).status).toBe('loading');
    await vi.advanceTimersByTimeAsync(5000); expect([...reads.values()]).toEqual([1, 1]);
    revision++; await vi.advanceTimersByTimeAsync(1000); await service.drain();
    expect(service.get('season', items.slice(0, 2))).toMatchObject({ status: 'partial', entries: [expect.objectContaining({ error: expect.any(String) }), expect.objectContaining({ error: null })] });
    expect([...reads.values()]).toEqual([1, 2]);
  });

  it('带旧可用分的失败摘要在冷却后重新检查，不能被新鲜BG状态掩盖错误', async () => {
    vi.useFakeTimers(); let reads = 0;
    const cached = summary(); cached.sources[0]!.error = '评分更新失败，可稍后重试。';
    const service = new SeasonRatingService(async id => detail(id), () => new Date(), { summary: async () => ++reads === 1 ? cached : summary() });
    service.get('season', items.slice(0, 1)); await service.drain();
    expect(service.get('season', items.slice(0, 1)).status).toBe('partial');
    await vi.advanceTimersByTimeAsync(60_001); service.get('season', items.slice(0, 1)); await service.drain();
    const result = service.get('season', items.slice(0, 1));
    expect(result).toMatchObject({ status: 'ready', entries: [expect.objectContaining({ summary: expect.objectContaining({ score: 8 }) })] });
    expect(result.entries[0]!.summary!.sources[0]!.error).toBeUndefined();
    expect(reads).toBe(2);
  });

  it('BG过期后确认无评分时不继续沿用旧分', async () => {
    vi.useFakeTimers(); let calls = 0;
    const service = new SeasonRatingService(async id => ({ ...detail(id), rating: ++calls === 1 ? detail(id).rating : null }), () => new Date());
    service.get('season', items.slice(0, 1)); await service.drain();
    await vi.advanceTimersByTimeAsync(24 * 3_600_000 + 1);
    service.get('season', items.slice(0, 1)); await service.drain();
    expect(service.get('season', items.slice(0, 1)).entries[0]!.rating).toBeNull();
  });

  it('BG过期后刷新失败且没有新分时保留旧可用分并标明失败', async () => {
    vi.useFakeTimers(); let calls = 0;
    const service = new SeasonRatingService(async id => ++calls === 1 ? detail(id) : { ...detail(id), rating: null, detailError: 'network error' }, () => new Date());
    service.get('season', items.slice(0, 1)); await service.drain();
    await vi.advanceTimersByTimeAsync(24 * 3_600_000 + 1);
    service.get('season', items.slice(0, 1)); await service.drain();
    expect(service.get('season', items.slice(0, 1))).toMatchObject({ status: 'partial', entries: [expect.objectContaining({ rating: expect.objectContaining({ score: 7 }), error: 'network error' })] });
  });

  it('BG成功确认无评分但缓存保存失败时清除旧分，错误提示不复活旧分', async () => {
    vi.useFakeTimers(); let calls = 0;
    const service = new SeasonRatingService(async id => ++calls === 1 ? detail(id) : { ...detail(id), rating: null, detailError: '资料已更新，但缓存未保存。', detailFetchFailed: false }, () => new Date());
    service.get('season', items.slice(0, 1)); await service.drain();
    await vi.advanceTimersByTimeAsync(24 * 3_600_000 + 1);
    service.get('season', items.slice(0, 1)); await service.drain();
    expect(service.get('season', items.slice(0, 1))).toMatchObject({ status: 'partial', entries: [expect.objectContaining({ rating: null, error: '资料已更新，但缓存未保存。' })] });
  });

  it('close解除静默等待，drain无需等完整窗口', async () => {
    vi.useFakeTimers(); const service = new SeasonRatingService(async id => detail(id), () => new Date(), { revision: () => 0, summary: async () => summary(true) });
    service.get('season', items.slice(0, 1)); await flush(); service.close();
    let drained = false; const draining = service.drain().then(() => { drained = true; });
    await flush(); expect(drained).toBe(true); await draining;
    expect(() => service.get('season', items)).toThrow();
  });
});

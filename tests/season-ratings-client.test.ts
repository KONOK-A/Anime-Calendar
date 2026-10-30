import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSeasonRatings } from '../src/season-ratings';
import { DataCache } from '../src/data-cache';
import { isSeasonRatings } from '../shared/ratings';
import type { SeasonRatings } from '../shared/types';
const snapshot = (season = '2026-4'): SeasonRatings => ({ schemaVersion: 1, scope: { type: 'ratings', key: `ratings:${season}`, season }, ids: ['bgm:1'], entries: [{ id: 'bgm:1', rating: { score: 8, total: 20, rank: null }, fetchedAt: '2026-10-30T00:00:00Z', error: null }], total: 1, processed: 1, status: 'ready', updatedAt: '2026-10-30T00:00:00Z' });
afterEach(() => vi.useRealTimers());
describe('评分摘要加载与缓存', () => {
  it('优先展示完整缓存，后台失败仍保留评分', async () => {
    const cache = new DataCache(() => {}, undefined); await cache.write('views', 'ratings:2026-4', snapshot(), null);
    let reject!: (error: Error) => void;
    const loader = createSeasonRatings(cache, async () => new Promise((_, no) => { reject = no; }));
    await loader.load('2026-4', ['bgm:1']); expect(loader.snapshot.value?.entries[0]?.rating?.score).toBe(8);
    reject(new Error('offline')); await vi.waitFor(() => expect(loader.loading.value).toBe(false));
    expect(loader.error.value).toContain('offline'); expect(loader.snapshot.value?.entries[0]?.rating?.score).toBe(8);
  });
  it('只在完整结果到达后应用排名，取消会停止轮询', async () => {
    vi.useFakeTimers(); const cache = new DataCache(() => {}, undefined);
    const fetcher = vi.fn(async () => Response.json({ ...snapshot(), status: 'loading', processed: 0, entries: [], updatedAt: null }));
    const loader = createSeasonRatings(cache, fetcher); const task = loader.load('2026-4', ['bgm:1']);
    await vi.advanceTimersByTimeAsync(10); expect(loader.snapshot.value).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
    loader.cancel(); await task; await vi.advanceTimersByTimeAsync(2000); expect(fetcher).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('旧页面卸载不会取消新季度的请求，迟到响应也不覆盖新季度', async () => {
    const cache = new DataCache(() => {}, undefined); let old!: (response: Response) => void, current!: (response: Response) => void;
    const loader = createSeasonRatings(cache, async input => new Promise(resolve => { if (String(input).includes('2025-4')) old = resolve; else current = resolve; }));
    const oldOwner = {}, newOwner = {};
    const first = loader.load('2025-4', ['bgm:1'], oldOwner); await vi.waitFor(() => expect(old).toBeTypeOf('function'));
    const second = loader.load('2026-4', ['bgm:1'], newOwner); loader.cancel(oldOwner); await vi.waitFor(() => expect(current).toBeTypeOf('function'));
    current(Response.json(snapshot())); await second; old(Response.json(snapshot('2025-4'))); await first;
    expect(loader.snapshot.value?.scope.season).toBe('2026-4'); expect(loader.error.value).toBeNull();
  });
  it('无效摘要、重复ID和其他季度不会被当成有效评分', () => {
    expect(isSeasonRatings(snapshot())).toBe(true);
    expect(isSeasonRatings({ ...snapshot(), entries: [] })).toBe(false);
    expect(isSeasonRatings({ ...snapshot(), ids: ['bgm:1', 'bgm:1'], total: 2 })).toBe(false);
    expect(isSeasonRatings({ ...snapshot(), entries: [{ ...snapshot().entries[0], rating: { score: 11, total: 20, rank: null } }] })).toBe(false);
  });
});

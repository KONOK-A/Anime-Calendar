import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSeasonRatings } from '../src/season-ratings';
import { DataCache } from '../src/data-cache';
import { isSeasonRatings } from '../shared/ratings';
import type { SeasonRatings } from '../shared/types';
import { summarizeRatings } from '../shared/scores';
import { sortSeasonAnime } from '../src/season-sort';
import type { Anime } from '../shared/types';
const snapshot = (season = '2026-4'): SeasonRatings => ({ schemaVersion: 1, scope: { type: 'ratings', key: `ratings:${season}`, season }, ids: ['bgm:1'], entries: [{ id: 'bgm:1', rating: { score: 8, total: 20, rank: null }, fetchedAt: '2026-10-30T00:00:00Z', error: null }], total: 1, processed: 1, status: 'ready', updatedAt: '2026-10-30T00:00:00Z' });
afterEach(() => vi.useRealTimers());
describe('评分摘要加载与缓存', () => {
  it('季度作品ID未变但外站关联改变时重新读取，不复用旧排序或旧摘要', async () => {
    const cache = new DataCache(() => {}, undefined), owner = {};
    const oldItem = { id: 'bgm:1', externalIds: { mal: 1 } }, currentItem = { id: 'bgm:1', externalIds: { mal: 2 } };
    const value = (id: number): SeasonRatings => ({ ...snapshot(), entries: [{ ...snapshot().entries[0]!, summary: summarizeRatings([{ provider: 'mal', score: id === 1 ? 7 : 9, maxScore: 10, votes: 100, url: `https://myanimelist.net/anime/${id}`, fetchedAt: null, status: 'ready' }]) }] });
    let next!: (response: Response) => void, calls = 0;
    const loader = createSeasonRatings(cache, async () => ++calls === 1 ? Response.json(value(1)) : new Promise<Response>(resolve => { next = resolve; }));
    await loader.load('2026-4', ['bgm:1'], owner, [oldItem]); await vi.waitFor(() => expect(loader.loading.value).toBe(false));
    expect(loader.snapshot.value?.entries[0]?.summary?.score).toBe(7);
    const task = loader.load('2026-4', ['bgm:1'], owner, [currentItem]); await vi.waitFor(() => expect(next).toBeTypeOf('function'));
    expect(loader.snapshot.value).toBeNull();
    next(Response.json(value(2))); await task; expect(loader.snapshot.value?.entries[0]?.summary?.score).toBe(9);
  });
  it('新关联季度不会从持久缓存恢复旧未关联摘要，旧请求迟到也不能覆盖当前身份', async () => {
    const cache = new DataCache(() => {}, undefined), owner = {};
    const oldValue: SeasonRatings = { ...snapshot(), entries: [{ ...snapshot().entries[0]!, summary: summarizeRatings([{ provider: 'mal', score: null, maxScore: 10, votes: null, url: null, fetchedAt: null, status: 'unlinked' }]) }] };
    await cache.write('views', 'ratings:2026-4', oldValue, null);
    let old!: (response: Response) => void, latest!: (response: Response) => void, calls = 0;
    const loader = createSeasonRatings(cache, async () => new Promise<Response>(resolve => { if (++calls === 1) old = resolve; else latest = resolve; }));
    const first = loader.load('2026-4', ['bgm:1'], owner); await vi.waitFor(() => expect(old).toBeTypeOf('function'));
    const current = loader.load('2026-4', ['bgm:1'], owner, [{ id: 'bgm:1', externalIds: { mal: 2 } }]); await vi.waitFor(() => expect(latest).toBeTypeOf('function'));
    expect(loader.snapshot.value).toBeNull();
    const updated: SeasonRatings = { ...snapshot(), entries: [{ ...snapshot().entries[0]!, summary: summarizeRatings([{ provider: 'mal', score: 9, maxScore: 10, votes: 100, url: 'https://myanimelist.net/anime/2', fetchedAt: null, status: 'ready' }]) }] };
    latest(Response.json(updated)); await current; old(Response.json(oldValue)); await first;
    expect(loader.snapshot.value?.entries[0]?.summary?.score).toBe(9);
  });
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
  it('完整综合分快照在loading时即可展示，继续轮询直到终态', async () => {
    vi.useFakeTimers(); const cache = new DataCache(() => {}, undefined);
    const value = { ...snapshot(), entries: [{ ...snapshot().entries[0]!, summary: summarizeRatings([{ provider: 'filmarks', score: 4.3, maxScore: 5, votes: null, url: null, fetchedAt: null, status: 'ready' }]) }] };
    let calls = 0;
    const loader = createSeasonRatings(cache, async () => Response.json({ ...value, status: ++calls === 1 ? 'loading' : 'ready' }));
    const ready = loader.load('2026-4', ['bgm:1']); await vi.advanceTimersByTimeAsync(10);
    expect(loader.snapshot.value?.entries[0]?.summary?.score).toBe(8.6); expect(loader.loading.value).toBe(true);
    await ready; await vi.advanceTimersByTimeAsync(1000);
    expect(loader.loading.value).toBe(false); expect(calls).toBe(2);
  });
  it('拒绝伪造综合分，并且旧来源时间的回退结果不覆盖当前快照', async () => {
    const good = summarizeRatings([{ provider: 'filmarks', score: 4.3, maxScore: 5, votes: null, url: null, fetchedAt: '2026-10-31T00:00:00Z', status: 'ready' }]);
    expect(isSeasonRatings({ ...snapshot(), entries: [{ ...snapshot().entries[0], summary: { ...good, score: 10 } }] })).toBe(false);
    const cache = new DataCache(() => {}, undefined);
    const cached = { ...snapshot(), updatedAt: '2026-10-31T00:00:00Z', entries: [{ ...snapshot().entries[0]!, summary: good }] };
    await cache.write('views', 'ratings:2026-4', cached, null);
    const loader = createSeasonRatings(cache, async () => Response.json(snapshot()));
    await loader.load('2026-4', ['bgm:1']); await vi.waitFor(() => expect(loader.loading.value).toBe(false));
    expect(loader.snapshot.value?.entries[0]?.summary?.score).toBe(8.6);
  });
  it('预算到期的完整partial快照即使尚未处理全部ID也展示可用分', async () => {
    const cache = new DataCache(() => {}, undefined);
    const partial = { ...snapshot(), ids: ['bgm:1', 'bgm:2'], total: 2, processed: 1, status: 'partial', entries: [...snapshot().entries, { id: 'bgm:2', rating: null, fetchedAt: null, error: '来源超时' }] };
    const loader = createSeasonRatings(cache, async () => Response.json(partial));
    await loader.load('2026-4', ['bgm:1', 'bgm:2']);
    expect(loader.snapshot.value?.entries[0]?.rating?.score).toBe(8); expect(loader.snapshot.value?.entries).toHaveLength(2); expect(loader.error.value).toContain('部分');
  });
  it.each([false, true])('更新过程中固定首份完整排名，终态才整体换分（已有缓存=%s）', async cached => {
    vi.useFakeTimers(); const cache = new DataCache(() => {}, undefined);
    const list = [{ id: 'bgm:1', begin: '2026-10-01' }, { id: 'bgm:2', begin: '2026-10-02' }] as Anime[];
    const value = (first: number, status: SeasonRatings['status'], second: number): SeasonRatings => ({ ...snapshot(), ids: ['bgm:1', 'bgm:2'], total: 2, processed: 2, status, updatedAt: `2026-10-30T00:00:0${second}Z`, entries: [first, 8].map((score, index) => ({ ...snapshot().entries[0]!, id: `bgm:${index + 1}`, summary: summarizeRatings([{ provider: 'filmarks', score: score / 2, maxScore: 5, votes: null, url: null, fetchedAt: null, status: 'ready' }]) })) });
    if (cached) await cache.write('views', 'ratings:2026-4', value(9, 'ready', 0), null);
    const rounds = cached ? [value(7, 'loading', 1), value(6, 'loading', 2), value(7, 'ready', 3)] : [value(9, 'loading', 0), value(7, 'loading', 1), value(7, 'ready', 2)];
    let calls = 0;
    const loader = createSeasonRatings(cache, async () => Response.json(rounds[calls++]));
    const order = () => sortSeasonAnime(list, 'rating', new Map(loader.snapshot.value?.entries.map(entry => [entry.id, entry.summary ?? null]))).map(item => item.id);
    const ready = loader.load('2026-4', ['bgm:1', 'bgm:2']); await vi.advanceTimersByTimeAsync(10); await ready;
    expect(order()).toEqual(['bgm:1', 'bgm:2']); expect(loader.snapshot.value?.entries[0]?.summary?.score).toBe(9);
    const displayed = loader.snapshot.value;
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2); expect(loader.snapshot.value).toBe(displayed); expect(order()).toEqual(['bgm:1', 'bgm:2']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(loader.loading.value).toBe(false); expect(order()).toEqual(['bgm:2', 'bgm:1']); expect(loader.snapshot.value?.entries[0]?.summary?.score).toBe(7);
  });
});

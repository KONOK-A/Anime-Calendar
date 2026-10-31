import { afterEach, describe, expect, it, vi } from 'vitest';
import { SeasonRatingService } from '../server/season-ratings.js';
import type { Anime, AnimeDetail } from '../shared/types';
import { summarizeRatings, type RatingSummary } from '../shared/scores';
const items = Array.from({ length: 5 }, (_, index) => ({ id: `bgm:${index + 1}`, bangumiId: index + 1, season: '2026-4' }) as Anime);
const detail = (id: string) => ({ id, rating: { score: Number(id.split(':')[1]) + 5, total: 10, rank: null }, detailFetchedAt: '2026-10-30T00:00:00Z', detailError: null }) as AnimeDetail;
const summary = (score: number, revalidating = false): RatingSummary => summarizeRatings([{ provider: 'filmarks', score: score / 2, maxScore: 5, votes: null, url: null, fetchedAt: '2026-10-30T00:00:00Z', status: 'ready' }], undefined, revalidating);
afterEach(() => vi.useRealTimers());
describe('按需季度评分摘要', () => {
  it('同季度并发读取复用任务，至多两部并行，只返回评分不返回详情', async () => {
    let active = 0, peak = 0, calls = 0;
    const service = new SeasonRatingService(async id => { calls++; peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return detail(id); }, () => new Date('2026-10-30T00:00:00Z'));
    const first = service.get('2026-4', items); expect(first.status).toBe('loading');
    service.get('2026-4', items); await service.drain();
    const result = service.get('2026-4', items);
    expect(result.status).toBe('ready'); expect(result.entries).toHaveLength(5); expect(calls).toBe(5); expect(peak).toBe(2);
    expect(result.entries[0]).not.toHaveProperty('summary'); expect(result.entries[0]).not.toHaveProperty('image');
  });
  it('单部失败保留可用旧分，缺少关联明确无评分，失败不删作品', async () => {
    const service = new SeasonRatingService(async id => ({ ...detail(id), detailError: id === 'bgm:2' ? 'network error' : null }), () => new Date('2026-10-30T00:00:00Z'));
    const list = [...items.slice(0, 2), { ...items[0]!, id: 'bd:unlinked', bangumiId: null }];
    service.get('2026-4', list); await service.drain(); const result = service.get('2026-4', list);
    expect(result.status).toBe('partial'); expect(result.entries).toHaveLength(3);
    expect(result.entries.find(item => item.id === 'bgm:2')).toMatchObject({ rating: { score: 7 }, error: expect.any(String) });
    expect(result.entries.find(item => item.id === 'bd:unlinked')).toMatchObject({ rating: null, error: null });
  });
  it('过期依据来源获取时间，作品集合变化后不复用旧季度结果', async () => {
    let now = new Date('2026-10-30T23:00:00Z'); const fetcher = vi.fn(async id => detail(id));
    const service = new SeasonRatingService(fetcher, () => now);
    service.get('2026-4', items); await service.drain(); expect(fetcher).toHaveBeenCalledTimes(5);
    now = new Date('2026-10-31T00:00:01Z'); service.get('2026-4', items); await service.drain(); expect(fetcher).toHaveBeenCalledTimes(10);
    service.get('2026-4', items.slice(0, 1)); await service.drain(); expect(service.get('2026-4', items.slice(0, 1)).ids).toEqual(['bgm:1']);
  });
  it('总预算到期返回明确的部分结果，关闭后不启动新任务', async () => {
    const releases: (() => void)[] = [];
    const service = new SeasonRatingService(async id => { await new Promise<void>(resolve => releases.push(resolve)); return detail(id); }, () => new Date(), { budgetMs: 20 });
    service.get('2026-4', items); await new Promise(resolve => setTimeout(resolve, 30));
    try { expect(service.get('2026-4', items)).toMatchObject({ status: 'partial', total: 5, processed: 0 }); service.close(); expect(() => service.get('2026-3', items)).toThrow(); }
    finally { releases.forEach(release => release()); await service.drain(); }
  });
  it('同批一项已返回、另一项超时时保留已取得分数与进度', async () => {
    let release!: () => void;
    const service = new SeasonRatingService(async id => { if (id === 'bgm:2') await new Promise<void>(resolve => { release = resolve; }); return detail(id); }, () => new Date(), { budgetMs: 20 });
    service.get('2026-4', items.slice(0, 2)); await new Promise(resolve => setTimeout(resolve, 30));
    try { const result = service.get('2026-4', items.slice(0, 2)); expect(result).toMatchObject({ status: 'partial', processed: 1 }); expect(result.entries.find(entry => entry.id === 'bgm:1')).toMatchObject({ rating: { score: 6 }, error: null }); }
    finally { release(); await service.drain(); }
  });
  it('预算已结束但来源尚未完成的任务继续占位，空季度不占任务名额', async () => {
    const releases: (() => void)[] = [];
    const service = new SeasonRatingService(async id => { await new Promise<void>(resolve => releases.push(resolve)); return detail(id); }, () => new Date(), { budgetMs: 20 });
    for (let index = 0; index < 8; index++) service.get(`season-${index}`, items.slice(0, 2));
    await new Promise(resolve => setTimeout(resolve, 30));
    try { expect(() => service.get('ninth', items.slice(0, 2))).toThrow(); expect(service.get('empty', [])).toMatchObject({ status: 'ready', total: 0 }); }
    finally { releases.forEach(release => release()); await service.drain(); }
  });
  it('先发布整季可用综合分，来源更新以完整快照一起替换', async () => {
    vi.useFakeTimers(); const calls = new Map<string, number>(), releases = new Map<string, () => void>();
    const service = new SeasonRatingService(async id => detail(id), () => new Date(), { summary: async id => {
      const count = (calls.get(id) ?? 0) + 1; calls.set(id, count);
      if (count === 1) return summary(id === 'bgm:1' ? 6 : 7, true);
      await new Promise<void>(resolve => releases.set(id, resolve)); return summary(id === 'bgm:1' ? 9 : 8);
    } });
    service.get('2026-4', items.slice(0, 2));
    await vi.waitFor(() => expect(service.get('2026-4', items.slice(0, 2))).toMatchObject({ status: 'loading', processed: 2, entries: [expect.objectContaining({ summary: expect.objectContaining({ score: 6 }) }), expect.objectContaining({ summary: expect.objectContaining({ score: 7 }) })] }));
    await vi.advanceTimersByTimeAsync(1000);
    releases.get('bgm:1')!(); await Promise.resolve();
    expect(service.get('2026-4', items.slice(0, 2)).entries.map(entry => entry.summary?.score)).toEqual([6, 7]);
    releases.get('bgm:2')!(); await service.drain();
    expect(service.get('2026-4', items.slice(0, 2))).toMatchObject({ status: 'ready', entries: [expect.objectContaining({ summary: expect.objectContaining({ score: 9 }) }), expect.objectContaining({ summary: expect.objectContaining({ score: 8 }) })] });
  });
  it('禁用或未关联的缺源不阻塞完成，未知人数的有效分仍保留', async () => {
    const value = summary(8.6); value.sources.push({ provider: 'anilist', score: null, maxScore: 100, votes: null, url: null, fetchedAt: null, status: 'disabled' });
    const service = new SeasonRatingService(async id => detail(id), () => new Date(), { summary: async () => value });
    service.get('2026-4', items.slice(0, 1)); await service.drain();
    expect(service.get('2026-4', items.slice(0, 1))).toMatchObject({ status: 'ready', entries: [expect.objectContaining({ summary: expect.objectContaining({ score: 8.6, count: 1 }), error: null })] });
  });
  it('预算结束保留完整综合分快照，后台未完成允许稍后重试', async () => {
    const service = new SeasonRatingService(async id => detail(id), () => new Date(), { budgetMs: 20, summary: async () => summary(8.6, true) });
    service.get('2026-4', items.slice(0, 1)); await new Promise(resolve => setTimeout(resolve, 30));
    expect(service.get('2026-4', items.slice(0, 1))).toMatchObject({ status: 'partial', processed: 1, entries: [expect.objectContaining({ summary: expect.objectContaining({ score: 8.6 }), error: expect.any(String) })] });
    service.close(); await service.drain();
  });
});

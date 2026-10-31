import { describe, expect, it } from 'vitest';
import { ratingSourceRows, resolveRatingSummary } from '../src/rating-display';
import type { RatingSummary } from '../shared/scores';

const summary: RatingSummary = { score: 8.3, count: 4, fetchedAt: '2026-10-30T00:00:00Z', sources: [
  { provider: 'bangumi', score: 8, maxScore: 10, votes: 1234, url: 'https://bgm.tv/subject/1', fetchedAt: null, status: 'ready' },
  { provider: 'mal', score: 8.2, maxScore: 10, votes: 2345, url: 'https://myanimelist.net/anime/1', fetchedAt: null, status: 'ready' },
  { provider: 'filmarks', score: 4.2, maxScore: 5, votes: null, url: 'https://filmarks.com/animes/1/1', fetchedAt: null, status: 'ready' },
  { provider: 'anilist', score: 86, maxScore: 100, votes: 3456, url: 'https://anilist.co/anime/1', fetchedAt: null, status: 'ready' },
] };

describe('跨页面评分展示', () => {
  it('目录快照优先于后来到达的实时分，显式空快照也不能被旧分覆盖', () => {
    const live = { ...summary, score: 7.5 };
    expect(resolveRatingSummary(summary, live, { score: 7.8, total: 20, rank: null }, 'https://bgm.tv/subject/1', null)?.score).toBe(8.3);
    expect(resolveRatingSummary(null, live, { score: 7.8, total: 20, rank: null }, 'https://bgm.tv/subject/1', null)).toBeNull();
  });

  it('摘要未到时仅用真实的 Bangumi 旧评分，不能伪造四站来源', () => {
    const fallback = resolveRatingSummary(undefined, undefined, { score: 7.8, total: 1234, rank: 321 }, 'https://bgm.tv/subject/1', '2026-10-30T00:00:00Z');
    expect(fallback?.score).toBe(7.8);
    expect(fallback?.count).toBe(1);
    expect(fallback?.sources.map(source => source.provider)).toEqual(['bangumi']);
    expect(resolveRatingSummary(undefined, undefined, null, 'https://bgm.tv/subject/1', null)).toBeNull();
    expect(resolveRatingSummary(undefined, summary, { score: 7.8, total: 20, rank: null }, 'https://bgm.tv/subject/1', null)?.score).toBe(8.3);
  });

  it('保留四站原始量纲和独立评分人数，Filmarks 没有评分人数时保持缺失', () => {
    const rows = ratingSourceRows(summary);
    expect(rows.map(row => [row.provider, row.scoreLabel, row.votesLabel])).toEqual([
      ['bangumi', '8.0 / 10', '1,234 人评分'],
      ['mal', '8.2 / 10', '2,345 人评分'],
      ['filmarks', '4.2 / 5', '评分人数暂缺'],
      ['anilist', '86 / 100', '3,456 人评分'],
    ]);
  });

  it('缺源仍保留四站位置，disabled 与故障不同，0 人不等于未知人数', () => {
    const rows = ratingSourceRows({ score: null, count: 0, fetchedAt: null, sources: [
      { ...summary.sources[0]!, score: null, votes: 0, status: 'unrated' },
      { ...summary.sources[3]!, score: null, votes: null, status: 'disabled' },
    ] });
    expect(rows).toHaveLength(4);
    expect(rows[0]?.scoreLabel).toBe('暂无评分');
    expect(rows[0]?.votesLabel).toBe('0 人评分');
    expect(rows[1]?.scoreLabel).toBe('待获取');
    expect(rows[3]?.scoreLabel).toBe('未启用');
    expect(rows[3]?.note).toContain('AniList');
    expect(ratingSourceRows(null).every(row => row.score === null)).toBe(true);
  });

  it('来源分数保留原始小数，不把 MAL 和 Filmarks 的精度裁成综合分精度', () => {
    const rows = ratingSourceRows({ ...summary, sources: [
      { ...summary.sources[1]!, score: 8.23 },
      { ...summary.sources[2]!, score: 4.18 },
    ] });
    expect(rows[1]?.scoreLabel).toBe('8.23 / 10');
    expect(rows[2]?.scoreLabel).toBe('4.18 / 5');
  });
});

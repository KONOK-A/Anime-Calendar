import { describe, expect, it } from 'vitest';
import { summarizeRatings, validProviderRating, validRatingSummary, type ProviderRating } from '../shared/scores.js';

const source = (provider: ProviderRating['provider'], score: number | null, maxScore: ProviderRating['maxScore'], votes: number | null = null): ProviderRating => ({ provider, score, maxScore, votes, url: null, fetchedAt: '2026-10-31T00:00:00Z', status: score === null ? 'unrated' : 'ready' });
describe('跨站评分摘要', () => {
  it('按来源等权换算十分制后才四舍五入，人数不影响权重', () => {
    const result = summarizeRatings([source('bangumi', 7.7, 10, 50000), source('mal', 8.21, 10, 100), source('filmarks', 3.6, 5), source('anilist', 79, 100, 10)]);
    expect(result).toMatchObject({ score: 7.8, count: 4 });
    expect(result.sources[2]).toMatchObject({ score: 3.6, maxScore: 5, votes: null });
    expect(validRatingSummary(result)).toBe(true);
  });
  it('缺分和无效分数不当零分，也不重复计数同一来源', () => {
    expect(summarizeRatings([source('bangumi', 7.8, 10), source('mal', null, 10), source('filmarks', 6, 5), source('bangumi', 9, 10)])).toMatchObject({ score: 7.8, count: 1 });
    expect(summarizeRatings([source('bangumi', null, 10)])).toMatchObject({ score: null, count: 0 });
  });
  it('拒绝异常分数、来源满分不匹配、不可信链接和伪造摘要', () => {
    expect(validProviderRating(source('mal', 8.2, 10))).toBe(true);
    for (const score of [0, -1, 11, NaN, Infinity]) expect(validProviderRating(source('mal', score, 10))).toBe(false);
    expect(validProviderRating(source('filmarks', 4, 10))).toBe(false);
    expect(validProviderRating({ ...source('mal', 8, 10), url: 'javascript:alert(1)' })).toBe(false);
    expect(validProviderRating({ ...source('mal', 8, 10), url: 'https://evil.invalid/anime/1' })).toBe(false);
    expect(validProviderRating(source('mal', 8, 10, -1))).toBe(false);
    expect(validRatingSummary({ ...summarizeRatings([source('mal', 8, 10)]), count: 2 })).toBe(false);
  });
});

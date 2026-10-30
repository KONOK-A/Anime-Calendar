import { describe, expect, it } from 'vitest';
import { sortSeasonAnime } from '../src/season-sort';
import type { Anime, AnimeRating } from '../shared/types';
const items = Array.from({ length: 25 }, (_, index) => ({ id: `bgm:${index + 1}`, begin: `2026-10-${String(index + 1).padStart(2, '0')}` }) as Anime);
const rating = (score: number): AnimeRating => ({ score, total: 20, rank: null });
describe('季度目录排序', () => {
  it('评分先对整季度排序，再分页；最高分即使原在第二页也进入第一页', () => {
    const scores = new Map(items.map((anime, index) => [anime.id, rating(index === 24 ? 9.9 : 6)]));
    expect(sortSeasonAnime(items, 'rating', scores).slice(0, 24)[0]!.id).toBe('bgm:25');
    expect(items[0]!.id).toBe('bgm:1');
  });
  it('无评分、零投票及无效分数放末尾，同分按首播和ID稳定排序', () => {
    const scores = new Map<string, AnimeRating | null>([['bgm:1', null], ['bgm:2', rating(8)], ['bgm:3', rating(8)], ['bgm:4', { ...rating(9), total: 0 }], ['bgm:5', rating(NaN)]]);
    expect(sortSeasonAnime(items.slice(0, 5), 'rating', scores).map(anime => anime.id)).toEqual(['bgm:2', 'bgm:3', 'bgm:1', 'bgm:4', 'bgm:5']);
  });
  it('默认首播顺序不受评分影响，重复首播时间按ID', () => {
    const list = [{ ...items[0]!, id: 'bgm:2' }, { ...items[0]!, id: 'bgm:1' }];
    expect(sortSeasonAnime(list, 'premiere', new Map([['bgm:2', rating(10)]])).map(anime => anime.id)).toEqual(['bgm:1', 'bgm:2']);
  });
});

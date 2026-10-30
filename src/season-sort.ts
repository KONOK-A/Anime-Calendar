import type { Anime, AnimeRating } from '../shared/types';
import { validRating } from '../shared/ratings';
export type SeasonSort = 'premiere' | 'rating';
export function sortSeasonAnime(items: Anime[], sort: SeasonSort, ratings: ReadonlyMap<string, AnimeRating | null>): Anime[] {
  return [...items].sort((a, b) => {
    const left = ratings.get(a.id), right = ratings.get(b.id);
    const score = sort === 'rating' ? (validRating(right) ? right.score : -1) - (validRating(left) ? left.score : -1) : 0;
    return score || a.begin.localeCompare(b.begin) || a.id.localeCompare(b.id);
  });
}

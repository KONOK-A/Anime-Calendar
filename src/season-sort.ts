import type { Anime, AnimeRating } from '../shared/types';
import { validRating } from '../shared/ratings';
import { validRatingSummary, type RatingSummary } from '../shared/scores';
export type SeasonSort = 'premiere' | 'rating';
export function sortSeasonAnime(items: Anime[], sort: SeasonSort, ratings: ReadonlyMap<string, AnimeRating | RatingSummary | null>): Anime[] {
  const value = (rating: AnimeRating | RatingSummary | null | undefined) => validRatingSummary(rating) ? rating.score ?? -1 : validRating(rating) ? rating.score : -1;
  return [...items].sort((a, b) => {
    const left = ratings.get(a.id), right = ratings.get(b.id);
    const score = sort === 'rating' ? value(right) - value(left) : 0;
    return score || a.begin.localeCompare(b.begin) || a.id.localeCompare(b.id);
  });
}

export type RatingProvider = 'bangumi' | 'mal' | 'filmarks' | 'anilist';
export interface ProviderRating {
  provider: RatingProvider; score: number | null; maxScore: 5 | 10 | 100; votes: number | null;
  url: string | null; fetchedAt: string | null; status: 'ready' | 'unrated' | 'unlinked' | 'unavailable' | 'disabled'; error?: string | null;
}
export interface RatingSummary { score: number | null; count: number; sources: ProviderRating[]; fetchedAt: string | null; revalidating?: boolean; retryAfterMs?: number }
export const ratingProviders: RatingProvider[] = ['bangumi', 'mal', 'filmarks', 'anilist'];
const scales = { bangumi: 10, mal: 10, filmarks: 5, anilist: 100 } as const;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const instant = (value: unknown) => value === null || typeof value === 'string' && Number.isFinite(Date.parse(value));
function providerUrl(provider: RatingProvider, value: unknown) {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  const patterns = { bangumi: /^https:\/\/bgm\.tv\/subject\/[1-9]\d*$/, mal: /^https:\/\/myanimelist\.net\/anime\/[1-9]\d*$/, filmarks: /^https:\/\/filmarks\.com\/animes\/[1-9]\d*\/[1-9]\d*$/, anilist: /^https:\/\/anilist\.co\/anime\/[1-9]\d*$/ };
  return patterns[provider].test(value);
}
export function validProviderRating(value: unknown): value is ProviderRating {
  if (!record(value) || !ratingProviders.includes(value.provider as RatingProvider)) return false;
  const provider = value.provider as RatingProvider;
  return value.maxScore === scales[provider] && (value.score === null || typeof value.score === 'number' && Number.isFinite(value.score) && value.score > 0 && value.score <= scales[provider]) &&
    (value.votes === null || Number.isSafeInteger(value.votes) && Number(value.votes) >= 0) && providerUrl(provider, value.url) && instant(value.fetchedAt) &&
    ['ready', 'unrated', 'unlinked', 'unavailable', 'disabled'].includes(String(value.status)) && (value.status === 'ready' ? value.score !== null : value.score === null) &&
    (value.error === undefined || value.error === null || typeof value.error === 'string');
}
export function summarizeRatings(sources: ProviderRating[], fetchedAt?: string | null, revalidating = false): RatingSummary {
  const seen = new Set<RatingProvider>(), scores: number[] = [];
  for (const source of sources) if (!seen.has(source.provider) && validProviderRating(source) && source.status === 'ready') { seen.add(source.provider); scores.push(source.score! * 10 / source.maxScore); }
  const dates = sources.flatMap(source => source.fetchedAt && Number.isFinite(Date.parse(source.fetchedAt)) ? [source.fetchedAt] : []).sort((a, b) => Date.parse(a) - Date.parse(b));
  return { score: scores.length ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length + Number.EPSILON) * 10) / 10 : null, count: scores.length, sources, fetchedAt: fetchedAt === undefined ? dates[0] ?? null : fetchedAt, ...(revalidating ? { revalidating: true } : {}) };
}
export function validRatingSummary(value: unknown): value is RatingSummary {
  if (!record(value) || !Array.isArray(value.sources) || !value.sources.every(validProviderRating) || new Set(value.sources.map(source => source.provider)).size !== value.sources.length || !instant(value.fetchedAt) || value.revalidating !== undefined && typeof value.revalidating !== 'boolean' || value.retryAfterMs !== undefined && (typeof value.retryAfterMs !== 'number' || !Number.isSafeInteger(value.retryAfterMs) || value.retryAfterMs <= 0)) return false;
  const expected = summarizeRatings(value.sources);
  return value.score === expected.score && value.count === expected.count;
}

import type { AnimeRating, SeasonRatings } from './types.js';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function validRating(value: unknown): value is AnimeRating {
  return record(value) && typeof value.score === 'number' && Number.isFinite(value.score) && value.score > 0 && value.score <= 10 && Number.isSafeInteger(value.total) && Number(value.total) > 0 && (value.rank === null || Number.isSafeInteger(value.rank) && Number(value.rank) > 0);
}
const instant = (value: unknown) => value === null || typeof value === 'string' && Number.isFinite(Date.parse(value));
export function isSeasonRatings(value: unknown): value is SeasonRatings {
  if (!record(value) || value.schemaVersion !== 1 || !record(value.scope) || value.scope.type !== 'ratings' || typeof value.scope.season !== 'string' || !/^\d{4}-[1-4]$/.test(value.scope.season) || value.scope.key !== `ratings:${value.scope.season}`) return false;
  if (!Array.isArray(value.ids) || !value.ids.every(id => typeof id === 'string' && /^(bgm:\d+|bd:[\w-]+)$/.test(id)) || new Set(value.ids).size !== value.ids.length || value.total !== value.ids.length || !Number.isSafeInteger(value.processed) || Number(value.processed) < 0 || Number(value.processed) > value.ids.length) return false;
  if (!['loading', 'ready', 'partial'].includes(String(value.status)) || !instant(value.updatedAt) || value.status !== 'loading' && value.updatedAt === null || !Array.isArray(value.entries)) return false;
  const ids = new Set(value.ids), seen = new Set<string>();
  for (const entry of value.entries) {
    if (!record(entry) || typeof entry.id !== 'string' || !ids.has(entry.id) || seen.has(entry.id) || entry.rating !== null && !validRating(entry.rating) || !instant(entry.fetchedAt) || entry.error !== null && typeof entry.error !== 'string') return false;
    seen.add(entry.id);
  }
  return value.status === 'loading' || seen.size === ids.size && (value.status !== 'ready' || value.processed === value.total && value.entries.every(entry => (entry as { error: unknown }).error === null));
}

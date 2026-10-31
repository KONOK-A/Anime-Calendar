import type { Anime, AnimeDetail, AppStatus, CatalogSnapshot, CatalogView } from '../shared/types';
import { STREAMING_ACCESS_POLICY } from '../shared/airing-policy';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const instant = (value: unknown) => value === null || typeof value === 'string' && Number.isFinite(Date.parse(value));
const source = (value: unknown) => record(value) && instant(value.fetchedAt) && (value.error === null || typeof value.error === 'string');
const rule = (value: unknown) => record(value) && instant(value.anchor) && instant(value.end) && typeof value.raw === 'string' && ['once', 'daily', 'weekly', 'unsupported', 'unknown'].includes(String(value.frequency));
const releaseKind = (value: unknown) => value === undefined || value === 'regular' || value === 'member-advance';
function anime(value: unknown): value is Anime {
  if (record(value) && record(value.networkAiring) && value.networkAiring.rules !== undefined && (!Array.isArray(value.networkAiring.rules) || !value.networkAiring.rules.every(rule))) return false;
  return record(value) && typeof value.id === 'string' && /^(bgm:\d+|bd:[\w-]+)$/.test(value.id) && typeof value.title === 'string' && typeof value.originalTitle === 'string' && strings(value.aliases) && ['tv', 'web'].includes(String(value.type)) && typeof value.begin === 'string' && typeof value.season === 'string' && Array.isArray(value.platforms) && value.platforms.every(item => record(item) && typeof item.name === 'string' && typeof item.url === 'string' && strings(item.regions)) && rule(value.rule) && rule(value.broadcastRule) && (!value.networkAiring || record(value.networkAiring) && typeof value.networkAiring.platform === 'string' && strings(value.networkAiring.regions) && typeof value.networkAiring.begin === 'string' && typeof value.networkAiring.sourceUrl === 'string' && rule(value.networkAiring.rule) && releaseKind(value.networkAiring.releaseKind));
}
export function isAppStatus(value: unknown): value is AppStatus {
  return record(value) && value.appId === 'anime-calendar' && value.version === '1.0.0' && typeof value.refreshing === 'boolean' && typeof value.hasCatalog === 'boolean' && record(value.sources) && source(value.sources.catalog) && source(value.sources.calendar) && strings(value.warnings);
}
function snapshot(value: unknown): value is CatalogSnapshot {
  if (record(value) && value.schedulePolicy !== undefined && value.schedulePolicy !== 'streaming') return false;
  if (record(value) && value.streamingAccessPolicy !== undefined && value.streamingAccessPolicy !== STREAMING_ACCESS_POLICY) return false;
  return record(value) && value.schemaVersion === 1 && Array.isArray(value.items) && value.items.every(anime) && strings(value.activeIds) && strings(value.warnings) && record(value.fetchedAt) && instant(value.fetchedAt.catalog) && instant(value.fetchedAt.calendar) && record(value.overrides) && value.overrides.version === 1 && Array.isArray(value.overrides.active) && value.overrides.active.every(item => record(item) && typeof item.animeId === 'string' && typeof item.active === 'boolean') && Array.isArray(value.overrides.events) && value.overrides.events.every(item => record(item) && typeof item.animeId === 'string' && typeof item.at === 'string' && Number.isFinite(Date.parse(item.at)) && ['scheduled', 'cancelled'].includes(String(item.status)) && releaseKind(item.releaseKind));
}
export function isCatalogView(value: unknown): value is CatalogView {
  if (!record(value) || value.schemaVersion !== 1 || !record(value.scope)) return false;
  const scope = value.scope;
  const validScope = scope.type === 'weekly'
    ? typeof scope.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(scope.week) && ['Asia/Shanghai', 'Asia/Tokyo'].includes(String(scope.timezone)) && typeof scope.season === 'string' && scope.key === `weekly:${scope.week}:${scope.timezone}:${scope.season}`
    : scope.type === 'season' ? typeof scope.season === 'string' && /^\d{4}-[1-4]$/.test(scope.season) && scope.key === `season:${scope.season}`
      : scope.type === 'items' && strings(scope.ids) && scope.ids.length <= 50 && scope.key === `items:${scope.ids.join(',')}` && strings(value.missingIds);
  return validScope && typeof value.revision === 'string' && isAppStatus(value.status) && Array.isArray(value.seasons) && value.seasons.every(item => record(item) && typeof item.season === 'string' && Number.isInteger(item.total) && Number(item.total) >= 0) && (value.catalog === null || snapshot(value.catalog));
}
export function isCurrentCatalogView(value: unknown): value is CatalogView & { catalog: CatalogSnapshot } {
  return isCatalogView(value) && value.catalog?.schedulePolicy === 'streaming' && value.catalog.streamingAccessPolicy === STREAMING_ACCESS_POLICY;
}
export function isAnimeDetail(value: unknown): value is AnimeDetail {
  if (!anime(value)) return false;
  const detail = value as unknown as Record<string, unknown>;
  if (detail.revalidating !== undefined && typeof detail.revalidating !== 'boolean') return false;
  if (detail.detailFetchFailed !== undefined && typeof detail.detailFetchFailed !== 'boolean') return false;
  if (detail.adaptation !== undefined && detail.adaptation !== null && !['漫改', '小说改', '原创', '游戏改'].includes(String(detail.adaptation))) return false;
  const variants = detail.imageVariants;
  if (variants !== undefined && (!record(variants) || !['thumb', 'card', 'hero'].every(key => variants[key] === null || typeof variants[key] === 'string'))) return false;
  return typeof detail.summary === 'string' && (detail.image === null || typeof detail.image === 'string') && (detail.episodes === null || typeof detail.episodes === 'number') && strings(detail.tags) && Array.isArray(detail.staff) && detail.staff.every(item => record(item) && typeof item.role === 'string' && strings(item.names)) && instant(detail.detailFetchedAt) && (detail.detailError === null || typeof detail.detailError === 'string') && (detail.rating === null || record(detail.rating) && typeof detail.rating.score === 'number' && typeof detail.rating.total === 'number');
}

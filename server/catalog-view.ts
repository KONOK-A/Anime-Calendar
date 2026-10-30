import { createHash } from 'node:crypto';
import type { AppStatus, CatalogScope, CatalogSnapshot, CatalogView, Timezone } from '../shared/types.js';
import { buildSchedule, effectiveActiveIds, seasonFrom, weekWindow } from '../shared/schedule.js';

const indexes = new WeakMap<CatalogSnapshot, { revision: string; seasons: CatalogView['seasons']; bySeason: Map<string, CatalogSnapshot['items']>; byId: Map<string, CatalogSnapshot['items'][number]>; ends: number[] }>();
function index(snapshot: CatalogSnapshot) {
  const cached = indexes.get(snapshot); if (cached) return cached;
  const bySeason = new Map<string, CatalogSnapshot['items']>();
  for (const item of snapshot.items) { const group = bySeason.get(item.season) ?? []; group.push(item); bySeason.set(item.season, group); }
  const value = { revision: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 24), seasons: [...bySeason].sort(([a], [b]) => b.localeCompare(a)).map(([season, items]) => ({ season, total: items.length })), bySeason, byId: new Map(snapshot.items.map(item => [item.id, item])), ends: [...new Set(snapshot.items.flatMap(item => item.rule.end ? [Date.parse(item.rule.end)] : []))].sort((a, b) => a - b) };
  indexes.set(snapshot, value); return value;
}
export function catalogTimeEpoch(snapshot: CatalogSnapshot, now: string): number {
  const ends = index(snapshot).ends, at = Date.parse(now); let low = 0, high = ends.length;
  while (low < high) { const mid = (low + high) >>> 1; if (ends[mid] < at) low = mid + 1; else high = mid; }
  return low;
}

export function catalogScope(type: CatalogScope['type'], query: Record<string, unknown>, now: string): CatalogScope {
  const read = (name: string) => { const value = query[name]; if (value !== undefined && typeof value !== 'string') throw new Error('查询参数无效'); return value as string | undefined; };
  if (type === 'weekly') {
    const week = read('week') ?? '', timezone = read('timezone') ?? 'Asia/Shanghai';
    const date = new Date(`${week}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== week || date.getUTCDay() !== 1 || !['Asia/Shanghai', 'Asia/Tokyo'].includes(timezone)) throw new Error('周表需要有效的周一日期和显示时区');
    const season = read('season') ?? seasonFrom(now);
    if (!/^\d{4}-[1-4]$/.test(season)) throw new Error('季度参数无效');
    return { type, week, timezone: timezone as Timezone, season, key: `weekly:${week}:${timezone}:${season}` };
  }
  if (type === 'season') {
    const season = read('season') ?? '';
    if (!/^\d{4}-[1-4]$/.test(season)) throw new Error('季度参数无效');
    return { type, season, key: `season:${season}` };
  }
  const raw = read('ids') ?? '', ids = raw ? raw.split(',') : [];
  if (ids.length > 50 || ids.some(id => id.length >= 120 || !/^(bgm:\d+|bd:[\w-]+)$/.test(id))) throw new Error('每批最多查询50个有效作品ID');
  const unique = [...new Set(ids)].sort();
  return { type, ids: unique, key: `items:${unique.join(',')}` };
}

export function projectCatalog(snapshot: CatalogSnapshot | null, status: AppStatus, scope: CatalogScope, now: string): CatalogView {
  if (!snapshot) return { schemaVersion: 1, scope, revision: 'unavailable', status, seasons: [], catalog: null, ...(scope.type === 'items' ? { missingIds: [] } : {}) };
  const { seasons, revision, bySeason, byId } = index(snapshot);
  let ids: Set<string>;
  if (scope.type === 'weekly') {
    ids = new Set(buildSchedule(snapshot, weekWindow(`${scope.week}T12:00:00Z`, scope.timezone)).map(event => event.animeId));
    const active = effectiveActiveIds(snapshot), inactive = new Set(snapshot.overrides.active.filter(item => !item.active).map(item => item.animeId));
    for (const item of snapshot.items) {
      if (!inactive.has(item.id) && (item.season === scope.season || active.has(item.id)) && (!item.rule.end || Date.parse(item.rule.end) >= Date.parse(now)) && (!item.rule.anchor || item.rule.frequency === 'unsupported' || ((item.rule.frequency === 'weekly' || item.rule.frequency === 'daily') && !active.has(item.id)))) ids.add(item.id);
    }
  } else if (scope.type === 'season') ids = new Set(snapshot.items.filter(item => item.season === scope.season).map(item => item.id));
  else ids = new Set(scope.ids);
  const items = scope.type === 'season' ? bySeason.get(scope.season) ?? [] : scope.type === 'items' ? scope.ids.flatMap(id => { const item = byId.get(id); return item ? [item] : []; }) : snapshot.items.filter(item => ids.has(item.id));
  const result: CatalogView = { schemaVersion: 1, scope, revision, status, seasons, catalog: { ...snapshot, items } };
  if (scope.type === 'items') { const found = new Set(items.map(item => item.id)); result.missingIds = scope.ids.filter(id => !found.has(id)); }
  return result;
}

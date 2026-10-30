import type { CatalogScope, Timezone } from '../shared/types';
import { dateKey, seasonFrom, weekWindow } from '../shared/schedule';

export interface CatalogRequest { scope: CatalogScope; url: string }
export function catalogRequests(route: string, now: string, timezone: Timezone, favorites: string[]): CatalogRequest[] {
  const path = route.replace(/^#/, '');
  if (path === '/weekly' || path === '/') {
    const week = dateKey(weekWindow(now, timezone).start, timezone), season = seasonFrom(now);
    return [{ scope: { type: 'weekly', week, timezone, season, key: `weekly:${week}:${timezone}:${season}` }, url: `/api/catalog/weekly?week=${week}&timezone=${encodeURIComponent(timezone)}&season=${season}` }];
  }
  if (path.startsWith('/season')) {
    const match = path.match(/^\/season\/(\d{4})\/([1-4])$/), season = match ? `${match[1]}-${match[2]}` : seasonFrom(now);
    return [{ scope: { type: 'season', season, key: `season:${season}` }, url: `/api/catalog/season?season=${season}` }];
  }
  let ids: string[];
  if (path === '/favorites') ids = favorites;
  else if (path.startsWith('/anime/')) {
    let id = ''; try { id = decodeURIComponent(path.slice('/anime/'.length)); } catch { /* Invalid direct links resolve to the existing not-found state. */ }
    ids = id.length < 120 && /^(bgm:\d+|bd:[\w-]+)$/.test(id) ? [id] : [];
  } else return [];
  ids = [...new Set(ids)].sort();
  const requests: CatalogRequest[] = [];
  for (let index = 0; index < Math.max(1, ids.length); index += 50) {
    const chunk = ids.slice(index, index + 50);
    requests.push({ scope: { type: 'items', ids: chunk, key: `items:${chunk.join(',')}` }, url: `/api/catalog/items?ids=${encodeURIComponent(chunk.join(','))}` });
  }
  return requests;
}

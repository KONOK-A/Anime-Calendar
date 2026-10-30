import { reactive, watch } from 'vue';
import type { SeasonSort } from './season-sort';

export interface SeasonBrowse { query: string; type: '' | 'tv' | 'web'; page: number; sort?: SeasonSort }
interface BrowseState {
  version: 1;
  weekly: { selectedDay: string; onlyFavorites: boolean; horizontalScroll?: Record<string, number> };
  seasons: Record<string, SeasonBrowse>;
  scroll: Record<string, number>;
  detailFrom: string;
  lastSeason: string;
}
const key = 'anime-calendar:browse:v1';
export const isListRoute = (value: string) => /^#\/(weekly|favorites|season(?:\/\d{4}\/[1-4])?)$/.test(value);
export function useBrowseState(notify: (text: string) => void) {
  const state = reactive<BrowseState>({ version: 1, weekly: { selectedDay: '', onlyFavorites: false }, seasons: {}, scroll: {}, detailFrom: '#/weekly', lastSeason: '#/season' });
  let saveErrorShown = false;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(key) ?? 'null');
    if (saved?.version === 1) {
      if (typeof saved.weekly?.selectedDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.weekly.selectedDay)) state.weekly.selectedDay = saved.weekly.selectedDay;
      state.weekly.onlyFavorites = saved.weekly?.onlyFavorites === true;
      for (const [view, position] of Object.entries(saved.weekly?.horizontalScroll ?? {})) {
        if (/^(Asia\/Shanghai|Asia\/Tokyo)\|\d{4}-\d{2}-\d{2}\|rows\|(all|favorites)$/.test(view) && typeof position === 'number' && Number.isFinite(position) && position >= 0) (state.weekly.horizontalScroll ??= {})[view] = position;
      }
      if (typeof saved.detailFrom === 'string' && isListRoute(saved.detailFrom)) state.detailFrom = saved.detailFrom;
      if (typeof saved.lastSeason === 'string' && saved.lastSeason.startsWith('#/season') && isListRoute(saved.lastSeason)) state.lastSeason = saved.lastSeason;
      for (const [route, position] of Object.entries(saved.scroll ?? {})) if (isListRoute(route) && typeof position === 'number' && Number.isFinite(position) && position >= 0) state.scroll[route] = position;
      for (const [season, entry] of Object.entries(saved.seasons ?? {})) {
        if (!/^\d{4}-[1-4]$/.test(season) || !entry || typeof entry !== 'object') continue;
        const value = entry as Partial<SeasonBrowse>;
        state.seasons[season] = { query: typeof value.query === 'string' ? value.query.slice(0, 500) : '', type: value.type === 'tv' || value.type === 'web' ? value.type : '', page: Number.isSafeInteger(value.page) && value.page! > 0 ? value.page! : 1, sort: value.sort === 'rating' ? 'rating' : 'premiere' };
      }
    }
  } catch { notify('浏览状态无法恢复，当前操作仍可使用；本标签页的浏览偏好可能无法保存。'); }
  watch(state, () => {
    try { window.sessionStorage.setItem(key, JSON.stringify(state)); }
    catch { if (!saveErrorShown) { saveErrorShown = true; notify('浏览位置和筛选未保存，当前标签页内仍可继续操作。'); } }
  }, { deep: true, flush: 'post' });
  return state;
}

import type { AiringEvent, Timezone } from '../shared/types';
import { dateKey } from '../shared/schedule';
export type ThemePreference = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';
export type WeeklyLayout = 'columns' | 'rows';
export type CatalogColumns = 4 | 5 | 6;
export function readThemePreference(value: string | null): ThemePreference { return value === 'light' || value === 'dark' ? value : 'system'; }
export function resolveTheme(preference: ThemePreference, systemDark: boolean): Theme { return preference === 'system' ? systemDark ? 'dark' : 'light' : preference; }
export function initialFeatured(events: AiringEvent[], now: string): AiringEvent | undefined {
  return events.find(event => Date.parse(event.at) >= Date.parse(now)) ?? events.at(-1);
}
export function featuredEvents(events: AiringEvent[], favorites: string[], now: string, timezone: Timezone): AiringEvent[] {
  const today = dateKey(now, timezone), grouped = new Map<string, AiringEvent[]>();
  const ordered = events.filter(event => event.status !== 'cancelled' && dateKey(event.at, timezone) === today).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.animeId.localeCompare(b.animeId));
  for (const event of ordered) {
    const list = grouped.get(event.animeId) ?? []; list.push(event); grouped.set(event.animeId, list);
  }
  const unique = [...grouped.values()].map(list => initialFeatured(list, now)!).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.animeId.localeCompare(b.animeId));
  const saved = unique.filter(event => favorites.includes(event.animeId));
  return saved.length ? saved : unique;
}

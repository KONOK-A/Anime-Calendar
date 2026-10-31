import type { AiringEvent, CatalogSnapshot, Timezone } from './types.js';
import { isEligibleNetwork, isMemberAdvance } from './airing-policy.js';

const DAY = 86_400_000;
const offsets: Record<Timezone, number> = { 'Asia/Shanghai': 8, 'Asia/Tokyo': 9 };
export function effectiveActiveIds(snapshot: CatalogSnapshot): Set<string> {
  const active = new Set(snapshot.activeIds);
  for (const override of snapshot.overrides.active) override.active ? active.add(override.animeId) : active.delete(override.animeId);
  return active;
}

export function dateKey(iso: string, zone: Timezone): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
export function formatClock(iso: string, zone: Timezone): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}
export function seasonFrom(begin: string): string {
  const key = /^\d{4}-\d{2}-\d{2}$/.test(begin) ? begin : Number.isFinite(Date.parse(begin)) ? dateKey(begin, 'Asia/Shanghai') : '';
  return key ? `${key.slice(0, 4)}-${Math.ceil(Number(key.slice(5, 7)) / 3)}` : 'unknown';
}
export function seasonLabel(season: string): string {
  if (season === 'unknown') return '季度待定';
  const [year, quarter] = season.split('-');
  return `${year} 年${['冬', '春', '夏', '秋'][Number(quarter) - 1]}季`;
}
export function weekWindow(iso: string, zone: Timezone): { start: string; end: string } {
  const midnight = new Date(`${dateKey(iso, zone)}T00:00:00Z`);
  const monday = midnight.getTime() - ((midnight.getUTCDay() + 6) % 7) * DAY - offsets[zone] * 3_600_000;
  return { start: new Date(monday).toISOString().replace('.000Z', 'Z'), end: new Date(monday + 7 * DAY).toISOString().replace('.000Z', 'Z') };
}

export function buildSchedule(snapshot: CatalogSnapshot, window: { start: string; end: string }): AiringEvent[] {
  const start = Date.parse(window.start), end = Date.parse(window.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 14 * DAY) throw new Error('排期窗口须为14天以内的有效区间');
  const active = effectiveActiveIds(snapshot);
  const events: AiringEvent[] = [];
  const eventKeys = new Set<string>();
  const overrides = snapshot.overrides.events.filter(event => !isMemberAdvance(event));
  for (const anime of snapshot.items) {
    if (isMemberAdvance(anime.networkAiring)) continue;
    const rules = anime.networkAiring?.rules?.length ? anime.networkAiring.rules : [anime.rule];
    for (const rule of rules) {
      const { anchor, frequency } = rule;
      if (!anchor || frequency === 'unknown' || frequency === 'unsupported') continue;
      const first = Date.parse(anchor), final = rule.end ? Date.parse(rule.end) : Infinity;
      const interval = frequency === 'weekly' ? 7 * DAY : frequency === 'daily' ? DAY : 0;
      if (interval && !active.has(anime.id)) continue;
      if (!isEligibleNetwork(anime.id, { rule, sourceUrl: anime.networkAiring?.sourceUrl ?? anime.scheduleSource ?? anime.sourceUrl, releaseKind: anime.networkAiring?.releaseKind }, snapshot.overrides.rules)) continue;
      let time = interval ? first + Math.max(0, Math.ceil((start - first) / interval)) * interval : first;
      while (time < end && time <= final) {
        const overridden = overrides.some(x => x.animeId === anime.id && Date.parse(x.originalAt ?? x.at) === time);
        const key = `${anime.id}|${time}`;
        if (time >= start && !overridden && !eventKeys.has(key)) {
          events.push({ animeId: anime.id, at: new Date(time).toISOString(), basis: interval ? 'estimated' : 'source', status: 'scheduled', sourceUrl: anime.scheduleSource ?? anime.networkAiring?.sourceUrl ?? anime.sourceUrl });
          eventKeys.add(key);
        }
        if (!interval) break;
        time += interval;
      }
    }
  }
  const ids = new Set(snapshot.items.map(x => x.id));
  for (const override of overrides) {
    const time = Date.parse(override.at);
    if (ids.has(override.animeId) && time >= start && time < end) events.push({ animeId: override.animeId, at: new Date(time).toISOString(), basis: 'official', status: override.status, sourceUrl: override.sourceUrl, note: override.note });
  }
  return events.sort((a, b) => a.at.localeCompare(b.at) || a.animeId.localeCompare(b.animeId));
}

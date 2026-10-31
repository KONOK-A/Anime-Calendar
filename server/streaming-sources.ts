import type { AiringRule, CatalogBase, ReleaseKind, RuleOverride } from '../shared/types.js';
import { instant, isRecord, parseNetworkRule, parseRule, safeUrl } from './normalize.js';
import { isEligibleNetwork } from '../shared/airing-policy.js';

export const STREAMING_SOURCE_URL = 'https://www.video.unext.jp/season_anime/autumn';
export interface StreamingScheduleRecord {
  title: string; season: string; begin: string; premiereDate: string | null; premiereAt: string | null; rule: AiringRule; rules?: AiringRule[];
  platform: string; regions: string[]; sourceUrl: string; note: string; animeId?: string; releaseKind?: ReleaseKind;
}
export interface StreamingSchedulePage { season: string; records: StreamingScheduleRecord[] }
const DAY = 86_400_000;
const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const japaneseDays = '日月火水木金土';

function content(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;|&#160;/g, ' ').trim();
}
function titleKey(title: string): string {
  return title.normalize('NFKC').toLowerCase().replace(/^tvアニメ/u, '').replace(/第([一二三四五六七八九十])期/gu, (_, number: string) => `第${'一二三四五六七八九十'.indexOf(number) + 1}期`).replace(/[\s\p{P}\p{S}]/gu, '');
}
function ruleAt(anchor: string, frequency: 'once' | 'weekly'): AiringRule {
  return { anchor, frequency, raw: `R/${anchor}/${frequency === 'once' ? 'P0D' : 'P7D'}`, end: null };
}
function publisherUrl(value: unknown): value is string {
  return typeof value === 'string' && (/^https:\/\/(?:www\.)?video\.unext\.jp\/season_anime\/(?:autumn|winter|spring|summer)$/.test(value) || /^https:\/\/animestore\.docomo\.ne\.jp\/animestore\/(?:ci_pc\?workId=\d+|CQ\/notice-\d+)$/.test(value));
}
function calendarDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function validRule(value: unknown): value is AiringRule {
  if (!isRecord(value) || !instant(value.anchor) || typeof value.raw !== 'string' || !value.raw.startsWith('R/') || !(value.end === null || instant(value.end))) return false;
  const parsed = parseRule(value.raw, '', typeof value.end === 'string' ? value.end : '');
  return parsed.frequency === value.frequency && Date.parse(parsed.anchor ?? '') === Date.parse(String(value.anchor));
}

/** Validate a stored publisher payload before replacing an already usable cache. */
export function normalizeStreamingData(input: unknown): StreamingSchedulePage {
  if (!isRecord(input) || typeof input.season !== 'string' || !/^20\d{2}-[1-4]$/.test(input.season) || !Array.isArray(input.records) || !input.records.length) throw new Error('官方网络缓存结构无效，旧数据已保留');
  for (const record of input.records) {
    if (!isRecord(record) || record.season !== input.season || typeof record.title !== 'string' || !record.title.trim() || !publisherUrl(record.sourceUrl) || typeof record.platform !== 'string' || !record.platform.trim() || !Array.isArray(record.regions) || !record.regions.every(region => typeof region === 'string') || typeof record.note !== 'string' || !validRule(record.rule)) throw new Error('官方网络缓存条目无效，旧数据已保留');
    if (!(record.begin === '' || calendarDate(record.begin) || instant(record.begin)) || !(record.premiereDate === null || calendarDate(record.premiereDate)) || !(record.premiereAt === null || instant(record.premiereAt))) throw new Error('官方网络首发日期无效，旧数据已保留');
    if (record.animeId !== undefined && (typeof record.animeId !== 'string' || !/^(?:bgm:\d+|bd:[a-f\d]{24})$/.test(record.animeId))) throw new Error('官方网络作品ID无效');
    if (record.releaseKind !== undefined && record.releaseKind !== 'regular' && record.releaseKind !== 'member-advance') throw new Error('官方网络配信分类无效');
    if (record.rules !== undefined && (!Array.isArray(record.rules) || !record.rules.length || !record.rules.every(validRule))) throw new Error('官方网络多周期无效，旧数据已保留');
  }
  return structuredClone(input) as unknown as StreamingSchedulePage;
}

/** A fetched record replaces its older seed from the same publisher and season. */
export function mergeStreamingRecords(...collections: readonly StreamingScheduleRecord[][]): StreamingScheduleRecord[] {
  const merged = new Map<string, StreamingScheduleRecord>();
  for (const records of collections) for (const record of records) merged.set(JSON.stringify([record.sourceUrl, record.season, titleKey(record.title)]), record);
  return [...merged.values()];
}

/** Parse only the publisher's explicit recurring release text, never a listing date alone. */
export function normalizeStreamingSchedulePage(input: unknown, sourceUrl = STREAMING_SOURCE_URL): StreamingSchedulePage {
  if (typeof input !== 'string' || !/^https:\/\/(?:www\.)?video\.unext\.jp\/season_anime\/(?:autumn|winter|spring|summer)$/.test(sourceUrl)) throw new Error('官方网络排期来源无效');
  const heading = content(input.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const seasonMatch = heading.match(/(20\d{2})年([冬春夏秋])アニメ/);
  if (!seasonMatch) throw new Error('官方网络排期缺少明确季度，旧数据已保留');
  const year = Number(seasonMatch[1]), season = `${year}-${'冬春夏秋'.indexOf(seasonMatch[2]!) + 1}`;
  const records: StreamingScheduleRecord[] = [];
  // Ignore Next.js hydration copies: the visible headings carry the weekday context.
  const visible = input.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const sections = [...visible.matchAll(/<div\b[^>]*\bid="(?:autumn|winter|spring|summer)_(sunday|monday|tuesday|wednesday|thursday|friday|saturday)"[^>]*>/g)];
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index]!, weekday = weekdays.indexOf(section[1]!);
    const sectionHtml = visible.slice(section.index! + section[0].length, sections[index + 1]?.index ?? visible.length);
    for (const match of sectionHtml.matchAll(/<p\b[^>]*class="[^"]*lead[^"]*"[^>]*>([\s\S]*?)<\/p>\s*<h4\b[^>]*>([\s\S]*?)<\/h4>/g)) {
      const note = content(match[1]!), title = content(match[2]!);
      const timing = note.match(/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?配信開始\s*以降(?:毎週([日月火水木金土])曜)?(\d{1,2}):(\d{2})更新/);
      if (!timing || !title) continue;
      const month = Number(timing[1]), day = Number(timing[2]), hour = Number(timing[6]), minute = Number(timing[7]);
      const initialHour = timing[3] === undefined ? hour : Number(timing[3]), initialMinute = timing[4] === undefined ? minute : Number(timing[4]);
      const premiereYear = seasonMatch[2] === '冬' && month === 12 ? year - 1 : year;
      const date = `${premiereYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const midnight = Date.parse(`${date}T00:00:00+09:00`);
      if (hour > 47 || initialHour > 47 || minute > 59 || initialMinute > 59 || !Number.isFinite(midnight) || new Date(midnight + 9 * 3_600_000).toISOString().slice(0, 10) !== date) continue;
      const calendarDay = new Date(midnight + 9 * 3_600_000).getUTCDay();
      if (calendarDay !== weekday || timing[5] && japaneseDays.indexOf(timing[5]) !== weekday) continue;
      const initial = midnight + initialHour * 3_600_000 + initialMinute * 60_000;
      let recurring = midnight + hour * 3_600_000 + minute * 60_000;
      const firstDiffers = initial !== recurring;
      const premiereAt = timing[3] === undefined ? null : new Date(initial).toISOString();
      // A date and an "以降" clock prove the following weeks; the first minute
      // remains unknown unless the page states it separately.
      if (!premiereAt || firstDiffers) recurring += 7 * DAY;
      const begin = premiereAt ?? date, rule = ruleAt(new Date(recurring).toISOString(), 'weekly');
      records.push({ title, season, begin, premiereDate: date, premiereAt, rule, ...(premiereAt && firstDiffers ? { rules: [ruleAt(premiereAt, 'once'), rule] } : {}), platform: 'U-NEXT', regions: ['JP'], sourceUrl, note });
    }
  }
  if (!records.length) throw new Error('官方网络排期未解析到有效周期，旧数据已保留');
  return { season, records };
}

/** Merge verified publisher records before manual overrides; no network access or cache mutation. */
export function applyStreamingSchedules(base: CatalogBase, records: StreamingScheduleRecord[], overrides: readonly RuleOverride[] = []): CatalogBase {
  const warnings = [...base.warnings];
  const matches = new Map<string, StreamingScheduleRecord[]>();
  for (const record of records) {
    if (!safeUrl(record.sourceUrl) || !record.rule.anchor || !Number.isFinite(Date.parse(record.rule.anchor))) continue;
    const key = titleKey(record.title);
    const candidates = base.items.filter(anime => anime.season === record.season && (record.animeId ? anime.id === record.animeId : [anime.originalTitle, anime.title, ...anime.aliases].some(title => titleKey(title) === key)));
    if (candidates.length !== 1) continue;
    const id = candidates[0]!.id;
    const original = record.rules ?? [record.rule];
    const rules = original.filter(rule => isEligibleNetwork(id, { sourceUrl: record.sourceUrl, rule, releaseKind: record.releaseKind }, overrides));
    if (!rules.length) continue;
    const primary = rules.find(rule => rule.raw === record.rule.raw);
    const replacement = primary ?? rules.find(rule => rule.frequency === record.rule.frequency) ?? rules[0]!;
    const premiere = instant(record.premiereAt);
    const independentPremiere = premiere !== null && rules.some(rule => rule.frequency === 'once' && instant(rule.anchor) === premiere);
    const declaredStart = premiere ?? instant(record.begin);
    const removedStart = declaredStart !== null && (original.some(rule => instant(rule.anchor) === declaredStart && !rules.includes(rule)) || !isEligibleNetwork(id, { sourceUrl: record.sourceUrl, releaseKind: record.releaseKind, rule: { anchor: declaredStart, frequency: 'once', raw: `R/${declaredStart}/P0D`, end: null } }, overrides));
    const filtered: StreamingScheduleRecord = {
      ...record, rule: replacement, ...(record.rules ? { rules } : {}),
      ...(!primary || removedStart ? { begin: independentPremiere ? record.premiereAt! : '', premiereDate: independentPremiere ? record.premiereDate : null, premiereAt: independentPremiere ? record.premiereAt : null } : {}),
    };
    const existing = matches.get(id) ?? [];
    matches.set(id, [...existing, filtered]);
  }
  const items = base.items.map(anime => {
    const candidates = matches.get(anime.id);
    if (!candidates?.length || anime.scheduleSource) return anime;
    const record = candidates.sort((a, b) => Date.parse(a.begin || a.rule.anchor || '') - Date.parse(b.begin || b.rule.anchor || ''))[0]!;
    const rule = instant(record.begin) ? parseNetworkRule(record.rule.raw, record.begin, record.rule.end ?? '', anime.begin, anime.broadcastRule) : { ...record.rule };
    const previous = anime.networkAiring;
    const interval = rule.frequency === 'weekly' ? 7 * DAY : rule.frequency === 'daily' ? DAY : 0;
    const difference = Date.parse(previous?.rule.anchor ?? '') - Date.parse(rule.anchor!);
    const conflict = previous && (previous.rule.frequency !== rule.frequency || (interval ? difference % interval !== 0 : difference !== 0));
    const note = conflict ? `${record.note}；来源冲突：采用官方网络排期，聚合规则 ${previous.rule.raw}（${previous.sourceUrl}）供核对。` : record.note;
    if (conflict) warnings.push(`来源冲突：${anime.title}（${anime.id}）采用官方网络排期；原平台 ${previous.sourceUrl}。`);
    return { ...anime, rule, networkAiring: { platform: record.platform, regions: record.regions, begin: record.begin, rule, ...(record.rules ? { rules: record.rules.map(entry => ({ ...entry, end: entry.end ?? (entry.frequency === 'weekly' ? rule.end : null) })) } : {}), sourceUrl: record.sourceUrl, note, ...(record.releaseKind ? { releaseKind: record.releaseKind } : {}) }, scheduleNote: note };
  });
  return { items, warnings: [...new Set(warnings)] };
}

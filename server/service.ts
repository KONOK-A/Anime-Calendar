import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { Anime, AnimeCredits, AnimeDetail, AppStatus, CatalogBase, CatalogSnapshot, CharacterName, CharacterNames, Overrides } from '../shared/types.js';
import { CacheStore } from './cache.js';
import { instant, isRecord, normalizeCalendar, normalizeCatalog, parseNetworkRule, parseRule, safeUrl } from './normalize.js';
import { dateKey } from '../shared/schedule.js';
import { infoboxStaff, mergeStaff, normalizeCast, normalizeCharacterName, normalizeStaff } from './credits.js';

interface Options { directory: string; now?: () => Date; fetcher?: (url: string, init?: RequestInit) => Promise<Response>; overridesPath?: string }
const CATALOG_URL = 'https://raw.githubusercontent.com/bangumi-data/bangumi-data/master/dist/data.json';
const CALENDAR_URL = 'https://api.bgm.tv/calendar';
const HOUR = 3_600_000;
const emptyOverrides = (): Overrides => ({ version: 1, active: [], events: [], rules: [] });
type Metadata = Pick<AnimeDetail, 'summary' | 'image' | 'episodes' | 'tags' | 'staff' | 'rating'>;

function metadata(input: unknown, id: number): Metadata {
  if (!isRecord(input) || input.id !== id || typeof input.name !== 'string') throw new Error('作品详情响应无效');
  const images = isRecord(input.images) ? input.images : {};
  const episodes = Number(input.eps) > 0 ? Number(input.eps) : Number(input.total_episodes) > 0 ? Number(input.total_episodes) : null;
  const sourceRating = isRecord(input.rating) ? input.rating : null;
  const rating = sourceRating && typeof sourceRating.score === 'number' && Number.isFinite(sourceRating.score) && sourceRating.score > 0 && sourceRating.score <= 10 && typeof sourceRating.total === 'number' && Number.isSafeInteger(sourceRating.total) && sourceRating.total > 0
    ? { score: sourceRating.score, total: sourceRating.total, rank: typeof sourceRating.rank === 'number' && Number.isSafeInteger(sourceRating.rank) && sourceRating.rank > 0 ? sourceRating.rank : null } : null;
  return { summary: typeof input.summary === 'string' ? input.summary : '', image: safeUrl(images.large) ?? safeUrl(images.common) ?? safeUrl(images.medium), episodes, rating, staff: infoboxStaff(input.infobox), tags: Array.isArray(input.tags) ? input.tags.filter(isRecord).map(x => x.name).filter((x): x is string => typeof x === 'string').slice(0, 12) : [] };
}

function readOverrides(input: unknown): Overrides {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.active) || !Array.isArray(input.events) || (input.rules !== undefined && !Array.isArray(input.rules))) throw new Error('人工修正格式无效');
  for (const entry of input.active) if (!isRecord(entry) || typeof entry.animeId !== 'string' || typeof entry.active !== 'boolean' || !safeUrl(entry.sourceUrl)) throw new Error('在播修正缺少作品ID、状态或来源');
  for (const entry of input.events) if (!isRecord(entry) || typeof entry.animeId !== 'string' || !instant(entry.at) || !['scheduled', 'cancelled'].includes(String(entry.status)) || !safeUrl(entry.sourceUrl) || (entry.originalAt !== undefined && !instant(entry.originalAt))) throw new Error('单次排期修正缺少有效时间或来源');
  for (const entry of (input.rules ?? []) as unknown[]) {
    if (!isRecord(entry) || typeof entry.animeId !== 'string' || !safeUrl(entry.sourceUrl) || typeof entry.note !== 'string' || !(typeof entry.broadcast === 'string' || entry.dateOnly === true || entry.kind === 'broadcast')) throw new Error('周期修正缺少规则或来源');
    if (entry.kind !== undefined && !['network', 'broadcast'].includes(String(entry.kind))) throw new Error('不支持的排期修正类型');
    if (entry.kind === 'network' && (typeof entry.broadcast !== 'string' || !instant(entry.broadcast.split('/')[1]) || typeof entry.platform !== 'string' || !entry.platform.trim())) throw new Error('网络排期修正缺少周期或平台');
    if (entry.regions !== undefined && (!Array.isArray(entry.regions) || !entry.regions.every(x => typeof x === 'string'))) throw new Error('网络地区格式无效');
    if (entry.end !== undefined && !instant(entry.end)) throw new Error('排期结束时间格式无效');
  }
  return input as unknown as Overrides;
}

export class AnimeService {
  private readonly store: CacheStore;
  private readonly now: () => Date;
  private readonly fetcher: NonNullable<Options['fetcher']>;
  private base: CatalogBase | null = null;
  private activeIds: string[] = [];
  private overrides = emptyOverrides();
  private readonly issues: string[] = [];
  private readonly sources: AppStatus['sources'] = { catalog: { fetchedAt: null, error: null }, calendar: { fetchedAt: null, error: null } };
  private refreshPromise: Promise<void> | null = null;
  private readonly details = new Map<string, Promise<AnimeDetail | null>>();
  private readonly creditRequests = new Map<string, Promise<AnimeCredits | null>>();
  private readonly nameRequests = new Map<number, Promise<{ data: CharacterName | null; error: string | null }>>();
  private permits = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly options: Options) {
    this.store = new CacheStore(options.directory); this.now = options.now ?? (() => new Date()); this.fetcher = options.fetcher ?? fetch;
  }
  async initialize(): Promise<void> {
    const [catalog, calendar] = await Promise.all([this.store.read('catalog', normalizeCatalog), this.store.read('calendar', normalizeCalendar)]);
    if (catalog) { this.base = catalog.data; this.sources.catalog.fetchedAt = catalog.fetchedAt; }
    if (calendar) { this.activeIds = calendar.data; this.sources.calendar.fetchedAt = calendar.fetchedAt; }
    try { this.overrides = readOverrides(JSON.parse(await readFile(this.options.overridesPath ?? join(dirname(this.options.directory), 'data', 'overrides.json'), 'utf8'))); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) this.issues.push(`人工修正未加载：${error instanceof Error ? error.message : '未知错误'}`); }
  }
  status(): AppStatus {
    return { appId: 'anime-calendar', version: '1.0.0', refreshing: this.refreshPromise !== null, hasCatalog: this.base !== null, sources: structuredClone(this.sources), warnings: [...new Set([...this.issues, ...this.store.warnings, ...(this.catalog()?.warnings ?? [])])] };
  }
  catalog(): CatalogSnapshot | null {
    if (!this.base) return null;
    const items = this.base.items.map(anime => {
      const override = this.overrides.rules?.find(x => x.animeId === anime.id);
      if (!override) return anime;
      const item: Anime = { ...anime, rule: { ...anime.rule }, broadcastRule: { ...anime.broadcastRule }, scheduleNote: override.note, scheduleSource: override.sourceUrl };
      if (override.kind === 'broadcast') { item.rule = { ...item.broadcastRule }; delete item.networkAiring; }
      if (typeof override.broadcast === 'string') {
        item.rule = override.kind === 'network'
          ? parseNetworkRule(override.broadcast, override.broadcast.split('/')[1], override.end ?? '', item.begin, item.broadcastRule)
          : parseRule(override.broadcast, item.begin, override.end ?? item.broadcastRule.end ?? '');
        if (override.kind !== 'network') { item.broadcastRule = { ...item.rule }; delete item.networkAiring; }
      }
      if (override.kind === 'network') item.networkAiring = { platform: override.platform!, regions: override.regions ?? [], begin: item.rule.anchor!, rule: item.rule, sourceUrl: override.sourceUrl };
      if (override.dateOnly) { item.begin = /^\d{4}-\d\d-\d\d$/.test(item.begin) ? item.begin : dateKey(item.begin, 'Asia/Tokyo'); item.rule = { ...item.rule, anchor: null, frequency: 'unknown', raw: '' }; delete item.networkAiring; }
      return item;
    });
    const warnings = [...this.base.warnings];
    for (const item of items) if (this.activeIds.includes(item.id) && item.rule.end && Date.parse(item.rule.end) < this.now().getTime()) warnings.push(`来源冲突：${item.title}（${item.id}）仍在放送名单中，但已有结束日期；不继续展开周期。`);
    return { schemaVersion: 1, items, warnings, activeIds: this.activeIds, overrides: this.overrides, fetchedAt: { catalog: this.sources.catalog.fetchedAt, calendar: this.sources.calendar.fetchedAt } };
  }
  refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }
  private async performRefresh(): Promise<void> {
    await Promise.all((['catalog', 'calendar'] as const).map(async source => {
      try {
        const raw = await this.request(source === 'catalog' ? CATALOG_URL : CALENDAR_URL);
        const normalized = source === 'catalog' ? normalizeCatalog(raw) : normalizeCalendar(raw);
        const at = this.now().toISOString(); await this.store.write(source, raw, at);
        if (source === 'catalog') this.base = normalized as CatalogBase; else this.activeIds = normalized as string[];
        this.sources[source] = { fetchedAt: at, error: null };
      } catch (error) { this.sources[source].error = error instanceof Error ? error.message : '获取失败'; }
    }));
  }
  needsRefresh(): boolean {
    return Object.values(this.sources).some(source => !source.fetchedAt || this.now().getTime() - Date.parse(source.fetchedAt) >= 6 * HOUR);
  }
  detail(id: string): Promise<AnimeDetail | null> {
    const pending = this.details.get(id); if (pending) return pending;
    const task = this.loadDetail(id).finally(() => this.details.delete(id)); this.details.set(id, task); return task;
  }
  private async loadDetail(id: string): Promise<AnimeDetail | null> {
    const anime = this.catalog()?.items.find(x => x.id === id); if (!anime) return null;
    const fallback: AnimeDetail = { ...anime, summary: '', image: null, episodes: null, tags: [], staff: [], rating: null, detailFetchedAt: null, detailError: null };
    if (!anime.bangumiId) return { ...fallback, detailError: '缺少 Bangumi 关联，仍可查看基础信息。' };
    const key = `detail-${createHash('sha256').update(id).digest('hex').slice(0, 24)}`;
    const cached = await this.store.read(key, data => metadata(data, anime.bangumiId!));
    if (cached && this.now().getTime() - Date.parse(cached.fetchedAt) < 24 * HOUR) return { ...fallback, ...cached.data, detailFetchedAt: cached.fetchedAt };
    try {
      const raw = await this.request(`https://api.bgm.tv/v0/subjects/${anime.bangumiId}`), data = metadata(raw, anime.bangumiId), at = this.now().toISOString();
      await this.store.write(key, raw, at); return { ...fallback, ...data, detailFetchedAt: at };
    } catch (error) {
      return { ...fallback, ...(cached?.data ?? {}), detailFetchedAt: cached?.fetchedAt ?? null, detailError: `详情获取失败：${error instanceof Error ? error.message : '未知错误'}。可稍后重试。` };
    }
  }
  credits(id: string): Promise<AnimeCredits | null> {
    const pending = this.creditRequests.get(id); if (pending) return pending;
    const task = this.loadCredits(id).finally(() => this.creditRequests.delete(id)); this.creditRequests.set(id, task); return task;
  }
  private async loadCredits(id: string): Promise<AnimeCredits | null> {
    const anime = this.catalog()?.items.find(item => item.id === id); if (!anime) return null;
    if (!anime.bangumiId) {
      const source = { fetchedAt: null, error: '缺少 Bangumi 关联，暂时无法获取制作与配音资料。' };
      return { staff: [], cast: [], sources: { staff: source, cast: source } };
    }
    const [detail, staff, cast] = await Promise.all([
      this.detail(id),
      this.creditSource(anime.bangumiId, 'persons', normalizeStaff),
      this.creditSource(anime.bangumiId, 'characters', normalizeCast),
    ]);
    return { staff: mergeStaff(staff.data, detail?.staff ?? []), cast: cast.data, sources: { staff: staff.source, cast: cast.source } };
  }
  private async creditSource<T>(id: number, kind: 'persons' | 'characters', normalize: (value: unknown) => T[]): Promise<{ data: T[]; source: { fetchedAt: string | null; error: string | null } }> {
    const key = `credits-${kind}-${id}`, cached = await this.store.read(key, normalize);
    if (cached && this.now().getTime() - Date.parse(cached.fetchedAt) < 24 * HOUR) return { data: cached.data, source: { fetchedAt: cached.fetchedAt, error: null } };
    try {
      const raw = await this.request(`https://api.bgm.tv/v0/subjects/${id}/${kind}`), data = normalize(raw), at = this.now().toISOString();
      await this.store.write(key, raw, at); return { data, source: { fetchedAt: at, error: null } };
    } catch (error) { return { data: cached?.data ?? [], source: { fetchedAt: cached?.fetchedAt ?? null, error: `${kind === 'persons' ? '制作资料' : '角色配音'}获取失败：${error instanceof Error ? error.message : '未知错误'}。可稍后重试。` } }; }
  }
  async characterNames(id: string, offset = 0): Promise<CharacterNames | null> {
    const anime = this.catalog()?.items.find(item => item.id === id); if (!anime) return null;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('角色分页位置无效');
    if (!anime.bangumiId) return { names: [], error: '缺少关联，无法补充中文角色名。' };
    const cast = await this.creditSource(anime.bangumiId, 'characters', normalizeCast);
    const visible = cast.data.slice(offset, offset + 8);
    const results = await Promise.all(visible.map(character => this.characterName(character.id)));
    return { names: results.map((result, index) => result.data ?? { id: visible[index].id, name: visible[index].name, originalName: visible[index].name }), error: cast.source.error || (results.some(result => result.error) ? '部分中文角色名未能获取，已保留缓存或原名，可重试。' : null) };
  }
  private characterName(id: number): Promise<{ data: CharacterName | null; error: string | null }> {
    const pending = this.nameRequests.get(id); if (pending) return pending;
    const task = this.loadCharacterName(id).finally(() => this.nameRequests.delete(id)); this.nameRequests.set(id, task); return task;
  }
  private async loadCharacterName(id: number): Promise<{ data: CharacterName | null; error: string | null }> {
    const key = `character-name-${id}`, cached = await this.store.read(key, value => normalizeCharacterName(value, id));
    if (cached && this.now().getTime() - Date.parse(cached.fetchedAt) < 24 * HOUR) return { data: cached.data, error: null };
    try {
      const raw = await this.request(`https://api.bgm.tv/v0/characters/${id}`), data = normalizeCharacterName(raw, id);
      await this.store.write(key, raw, this.now().toISOString()); return { data, error: null };
    } catch (error) { return { data: cached?.data ?? null, error: error instanceof Error ? error.message : '角色名获取失败' }; }
  }
  private async request(url: string): Promise<unknown> {
    if (this.permits < 2) this.permits++; else await new Promise<void>(resolve => this.waiting.push(resolve));
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await this.fetcher(url, { headers: { accept: 'application/json', 'user-agent': 'Kano/anime-calendar/1.0.0 (local personal calendar)' }, signal: AbortSignal.timeout(45_000) });
        if (response.ok) return await response.json();
        await response.body?.cancel();
        if (attempt === 0 && [429, 503].includes(response.status)) { await new Promise(resolve => setTimeout(resolve, Math.min(3, Number(response.headers.get('retry-after')) || 1) * 1000)); continue; }
        throw new Error(`上游返回 HTTP ${response.status}`);
      }
      throw new Error('请求未完成');
    } finally { const next = this.waiting.shift(); if (next) next(); else this.permits--; }
  }
}

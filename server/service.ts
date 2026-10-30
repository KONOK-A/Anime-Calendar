import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { Anime, AnimeCredits, AnimeDetail, AppStatus, CatalogBase, CatalogSnapshot, CharacterName, CharacterNames, Overrides } from '../shared/types.js';
import { CacheStore } from './cache.js';
import { instant, isRecord, normalizeCalendar, normalizeCatalog, parseNetworkRule, parseRule, safeUrl } from './normalize.js';
import { dateKey } from '../shared/schedule.js';
import { infoboxStaff, mergeStaff, normalizeCast, normalizeCharacterName, normalizeStaff } from './credits.js';
import { UpstreamClient } from './upstream.js';
import { ResourceCache } from './resources.js';
import { PosterError, PosterStore } from './posters.js';

interface Options { directory: string; now?: () => Date; fetcher?: (url: string, init?: RequestInit) => Promise<Response>; overridesPath?: string; observe?: (event: Record<string, unknown>) => void }
const CATALOG_URL = 'https://raw.githubusercontent.com/bangumi-data/bangumi-data/master/dist/data.json';
const CALENDAR_URL = 'https://api.bgm.tv/calendar';
const HOUR = 3_600_000;
const emptyOverrides = (): Overrides => ({ version: 1, active: [], events: [], rules: [] });
type Metadata = Pick<AnimeDetail, 'summary' | 'image' | 'imageVariants' | 'episodes' | 'tags' | 'staff' | 'rating'>;

function metadata(input: unknown, id: number): Metadata {
  if (!isRecord(input) || input.id !== id || typeof input.name !== 'string') throw new Error('作品详情响应无效');
  const images = isRecord(input.images) ? input.images : {};
  const episodes = Number(input.eps) > 0 ? Number(input.eps) : Number(input.total_episodes) > 0 ? Number(input.total_episodes) : null;
  const sourceRating = isRecord(input.rating) ? input.rating : null;
  const rating = sourceRating && typeof sourceRating.score === 'number' && Number.isFinite(sourceRating.score) && sourceRating.score > 0 && sourceRating.score <= 10 && typeof sourceRating.total === 'number' && Number.isSafeInteger(sourceRating.total) && sourceRating.total > 0
    ? { score: sourceRating.score, total: sourceRating.total, rank: typeof sourceRating.rank === 'number' && Number.isSafeInteger(sourceRating.rank) && sourceRating.rank > 0 ? sourceRating.rank : null } : null;
  const image = safeUrl(images.large) ?? safeUrl(images.common) ?? safeUrl(images.medium);
  return { summary: typeof input.summary === 'string' ? input.summary : '', image, imageVariants: { thumb: safeUrl(images.small) ?? safeUrl(images.common) ?? image, card: safeUrl(images.common) ?? safeUrl(images.medium) ?? image, hero: safeUrl(images.medium) ?? image }, episodes, rating, staff: infoboxStaff(input.infobox), tags: Array.isArray(input.tags) ? input.tags.filter(isRecord).map(x => x.name).filter((x): x is string => typeof x === 'string').slice(0, 12) : [] };
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
  readonly upstream: UpstreamClient;
  private readonly resources: ResourceCache;
  readonly posters: PosterStore;
  private base: CatalogBase | null = null;
  private activeIds: string[] = [];
  private overrides = emptyOverrides();
  private readonly issues = new Map<string, string>();
  private readonly sources: AppStatus['sources'] = { catalog: { fetchedAt: null, error: null }, calendar: { fetchedAt: null, error: null } };
  private refreshPromise: Promise<void> | null = null;
  private maintenancePromise: Promise<void> | null = null;
  private readonly details = new Map<string, Promise<AnimeDetail | null>>();
  private readonly creditRequests = new Map<string, Promise<AnimeCredits | null>>();
  private readonly characterRequests = new Map<string, Promise<CharacterNames | null>>();
  private snapshot: CatalogSnapshot | null = null;
  private readonly byId = new Map<string, Anime>();
  private nextBoundary = Infinity;
  private snapshotAt = -Infinity;
  private statusVersion = 0;
  private readonly sourceRaw = new Map<string, unknown>();
  private readonly validators = new Map<string, { etag?: string; lastModified?: string }>();
  private readonly retries = new Map<string, { at: number; failures: number }>();

  constructor(private readonly options: Options) {
    this.store = new CacheStore(options.directory); this.now = options.now ?? (() => new Date()); this.upstream = new UpstreamClient(options.fetcher, options.observe);
    this.resources = new ResourceCache(this.store, this.upstream, this.now);
    this.posters = new PosterStore(join(options.directory, 'media'), this.upstream, async (id, size) => {
      if (!this.catalog()) throw new PosterError('目录正在初始化。', 503);
      if (!this.item(id)) throw new PosterError('当前目录未收录该作品。', 404);
      const detail = await this.detail(id);
      return detail?.imageVariants?.[size] ?? detail?.image ?? null;
    });
  }
  async initialize(): Promise<void> {
    const [catalog, calendar] = await Promise.all([this.store.read('catalog', normalizeCatalog), this.store.read('calendar', normalizeCalendar)]);
    if (catalog) { this.base = catalog.data; this.sources.catalog.fetchedAt = catalog.fetchedAt; }
    if (calendar) { this.activeIds = calendar.data; this.sources.calendar.fetchedAt = calendar.fetchedAt; }
    for (const [key, value] of [['catalog', catalog], ['calendar', calendar]] as const) if (value) { this.sourceRaw.set(key, value.raw); if (value.validators) this.validators.set(key, value.validators); }
    try { this.overrides = readOverrides(JSON.parse(await readFile(this.options.overridesPath ?? join(dirname(this.options.directory), 'data', 'overrides.json'), 'utf8'))); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) this.issues.set('overrides', `人工修正未加载：${error instanceof Error ? error.message : '未知错误'}`); }
    await this.store.maintain().catch(() => this.issues.set('cache-maintenance', '缓存容量整理暂未完成，已有资料仍可使用。'));
  }
  status(catalog: CatalogSnapshot | null = this.catalog()): AppStatus {
    return { appId: 'anime-calendar', version: '1.0.0', refreshing: this.refreshPromise !== null, hasCatalog: this.base !== null, sources: structuredClone(this.sources), warnings: [...new Set([...this.issues.values(), ...this.store.warnings, ...this.posters.warnings, ...(catalog?.warnings ?? [])])] };
  }
  catalog(): CatalogSnapshot | null {
    if (!this.base) return null;
    const at = this.now().getTime();
    if (this.snapshot && at >= this.snapshotAt && at < this.nextBoundary) return this.snapshot;
    const rules = new Map(this.overrides.rules?.map(rule => [rule.animeId, rule]));
    const items = this.snapshot?.items ?? this.base.items.map(anime => {
      const override = rules.get(anime.id);
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
    const active = new Set(this.activeIds); this.nextBoundary = Infinity;
    for (const item of items) {
      if (item.rule.end) { const end = Date.parse(item.rule.end); if (end >= at) this.nextBoundary = Math.min(this.nextBoundary, end + 1); if (active.has(item.id) && end < at) warnings.push(`来源冲突：${item.title}（${item.id}）仍在放送名单中，但已有结束日期；不继续展开周期。`); }
    }
    this.snapshotAt = at;
    this.byId.clear(); for (const item of items) this.byId.set(item.id, item);
    return this.snapshot = { schemaVersion: 1, items, warnings, activeIds: this.activeIds, overrides: this.overrides, fetchedAt: { catalog: this.sources.catalog.fetchedAt, calendar: this.sources.calendar.fetchedAt } };
  }
  item(id: string): Anime | undefined { this.catalog(); return this.byId.get(id); }
  epoch(): string { this.catalog(); return `${this.statusVersion}:${this.store.revision}:${this.posters.revision}:${this.snapshotAt}`; }
  async drain(): Promise<void> {
    do {
      await Promise.allSettled([this.refreshPromise, this.maintenancePromise, ...this.details.values(), ...this.creditRequests.values(), ...this.characterRequests.values(), this.resources.drain(), this.posters.drain()]);
      await this.resources.drain(); await this.store.drain(); await this.upstream.idle();
    } while (this.refreshPromise || this.maintenancePromise || this.details.size || this.creditRequests.size || this.characterRequests.size);
  }
  close(): void { this.upstream.close(); }
  refresh(mode: 'all' | 'stale' = 'all'): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.statusVersion++;
    this.refreshPromise = this.performRefresh(mode).finally(() => { this.refreshPromise = null; this.statusVersion++; });
    return this.refreshPromise;
  }
  private async performRefresh(mode: 'all' | 'stale'): Promise<void> {
    const started = Date.now(), selected = (['catalog', 'calendar'] as const).filter(source => mode === 'all' || this.sourceIsDue(source));
    await Promise.all(selected.map(async source => {
      try {
        const previous = this.validators.get(source), headers: Record<string, string> = {};
        if (previous?.etag) headers['if-none-match'] = previous.etag;
        if (previous?.lastModified) headers['if-modified-since'] = previous.lastModified;
        const response = await this.upstream.request(source === 'catalog' ? CATALOG_URL : CALENDAR_URL, { timeoutMs: 60_000, maxBytes: source === 'catalog' ? 16 * 1024 * 1024 : 4 * 1024 * 1024, background: mode === 'stale', headers });
        const raw = response.status === 304 ? this.sourceRaw.get(source) : JSON.parse(response.bytes.toString('utf8')) as unknown;
        const normalized = source === 'catalog' ? normalizeCatalog(raw) : normalizeCalendar(raw);
        const at = this.now().toISOString(), validators = { etag: response.headers.get('etag') ?? previous?.etag, lastModified: response.headers.get('last-modified') ?? previous?.lastModified };
        try { await this.store.write(source, raw, at, validators); this.issues.delete(`source-${source}`); } catch { this.issues.set(`source-${source}`, `来源 ${source} 已更新，但缓存未保存。`); }
        if (source === 'catalog') this.base = normalized as CatalogBase; else this.activeIds = normalized as string[];
        this.sourceRaw.set(source, raw); this.validators.set(source, validators); this.retries.delete(source);
        this.sources[source] = { fetchedAt: at, error: null };
        this.snapshot = null; this.statusVersion++;
      } catch (error) {
        this.sources[source].error = error instanceof Error ? error.message : '获取失败';
        const failures = (this.retries.get(source)?.failures ?? 0) + 1;
        this.retries.set(source, { at: this.now().getTime() + Math.min(60, 15 * 2 ** (failures - 1)) * 60_000, failures }); this.statusVersion++;
      }
    }));
    this.options.observe?.({ event: 'refresh', mode, durationMs: Date.now() - started, results: selected.map(source => ({ source, ok: !this.sources[source].error, fetchedAt: this.sources[source].fetchedAt })) });
  }
  private sourceIsDue(source: 'catalog' | 'calendar') { const value = this.sources[source]; return (!value.fetchedAt || this.now().getTime() - Date.parse(value.fetchedAt) >= 6 * HOUR) && (this.retries.get(source)?.at ?? 0) <= this.now().getTime(); }
  needsRefresh(): boolean {
    return (['catalog', 'calendar'] as const).some(source => this.sourceIsDue(source));
  }
  detail(id: string, wait = false): Promise<AnimeDetail | null> {
    const key = `${id}:${wait}`, pending = this.details.get(key); if (pending) return pending;
    const task = this.loadDetail(id, wait).finally(() => this.details.delete(key)); this.details.set(key, task); return task;
  }
  private async loadDetail(id: string, wait: boolean): Promise<AnimeDetail | null> {
    const anime = this.item(id); if (!anime) return null;
    const fallback: AnimeDetail = { ...anime, summary: '', image: null, episodes: null, tags: [], staff: [], rating: null, detailFetchedAt: null, detailError: null };
    if (!anime.bangumiId) return { ...fallback, detailError: '缺少 Bangumi 关联，仍可查看基础信息。' };
    const key = `detail-${createHash('sha256').update(id).digest('hex').slice(0, 24)}`;
    const result = await this.resources.get(key, `https://api.bgm.tv/v0/subjects/${anime.bangumiId}`, raw => metadata(raw, anime.bangumiId!), wait);
    return { ...fallback, ...(result.data ?? {}), detailFetchedAt: result.fetchedAt, detailError: result.error, ...(result.revalidating ? { revalidating: true } : {}) };
  }
  credits(id: string, wait = false): Promise<AnimeCredits | null> {
    const key = `${id}:${wait}`, pending = this.creditRequests.get(key); if (pending) return pending;
    const task = this.loadCredits(id, wait).finally(() => this.creditRequests.delete(key)); this.creditRequests.set(key, task); return task;
  }
  private async loadCredits(id: string, wait: boolean): Promise<AnimeCredits | null> {
    const anime = this.item(id); if (!anime) return null;
    if (!anime.bangumiId) {
      const source = { fetchedAt: null, error: '缺少 Bangumi 关联，暂时无法获取制作与配音资料。' };
      return { staff: [], cast: [], sources: { staff: source, cast: source } };
    }
    const [detail, staff, cast] = await Promise.all([this.detail(id, wait), this.creditSource(anime.bangumiId, 'persons', normalizeStaff, wait), this.creditSource(anime.bangumiId, 'characters', normalizeCast, wait)]);
    return { staff: mergeStaff(staff.data, detail?.staff ?? []), cast: cast.data, sources: { staff: staff.source, cast: cast.source }, ...(detail?.revalidating || staff.source.revalidating || cast.source.revalidating ? { revalidating: true } : {}) };
  }
  private async creditSource<T>(id: number, kind: 'persons' | 'characters', normalize: (value: unknown) => T[], wait = false): Promise<{ data: T[]; source: { fetchedAt: string | null; error: string | null; revalidating?: boolean } }> {
    const result = await this.resources.get(`credits-${kind}-${id}`, `https://api.bgm.tv/v0/subjects/${id}/${kind}`, normalize, wait);
    return { data: result.data ?? [], source: { fetchedAt: result.fetchedAt, error: result.error, ...(result.revalidating ? { revalidating: true } : {}) } };
  }
  characterNames(id: string, offset = 0, wait = false): Promise<CharacterNames | null> {
    const key = `${id}:${offset}:${wait}`, existing = this.characterRequests.get(key); if (existing) return existing;
    const task = this.loadCharacterNames(id, offset, wait).finally(() => this.characterRequests.delete(key)); this.characterRequests.set(key, task); return task;
  }
  private async loadCharacterNames(id: string, offset: number, wait: boolean): Promise<CharacterNames | null> {
    const anime = this.item(id); if (!anime) return null;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('角色分页位置无效');
    if (!anime.bangumiId) return { names: [], error: '缺少关联，无法补充中文角色名。' };
    const cast = await this.creditSource(anime.bangumiId, 'characters', normalizeCast, wait), visible = cast.data.slice(offset, offset + 8);
    const results = await Promise.all(visible.map(character => this.resources.get(`character-name-${character.id}`, `https://api.bgm.tv/v0/characters/${character.id}`, raw => normalizeCharacterName(raw, character.id), wait)));
    return { names: results.map((result, index) => result.data ?? { id: visible[index].id, name: visible[index].name, originalName: visible[index].name }), error: cast.source.error || (results.some(result => result.error) ? '部分中文角色名未能获取，已保留缓存或原名，可重试。' : null), ...(cast.source.revalidating || results.some(result => result.revalidating) ? { revalidating: true } : {}) };
  }
  private maintenanceAt = 0;
  maintain(): Promise<void> {
    if (this.maintenancePromise) return this.maintenancePromise;
    if (Date.now() - this.maintenanceAt < 3_600_000) return Promise.resolve();
    this.maintenanceAt = Date.now();
    return this.maintenancePromise = Promise.all([this.store.maintain(), this.posters.maintain()]).then(() => { this.issues.delete('cache-maintenance'); }).finally(() => { this.maintenancePromise = null; });
  }
}

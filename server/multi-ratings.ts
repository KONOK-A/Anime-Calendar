import { createHash } from 'node:crypto';
import type { AnimeRating } from '../shared/types.js';
import { summarizeRatings, validProviderRating, type ProviderRating, type RatingProvider, type RatingSummary } from '../shared/scores.js';
import { CacheStore } from './cache.js';
import { UpstreamClient, UpstreamError } from './upstream.js';
import { parseAniListRating, parseFilmarksRating, parseMalRating, parseMalPageRating, type FilmarksLink, type ParsedRating } from './rating-providers.js';

export interface RatingItem { id: string; bangumiId: number | null; externalIds?: { mal?: number; aniList?: number } }
export interface BangumiRatingState { rating: AnimeRating | null; fetchedAt: string | null; error?: string | null; fetchFailed?: boolean; revalidating?: boolean }
export interface MultiRatingOptions {
  store: CacheStore; upstream: UpstreamClient; now: () => Date; malClientId?: string; aniListEnabled?: boolean;
  filmarksLink?: (item: RatingItem) => FilmarksLink | null | undefined;
}
interface Spec { provider: Exclude<RatingProvider, 'bangumi'>; url: string; link: string; maxScore: 5 | 10 | 100; headers?: Record<string, string>; method?: 'POST'; body?: string; parse: (raw: string) => ParsedRating }
interface State { source: ProviderRating; retryUntil: number }
interface Queued { spec: Spec; run: () => Promise<ProviderRating>; resolve: (value: ProviderRating) => void; reject: (error: Error) => void }
interface SourceResult { source: ProviderRating; revalidating: boolean; retryAfterMs?: number }
const DAY = 24 * 3_600_000;
const validId = (id: unknown): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
const intervals = { mal: 1100, filmarks: 1500, anilist: 2100 };
function providerFailure(error: unknown): boolean {
  if (!(error instanceof UpstreamError)) return true;
  if (/队列|排队|关闭/.test(error.message)) return false;
  const http = /^上游返回 HTTP (\d{3})$/.exec(error.message), status = http ? Number(http[1]) : 0;
  return error.statusCode === 504 || (error.retryAt ?? 0) > Date.now() || status === 429 || status >= 500;
}
export const ratingCacheKey = (provider: Spec['provider'], url: string) => `ratings-${provider}-${createHash('sha256').update(url).digest('hex').slice(0, 24)}`;

/** Ratings own only their bounded background queue; HTTP retries/concurrency remain with UpstreamClient. */
export class MultiRatingService {
  private readonly states = new Map<string, State>();
  private readonly pending = new Map<string, Promise<ProviderRating>>();
  private readonly lookups = new Map<string, Promise<ProviderRating | null>>();
  private readonly missing = new Map<string, number>();
  private readonly queue: Queued[] = [];
  private readonly starts = new Map<Spec['provider'], number>();
  private readonly providerFailures = new Map<Spec['provider'], number>();
  private active = false;
  private closed = false;
  private version = 0;
  private wake?: ReturnType<typeof setTimeout>;
  constructor(private readonly options: MultiRatingOptions) {}

  get revision(): number { return this.version; }
  get(item: RatingItem, bangumi: BangumiRatingState, wait = false, budgetMs = 15_000): Promise<RatingSummary> {
    const deadline = Date.now() + (Number.isFinite(budgetMs) ? Math.max(0, Math.min(15_000, budgetMs)) : 15_000);
    return this.summary(item, bangumi, wait, true, deadline);
  }
  peek(item: RatingItem, bangumi: BangumiRatingState): Promise<RatingSummary> { return this.summary(item, bangumi, false, false, 0); }
  peekKnown(item: RatingItem, bangumi: BangumiRatingState): RatingSummary {
    const sources = (['mal', 'filmarks', 'anilist'] as const).map(provider => {
      const spec = this.describe(item, provider);
      if (!('parse' in spec)) return { source: spec, revalidating: false };
      const key = ratingCacheKey(provider, spec.body ? `${spec.url}|${spec.body}` : spec.url);
      const source: ProviderRating = this.states.get(key)?.source ?? { provider, score: null, maxScore: spec.maxScore, votes: null, url: spec.link, fetchedAt: null, status: 'unavailable' };
      const revalidating = this.pending.has(key);
      return { source, revalidating, retryAfterMs: this.retryAfter(key, spec, source, revalidating) };
    });
    return this.combine(item, bangumi, sources);
  }
  private async summary(item: RatingItem, bangumi: BangumiRatingState, wait: boolean, refresh: boolean, deadline: number): Promise<RatingSummary> {
    const sources = await Promise.all((['mal', 'filmarks', 'anilist'] as const).map(provider => this.source(item, provider, wait, refresh, deadline)));
    return this.combine(item, bangumi, sources);
  }
  private combine(item: RatingItem, bangumi: BangumiRatingState, sources: SourceResult[]): RatingSummary {
    const original: ProviderRating = { provider: 'bangumi', score: bangumi.rating?.score ?? null, maxScore: 10, votes: bangumi.rating?.total ?? null, url: validId(item.bangumiId) ? `https://bgm.tv/subject/${item.bangumiId}` : null, fetchedAt: bangumi.fetchedAt, status: bangumi.rating ? 'ready' : !validId(item.bangumiId) ? 'unlinked' : (bangumi.fetchFailed ?? !!bangumi.error) ? 'unavailable' : 'unrated', ...(bangumi.error ? { error: bangumi.error } : {}) };
    const checked: ProviderRating = validProviderRating(original) ? original : { provider: 'bangumi', score: null, maxScore: 10, votes: null, url: null, fetchedAt: null, status: 'unavailable', error: 'Bangumi 评分数据无效。' };
    const summary = summarizeRatings([checked, ...sources.map(value => value.source)], undefined, !!bangumi.revalidating || sources.some(value => value.revalidating));
    const retries = sources.flatMap(value => value.retryAfterMs === undefined ? [] : [value.retryAfterMs]);
    return retries.length ? { ...summary, retryAfterMs: Math.min(...retries) } : summary;
  }
  private describe(item: RatingItem, provider: Spec['provider']): Spec | ProviderRating {
    const empty = (status: ProviderRating['status'], maxScore: ProviderRating['maxScore'], error?: string): ProviderRating => ({ provider, score: null, maxScore, votes: null, url: null, fetchedAt: null, status, ...(error ? { error } : {}) });
    if (provider === 'mal') {
      const id = item.externalIds?.mal;
      if (!validId(id)) return empty('unlinked', 10);
      const official = !!this.options.malClientId?.trim();
      return { provider, maxScore: 10, url: official ? `https://api.myanimelist.net/v2/anime/${id}?fields=mean,num_scoring_users` : `https://myanimelist.net/anime/${id}`, link: `https://myanimelist.net/anime/${id}`, headers: official ? { 'X-MAL-CLIENT-ID': this.options.malClientId!.trim() } : { accept: 'text/html' }, parse: text => official ? parseMalRating(JSON.parse(text), id, 'official') : parseMalPageRating(text, id) };
    }
    if (provider === 'anilist') {
      const id = item.externalIds?.aniList;
      if (this.options.aniListEnabled === false) return { ...empty('disabled', 100, 'AniList 评分来源已在当前配置中关闭。'), url: validId(id) ? `https://anilist.co/anime/${id}` : null };
      if (!validId(id)) return empty('unlinked', 100);
      const query = `{Media(id:${id},type:ANIME){id type averageScore stats{scoreDistribution{score amount}}}}`;
      return { provider, maxScore: 100, url: 'https://graphql.anilist.co/', method: 'POST', body: JSON.stringify({ query }), headers: { 'content-type': 'application/json' }, link: `https://anilist.co/anime/${id}`, parse: text => parseAniListRating(JSON.parse(text), id) };
    }
    const link = this.options.filmarksLink?.(item);
    if (!link || !validId(link.seriesId) || !validId(link.seasonId)) return empty('unlinked', 5);
    const url = `https://filmarks.com/animes/${link.seriesId}/${link.seasonId}`;
    return { provider, maxScore: 5, url, link: url, headers: { accept: 'text/html' }, parse: text => parseFilmarksRating(text, link) };
  }
  private remember(key: string, state: State) {
    const previous = this.states.get(key);
    if (previous !== state && (!previous || JSON.stringify(previous.source) !== JSON.stringify(state.source))) this.version++;
    this.missing.delete(key);
    this.states.delete(key); this.states.set(key, state);
    while (this.states.size > 256) { this.states.delete(this.states.keys().next().value!); this.version++; }
  }
  private cooling(provider: Spec['provider']): boolean { return (this.providerFailures.get(provider) ?? 0) > this.options.now().getTime(); }
  private retryAfter(key: string, spec: Spec, source: ProviderRating, revalidating: boolean): number | undefined {
    if (this.closed || revalidating || source.status === 'unrated' && !source.error) return;
    const now = this.options.now().getTime();
    if (source.fetchedAt && now - Date.parse(source.fetchedAt) < DAY && !source.error) return;
    const until = Math.max(this.states.get(key)?.retryUntil ?? 0, this.providerFailures.get(spec.provider) ?? 0);
    const remaining = Math.ceil(until - now);
    if (Number.isSafeInteger(remaining) && remaining > 0) return remaining;
    // A full rating queue did not create a task for this resource. Keep that
    // distinct from revalidating, while allowing a bounded caller to try later.
    if (source.status === 'unavailable' && this.pending.size >= 96) return 1000;
  }
  private unavailable(spec: Spec, cached: ProviderRating | null): ProviderRating {
    return { ...(cached ?? { provider: spec.provider, score: null, maxScore: spec.maxScore, votes: null, url: spec.link, fetchedAt: null, status: 'unavailable' }), error: '评分更新失败，可稍后重试。' };
  }
  private async cached(key: string, spec: Spec): Promise<ProviderRating | null> {
    const known = this.states.get(key); if (known) { this.remember(key, known); return known.source; }
    if ((this.missing.get(key) ?? 0) > this.options.now().getTime()) return null;
    this.missing.delete(key);
    let lookup = this.lookups.get(key);
    if (!lookup) {
      lookup = this.options.store.read(key, value => {
        if (!validProviderRating(value) || value.provider !== spec.provider || value.url !== spec.link || !['ready', 'unrated'].includes(value.status) || value.maxScore !== spec.maxScore) throw new Error('评分缓存身份无效');
        return value;
      }).then(result => {
        if (!result) {
          this.missing.set(key, this.options.now().getTime() + 60_000);
          while (this.missing.size > 256) this.missing.delete(this.missing.keys().next().value!);
          return null;
        }
        const source = { ...result.data, fetchedAt: result.fetchedAt }; this.remember(key, { source, retryUntil: 0 }); return source;
      }).finally(() => { this.lookups.delete(key); });
      this.lookups.set(key, lookup);
    }
    return lookup;
  }
  private async source(item: RatingItem, provider: Spec['provider'], wait: boolean, refresh: boolean, deadline: number): Promise<SourceResult> {
    const described = this.describe(item, provider);
    if (!('parse' in described)) return { source: described, revalidating: false };
    const spec = described, key = ratingCacheKey(provider, spec.body ? `${spec.url}|${spec.body}` : spec.url);
    // Pending work already owns its cold lookup; polling must not reopen the same missing file.
    const known = this.states.get(key);
    if (known) this.remember(key, known);
    const cached = known?.source ?? (this.pending.has(key) ? null : await this.cached(key, spec));
    const fallback: ProviderRating = cached ?? { provider, score: null, maxScore: spec.maxScore, votes: null, url: spec.link, fetchedAt: null, status: 'unavailable' };
    let task = this.pending.get(key);
    const fresh = !!cached?.fetchedAt && this.options.now().getTime() - Date.parse(cached.fetchedAt) < DAY;
    if (!task && !fresh && this.cooling(provider)) { const source = this.unavailable(spec, cached); return { source, revalidating: false, retryAfterMs: this.retryAfter(key, spec, source, false) }; }
    if (!task && !this.closed && refresh && !fresh && (this.states.get(key)?.retryUntil ?? 0) <= this.options.now().getTime()) {
      if (this.pending.size >= 96) return { source: { ...fallback, error: '评分更新任务较多，请稍后重试。' }, revalidating: false, retryAfterMs: 1000 };
      task = this.enqueue(spec, () => this.load(key, spec, cached)).catch(() => ({ ...fallback, error: '评分服务正在关闭。' })).finally(() => { this.pending.delete(key); this.version++; });
      this.pending.set(key, task); this.version++;
    }
    if (task && wait) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const remaining = Math.max(0, deadline - Date.now());
      if (!remaining) return { source: fallback, revalidating: true };
      const timeout = new Promise<SourceResult>(resolve => { timer = setTimeout(() => resolve({ source: fallback, revalidating: true }), remaining); });
      try { return await Promise.race([task.then(source => ({ source, revalidating: false, retryAfterMs: this.retryAfter(key, spec, source, false) })), timeout]); }
      finally { clearTimeout(timer); }
    }
    return { source: fallback, revalidating: !!task, retryAfterMs: this.retryAfter(key, spec, fallback, !!task) };
  }
  private enqueue(spec: Spec, run: Queued['run']): Promise<ProviderRating> {
    return new Promise((resolve, reject) => { this.queue.push({ spec, run, resolve, reject }); this.pump(); });
  }
  private pump() {
    clearTimeout(this.wake); this.wake = undefined;
    if (this.closed || this.active || !this.queue.length) return;
    const delay = (entry: Queued) => this.cooling(entry.spec.provider) ? 0 : Math.max(0, (this.starts.get(entry.spec.provider) ?? -Infinity) + intervals[entry.spec.provider] - Date.now());
    const index = this.queue.findIndex(entry => delay(entry) === 0);
    if (index < 0) { this.wake = setTimeout(() => this.pump(), Math.min(...this.queue.map(delay))); return; }
    const entry = this.queue.splice(index, 1)[0]; this.active = true;
    if (!this.cooling(entry.spec.provider)) this.starts.set(entry.spec.provider, Date.now());
    void entry.run().then(entry.resolve, entry.reject).finally(() => { this.active = false; this.version++; this.pump(); });
  }
  private async load(key: string, spec: Spec, cached: ProviderRating | null): Promise<ProviderRating> {
    if (this.cooling(spec.provider)) return this.unavailable(spec, cached);
    let received = false;
    try {
      const response = await this.options.upstream.request(spec.url, { background: true, maxBytes: 2 * 1024 * 1024, ...(spec.headers ? { headers: spec.headers } : {}), ...(spec.method ? { method: spec.method, body: spec.body } : {}) });
      received = true;
      const value = spec.parse(response.bytes.toString('utf8')), fetchedAt = this.options.now().toISOString();
      const source: ProviderRating = { provider: spec.provider, ...value, maxScore: spec.maxScore, url: spec.link, fetchedAt, status: value.score === null ? 'unrated' : 'ready' };
      if (!validProviderRating(source)) throw new Error('评分来源响应无效');
      try { await this.options.store.write(key, source, fetchedAt); } catch { source.error = '评分已更新，但缓存未保存。'; }
      this.providerFailures.delete(spec.provider); this.remember(key, { source, retryUntil: 0 }); return source;
    } catch (error) {
      // Never surface upstream HTML/JSON (or credentials) in error messages.
      const source = this.unavailable(spec, cached);
      const retry = error instanceof UpstreamError && error.retryAt ? Math.max(60_000, error.retryAt - Date.now()) : 60_000;
      if (!received && providerFailure(error)) this.providerFailures.set(spec.provider, this.options.now().getTime() + retry);
      this.remember(key, { source, retryUntil: this.options.now().getTime() + retry }); return source;
    }
  }
  close() { this.closed = true; clearTimeout(this.wake); for (const entry of this.queue.splice(0)) entry.reject(new Error('评分服务正在关闭。')); }
  async drain() {
    do { await Promise.allSettled([...this.lookups.values()]); await Promise.allSettled([...this.pending.values()]); await this.options.store.drain(); } while (this.lookups.size || this.pending.size);
  }
}

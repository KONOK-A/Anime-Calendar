import type { Anime, AnimeDetail, SeasonRatingEntry, SeasonRatings } from '../shared/types.js';
import { validRating } from '../shared/ratings.js';
import { validRatingSummary, type RatingSummary } from '../shared/scores.js';
type DetailState = Pick<AnimeDetail, 'rating' | 'detailFetchedAt' | 'detailError' | 'detailFetchFailed' | 'revalidating'>;
export interface SeasonRatingOptions { budgetMs?: number; summary?: (id: string, detail?: DetailState) => Promise<RatingSummary | null>; revision?: () => number }
interface Job {
  signature: string; view: SeasonRatings; until: number; task?: Promise<void>; work?: Promise<void>;
  progress: number; publishedProgress: number; revision?: number;
  entries: Map<string, SeasonRatingEntry>; details: Map<string, { value: DetailState; until: number; changed: boolean }>;
}
const DAY = 24 * 3_600_000;
const failedDetail = (state: DetailState) => state.detailFetchFailed ?? !!state.detailError;
const refreshing = (entry: SeasonRatingEntry) => !!entry.summary?.revalidating || !!entry.summary?.sources.some(source => /任务较多|队列|排队/.test(source.error ?? ''));
export class SeasonRatingService {
  private readonly jobs = new Map<string, Job>();
  private readonly active = new Set<Job>();
  private readonly pending = new Set<Promise<void>>();
  private readonly wakes = new Set<() => void>();
  private closed = false;
  constructor(private readonly detail: (id: string) => Promise<AnimeDetail | null>, private readonly now: () => Date, private readonly options: SeasonRatingOptions = {}) {}
  get(season: string, items: Anime[]): SeasonRatings {
    if (this.closed) throw Object.assign(new Error('评分服务正在关闭。'), { statusCode: 503 });
    const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id)), ids = sorted.map(item => item.id), signature = JSON.stringify(sorted.map(item => [item.id, item.externalIds?.mal ?? null, item.externalIds?.aniList ?? null]));
    const previous = this.jobs.get(season);
    if (previous && previous.signature === signature) {
      const progressed = previous.view.status === 'partial' && (previous.progress !== previous.publishedProgress || this.options.revision && previous.revision !== this.options.revision());
      if (previous.task || previous.until > this.now().getTime() && !progressed) return structuredClone(previous.view);
    }
    const reusable = previous?.signature === signature ? previous : undefined;
    if (ids.length && (!reusable || !this.active.has(reusable)) && this.active.size >= 8) throw Object.assign(new Error('评分任务较多，请稍后重试。'), { statusCode: 503 });
    const view: SeasonRatings = { schemaVersion: 1, scope: { type: 'ratings', key: `ratings:${season}`, season }, ids, entries: [], total: ids.length, processed: 0, status: ids.length ? 'loading' : 'ready', updatedAt: ids.length ? null : this.now().toISOString() };
    if (!ids.length) return view;
    const job: Job = reusable ?? { signature, view, until: 0, progress: 0, publishedProgress: 0, entries: new Map(), details: new Map() };
    job.view = view;
    view.entries = sorted.flatMap(item => job.entries.has(item.id) ? [job.entries.get(item.id)!] : []);
    view.processed = job.entries.size;
    this.jobs.set(season, job);
    if (ids.length) {
      const task = this.fill(job, sorted).finally(() => { job.task = undefined; this.pending.delete(task); });
      job.task = task; this.pending.add(task);
    }
    while (this.jobs.size > 8) { const oldest = [...this.jobs].find(([key, value]) => key !== season && !value.task && !value.work); if (!oldest) break; this.jobs.delete(oldest[0]); }
    return structuredClone(view);
  }
  private async fill(job: Job, items: Anime[]) {
    const entries = job.entries, view = job.view, previousWork = job.work; let sealed = false;
    const retryUntil = job.until, retryAllowed = retryUntil <= this.now().getTime();
    let revision = this.options.revision?.();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    const remember = (entry: SeasonRatingEntry) => { if (entries.get(entry.id) !== entry) { entries.set(entry.id, entry); job.progress++; } };
    const publish = () => { if (sealed || job.view !== view) return; view.entries = items.flatMap(item => entries.has(item.id) ? [entries.get(item.id)!] : []); view.processed = entries.size; view.updatedAt = this.now().toISOString(); };
    const wait = () => new Promise<void>(resolve => {
      const finish = () => { clearTimeout(pause); this.wakes.delete(finish); wake = undefined; resolve(); };
      const pause = setTimeout(finish, 1000); wake = finish; this.wakes.add(finish);
    });
    const readSummary = async (entry: SeasonRatingEntry): Promise<SeasonRatingEntry> => {
      if (!this.options.summary) return entry;
      try {
        const summary = await this.options.summary(entry.id, job.details.get(entry.id)?.value);
        if (!validRatingSummary(summary)) throw new Error('评分摘要暂不可用');
        const failed = summary.sources.some(source => source.status !== 'disabled' && source.status !== 'unlinked' && !!source.error);
        return { ...entry, summary, fetchedAt: summary.fetchedAt ?? entry.fetchedAt, error: failed ? '部分评分来源暂不可用。' : null };
      } catch { return { ...entry, ...(entry.summary ? { summary: { ...entry.summary, revalidating: false } } : {}), error: '综合评分暂不可用。' }; }
    };
    const work = async () => {
      // A previous window may still own real metadata or summary work. Reuse it
      // before scheduling more, keeping both the job slot and two-item limit.
      if (previousWork) await previousWork;
      for (let index = 0; index < items.length && !sealed && !this.closed; index += 2) {
        await Promise.all(items.slice(index, index + 2).map(async item => {
          let value = entries.get(item.id) ?? { id: item.id, rating: null, fetchedAt: null, error: null };
          let known = job.details.get(item.id);
          const metadataExpired = !known || known.until <= this.now().getTime() && (retryAllowed || !failedDetail(known.value));
          if (metadataExpired) {
            let state: DetailState | undefined;
            if (item.bangumiId) try {
              const detail = await this.detail(item.id);
              if (detail) state = { rating: detail.rating, detailFetchedAt: detail.detailFetchedAt, detailError: detail.detailError, detailFetchFailed: detail.detailFetchFailed, revalidating: detail.revalidating };
              if (state && failedDetail(state) && !validRating(state.rating) && validRating(value.rating)) state = { ...state, rating: value.rating, detailFetchedAt: known?.value.detailFetchedAt ?? value.fetchedAt };
              value = { ...value, rating: validRating(state?.rating) ? state.rating : state && !failedDetail(state) ? null : value.rating, fetchedAt: state?.detailFetchedAt ?? value.fetchedAt, error: state ? state.detailError : '作品资料暂不可用。' };
            } catch { value = { ...value, error: '评分暂不可用。' }; }
            const fetched = state?.detailFetchedAt ? Date.parse(state.detailFetchedAt) : NaN;
            known = { value: state ?? { rating: value.rating, detailFetchedAt: value.fetchedAt, detailError: value.error, detailFetchFailed: !!value.error, revalidating: false }, until: !item.bangumiId ? Infinity : Number.isFinite(fetched) ? fetched + DAY : this.now().getTime() + 60_000, changed: true };
            // Metadata survives its snapshot window without publishing an entry
            // whose first summary is still pending.
            job.details.set(item.id, known); job.progress++;
          }
          if (known && (known.changed || !entries.has(item.id))) value = { ...value, rating: validRating(known.value.rating) ? known.value.rating : null, fetchedAt: known.value.detailFetchedAt ?? value.fetchedAt, error: known.value.detailError };
          const summaryExpired = !value.summary?.fetchedAt || Date.parse(value.summary.fetchedAt) + DAY <= this.now().getTime();
          let summarized = false;
          if (!sealed && !this.closed && (known?.changed || !value.summary || refreshing(value) || (value.error ? retryAllowed : summaryExpired))) { value = await readSummary(value); summarized = true; }
          if (summarized || !this.options.summary || !sealed && !this.closed) {
            remember(value); if (known) known.changed = false;
            publish();
          }
        }));
      }
      while (!sealed && !this.closed && [...entries.values()].some(refreshing)) {
        await wait();
        if (sealed || this.closed) break;
        const currentRevision = this.options.revision?.();
        if (this.options.revision && revision === currentRevision) continue;
        revision = currentRevision;
        const updating = [...entries.values()].filter(refreshing), replacements = new Map(entries);
        for (let index = 0; index < updating.length && !sealed && !this.closed; index += 2) {
          await Promise.all(updating.slice(index, index + 2).map(async entry => { replacements.set(entry.id, await readSummary(entry)); }));
        }
        for (const value of replacements.values()) remember(value);
        publish();
      }
    };
    try {
      const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Rating budget exceeded')), Math.min(this.options.budgetMs ?? 45_000, 45_000)); });
      const operation = work(); job.work = operation; this.active.add(job); this.pending.add(operation);
      const clear = () => { this.pending.delete(operation); if (job.work === operation) { job.work = undefined; this.active.delete(job); } };
      void operation.then(clear, clear);
      await Promise.race([operation, deadline]);
    } catch { /* Completed values remain usable; remaining IDs are explicitly unresolved. */ }
    finally {
      sealed = true; clearTimeout(timer); wake?.();
      view.entries = items.map(item => {
        const entry = entries.get(item.id);
        return entry ? refreshing(entry) ? { ...entry, error: entry.error ?? '部分评分来源仍在后台更新，可稍后重试。' } : entry : { id: item.id, rating: null, fetchedAt: null, error: '评分暂未取得，可稍后重试。' };
      });
      view.processed = entries.size;
      job.publishedProgress = job.progress; job.revision = this.options.revision?.();
      view.status = view.entries.some(item => item.error) ? 'partial' : 'ready'; view.updatedAt = this.now().toISOString();
      const dates = view.entries.flatMap(item => item.fetchedAt ? [Date.parse(item.fetchedAt) + DAY] : []);
      job.until = view.status === 'partial' ? retryUntil > this.now().getTime() ? retryUntil : this.now().getTime() + 60_000 : Math.max(this.now().getTime() + 60_000, Math.min(this.now().getTime() + DAY, ...dates));
    }
  }
  close() { this.closed = true; for (const wake of this.wakes) wake(); }
  async drain() { do { await Promise.allSettled([...this.pending]); } while (this.pending.size); }
}

import type { Anime, AnimeDetail, SeasonRatingEntry, SeasonRatings } from '../shared/types.js';
import { validRating } from '../shared/ratings.js';
interface Job { signature: string; view: SeasonRatings; until: number; task?: Promise<void> }
export class SeasonRatingService {
  private readonly jobs = new Map<string, Job>();
  private readonly active = new Set<Promise<void>>();
  private readonly pending = new Set<Promise<void>>();
  private closed = false;
  constructor(private readonly detail: (id: string) => Promise<AnimeDetail | null>, private readonly now: () => Date, private readonly options: { budgetMs?: number } = {}) {}
  get(season: string, items: Anime[]): SeasonRatings {
    if (this.closed) throw Object.assign(new Error('评分服务正在关闭。'), { statusCode: 503 });
    const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id)), ids = sorted.map(item => item.id), signature = ids.join(',');
    const previous = this.jobs.get(season);
    if (previous && previous.signature === signature && (previous.task || previous.until > this.now().getTime())) return structuredClone(previous.view);
    if (ids.length && this.active.size >= 8) throw Object.assign(new Error('评分任务较多，请稍后重试。'), { statusCode: 503 });
    const view: SeasonRatings = { schemaVersion: 1, scope: { type: 'ratings', key: `ratings:${season}`, season }, ids, entries: [], total: ids.length, processed: 0, status: ids.length ? 'loading' : 'ready', updatedAt: ids.length ? null : this.now().toISOString() };
    const job: Job = { signature, view, until: this.now().getTime() + 24 * 3_600_000 };
    this.jobs.set(season, job);
    if (ids.length) {
      const task = this.fill(job, sorted).finally(() => { job.task = undefined; this.pending.delete(task); });
      job.task = task; this.pending.add(task);
    }
    while (this.jobs.size > 8) { const oldest = [...this.jobs].find(([key, value]) => key !== season && !value.task); if (!oldest) break; this.jobs.delete(oldest[0]); }
    return structuredClone(view);
  }
  private async fill(job: Job, items: Anime[]) {
    const entries = new Map<string, SeasonRatingEntry>(); let sealed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = async () => {
      for (let index = 0; index < items.length && !sealed && !this.closed; index += 2) {
        await Promise.all(items.slice(index, index + 2).map(async item => {
          let value: SeasonRatingEntry = { id: item.id, rating: null, fetchedAt: null, error: null };
          if (item.bangumiId) try {
            const detail = await this.detail(item.id);
            value = { id: item.id, rating: validRating(detail?.rating) ? detail.rating : null, fetchedAt: detail?.detailFetchedAt ?? null, error: detail ? detail.detailError : '作品资料暂不可用。' };
          } catch { value.error = '评分暂不可用。'; }
          if (!sealed) { entries.set(item.id, value); job.view.entries = [...entries.values()]; job.view.processed = entries.size; }
        }));
      }
    };
    try {
      const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Rating budget exceeded')), this.options.budgetMs ?? 45_000); });
      const operation = work(); this.active.add(operation);
      const clear = () => { this.active.delete(operation); };
      void operation.then(clear, clear);
      await Promise.race([operation, deadline]);
    } catch { /* Completed values remain usable; remaining IDs are explicitly unresolved. */ }
    finally {
      sealed = true; clearTimeout(timer);
      job.view.entries = items.map(item => entries.get(item.id) ?? { id: item.id, rating: null, fetchedAt: null, error: '评分暂未取得，可稍后重试。' });
      job.view.status = job.view.entries.some(item => item.error) ? 'partial' : 'ready'; job.view.updatedAt = this.now().toISOString();
      const dates = job.view.entries.flatMap(item => item.fetchedAt ? [Date.parse(item.fetchedAt) + 24 * 3_600_000] : []);
      job.until = job.view.status === 'partial' ? this.now().getTime() + 60_000 : Math.max(this.now().getTime() + 60_000, Math.min(this.now().getTime() + 24 * 3_600_000, ...dates));
    }
  }
  close() { this.closed = true; }
  async drain() { do { await Promise.allSettled([...this.active, ...this.pending]); } while (this.active.size || this.pending.size); }
}

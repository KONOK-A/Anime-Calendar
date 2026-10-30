import type { CacheValue } from './cache.js';
import { CacheStore } from './cache.js';
import { UpstreamClient, UpstreamError } from './upstream.js';

export interface ResourceValue<T> { data: T | null; fetchedAt: string | null; error: string | null; revalidating: boolean }
export class ResourceCache {
  private readonly pending = new Map<string, Promise<ResourceValue<unknown>>>();
  private readonly failures = new Map<string, { until: number; error: string }>();
  private readonly lookups = new Map<string, Promise<CacheValue<unknown> | null>>();
  constructor(private readonly store: CacheStore, private readonly upstream: UpstreamClient, private readonly now: () => Date) {}
  async get<T>(key: string, url: string, validate: (raw: unknown) => T, wait = false): Promise<ResourceValue<T>> {
    let lookup = this.lookups.get(key) as Promise<CacheValue<T> | null> | undefined;
    if (!lookup) { lookup = this.store.read(key, validate); this.lookups.set(key, lookup); void lookup.then(() => this.lookups.delete(key), () => this.lookups.delete(key)); }
    const cached = await lookup, existing = this.pending.get(key) as Promise<ResourceValue<T>> | undefined;
    const fallback = { data: cached?.data ?? null, fetchedAt: cached?.fetchedAt ?? null, error: null, revalidating: false };
    if (existing) { if (wait || !cached) { this.upstream.promote(url); return existing; } return { ...fallback, revalidating: true }; }
    if (cached && this.now().getTime() - Date.parse(cached.fetchedAt) < 24 * 3_600_000) return fallback;
    const failure = this.failures.get(key);
    if (failure && failure.until > this.now().getTime()) return { ...fallback, error: failure.error };
    this.failures.delete(key);
    const task = this.load(key, url, validate, cached, !!cached && !wait);
    this.pending.set(key, task);
    void task.then(() => { if (this.pending.get(key) === task) this.pending.delete(key); });
    if (cached && !wait) return { ...fallback, revalidating: true };
    return task;
  }
  private async load<T>(key: string, url: string, validate: (raw: unknown) => T, cached: CacheValue<T> | null, background: boolean): Promise<ResourceValue<T>> {
    try {
      const response = await this.upstream.request(url, { background }), raw: unknown = JSON.parse(response.bytes.toString('utf8')), data = validate(raw), fetchedAt = this.now().toISOString();
      let error: string | null = null;
      try { await this.store.write(key, raw, fetchedAt); } catch { error = '资料已更新，但缓存未保存。'; }
      this.failures.delete(key); return { data, fetchedAt, error, revalidating: false };
    } catch (error) {
      const message = `资料更新失败：${error instanceof Error ? error.message : '未知错误'}。可稍后重试。`;
      if (!(error instanceof Error) || !/队列|排队/.test(error.message)) {
        const retry = error instanceof UpstreamError && error.retryAt ? Math.max(60_000, error.retryAt - Date.now()) : 60_000;
        this.failures.set(key, { until: this.now().getTime() + retry, error: message });
        if (this.failures.size > 256) this.failures.delete(this.failures.keys().next().value!);
      }
      return { data: cached?.data ?? null, fetchedAt: cached?.fetchedAt ?? null, error: message, revalidating: false };
    }
  }
  async drain() {
    do { await Promise.allSettled([...this.lookups.values()]); await Promise.allSettled([...this.pending.values()]); await this.store.drain(); }
    while (this.lookups.size || this.pending.size);
  }
}

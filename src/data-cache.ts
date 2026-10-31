export interface CachedData<T> { schemaVersion: 1; savedAt: number; etag: string | null; data: T }
type CacheKind = 'views' | 'details' | 'ratings';
const limits = { views: 32, details: 128, ratings: 128 }, lifetime = 7 * 86_400_000;

/** Public catalogue data only; personal favorites/preferences use their existing stores. */
export class DataCache {
  private memory = { views: new Map<string, CachedData<unknown>>(), details: new Map<string, CachedData<unknown>>(), ratings: new Map<string, CachedData<unknown>>() };
  private queues = { views: Promise.resolve(), details: Promise.resolve(), ratings: Promise.resolve() };
  private disabled = false;
  private warned = false;
  constructor(private notify: (text: string) => void, private storage: CacheStorage | undefined = globalThis.caches, private now: () => number = Date.now) {}
  private key(kind: CacheKind, key: string) { return new Request(new URL(`/__anime_calendar_cache__/v1/${kind}/${encodeURIComponent(key)}`, globalThis.location?.origin ?? 'http://127.0.0.1').href); }
  private warn() { this.disabled = true; if (!this.warned) { this.warned = true; this.notify('加速缓存未保存，当前仍可正常使用。'); } }
  private valid<T>(value: unknown, validate: (data: unknown) => data is T): value is CachedData<T> {
    if (!value || typeof value !== 'object') return false;
    const record = value as Partial<CachedData<unknown>>;
    return record.schemaVersion === 1 && typeof record.savedAt === 'number' && Number.isFinite(record.savedAt) && record.savedAt <= this.now() + 300_000 && this.now() - record.savedAt < lifetime && (record.etag === null || typeof record.etag === 'string') && validate(record.data);
  }
  private matches(kind: CacheKind, key: string, data: unknown) {
    const value = data as { scope?: { key?: string }; id?: string } | null;
    return kind === 'views' ? !value?.scope || value.scope.key === key : !value?.id || value.id === key;
  }
  async read<T>(kind: CacheKind, key: string, validate: (data: unknown) => data is T): Promise<CachedData<T> | undefined> {
    const memory = this.memory[kind].get(key);
    if (this.valid(memory, validate) && this.matches(kind, key, memory.data)) return structuredClone(memory);
    this.memory[kind].delete(key);
    if (!this.storage || this.disabled) return;
    try {
      const cache = await this.storage.open(`anime-calendar:${kind}:v1`), request = this.key(kind, key);
      const response = await cache.match(request); if (!response) return;
      let value: unknown;
      try { value = await response.json(); } catch { await cache.delete(request); return; }
      if (!this.valid(value, validate) || !this.matches(kind, key, value.data)) { await cache.delete(request); return; }
      this.remember(kind, key, value);
      return structuredClone(value);
    } catch { this.warn(); }
  }
  private remember(kind: CacheKind, key: string, record: CachedData<unknown>) {
    const memory = this.memory[kind]; memory.delete(key); memory.set(key, record);
    while (memory.size > limits[kind]) memory.delete(memory.keys().next().value!);
  }
  private sourceTime(data: unknown) {
    const value = data as { updatedAt?: string | null; fetchedAt?: string | null; detailFetchedAt?: string; status?: { sources?: Record<string, { fetchedAt?: string | null }> } } | null;
    const dates = [value?.updatedAt, value?.fetchedAt, value?.detailFetchedAt, ...Object.values(value?.status?.sources ?? {}).map(source => source?.fetchedAt)];
    return Math.max(0, ...dates.map(date => date ? Date.parse(date) : 0).filter(Number.isFinite));
  }
  write<T>(kind: CacheKind, key: string, data: T, etag: string | null): Promise<void> {
    const previous = this.memory[kind].get(key);
    if (previous && this.sourceTime(data) < this.sourceTime(previous.data)) return this.queues[kind];
    const record: CachedData<T> = { schemaVersion: 1, savedAt: this.now(), etag, data: structuredClone(data) };
    this.remember(kind, key, record);
    this.queues[kind] = this.queues[kind].then(async () => {
      if (!this.storage || this.disabled) { if (!this.storage) this.warn(); return; }
      try {
        const cache = await this.storage.open(`anime-calendar:${kind}:v1`), request = this.key(kind, key);
        await cache.delete(request);
        await cache.put(request, new Response(JSON.stringify(record), { headers: { 'content-type': 'application/json', 'x-anime-saved-at': String(record.savedAt) } }));
        const keys = await cache.keys();
        for (let index = 0; index < keys.length; index++) {
          const response = await cache.match(keys[index]!);
          const savedAt = Number(response?.headers.get('x-anime-saved-at'));
          if (index < keys.length - limits[kind] || !Number.isFinite(savedAt) || this.now() - savedAt >= lifetime) await cache.delete(keys[index]!);
        }
      } catch { this.warn(); }
    });
    return this.queues[kind];
  }
}

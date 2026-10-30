import { ref, shallowRef } from 'vue';
import type { SeasonRatings } from '../shared/types';
import { isSeasonRatings } from '../shared/ratings';
import type { DataCache } from './data-cache';

/** A complete score snapshot is applied once, never as individual visible cards load. */
export function createSeasonRatings(cache: DataCache, fetcher: typeof fetch = fetch) {
  const snapshot = shallowRef<SeasonRatings | null>(null), loading = ref(false), error = ref<string | null>(null);
  const progress = ref({ processed: 0, total: 0 });
  let controller: AbortController | undefined, version = 0, signature = '', readyPromise = Promise.resolve();
  const owners = new Set<object>(), defaultOwner = {};
  const matches = (data: SeasonRatings, season: string, ids: string[]) => data.scope.season === season && data.ids.length === ids.length && [...data.ids].sort().join(',') === ids.join(',');
  function cancel(owner?: object) {
    if (owner) { owners.delete(owner); if (owners.size) return; } else owners.clear();
    version++; controller?.abort('cancelled'); controller = undefined; signature = ''; loading.value = false;
  }
  function load(season: string, requestedIds: string[], owner: object = defaultOwner): Promise<void> {
    const ids = [...requestedIds].sort(), key = `ratings:${season}`, wanted = `${key}|${ids.join(',')}`;
    if (signature === wanted && loading.value) { owners.add(owner); return readyPromise; }
    cancel(); signature = wanted; const round = version; controller = new AbortController();
    owners.add(owner);
    const active = controller, current = () => round === version && !active.signal.aborted;
    if (snapshot.value && !matches(snapshot.value, season, ids)) snapshot.value = null;
    loading.value = true; error.value = null; progress.value = { processed: 0, total: ids.length };
    let settle!: () => void; readyPromise = new Promise<void>(resolve => { settle = resolve; });
    const limit = setTimeout(() => active.abort(new Error('评分读取超时，请稍后重试。')), 60_000);
    void (async () => {
      const stored = await cache.read('views', key, isSeasonRatings);
      if (!current()) return;
      if (stored && stored.data.status !== 'loading' && matches(stored.data, season, ids)) { snapshot.value = stored.data; settle(); }
      while (current()) {
        const response = await fetcher(`/api/catalog/ratings?season=${encodeURIComponent(season)}`, { signal: AbortSignal.any([active.signal, AbortSignal.timeout(15_000)]) });
        const value: unknown = await response.json();
        if (!current()) return;
        if (!response.ok) throw new Error((value as { error?: string }).error ?? '评分暂不可用，请稍后重试。');
        if (!isSeasonRatings(value) || !matches(value, season, ids)) throw new Error('评分资料范围无效，请重试。');
        progress.value = { processed: value.processed, total: value.total };
        if (value.status !== 'loading') {
          const old = new Map(snapshot.value?.entries.map(entry => [entry.id, entry]));
          const entries = value.entries.map(entry => entry.error && !entry.rating && old.get(entry.id)?.rating ? { ...old.get(entry.id)!, error: entry.error } : entry);
          snapshot.value = { ...value, entries };
          if (value.status === 'partial') error.value = '部分评分暂未取得，已保留可用评分。';
          void cache.write('views', key, snapshot.value, null); return;
        }
        await new Promise<void>((resolve, reject) => {
          const done = () => { active.signal.removeEventListener('abort', abort); resolve(); };
          const timer = setTimeout(done, 1000);
          const abort = () => { clearTimeout(timer); reject(active.signal.reason); };
          active.signal.addEventListener('abort', abort, { once: true });
        });
      }
    })().catch(reason => {
      if (round === version && active.signal.reason !== 'cancelled') error.value = active.signal.reason instanceof Error ? active.signal.reason.message : reason instanceof Error ? reason.message : '无法读取评分，请重试。';
    }).finally(() => { clearTimeout(limit); if (round === version) loading.value = false; settle(); });
    return readyPromise;
  }
  return { snapshot, loading, error, progress, load, cancel, ready: () => readyPromise };
}

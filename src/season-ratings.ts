import { ref, shallowRef } from 'vue';
import type { Anime, SeasonRatingEntry, SeasonRatings } from '../shared/types';
import { isSeasonRatings, validRating } from '../shared/ratings';
import type { DataCache } from './data-cache';
import type { RatingSummary } from '../shared/scores';

type RatingItem = Pick<Anime, 'id' | 'externalIds'>;
export const ratingItemIdentity = (item?: RatingItem) => `${item?.id ?? 'unknown'}:${item?.externalIds?.mal ?? ''}:${item?.externalIds?.aniList ?? ''}`;
export function ratingMatchesItem(summary: RatingSummary | null | undefined, item?: RatingItem): boolean {
  if (!item) return true;
  return (['mal', 'anilist'] as const).every(provider => {
    const id = item.externalIds?.[provider === 'mal' ? 'mal' : 'aniList'];
    const expected = id ? `${provider === 'mal' ? 'https://myanimelist.net' : 'https://anilist.co'}/anime/${id}` : null;
    return (summary?.sources.find(source => source.provider === provider)?.url ?? null) === expected;
  });
}

/** Show the first usable snapshot early, then keep its ranking until the task finishes. */
export function createSeasonRatings(cache: DataCache, fetcher: typeof fetch = fetch) {
  const snapshot = shallowRef<SeasonRatings | null>(null), loading = ref(false), error = ref<string | null>(null);
  const progress = ref({ processed: 0, total: 0 });
  let controller: AbortController | undefined, version = 0, signature = '', snapshotSignature = '', readyPromise = Promise.resolve();
  const owners = new Set<object>(), defaultOwner = {};
  const matches = (data: SeasonRatings, season: string, ids: string[]) => data.scope.season === season && data.ids.length === ids.length && [...data.ids].sort().join(',') === ids.join(',');
  const complete = (data: SeasonRatings) => data.entries.length === data.total && (data.status !== 'loading' || data.processed === data.total) && data.updatedAt !== null;
  const scored = (entry: SeasonRatingEntry | undefined) => entry?.summary !== undefined ? entry.summary.score !== null : validRating(entry?.rating);
  function cancel(owner?: object) {
    if (owner) { owners.delete(owner); if (owners.size) return; } else owners.clear();
    version++; controller?.abort('cancelled'); controller = undefined; signature = ''; loading.value = false;
  }
  function load(season: string, requestedIds: string[], owner: object = defaultOwner, items: readonly RatingItem[] = []): Promise<void> {
    const ids = [...requestedIds].sort(), key = `ratings:${season}`, byId = new Map(items.map(item => [item.id, item]));
    const wanted = `${key}|${ids.map(id => ratingItemIdentity(byId.get(id) ?? { id })).join(',')}`;
    if (signature === wanted && loading.value) { owners.add(owner); return readyPromise; }
    cancel(); signature = wanted; const round = version; controller = new AbortController();
    owners.add(owner);
    const active = controller, current = () => round === version && !active.signal.aborted;
    if (snapshot.value && (!matches(snapshot.value, season, ids) || snapshotSignature !== wanted)) snapshot.value = null;
    loading.value = true; error.value = null; progress.value = { processed: 0, total: ids.length };
    let settle!: () => void; readyPromise = new Promise<void>(resolve => { settle = resolve; });
    const limit = setTimeout(() => active.abort(new Error('评分读取超时，请稍后重试。')), 60_000);
    void (async () => {
      const stored = await cache.read('views', key, (value): value is SeasonRatings => isSeasonRatings(value) && value.entries.every(entry => ratingMatchesItem(entry.summary, byId.get(entry.id))));
      if (!current()) return;
      if (stored && complete(stored.data) && matches(stored.data, season, ids) && (!snapshot.value?.updatedAt || !stored.data.updatedAt || Date.parse(stored.data.updatedAt) >= Date.parse(snapshot.value.updatedAt))) { snapshot.value = stored.data; snapshotSignature = wanted; settle(); }
      while (current()) {
        const response = await fetcher(`/api/catalog/ratings?season=${encodeURIComponent(season)}`, { signal: AbortSignal.any([active.signal, AbortSignal.timeout(15_000)]) });
        const value: unknown = await response.json();
        if (!current()) return;
        if (!response.ok) throw new Error((value as { error?: string }).error ?? '评分暂不可用，请稍后重试。');
        if (!isSeasonRatings(value) || !matches(value, season, ids)) throw new Error('评分资料范围无效，请重试。');
        progress.value = { processed: value.processed, total: value.total };
        if (complete(value) && (value.status !== 'loading' || !snapshot.value || !complete(snapshot.value)) && (!snapshot.value?.updatedAt || !value.updatedAt || Date.parse(value.updatedAt) >= Date.parse(snapshot.value.updatedAt))) {
          const old = new Map(snapshot.value?.entries.map(entry => [entry.id, entry]));
          const entries = value.entries.map(entry => entry.error && !scored(entry) && scored(old.get(entry.id)) ? { ...old.get(entry.id)!, error: entry.error } : entry);
          snapshot.value = { ...value, entries };
          snapshotSignature = wanted;
          void cache.write('views', key, snapshot.value, null); settle();
        }
        if (value.status !== 'loading') { if (value.status === 'partial') error.value = '部分评分暂未取得，已保留可用评分。'; return; }
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

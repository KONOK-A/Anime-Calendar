import { computed, inject, onUnmounted, reactive, ref, watch, type InjectionKey } from 'vue';
import type { Anime, AnimeCredits, AnimeDetail, AppStatus, CatalogSnapshot, CatalogView, CharacterNames, Timezone } from '../shared/types';
import { seasonFrom } from '../shared/schedule';
import { exportBackup, FAVORITES_KEY, parseBackup, readFavorites, saveFavorites } from './favorites';
import { useTheme } from './theme';
import { useBrowseState } from './browse';
import type { CatalogColumns, WeeklyLayout } from './presentation';
import { DataCache, type CachedData } from './data-cache';
import { isAnimeDetail, isCatalogView, isCurrentCatalogView } from './data-validation';
import { catalogRequests, type CatalogRequest } from './catalog-requests';
import { createSeasonRatings, ratingItemIdentity, ratingMatchesItem } from './season-ratings';
import { summarizeRatings, validRatingSummary, type RatingSummary } from '../shared/scores';

type AnimeRatings = RatingSummary & { id: string };
function isAnimeRatings(value: unknown): value is AnimeRatings {
  return validRatingSummary(value) && 'id' in value && typeof value.id === 'string' && /^(bgm:\d+|bd:[\w-]+)$/.test(value.id);
}

const storage = { getItem: (key: string) => window.localStorage.getItem(key), setItem: (key: string, value: string) => window.localStorage.setItem(key, value) };
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) }); } catch { throw new Error('无法连接服务，请稍后重试。'); }
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error ?? `请求失败（${response.status}）`), { statusCode: response.status });
  return value as T;
}
export function createAppState() {
  const catalog = ref<CatalogSnapshot | null>(null), status = ref<AppStatus | null>(null), loading = ref(true);
  const seasons = ref<CatalogView['seasons']>([]), missingIds = ref<string[]>([]), unresolvedIds = ref<string[]>([]), viewError = ref<string | null>(null);
  const notice = ref<{ text: string; kind: 'info' | 'error' } | null>(null);
  const appearance = useTheme(text => notify(text));
  const browse = useBrowseState(text => notify(text));
  const favorites = ref<string[]>([]), timezone = ref<Timezone>('Asia/Shanghai');
  const weeklyLayout = ref<WeeklyLayout>('columns');
  const catalogColumns = ref<CatalogColumns>(4);
  const details = reactive(new Map<string, AnimeDetail>()), detailLoading = reactive(new Set<string>()), detailErrors = reactive(new Map<string, string>());
  const pending = new Map<string, Promise<void>>();
  const ratingSummaries = reactive(new Map<string, RatingSummary>()), ratingsLoading = reactive(new Set<string>()), ratingErrors = reactive(new Map<string, string>());
  const pendingRatings = new Map<string, { identity: string; controller: AbortController; task: Promise<void> }>(), ratingIdentities = new Map<string, string>();
  const missingDetails = new Set<string>();
  const credits = reactive(new Map<string, AnimeCredits>()), creditsLoading = reactive(new Set<string>()), creditsErrors = reactive(new Map<string, string>());
  const pendingCredits = new Map<string, Promise<void>>();
  const characterNamesLoading = reactive(new Set<string>()), characterNameErrors = reactive(new Map<string, string>());
  const pendingNames = new Map<string, Promise<void>>(), namedPages = new Map<string, number>();
  const now = ref(new Date().toISOString());
  const currentSeason = computed(() => seasonFrom(now.value));
  const cache = new DataCache(text => { if (notice.value?.kind !== 'error') notify(text); });
  const seasonRatings = createSeasonRatings(cache);
  onUnmounted(() => seasonRatings.cancel());
  const knownItems = new Map<string, Anime>(), viewRequests = new Map<string, Promise<{ data: CatalogView; etag: string | null }>>();
  const controllers = new Set<AbortController>();
  const confirmations = new Set<AbortController>();
  let currentRoute = window.location.hash || '#/weekly', signature = '', viewVersion = 0, disposed = false, initialized = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let polling = false;
  const clock = setInterval(() => { now.value = new Date().toISOString(); }, 60_000);
  onUnmounted(() => { disposed = true; viewVersion++; for (const controller of controllers) controller.abort(); clearInterval(clock); clearTimeout(pollTimer); });
  const read = readFavorites(storage); favorites.value = read.ids;
  if (read.error) notice.value = { text: read.error, kind: 'error' };
  function syncFavorites(event: StorageEvent) {
    if (event.key !== FAVORITES_KEY && event.key !== null) return;
    const latest = readFavorites(storage);
    if (latest.error) notify(latest.error, 'error'); else favorites.value = latest.ids;
  }
  window.addEventListener('storage', syncFavorites); onUnmounted(() => window.removeEventListener('storage', syncFavorites));
  async function favoritesLock(work: () => void) {
    if (navigator.locks) await navigator.locks.request('anime-calendar:favorites', work); else work();
  }
  try { const saved = storage.getItem('anime-calendar:timezone'); if (saved === 'Asia/Tokyo') timezone.value = saved; } catch { /* 北京时间仍可使用，收藏操作另行报告存储失败。 */ }
  try { if (storage.getItem('anime-calendar:weekly-layout') === 'rows') weeklyLayout.value = 'rows'; } catch { /* 可选显示偏好读取失败时使用竖列。 */ }
  try { const saved = storage.getItem('anime-calendar:catalog-columns'); if (saved === '5' || saved === '6') catalogColumns.value = Number(saved) as CatalogColumns; } catch { /* 可选显示偏好读取失败时使用四列。 */ }

  function setWeeklyLayout(value: WeeklyLayout) {
    weeklyLayout.value = value;
    try { storage.setItem('anime-calendar:weekly-layout', value); } catch { notify('布局已切换，但未保存。'); }
  }
  function setCatalogColumns(value: CatalogColumns) {
    catalogColumns.value = value;
    try { storage.setItem('anime-calendar:catalog-columns', String(value)); } catch { notify('列数已切换，但未保存。'); }
  }

  function notify(text: string, kind: 'info' | 'error' = 'info') { notice.value = { text, kind }; }
  function applyViews(views: CatalogView[], cached: boolean, extraItems: Anime[] = []) {
    const last = views.at(-1); if (!last?.catalog) return;
    const byId = new Map(extraItems.map(item => [item.id, item]));
    const changedRatings = new Set<string>();
    for (const view of views) for (const item of view.catalog?.items ?? []) {
      if (ratingItemIdentity(knownItems.get(item.id) ?? details.get(item.id)) !== ratingItemIdentity(item) && (ratingSummaries.has(item.id) || pendingRatings.has(item.id))) changedRatings.add(item.id);
      byId.set(item.id, item); knownItems.set(item.id, item);
      if (missingDetails.delete(item.id)) detailErrors.delete(item.id);
    }
    catalog.value = { ...last.catalog, items: [...byId.values()] };
    // Only live status polling may finish an already-observed refresh.
    if (!cached || !status.value) {
      const next = structuredClone(last.status);
      next.refreshing = cached ? false : next.refreshing || status.value?.refreshing === true;
      status.value = next;
    }
    seasons.value = last.seasons;
    missingIds.value = [...new Set(views.flatMap(view => view.missingIds ?? []))];
    for (const id of missingIds.value) knownItems.delete(id);
    for (const id of changedRatings) { ratingSummaries.delete(id); ratingIdentities.delete(id); void loadRatings(id, true); }
  }
  function fetchView(request: CatalogRequest, previous: CachedData<CatalogView> | undefined, force: boolean) {
    const key = `${request.scope.key}|${force ? 'force' : previous?.etag ?? ''}`;
    const pending = viewRequests.get(key); if (pending) return pending;
    const task = (async () => {
      const controller = new AbortController(); controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        let response: Response;
        try { response = await fetch(request.url, { headers: !force && previous?.etag ? { 'if-none-match': previous.etag } : {}, signal: controller.signal }); }
        catch { throw new Error(controller.signal.aborted ? '读取页面超时，请稍后重试。' : '无法连接服务，请稍后重试。'); }
        if (response.status === 304) {
          if (previous?.data.catalog) return { data: previous.data, etag: previous.etag };
          response = await fetch(request.url, { cache: 'reload', signal: controller.signal });
        }
        const value: unknown = await response.json();
        if (!response.ok) {
          const error = new Error((value as { error?: string }).error ?? '读取页面资料失败，请稍后重试。');
          if (isCatalogView(value)) Object.assign(error, { appStatus: value.status });
          throw error;
        }
        if (!isCurrentCatalogView(value)) throw new Error('页面资料格式无效，请稍后重试。');
        const scope = value.scope, wanted = request.scope;
        if (scope.type !== wanted.type || scope.key !== wanted.key) throw new Error('页面资料范围不匹配，请重试。');
        return { data: value, etag: response.headers.get('etag') };
      } finally { clearTimeout(timeout); controllers.delete(controller); }
    })().finally(() => { viewRequests.delete(key); });
    viewRequests.set(key, task); return task;
  }
  async function loadPage(route = currentRoute, force = false) {
    currentRoute = route; initialized = true;
    const requests = catalogRequests(route, now.value, timezone.value, favorites.value), nextSignature = requests.map(request => request.scope.key).join('|');
    const version = ++viewVersion, current = () => !disposed && version === viewVersion;
    const same = signature === nextSignature; signature = nextSignature;
    if (!same) { for (const controller of confirmations) controller.abort('route-changed'); confirmations.clear(); }
    const lookupIds = requests.flatMap(request => request.scope.type === 'items' ? request.scope.ids : []);
    if (route.replace(/^#/, '').startsWith('/anime/') && lookupIds[0]) void loadDetail(lookupIds[0]);
    const seeded = lookupIds.length > 0 && lookupIds.every(id => knownItems.has(id));
    const seedItems = seeded ? lookupIds.map(id => knownItems.get(id)!) : [];
    const retainCollection = route.replace(/^#/, '') === '/favorites' && catalog.value !== null;
    if (!same && !retainCollection && !seeded) catalog.value = null;
    if (seeded && catalog.value) catalog.value = { ...catalog.value, items: seedItems };
    loading.value = !catalog.value; viewError.value = null; unresolvedIds.value = []; missingIds.value = [];
    if (!requests.length) { loading.value = false; return; }
    const cached = await Promise.all(requests.map(request => cache.read<CatalogView>('views', request.scope.key, isCurrentCatalogView)));
    if (!current()) return;
    const available = cached.flatMap(entry => entry?.data.catalog ? [entry.data] : []);
    if (available.length) applyViews(available, true, retainCollection ? (catalog.value?.items ?? []).filter(item => favorites.value.includes(item.id)) : seedItems);
    const ready = same && !!catalog.value || seeded || available.length === requests.length || retainCollection;
    if (ready) loading.value = false;
    const update = async () => {
      const results = cached.map(entry => entry?.data.catalog ? entry.data : undefined);
      const failures: { request: CatalogRequest; error: Error & { appStatus?: AppStatus } }[] = [];
      for (let index = 0; index < requests.length; index += 2) {
        await Promise.all(requests.slice(index, index + 2).map(async (request, offset) => {
          try {
            const result = await fetchView(request, cached[index + offset], force);
            results[index + offset] = result.data;
            void cache.write('views', result.data.scope.key, result.data, result.etag);
          } catch (error) { failures.push({ request, error: error as Error & { appStatus?: AppStatus } }); }
        }));
      }
      if (!current()) return;
      const valid = results.filter((value): value is CatalogView => !!value);
      if (valid.length) applyViews(valid, false);
      if (failures.length) {
        const failure = failures[0]!;
        if (failure.error.appStatus) status.value = failure.error.appStatus;
        if (status.value && !failure.error.appStatus) status.value.refreshing = false;
        viewError.value = failure.error.message;
        unresolvedIds.value = failures.flatMap(item => item.request.scope.type === 'items' ? item.request.scope.ids : []).filter(id => !catalog.value?.items.some(item => item.id === id) && !missingIds.value.includes(id));
        notify(`${failure.error.message}${catalog.value ? ' 当前显示已有缓存。' : ''}`, 'error');
      }
      loading.value = false;
      if (status.value?.refreshing && !pollTimer) pollTimer = setTimeout(poll, 1500);
    };
    if (ready) void update(); else await update();
  }
  async function poll() {
    if (polling || disposed) return;
    polling = true; clearTimeout(pollTimer); pollTimer = undefined;
    try {
      const latest = await json<AppStatus>('/api/status', { signal: AbortSignal.timeout(15_000) });
      if (disposed) return;
      status.value = latest;
      if (status.value.refreshing) { if (!pollTimer) pollTimer = setTimeout(poll, 1500); }
      else { await loadPage(currentRoute, true); }
    } catch (error) { if (!disposed) { if (status.value) status.value = { ...status.value, refreshing: false }; notify((error as Error).message, 'error'); } }
    finally { polling = false; }
  }
  async function initialize(route = window.location.hash || '#/weekly') { await loadPage(route); }
  async function retryView() { await loadPage(currentRoute, true); }
  watch([timezone, currentSeason, () => catalogRequests('#/weekly', now.value, timezone.value, [])[0]!.scope.key], (next, previous) => {
    if (!initialized) return;
    const path = currentRoute.replace(/^#/, '');
    if (path === '/weekly' || path === '/' || path === '/season' && next[1] !== previous[1]) void loadPage(currentRoute);
  });
  watch(favorites, () => { if (initialized && currentRoute.replace(/^#/, '') === '/favorites') void loadPage(currentRoute); });
  async function refresh() {
    try {
      status.value = await json<AppStatus>('/api/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (status.value.refreshing) void poll(); else await loadPage(currentRoute, true);
    } catch (error) { notify((error as Error).message, 'error'); }
  }
  function relevant(id: string) { return !!catalog.value?.items.some(item => item.id === id); }
  function ratingItem(id: string) { return knownItems.get(id) ?? details.get(id); }
  function loadRatings(id: string, force = false): Promise<void> {
    const item = ratingItem(id), identity = ratingItemIdentity(item), pending = pendingRatings.get(id);
    if (pending?.identity === identity && !pending.controller.signal.aborted) return pending.task;
    pending?.controller.abort('rating-identity-changed');
    const known = ratingSummaries.get(id);
    if (!force && known && ratingIdentities.get(id) === identity && !known.revalidating && !known.retryAfterMs && known.fetchedAt && Date.now() - Date.parse(known.fetchedAt) < 24 * 3_600_000 && !known.sources.some(source => source.status === 'unavailable')) return Promise.resolve();
    if (ratingIdentities.get(id) !== identity) ratingSummaries.delete(id);
    ratingsLoading.add(id); ratingErrors.delete(id);
    const controller = new AbortController(), deadline = Date.now() + 180_000; controllers.add(controller);
    const current = () => !disposed && !controller.signal.aborted && ratingItemIdentity(ratingItem(id)) === identity && pendingRatings.get(id)?.controller === controller;
    const apply = (value: unknown) => {
      if (!isAnimeRatings(value) || value.id !== id) throw new Error('评分资料格式或作品关联无效。');
      if (!current()) return value;
      const previous = new Map(ratingSummaries.get(id)?.sources.map(source => [source.provider, source]));
      let retained = false;
      const sources = value.sources.map(source => {
        const old = previous.get(source.provider);
        if (source.status !== 'unavailable' || !source.url || old?.url !== source.url || old.status !== 'ready' || old.score === null) return source;
        retained = true; return { ...old, error: source.error ?? '来源暂不可用，当前显示上次取得的评分。' };
      });
      const data: AnimeRatings = retained ? { id, ...summarizeRatings(sources, undefined, value.revalidating === true), ...(value.retryAfterMs ? { retryAfterMs: value.retryAfterMs } : {}) } : value;
      if (retained) ratingErrors.set(id, '部分来源暂不可用，已保留已有评分。'); else ratingErrors.delete(id);
      ratingSummaries.set(id, data); ratingIdentities.set(id, identity);
      const saved = { ...data, revalidating: false }; delete saved.retryAfterMs;
      void cache.write('ratings', id, saved, null);
      return data;
    };
    const task = (async () => {
      const cached = await cache.read('ratings', id, (value): value is AnimeRatings => isAnimeRatings(value) && ratingMatchesItem(value, item));
      if (!current()) return;
      if (cached) { const restored = { ...cached.data, revalidating: false }; delete restored.retryAfterMs; ratingSummaries.set(id, restored); ratingIdentities.set(id, identity); }
      let latest = apply(await json(`/api/anime/${encodeURIComponent(id)}/ratings`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(18_000)]) }));
      let nextConfirmation = Date.now();
      while (current() && relevant(id) && (latest.revalidating || latest.retryAfterMs)) {
        const delay = latest.revalidating ? Math.max(0, nextConfirmation - Date.now()) : latest.retryAfterMs!;
        if (delay >= deadline - Date.now()) break;
        confirmations.add(controller);
        if (delay) await new Promise<void>((resolve, reject) => {
          const finish = () => { controller.signal.removeEventListener('abort', abort); resolve(); };
          const timer = setTimeout(finish, delay);
          const abort = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); reject(controller.signal.reason); };
          controller.signal.addEventListener('abort', abort, { once: true });
          if (controller.signal.aborted) abort();
        });
        if (!current() || !relevant(id)) break;
        nextConfirmation = Date.now() + 1000;
        latest = apply(await json(`/api/anime/${encodeURIComponent(id)}/ratings?wait=1`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(1, Math.min(18_000, deadline - Date.now())))]) }));
      }
      if (current() && relevant(id) && (latest.revalidating || latest.retryAfterMs)) ratingErrors.set(id, '部分来源暂未取得，可稍后重试。');
    })().catch(error => {
      if (current()) ratingErrors.set(id, `评分暂未更新：${(error as Error).message}`);
    }).finally(() => { confirmations.delete(controller); controllers.delete(controller); if (pendingRatings.get(id)?.controller === controller) { pendingRatings.delete(id); ratingsLoading.delete(id); } });
    pendingRatings.set(id, { identity, controller, task }); return task;
  }
  function loadDetail(id: string, force = false): Promise<void> {
    if (ratingItem(id)) void loadRatings(id);
    if (pending.has(id)) return pending.get(id)!;
    const cached = details.get(id);
    if (!force && cached && (!cached.bangumiId || !cached.detailError && !cached.revalidating && cached.detailFetchedAt && Date.now() - Date.parse(cached.detailFetchedAt) < 24 * 3_600_000)) return Promise.resolve();
    detailLoading.add(id);
    detailErrors.delete(id);
    let activeController: AbortController | undefined;
    const task = (async () => {
      const stored = await cache.read('details', id, isAnimeDetail);
      if (disposed) return;
      if (stored) details.set(id, stored.data);
      if (!force && stored?.data.detailFetchedAt && Date.now() - Date.parse(stored.data.detailFetchedAt) < 24 * 3_600_000) return;
      const controller = new AbortController(); activeController = controller; controllers.add(controller);
      try {
        const value: unknown = await json<unknown>(`/api/anime/${encodeURIComponent(id)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        const data = value as AnimeDetail;
        if (!isAnimeDetail(value)) {
          if (value && typeof value === 'object' && data.rating === undefined && isAnimeDetail({ ...data, rating: null })) { if (!disposed) details.set(id, data); return; }
          throw new Error('作品详情格式无效，请稍后重试。');
        }
        if (!disposed) details.set(id, data);
        if (!data.detailError) void cache.write('details', id, { ...data, revalidating: false }, null);
        if (data.revalidating === true && relevant(id)) {
          confirmations.add(controller);
          const latest: unknown = await json(`/api/anime/${encodeURIComponent(id)}?wait=1`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
          if (!isAnimeDetail(latest) || latest.id !== id) throw new Error('作品详情格式无效，请稍后重试。');
          if (!disposed && !controller.signal.aborted) details.set(id, latest);
          if (!latest.detailError && latest.revalidating !== true) void cache.write('details', id, latest, null);
        }
      } finally { confirmations.delete(controller); controllers.delete(controller); }
    })().catch(error => { if (!disposed && activeController?.signal.reason !== 'route-changed') { if (error.statusCode === 404) missingDetails.add(id); detailErrors.set(id, `详情请求失败：${(error as Error).message}`); } }).finally(() => { pending.delete(id); detailLoading.delete(id); if (!disposed && !missingDetails.has(id) && relevant(id)) void loadRatings(id); });
    pending.set(id, task); return task;
  }
  function loadCredits(id: string, force = false): Promise<void> {
    if (pendingCredits.has(id)) return pendingCredits.get(id)!;
    const cached = credits.get(id);
    if (!force && cached && !cached.revalidating && Object.values(cached.sources).every(source => !source.error && source.fetchedAt && Date.now() - Date.parse(source.fetchedAt) < 24 * 3_600_000)) return Promise.resolve();
    creditsLoading.add(id); creditsErrors.delete(id);
    const controller = new AbortController(); controllers.add(controller);
    const apply = (data: AnimeCredits) => {
      if (disposed || controller.signal.aborted) return;
      const previous = new Map(credits.get(id)?.cast.map(character => [character.id, character]));
      data.cast = data.cast.map(character => { const old = previous.get(character.id); return old?.originalName ? { ...character, name: old.name, originalName: old.originalName } : character; });
      credits.set(id, data); void loadCharacterNames(id);
    };
    const task = (async () => {
      const url = `/api/anime/${encodeURIComponent(id)}/credits`;
      const data = await json<AnimeCredits>(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) }); apply(data);
      if (data.revalidating === true && relevant(id)) { confirmations.add(controller); apply(await json<AnimeCredits>(`${url}?wait=1`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })); }
    })().catch(error => { if (!disposed && controller.signal.reason !== 'route-changed') creditsErrors.set(id, `补充资料请求失败：${(error as Error).message}`); }).finally(() => { confirmations.delete(controller); controllers.delete(controller); pendingCredits.delete(id); creditsLoading.delete(id); });
    pendingCredits.set(id, task); return task;
  }
  async function loadCharacterNames(id: string, all = false): Promise<void> {
    const current = credits.get(id); if (!current?.cast.length) return;
    characterNameErrors.delete(id);
    const tasks: Promise<void>[] = [], count = all ? current.cast.length : Math.min(8, current.cast.length);
    for (let offset = 0; offset < count; offset += 8) {
      const ids = current.cast.slice(offset, offset + 8).map(character => character.id).join(',');
      const key = `${id}:${offset}:${ids}`;
      if (Date.now() - (namedPages.get(key) ?? 0) < 24 * 3_600_000) continue;
      const pending = pendingNames.get(key); if (pending) { tasks.push(pending); continue; }
      characterNamesLoading.add(id);
      const controller = new AbortController(); controllers.add(controller);
      const apply = (result: CharacterNames) => {
        if (disposed || controller.signal.aborted) return;
        const names = new Map(result.names.map(name => [name.id, name]));
        const latest = credits.get(id); if (latest) latest.cast = latest.cast.map(character => { const name = names.get(character.id); return name ? { ...character, name: name.name, originalName: name.originalName } : character; });
        if (result.error) characterNameErrors.set(id, result.error); else if (result.revalidating !== true) namedPages.set(key, Date.now());
      };
      const task = (async () => {
        const url = `/api/anime/${encodeURIComponent(id)}/character-names?offset=${offset}`;
        const data = await json<CharacterNames>(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) }); apply(data);
        if (data.revalidating === true && relevant(id)) { confirmations.add(controller); apply(await json<CharacterNames>(`${url}&wait=1`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })); }
      })().catch(error => { if (!disposed && controller.signal.reason !== 'route-changed') characterNameErrors.set(id, `中文角色名获取失败：${(error as Error).message}`); }).finally(() => {
        confirmations.delete(controller); controllers.delete(controller);
        pendingNames.delete(key); if (![...pendingNames.keys()].some(key => key.startsWith(`${id}:`))) characterNamesLoading.delete(id);
      });
      pendingNames.set(key, task); tasks.push(task);
    }
    await Promise.all(tasks);
  }
  async function toggleFavorite(id: string) {
    const adding = !favorites.value.includes(id);
    await favoritesLock(() => {
      const latest = readFavorites(storage);
      if (latest.error) { notify(latest.error, 'error'); return; }
      const next = adding ? [...new Set([...latest.ids, id])] : latest.ids.filter(x => x !== id);
      const result = saveFavorites(storage, next);
      if (!result.saved) { notify(result.error!, 'error'); return; }
      favorites.value = next;
    });
  }
  function setTimezone(zone: Timezone) {
    timezone.value = zone;
    browse.weekly.selectedDay = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now.value));
    try { storage.setItem('anime-calendar:timezone', zone); } catch { notify('本次已切换时区，但浏览器未能保存显示偏好。'); }
  }
  async function importFavorites(file: File) {
    try {
      if (file.size > 2_000_000) throw new Error('备份文件过大，现有收藏未改动。');
      const content = await file.text(); parseBackup(content, []);
      await favoritesLock(() => {
        const latest = readFavorites(storage), next = parseBackup(content, latest.error ? favorites.value : latest.ids), saved = saveFavorites(storage, next);
        if (!saved.saved) throw new Error(saved.error);
        favorites.value = next; notify(`备份已合并，当前共 ${next.length} 部追番。`);
      });
    } catch (error) { notify((error as Error).message, 'error'); }
  }
  function downloadFavorites() {
    const blob = new Blob([exportBackup(favorites.value, new Date().toISOString())], { type: 'application/json' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = `anime-calendar-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { catalog, status, seasons, seasonRatings, ratingSummaries, ratingsLoading, ratingErrors, loadRatings, loading, missingIds, unresolvedIds, viewError, loadPage, retryView, notice, favorites, timezone, weeklyLayout, setWeeklyLayout, catalogColumns, setCatalogColumns, details, detailLoading, detailErrors, credits, creditsLoading, creditsErrors, characterNamesLoading, characterNameErrors, now, currentSeason, appearance, browse, notify, initialize, refresh, loadDetail, loadCredits, loadCharacterNames, toggleFavorite, setTimezone, importFavorites, downloadFavorites };
}
export type AppState = ReturnType<typeof createAppState>;
export const appKey: InjectionKey<AppState> = Symbol('anime-calendar');
export function useAppState(): AppState { const value = inject(appKey); if (!value) throw new Error('应用状态尚未初始化'); return value; }

import { computed, inject, onUnmounted, reactive, ref, type InjectionKey } from 'vue';
import type { AnimeCredits, AnimeDetail, AppStatus, CatalogSnapshot, CharacterNames, Timezone } from '../shared/types';
import { seasonFrom } from '../shared/schedule';
import { exportBackup, FAVORITES_KEY, parseBackup, readFavorites, saveFavorites } from './favorites';

const storage = { getItem: (key: string) => window.localStorage.getItem(key), setItem: (key: string, value: string) => window.localStorage.setItem(key, value) };
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, init); } catch { throw new Error('无法连接本地服务，请检查启动窗口是否仍在运行。'); }
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `请求失败（${response.status}）`);
  return value as T;
}
export function createAppState() {
  const catalog = ref<CatalogSnapshot | null>(null), status = ref<AppStatus | null>(null), loading = ref(true);
  const notice = ref<{ text: string; kind: 'info' | 'error' } | null>(null);
  const favorites = ref<string[]>([]), timezone = ref<Timezone>('Asia/Shanghai');
  const details = reactive(new Map<string, AnimeDetail>()), detailLoading = reactive(new Set<string>()), detailErrors = reactive(new Map<string, string>());
  const pending = new Map<string, Promise<void>>();
  const credits = reactive(new Map<string, AnimeCredits>()), creditsLoading = reactive(new Set<string>()), creditsErrors = reactive(new Map<string, string>());
  const pendingCredits = new Map<string, Promise<void>>();
  const characterNamesLoading = reactive(new Set<string>()), characterNameErrors = reactive(new Map<string, string>());
  const pendingNames = new Map<string, Promise<void>>(), namedPages = new Map<string, number>();
  const now = ref(new Date().toISOString());
  const currentSeason = computed(() => seasonFrom(now.value));
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const clock = setInterval(() => { now.value = new Date().toISOString(); }, 60_000);
  onUnmounted(() => { clearInterval(clock); clearTimeout(pollTimer); });
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

  function notify(text: string, kind: 'info' | 'error' = 'info') { notice.value = { text, kind }; }
  async function loadCatalog() {
    if (!status.value?.hasCatalog) { catalog.value = null; return; }
    catalog.value = await json<CatalogSnapshot>('/api/catalog');
  }
  async function poll() {
    clearTimeout(pollTimer);
    try {
      status.value = await json<AppStatus>('/api/status');
      if (status.value.refreshing) pollTimer = setTimeout(poll, 1500);
      else { await loadCatalog(); }
    } catch (error) { if (status.value) status.value = { ...status.value, refreshing: false }; notify((error as Error).message, 'error'); }
  }
  async function initialize() {
    loading.value = true;
    try { status.value = await json<AppStatus>('/api/status'); await loadCatalog(); if (status.value.refreshing) void poll(); }
    catch (error) { notify((error as Error).message, 'error'); }
    finally { loading.value = false; }
  }
  async function refresh() {
    try {
      status.value = await json<AppStatus>('/api/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (status.value.refreshing) void poll(); else await loadCatalog();
    } catch (error) { notify((error as Error).message, 'error'); }
  }
  function loadDetail(id: string, force = false): Promise<void> {
    if (pending.has(id)) return pending.get(id)!;
    const cached = details.get(id);
    if (!force && cached && (!cached.detailFetchedAt || Date.now() - Date.parse(cached.detailFetchedAt) < 24 * 3_600_000)) return Promise.resolve();
    detailLoading.add(id);
    detailErrors.delete(id);
    const task = json<AnimeDetail>(`/api/anime/${encodeURIComponent(id)}`).then(data => { details.set(id, data); }).catch(error => { detailErrors.set(id, `详情请求失败：${(error as Error).message}`); }).finally(() => { pending.delete(id); detailLoading.delete(id); });
    pending.set(id, task); return task;
  }
  function loadCredits(id: string, force = false): Promise<void> {
    if (pendingCredits.has(id)) return pendingCredits.get(id)!;
    const cached = credits.get(id);
    if (!force && cached && Object.values(cached.sources).every(source => !source.error && source.fetchedAt && Date.now() - Date.parse(source.fetchedAt) < 24 * 3_600_000)) return Promise.resolve();
    creditsLoading.add(id); creditsErrors.delete(id);
    const task = json<AnimeCredits>(`/api/anime/${encodeURIComponent(id)}/credits`).then(data => {
      const previous = new Map(credits.get(id)?.cast.map(character => [character.id, character]));
      data.cast = data.cast.map(character => { const old = previous.get(character.id); return old?.originalName ? { ...character, name: old.name, originalName: old.originalName } : character; });
      credits.set(id, data); void loadCharacterNames(id);
    }).catch(error => { creditsErrors.set(id, `补充资料请求失败：${(error as Error).message}`); }).finally(() => { pendingCredits.delete(id); creditsLoading.delete(id); });
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
      const task = json<CharacterNames>(`/api/anime/${encodeURIComponent(id)}/character-names?offset=${offset}`).then(result => {
        const names = new Map(result.names.map(name => [name.id, name]));
        const latest = credits.get(id); if (latest) latest.cast = latest.cast.map(character => { const name = names.get(character.id); return name ? { ...character, name: name.name, originalName: name.originalName } : character; });
        if (result.error) characterNameErrors.set(id, result.error); else namedPages.set(key, Date.now());
      }).catch(error => { characterNameErrors.set(id, `中文角色名获取失败：${(error as Error).message}`); }).finally(() => {
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
  return { catalog, status, loading, notice, favorites, timezone, details, detailLoading, detailErrors, credits, creditsLoading, creditsErrors, characterNamesLoading, characterNameErrors, now, currentSeason, notify, initialize, refresh, loadDetail, loadCredits, loadCharacterNames, toggleFavorite, setTimezone, importFavorites, downloadFavorites };
}
export type AppState = ReturnType<typeof createAppState>;
export const appKey: InjectionKey<AppState> = Symbol('anime-calendar');
export function useAppState(): AppState { const value = inject(appKey); if (!value) throw new Error('应用状态尚未初始化'); return value; }

import { onUnmounted, ref, shallowRef, type Ref } from 'vue';
import { readFavorites, saveFavorites } from '../favorites';
import { defaultWatchRecord, emptyWatchSnapshot, exportWatchBackup, mergeWatchBackup, parseWatchBackup, updateWatchRecord, type ParsedWatchBackup, type WatchList, type WatchRecordPatch, type WatchSnapshot, type WatchTitle } from './model';
import { createWatchStore } from './store';

export interface WatchBackupPreview extends ParsedWatchBackup {
  addedRecords: number;
  addedLists: number;
  conflicts: number;
  addedFavorites: number;
}

interface LibraryOptions {
  favorites: Ref<string[]>;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  lock(work: () => void | Promise<void>): Promise<void>;
  notify(message: string, kind?: 'info' | 'error'): void;
}

const maxBackupBytes = 64 * 1024 * 1024;
const nameKey = (value: string) => value.trim().normalize('NFKC').toLocaleLowerCase('zh-CN');
const stamp = () => new Date().toISOString();

export function useWatchLibrary(options: LibraryOptions) {
  const { favorites, storage, lock, notify } = options;
  const watchlist = shallowRef(emptyWatchSnapshot());
  const watchReady = ref(false), watchStorageError = ref<string | null>(null);
  const watchEditor = shallowRef<{ id: string; focus?: 'date' } | null>(null);
  const store = createWatchStore();
  let unsubscribe: (() => void) | undefined, reading: Promise<void> | undefined;
  let generation = 0, disposed = false;

  function readLibrary() {
    const readGeneration = ++generation;
    const task = store.read().then(snapshot => {
      if (disposed || readGeneration !== generation) return;
      watchlist.value = snapshot;
      watchStorageError.value = null;
    }).catch(() => {
      if (!disposed && readGeneration === generation) watchStorageError.value = '暂时无法读取追番记录。请检查浏览器存储后重试。';
    }).finally(() => {
      if (reading === task) reading = undefined;
      if (!disposed) watchReady.value = true;
    });
    reading = task;
    return task;
  }

  function syncLibrary() { void readLibrary(); }
  function ensureWatchLibrary() {
    if (!unsubscribe) {
      unsubscribe = store.subscribe(syncLibrary);
      window.addEventListener('focus', syncLibrary);
    }
    return reading ?? (watchReady.value && !watchStorageError.value ? Promise.resolve() : readLibrary());
  }

  function openWatchEditor(id: string, focus?: 'date') {
    watchEditor.value = { id, focus };
    void ensureWatchLibrary();
  }

  function publish(snapshot: WatchSnapshot) {
    if (disposed) return;
    const verify = !!reading;
    generation++;
    watchlist.value = snapshot;
    watchReady.value = true;
    watchStorageError.value = null;
    if (verify) void readLibrary();
  }

  async function mutate(change: (snapshot: WatchSnapshot) => WatchSnapshot): Promise<boolean> {
    await ensureWatchLibrary();
    try {
      publish(await store.mutate(change));
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : '浏览器存储暂不可用。';
      notify(`未保存：${detail}`, 'error');
      return false;
    }
  }

  function changeRecords(snapshot: WatchSnapshot, ids: string[], patch: (watched: number | null) => WatchRecordPatch) {
    const records = new Map(snapshot.records.map(record => [record.id, record]));
    const at = stamp();
    for (const id of new Set(ids)) {
      const previous = records.get(id) ?? defaultWatchRecord(id);
      records.set(id, updateWatchRecord(previous, patch(previous.watched), at));
    }
    return { ...snapshot, records: [...records.values()] };
  }

  function updateWatchRecords(ids: string[], patch: WatchRecordPatch) {
    return mutate(snapshot => changeRecords(snapshot, ids, () => patch));
  }

  function incrementWatch(id: string) {
    return mutate(snapshot => changeRecords(snapshot, [id], watched => ({ watched: (watched ?? 0) + 1 })));
  }

  function saveWatchRecord(id: string, patch: WatchRecordPatch, listIds: string[], previousListIds: string[]) {
    return mutate(snapshot => {
      const next = Object.keys(patch).length ? changeRecords(snapshot, [id], () => patch) : snapshot;
      const selected = new Set(listIds), previous = new Set(previousListIds);
      const memberships = next.memberships.filter(row => row.animeId !== id || !previous.has(row.listId) || selected.has(row.listId));
      for (const listId of selected) {
        if (!previous.has(listId) && next.lists.some(list => list.id === listId)) memberships.push({ listId, animeId: id });
      }
      return { ...next, memberships };
    });
  }

  function saveWatchList(input: { id?: string; name: string; description: string; pinned: boolean; memberIds?: string[] }) {
    const id = input.id ?? crypto.randomUUID();
    return mutate(snapshot => {
      const existing = snapshot.lists.find(list => list.id === id);
      if (input.id && !existing) throw new Error('该清单已移除。');
      if (snapshot.lists.some(list => list.id !== id && nameKey(list.name) === nameKey(input.name))) throw new Error('已有同名清单。');
      const list: WatchList = { id, name: input.name.trim(), description: input.description.trim(), pinned: input.pinned, createdAt: existing?.createdAt ?? stamp() };
      const additions = [...new Set(input.memberIds ?? [])].map(animeId => ({ listId: id, animeId }));
      const memberships = [...snapshot.memberships, ...additions];
      return { ...snapshot, lists: [...snapshot.lists.filter(item => item.id !== id), list], memberships };
    });
  }

  function deleteWatchList(id: string) {
    return mutate(snapshot => ({ ...snapshot, lists: snapshot.lists.filter(list => list.id !== id), memberships: snapshot.memberships.filter(row => row.listId !== id) }));
  }

  function addWatchListMembers(listId: string, ids: string[]) {
    return mutate(snapshot => {
      if (!snapshot.lists.some(list => list.id === listId)) throw new Error('该清单已移除。');
      const existing = new Set(snapshot.memberships.filter(row => row.listId === listId).map(row => row.animeId));
      const additions = [...new Set(ids)].filter(id => !existing.has(id)).map(animeId => ({ animeId, listId }));
      return { ...snapshot, memberships: [...snapshot.memberships, ...additions] };
    });
  }

  function removeWatchListMembers(listId: string, ids: string[]) {
    const selected = new Set(ids);
    return mutate(snapshot => ({ ...snapshot, memberships: snapshot.memberships.filter(row => row.listId !== listId || !selected.has(row.animeId)) }));
  }

  function clearWatchRecord(id: string) {
    return mutate(snapshot => ({ ...snapshot, records: snapshot.records.filter(record => record.id !== id), memberships: snapshot.memberships.filter(row => row.animeId !== id), titles: favorites.value.includes(id) ? snapshot.titles : snapshot.titles.filter(title => title.id !== id) }));
  }

  const titleQueue = new Map<string, WatchTitle>();
  let titleTimer: ReturnType<typeof setTimeout> | undefined;
  let titleWriteWarning = false;
  function rememberWatchTitles(titles: WatchTitle[]) {
    if (disposed) return;
    for (const title of titles) {
      const previous = titleQueue.get(title.id);
      titleQueue.set(title.id, title.episodes === null && previous?.episodes ? { ...title, episodes: previous.episodes } : title);
    }
    if (!titleQueue.size || titleTimer) return;
    titleTimer = setTimeout(() => {
      titleTimer = undefined;
      const queue = [...titleQueue.values()];
      titleQueue.clear();
      void ensureWatchLibrary().then(async () => {
        if (disposed || watchStorageError.value) return;
        try {
          const retained = new Set([...favorites.value, ...watchlist.value.records.map(row => row.id), ...watchlist.value.memberships.map(row => row.animeId)]);
          await store.mergeTitles(queue.filter(title => retained.has(title.id)));
        } catch {
          if (!disposed && !titleWriteWarning) { titleWriteWarning = true; notify('部分作品资料未能缓存。'); }
        }
      });
    }, 120);
  }

  async function previewWatchBackup(file: File): Promise<WatchBackupPreview | null> {
    try {
      if (file.size > maxBackupBytes) throw new Error('备份文件过大，现有记录未改动。');
      const backup = parseWatchBackup(await file.text());
      const existing = new Set(favorites.value);
      const addedFavorites = backup.favorites.filter(id => !existing.has(id)).length;
      if (existing.size + addedFavorites > 30_000) throw new Error('合并后收藏超过数量限制。');
      if (backup.version === 1) return { ...backup, addedRecords: 0, conflicts: 0, addedLists: 0, addedFavorites };
      await ensureWatchLibrary();
      const { addedRecords, conflicts, addedLists } = mergeWatchBackup(await store.read(), backup.snapshot);
      return { ...backup, addedRecords, conflicts, addedLists, addedFavorites };
    } catch (error) {
      notify(error instanceof Error ? error.message : '无法读取备份。', 'error');
      return null;
    }
  }

  async function applyWatchBackup(backup: WatchBackupPreview) {
    let recordsSaved = false;
    try {
      await lock(async () => {
        const latest = readFavorites(storage);
        const next = [...new Set([...(latest.error ? favorites.value : latest.ids), ...backup.favorites])];
        if (next.length > 30_000) throw new Error('合并后收藏超过数量限制。');
        if (backup.version === 2) {
          publish(await store.mutate(snapshot => mergeWatchBackup(snapshot, backup.snapshot).snapshot));
          recordsSaved = true;
        }
        const saved = saveFavorites(storage, next);
        if (!saved.saved) throw new Error(saved.error);
        favorites.value = next;
      });
      notify(`备份已合并，当前共 ${favorites.value.length} 部追番。`);
      return true;
    } catch (error) {
      notify(recordsSaved ? '个人记录和清单已保存，收藏列表未保存。可用同一份备份重试。' : (error instanceof Error ? error.message : '备份未能保存。'), 'error');
      return false;
    }
  }

  async function downloadWatchBackup() {
    try {
      await ensureWatchLibrary();
      const snapshot = await store.read(), at = stamp();
      const ids = readFavorites(storage);
      if (ids.error) throw new Error(ids.error);
      const retained = new Set([...ids.ids, ...snapshot.records.map(row => row.id), ...snapshot.memberships.map(row => row.animeId)]);
      const exported = { ...snapshot, titles: snapshot.titles.filter(title => retained.has(title.id)) };
      const backup = new Blob([exportWatchBackup(ids.ids, exported, at)], { type: 'application/json' });
      if (backup.size > maxBackupBytes) throw new Error('完整备份超过 64 MiB。可先导出仅收藏备份。');
      const url = URL.createObjectURL(backup);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `anime-calendar-watchlist-${at.slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { notify(error instanceof Error ? error.message : '备份导出失败。', 'error'); }
  }

  onUnmounted(() => {
    disposed = true;
    clearTimeout(titleTimer);
    unsubscribe?.();
    window.removeEventListener('focus', syncLibrary);
    store.close();
  });

  return {
    watchlist, watchReady, watchStorageError, watchEditor, ensureWatchLibrary, rememberWatchTitles, openWatchEditor,
    updateWatchRecords, incrementWatch, saveWatchRecord, saveWatchList, deleteWatchList, addWatchListMembers,
    removeWatchListMembers, clearWatchRecord, previewWatchBackup, applyWatchBackup, downloadWatchBackup,
  };
}

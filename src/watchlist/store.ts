import { WATCH_LIMITS, emptyWatchSnapshot, validateWatchSnapshot, watchMembershipKey, type WatchSnapshot, type WatchTitle } from './model';

const databaseName = 'anime-calendar:watchlist';
const storeNames = ['records', 'lists', 'memberships', 'titles'] as const;
type StoreName = typeof storeNames[number];
type Change = (snapshot: WatchSnapshot) => WatchSnapshot;

function writeChanges<T>(store: IDBObjectStore, before: T[], after: T[], key: (row: T) => string, storageKey: (row: T) => IDBValidKey = key) {
  const previous = new Map(before.map(row => [key(row), row]));
  let changed = false;
  for (const row of after) {
    const identity = key(row), old = previous.get(identity);
    if (!old || JSON.stringify(row) !== JSON.stringify(old)) { store.put(row); changed = true; }
    previous.delete(identity);
  }
  for (const row of previous.values()) { store.delete(storageKey(row)); changed = true; }
  return changed;
}

function writeSnapshot(transaction: IDBTransaction, before: WatchSnapshot, after: WatchSnapshot) {
  const records = writeChanges(transaction.objectStore('records'), before.records, after.records, row => row.id);
  const lists = writeChanges(transaction.objectStore('lists'), before.lists, after.lists, row => row.id);
  const titles = writeChanges(transaction.objectStore('titles'), before.titles, after.titles, row => row.id);
  const memberships = writeChanges(transaction.objectStore('memberships'), before.memberships, after.memberships, watchMembershipKey, row => [row.listId, row.animeId]);
  return records || lists || titles || memberships;
}

export function createWatchStore() {
  let opening: Promise<IDBDatabase> | undefined;
  let database: IDBDatabase | undefined;
  let channel: BroadcastChannel | undefined;
  let channelUnavailable = false, closed = false;
  const listeners = new Set<() => void>();

  function broadcasts() {
    if (!channel && !channelUnavailable && !closed) {
      try {
        channel = new BroadcastChannel(databaseName);
        channel.onmessage = event => {
          if (event.data === 'updated') for (const listener of listeners) listener();
        };
      } catch { channelUnavailable = true; }
    }
    return channel;
  }

  function open() {
    if (closed) return Promise.reject(new Error('追番存储已关闭。'));
    if (opening) return opening;
    const task = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('当前浏览器无法打开追番存储。')); return; }
      const request = indexedDB.open(databaseName, 1);
      let blocked = false;
      request.onblocked = () => { blocked = true; reject(new Error('追番存储暂时被其他标签页占用，请关闭旧页面后重试。')); };
      request.onupgradeneeded = () => {
        if (closed || blocked) { request.transaction?.abort(); return; }
        for (const name of storeNames) request.result.createObjectStore(name, { keyPath: name === 'memberships' ? ['listId', 'animeId'] : 'id' });
      };
      request.onerror = () => reject(request.error ?? new Error('无法打开追番存储。'));
      request.onsuccess = () => {
        const connection = request.result;
        if (closed || blocked) { connection.close(); reject(new Error('无法打开追番存储。')); return; }
        database = connection;
        const release = () => {
          if (database === connection) { database = undefined; opening = undefined; }
        };
        connection.onclose = release;
        connection.onversionchange = () => { connection.close(); release(); };
        resolve(connection);
      };
    });
    opening = task;
    void task.catch(() => { if (opening === task) opening = undefined; });
    return task;
  }

  async function load(change?: Change): Promise<WatchSnapshot> {
    const connection = await open();
    if (closed) throw new Error('追番存储已关闭。');
    return new Promise((resolve, reject) => {
      const transaction = connection.transaction([...storeNames], change ? 'readwrite' : 'readonly');
      const rows = emptyWatchSnapshot();
      let remaining = storeNames.length, result: WatchSnapshot | undefined;
      let changed = false, error: unknown;
      transaction.onabort = () => reject(error ?? transaction.error ?? new Error('追番存储事务已取消。'));
      transaction.oncomplete = () => {
        if (!result) { reject(new Error('无法读取追番记录。')); return; }
        if (changed) {
          try { broadcasts()?.postMessage('updated'); } catch { /* Refreshing the tab also reads the committed data. */ }
        }
        resolve(result);
      };
      function received<Name extends StoreName>(name: Name, value: WatchSnapshot[Name]) {
        rows[name] = value;
        if (--remaining > 0) return;
        try {
          const current = validateWatchSnapshot(rows);
          result = change ? validateWatchSnapshot(change(current)) : current;
          if (change) changed = writeSnapshot(transaction, rows, result);
        } catch (failure) { error = failure; transaction.abort(); }
      }
      for (const name of storeNames) {
        const request = transaction.objectStore(name).getAll();
        request.onsuccess = () => received(name, request.result);
      }
    });
  }

  async function mergeTitles(titles: WatchTitle[]): Promise<void> {
    if (!titles.length) return;
    const checked = validateWatchSnapshot({ ...emptyWatchSnapshot(), titles }).titles;
    const connection = await open();
    if (closed) throw new Error('追番存储已关闭。');
    // Catalog batches touch only public title metadata, so editing or loading a
    // large library does not rewrite its personal records for every request.
    return new Promise((resolve, reject) => {
      const transaction = connection.transaction('titles', 'readwrite');
      const store = transaction.objectStore('titles');
      let failure: Error | undefined;
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('作品索引存储事务已取消。'));
      transaction.oncomplete = () => resolve();
      const size = store.count();
      size.onsuccess = () => {
        let count = size.result;
        for (const title of checked) {
          const lookup = store.get(title.id);
          lookup.onsuccess = () => {
            const previous = lookup.result as WatchTitle | undefined;
            if (!previous && ++count > WATCH_LIMITS.titles) {
              failure = new Error('作品索引已达到存储数量上限。'); transaction.abort(); return;
            }
            const merged = { ...title, episodes: title.episodes ?? previous?.episodes ?? null };
            if (!previous || JSON.stringify(previous) !== JSON.stringify(merged)) store.put(merged);
          };
        }
      };
    });
  }

  return {
    read: () => load(),
    mutate: (change: Change) => load(change),
    mergeTitles,
    subscribe(callback: () => void) {
      if (closed) return () => {};
      listeners.add(callback); broadcasts();
      return () => { listeners.delete(callback); };
    },
    close() {
      closed = true;
      database?.close(); database = undefined; opening = undefined;
      channel?.close(); channel = undefined; listeners.clear();
    },
  };
}

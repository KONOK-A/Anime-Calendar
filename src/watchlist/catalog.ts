import { computed, ref, shallowReactive, shallowRef } from 'vue';
import { isMemberAdvance } from '../../shared/airing-policy';
import { buildSchedule, dateKey, effectiveActiveIds, weekWindow } from '../../shared/schedule';
import type { AiringEvent, Anime, CatalogSnapshot, CatalogView, Timezone } from '../../shared/types';
import { catalogRequests, type CatalogRequest } from '../catalog-requests';
import { watchTitle, type WatchTitle } from './model';

interface WatchCatalogOptions {
  load(request: CatalogRequest, signal: AbortSignal, force: boolean): Promise<CatalogView>;
  onTitles(titles: WatchTitle[]): void;
  onStatus?(view: CatalogView): void;
}

const day = 86_400_000;

export function watchDisplayDays(now: string, timezone: Timezone): string[] {
  const today = Date.parse(`${dateKey(now, timezone)}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, index) => new Date(today + index * day).toISOString().slice(0, 10));
}

function watchWindowEnd(now: string, timezone: Timezone, days: 7 | 14) {
  const offset = timezone === 'Asia/Tokyo' ? '+09:00' : '+08:00';
  return Date.parse(`${dateKey(now, timezone)}T00:00:00${offset}`) + days * day;
}

export function watchWeekRequests(now: string, timezone: Timezone, days: 7 | 14 = 7): CatalogRequest[] {
  const requests = catalogRequests('/weekly', now, timezone, []);
  const end = watchWindowEnd(now, timezone, days);
  for (let start = Date.parse(weekWindow(now, timezone).end); start < end; start += 7 * day) {
    requests.push(...catalogRequests('/weekly', new Date(start + day / 2).toISOString(), timezone, []));
  }
  return requests;
}

/** Each week's projection is authoritative only inside its own display week. */
export function watchReferenceEvents(views: CatalogView[], now: string, timezone: Timezone, days: 7 | 14 = 7): Map<string, AiringEvent> {
  const start = Date.parse(now);
  const end = watchWindowEnd(now, timezone, days);
  const events: AiringEvent[] = [];
  for (const { scope, catalog } of views) {
    if (scope.type !== 'weekly' || scope.timezone !== timezone || !catalog) continue;
    const week = weekWindow(`${scope.week}T12:00:00Z`, timezone);
    const from = Math.max(start, Date.parse(week.start)), until = Math.min(end, Date.parse(week.end));
    if (from >= until) continue;
    events.push(...buildSchedule(catalog, { start: new Date(from).toISOString(), end: new Date(until).toISOString() }));
  }
  const key = (event: AiringEvent) => `${event.animeId}|${event.at}`;
  const cancelled = new Set(events.filter(event => event.status === 'cancelled').map(key));
  const next = new Map<string, AiringEvent>();
  events.sort((a, b) => a.at.localeCompare(b.at) || Number(b.basis === 'official') - Number(a.basis === 'official') || a.animeId.localeCompare(b.animeId));
  for (const event of events) if (!next.has(event.animeId) && !cancelled.has(key(event))) next.set(event.animeId, event);
  return next;
}

export function createWatchCatalog(options: WatchCatalogOptions) {
  const titles = shallowReactive(new Map<string, WatchTitle>());
  const items = shallowReactive(new Map<string, Anime>());
  const missing = shallowReactive(new Set<string>());
  const failed = shallowReactive(new Set<string>());
  const schedule = shallowRef<CatalogSnapshot>();
  const activeIds = computed(() => schedule.value && effectiveActiveIds(schedule.value));
  let scheduleRevision: string | undefined;
  const active = ref(false), waiting = ref(0), running = ref(0);
  const pending = computed(() => active.value && running.value > 0);
  const indexing = computed(() => active.value && (waiting.value > 0 || pending.value));
  const attempted = new Set<string>(), forced = new Set<string>(), queued = new Set<string>();
  const requests = new Map<AbortController, string[]>(), inFlight = new Set<string>();
  let wanted = new Set<string>(), visible = new Set<string>();
  let pumpScheduled = false, disposed = false;

  function reconcile(id: string) {
    if (wanted.has(id) && !attempted.has(id) && !inFlight.has(id) && (visible.has(id) || forced.has(id) || !titles.has(id))) queued.add(id);
    else queued.delete(id);
  }

  function enqueuePump() {
    waiting.value = queued.size;
    running.value = requests.size;
    if (pumpScheduled || disposed || !active.value || !queued.size) return;
    pumpScheduled = true;
    queueMicrotask(() => {
      pumpScheduled = false;
      pump();
    });
  }

  function priorityBatch(): string[] {
    const current = [...visible].filter(id => queued.has(id));
    if (current.length) return current.slice(0, 50);
    // Complete the on-screen reads before starting work for the rest of the library.
    if ([...visible].some(id => wanted.has(id) && inFlight.has(id))) return [];
    const ids: string[] = [];
    for (const id of queued) {
      ids.push(id);
      if (ids.length === 50) break;
    }
    return ids;
  }

  function pump() {
    while (!disposed && active.value && requests.size < 2 && queued.size) {
      const ids = priorityBatch();
      if (!ids.length) break;
      const controller = new AbortController();
      for (const id of ids) {
        queued.delete(id);
        inFlight.add(id);
      }
      requests.set(controller, ids);
      const request = catalogRequests('/favorites', new Date().toISOString(), 'Asia/Shanghai', ids)[0]!;
      void run(request, ids, controller.signal, ids.some(id => forced.has(id))).finally(() => {
        requests.delete(controller);
        for (const id of ids) {
          inFlight.delete(id);
          reconcile(id);
        }
        enqueuePump();
      });
    }
    waiting.value = queued.size;
    running.value = requests.size;
  }

  function finish(id: string) {
    attempted.add(id);
    forced.delete(id);
    missing.delete(id);
    failed.delete(id);
  }

  async function run(request: CatalogRequest, ids: string[], signal: AbortSignal, force: boolean) {
    let view: CatalogView;
    try {
      view = await options.load(request, signal, force);
      if (!view.catalog || view.scope.key !== request.scope.key) throw new Error('目录返回范围不符');
    } catch {
      if (signal.aborted || disposed || !active.value) return;
      for (const id of ids) if (wanted.has(id)) {
        finish(id);
        failed.add(id);
      }
      return;
    }
    if (signal.aborted || disposed || !active.value) return;
    if (view.revision !== scheduleRevision) {
      scheduleRevision = view.revision;
      schedule.value = view.catalog;
    }
    const current = new Map(view.catalog.items.map(item => [item.id, item]));
    const absent = new Set(view.missingIds ?? []);
    const changed: WatchTitle[] = [];
    for (const id of ids) {
      if (!wanted.has(id)) continue;
      finish(id);
      const item = current.get(id);
      if (item) {
        const title = rememberItem(item);
        if (title === null) failed.add(id);
        else if (title) changed.push(title);
      } else if (absent.has(id)) {
        items.delete(id);
        missing.add(id);
      } else failed.add(id);
    }
    if (changed.length) options.onTitles(changed);
    options.onStatus?.(view);
  }

  function airingEnded(id: string, now: string): boolean {
    const item = items.get(id), snapshot = schedule.value;
    if (!item || !snapshot || activeIds.value?.has(id)) return false;
    const at = Date.parse(now);
    const rules = item.networkAiring?.rules?.length ? item.networkAiring.rules : [item.rule];
    const ends = [item.broadcastRule?.end, ...rules.map(rule => rule.end)].map(end => Date.parse(end ?? '')).filter(Number.isFinite);
    if (!ends.length || ends.some(end => end >= at) || rules.some(rule => Date.parse(rule.anchor ?? '') >= at)) return false;
    return !snapshot.overrides.events.some(event => event.animeId === id && event.status === 'scheduled' && !isMemberAdvance(event) && Date.parse(event.at) >= at);
  }

  function rememberItem(item: Anime): WatchTitle | undefined | null {
    const previous = titles.get(item.id);
    let title: WatchTitle;
    try { title = watchTitle(item, previous?.episodes); }
    catch { return null; }
    items.set(item.id, item);
    if (JSON.stringify(previous) === JSON.stringify(title)) return;
    titles.set(item.id, title);
    return title;
  }

  function prioritize(ids: string[]) {
    const before = visible;
    visible = new Set(ids);
    for (const id of before) reconcile(id);
    for (const id of visible) reconcile(id);
    enqueuePump();
  }

  function activate(ids: string[], visibleIds = [...visible]) {
    if (disposed) return;
    active.value = true;
    const next = new Set(ids);
    for (const id of wanted) if (!next.has(id)) {
      queued.delete(id);
      attempted.delete(id);
      forced.delete(id);
      missing.delete(id);
      failed.delete(id);
    }
    wanted = next;
    for (const [controller, batch] of requests) if (batch.every(id => !wanted.has(id))) controller.abort();
    for (const id of wanted) reconcile(id);
    prioritize(visibleIds);
  }

  function seed(values: WatchTitle[]) {
    for (const value of values) {
      const previous = titles.get(value.id);
      if (!previous) titles.set(value.id, value);
      else if (value.episodes !== null && previous.episodes !== value.episodes) titles.set(value.id, { ...previous, episodes: value.episodes });
      reconcile(value.id);
    }
    enqueuePump();
  }

  function seedItems(values: Anime[]) {
    for (const item of values) {
      if (!titles.has(item.id)) rememberItem(item);
      else if (!items.has(item.id)) items.set(item.id, item);
      reconcile(item.id);
    }
    enqueuePump();
  }

  function refresh(ids = [...wanted]) {
    for (const id of ids) if (wanted.has(id) && !inFlight.has(id)) {
      attempted.delete(id);
      forced.add(id);
      reconcile(id);
    }
    enqueuePump();
  }

  function deactivate() {
    active.value = false;
    for (const controller of requests.keys()) controller.abort();
  }

  function dispose() {
    disposed = true;
    deactivate();
  }

  return { titles, items, missing, failed, pending, indexing, airingEnded, activate, prioritize, seed, seedItems, refresh, deactivate, dispose };
}

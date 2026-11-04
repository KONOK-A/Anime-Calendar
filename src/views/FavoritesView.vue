<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import Icon from '../components/Icon.vue';
import Poster from '../components/Poster.vue';
import { useAppState } from '../state';
import { WATCHLIST_PAGE_SIZE } from '../browse';
import { useListMotion } from '../motion';
import { dateKey, seasonLabel } from '../../shared/schedule';
import WatchEntry from '../watchlist/WatchEntry.vue';
import WatchSelect from '../watchlist/WatchSelect.vue';
import { watchDisplayDays } from '../watchlist/catalog';
import { defaultWatchRecord, WATCH_LIMITS, WATCH_STATUSES, WATCH_STATUS_LABELS, type WatchList, type WatchStatus } from '../watchlist/model';
import '../watchlist/workspace.css';

const state = useAppState();
const browse = state.browse.watchlist;
const { titles, missing, failed, indexing } = state.watchCatalog;
const snapshot = state.watchlist;
const heading = ref<HTMLElement>();
const resultsHeading = ref<HTMLElement>();
const entries = ref<HTMLElement>();
const searchInput = ref<HTMLInputElement>();
const pageSelection = ref<HTMLButtonElement>();
const panel = ref<HTMLDialogElement>();
const fileInput = ref<HTMLInputElement>();
const exportOptions = ref<HTMLDetailsElement>();
const selected = shallowRef(new Set<string>());
const savedIds = computed(() => new Set(state.favorites.value));
const records = computed(() => new Map(snapshot.value.records.map(record => [record.id, record])));
const lists = computed(() => [...snapshot.value.lists].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
const activeList = computed(() => lists.value.find(list => list.id === browse.listId));
const members = computed(() => {
  const activeByList = new Map<string, string[]>();
  const assigned = new Set<string>();
  for (const { listId, animeId } of snapshot.value.memberships) {
    assigned.add(animeId);
    if (savedIds.value.has(animeId) && !record(animeId).archived) {
      const activeIds = activeByList.get(listId) ?? [];
      activeIds.push(animeId);
      activeByList.set(listId, activeIds);
    }
  }
  return { activeByList, assigned };
});
function record(id: string) { return records.value.get(id) ?? defaultWatchRecord(id); }
function title(id: string) { return titles.get(id); }
function name(id: string) { return title(id)?.title ?? id; }
function availability(id: string) { return missing.has(id) ? 'missing' : failed.has(id) ? 'failed' : undefined; }
function listMembers(id: string) { return members.value.activeByList.get(id) ?? []; }

const detached = computed(() => [...new Set([...records.value.keys(), ...members.value.assigned])].filter(id => !savedIds.value.has(id)));
const active = computed(() => state.favorites.value.filter(id => !record(id).archived));
const inbox = computed(() => active.value.filter(id => !members.value.assigned.has(id)));
const archived = computed(() => state.favorites.value.filter(id => record(id).archived));
const visibleList = computed(() => browse.section === 'all' || browse.section === 'inbox' || browse.section === 'archive' || browse.section === 'lists' && !!activeList.value);
const navigation = computed(() => [
  { id: 'plan', label: '近期排期', icon: 'calendar' },
  { id: 'all', label: '全部作品', icon: 'rows', count: active.value.length },
  { id: 'inbox', label: '待整理', icon: 'bookmark', count: inbox.value.length },
  { id: 'lists', label: '我的清单', icon: 'grid', count: lists.value.length },
  { id: 'archive', label: '归档', icon: 'archive', count: archived.value.length + detached.value.length },
] as const);

const referenceDays = computed(() => watchDisplayDays(state.now.value, state.timezone.value));
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', weekday: 'short' });
function weekday(day: string) { return dateFormatter.format(new Date(`${day}T12:00:00Z`)); }
function dateLabel(day: string) { return `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`; }
const watchingCount = computed(() => active.value.filter(id => records.value.get(id)?.status === 'watching').length);
const reference = computed(() => [...state.watchReference.value.entries()].filter(([id]) => savedIds.value.has(id)));
const referenceGroups = computed(() => {
  const byDay = new Map<string, string[]>();
  for (const [id, event] of reference.value) {
    const day = dateKey(event.at, state.timezone.value);
    const group = byDay.get(day) ?? [];
    group.push(id);
    byDay.set(day, group);
  }
  return [...byDay.entries()];
});
const next = (id: string) => state.watchNextEvents.value.get(id);

const scope = computed(() => {
  if (browse.section === 'inbox') return inbox.value;
  if (browse.section === 'lists' && activeList.value) return listMembers(activeList.value.id);
  if (browse.section === 'archive') return [...archived.value, ...detached.value];
  return active.value;
});
const collator = new Intl.Collator('zh-CN', { numeric: true });
const normalized = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase();
function searchText(id: string) {
  const item = title(id);
  return normalized([item?.title, item?.originalTitle, ...(item?.aliases ?? []), id].filter(Boolean).join('\n'));
}
const searchIndex = computed(() => new Map(scope.value.map(id => [id, searchText(id)])));
const quarterOptions = computed(() => [...new Set(scope.value.map(id => title(id)?.season).filter((value): value is string => !!value))].sort().reverse());
const quarterChoices = computed(() => [{ value: '', label: '全部季度' }, ...quarterOptions.value.map(value => ({ value, label: seasonLabel(value) }))]);
const listChoices = computed(() => [{ value: '', label: '所有清单' }, ...lists.value.map(list => ({ value: list.id, label: list.name }))]);
const sortChoices: { value: typeof browse.sort; label: string }[] = [
  { value: 'recent', label: '最近记录' }, { value: 'added', label: '最近加入' },
  { value: 'date', label: '计划日期' }, { value: 'title', label: '作品标题' },
];
function changeSort(value: string) {
  const choice = sortChoices.find(option => option.value === value);
  if (choice) browse.sort = choice.value;
}
const addedRank = computed(() => new Map(state.favorites.value.map((id, rank) => [id, rank])));
const recordTimes = computed(() => new Map(snapshot.value.records.map(record => [record.id, Date.parse(record.updatedAt)])));
const match = computed(() => {
  const query = normalized(browse.query);
  return scope.value.filter(id => {
    return (!query || searchIndex.value.get(id)?.includes(query))
      && (!browse.status || record(id).status === browse.status)
      && (!browse.season || title(id)?.season === browse.season);
  }).sort((a, b) => {
    if (browse.section === 'archive' && savedIds.value.has(a) !== savedIds.value.has(b)) return savedIds.value.has(a) ? -1 : 1;
    const recentAdded = (addedRank.value.get(b) ?? -1) - (addedRank.value.get(a) ?? -1);
    if (browse.sort === 'title') return Number(!title(a)) - Number(!title(b)) || collator.compare(name(a), name(b)) || a.localeCompare(b);
    if (browse.sort === 'date') return (records.value.get(a)?.plannedDate ?? 'z').localeCompare(records.value.get(b)?.plannedDate ?? 'z') || recentAdded || a.localeCompare(b);
    if (browse.sort === 'added') return recentAdded || a.localeCompare(b);
    const timeA = recordTimes.value.get(a) ?? -Infinity;
    const timeB = recordTimes.value.get(b) ?? -Infinity;
    return timeA === timeB ? recentAdded || a.localeCompare(b) : timeB - timeA;
  });
});
const sortHint = computed(() => {
  const ids = match.value;
  if (!ids.length) return '';
  if (browse.sort === 'recent') return ids.some(id => recordTimes.value.has(id)) ? '最近编辑的记录优先' : '暂无追番记录，按最近加入排列';
  if (browse.sort === 'date') return ids.some(id => records.value.get(id)?.plannedDate) ? '计划日期从早到晚，未安排的排在后面' : '暂无计划日期，按最近加入排列';
  if (browse.sort === 'added') return '最近收藏的作品优先';
  return '';
});
const pages = computed(() => Math.max(1, Math.ceil(match.value.length / WATCHLIST_PAGE_SIZE)));
const pageIds = computed(() => match.value.slice((browse.page - 1) * WATCHLIST_PAGE_SIZE, browse.page * WATCHLIST_PAGE_SIZE));
const hasFilters = computed(() => !!(browse.query.trim() || browse.status || browse.season));
const listMotion = useListMotion(entries, () => pageIds.value.join(','));
const listTitle = computed(() => activeList.value && browse.section === 'lists' ? activeList.value.name : navigation.value.find(item => item.id === browse.section)?.label ?? '全部作品');
const visibleGroups = computed(() => browse.section !== 'archive' ? [{ label: '', ids: pageIds.value }] : [
  { label: '已归档的作品', ids: pageIds.value.filter(id => savedIds.value.has(id)) },
  { label: '已取消收藏的记录', ids: pageIds.value.filter(id => !savedIds.value.has(id)) },
].filter(group => group.ids.length));
const prioritized = computed(() => {
  if (visibleList.value) return pageIds.value;
  if (browse.section === 'plan') return reference.value.map(([id]) => id);
  return lists.value.slice(0, 8).flatMap(list => listMembers(list.id).slice(0, 3));
});
watch(prioritized, ids => state.watchCatalog.prioritize(ids), { immediate: true });
watch([() => browse.query, () => browse.status, () => browse.season], () => {
  browse.page = 1;
  selected.value = new Set();
});
watch(() => browse.sort, () => { browse.page = 1; });
watch(() => browse.page, () => { if (selected.value.size) selected.value = new Set(); }, { flush: 'sync' });
watch([pages, state.watchReady, indexing], ([total, ready, loading]) => {
  if (ready && !loading && browse.page > total) browse.page = total;
}, { immediate: true });
watch([state.watchReady, activeList], ([ready, list]) => {
  if (ready && browse.listId && !list) { browse.listId = ''; browse.page = 1; }
}, { immediate: true });
watch(pageIds, (ids, previous) => {
  if (selected.value.size) {
    const onPage = ids.filter(id => selected.value.has(id));
    if (onPage.length !== selected.value.size) selected.value = new Set(onPage);
  }
  const control = document.activeElement;
  const card = control?.closest<HTMLElement>('.watch-entry');
  const id = card?.dataset.animeId;
  if (!id || !entries.value?.contains(card!) || !(control instanceof HTMLElement)) return;
  const stays = ids.includes(id);
  const replacement = stays ? id : ids[Math.min(previous.indexOf(id), ids.length - 1)];
  void nextTick(async () => {
    if (document.activeElement && document.activeElement !== document.body && document.activeElement !== control) return;
    const entry = Array.from(entries.value?.querySelectorAll<HTMLElement>('.watch-entry') ?? []).find(element => element.dataset.animeId === replacement);
    const target = stays && entry?.contains(control) ? control : entry?.querySelector<HTMLElement>('a.anime-link,button') ?? resultsHeading.value;
    target?.focus({ preventScroll: true });
    await listMotion.settled();
    if (document.activeElement === target) revealIfOutsideViewport(target, 'nearest');
  });
}, { flush: 'pre' });

function revealIfOutsideViewport(target: HTMLElement, block: ScrollLogicalPosition = 'start') {
  const header = document.querySelector('.site-header');
  const nav = header?.querySelector('.main-nav');
  const top = Math.max(0, header?.getBoundingClientRect().bottom ?? 0);
  const bottom = nav && getComputedStyle(nav).position === 'fixed' ? nav.getBoundingClientRect().top : window.innerHeight;
  const bounds = target.getBoundingClientRect();
  if (bounds.top < top + 6 || bounds.bottom > bottom - 6) target.scrollIntoView({ block, behavior: 'instant' });
}
function focusResults() {
  const target = resultsHeading.value;
  if (!target) return;
  target.focus({ preventScroll: true });
  revealIfOutsideViewport(target);
}
function show(section: typeof browse.section, listId = '', status: '' | WatchStatus = '') {
  if (browse.section === section && browse.listId === listId && browse.status === status) return;
  Object.assign(browse, { section, listId, status, query: '', season: '', page: 1 });
  selected.value = new Set();
  void nextTick(focusResults);
}
function pageTo(page: number, trigger?: EventTarget | null) {
  if (page < 1 || page > pages.value || page === browse.page) return;
  browse.page = page;
  void nextTick(() => {
    if (trigger instanceof HTMLButtonElement && trigger.isConnected) {
      const control = trigger.disabled ? trigger.parentElement?.querySelector<HTMLButtonElement>('button:not(:disabled)') : trigger;
      if (control) {
        control.focus({ preventScroll: true });
        return;
      }
    }
    focusResults();
  });
}
function resetFilters() {
  Object.assign(browse, { query: '', status: '', season: '' });
  void nextTick(() => {
    const input = searchInput.value;
    if (!input) return;
    input.focus({ preventScroll: true });
    revealIfOutsideViewport(input, 'nearest');
  });
}
function toggleSelection(id: string) {
  if (!pageIds.value.includes(id)) return;
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  selected.value = next;
}
const batchAllowed = computed(() => browse.section !== 'archive');
const allPageSelected = computed(() => !!pageIds.value.length && pageIds.value.every(id => selected.value.has(id)));
function togglePage() {
  selected.value = new Set(allPageSelected.value ? [] : pageIds.value);
}
function clearSelection() {
  selected.value = new Set();
  void nextTick(() => {
    const target = pageSelection.value ?? resultsHeading.value;
    if (!target) return;
    target.focus({ preventScroll: true });
    revealIfOutsideViewport(target, 'nearest');
  });
}
const localEditable = computed(() => state.watchReady.value && !state.watchStorageError.value);
const catalogIssue = computed(() => {
  const ids = state.favorites.value;
  return { missing: ids.filter(id => missing.has(id)), failed: ids.filter(id => failed.has(id)) };
});
function closeExportOptions(restoreFocus = false) {
  if (!exportOptions.value?.open) return;
  exportOptions.value.open = false;
  if (restoreFocus) exportOptions.value.querySelector('summary')?.focus();
}
function exportFocusOut(event: FocusEvent) {
  if (event.relatedTarget instanceof Node && !exportOptions.value?.contains(event.relatedTarget)) closeExportOptions();
}
function exportPointerDown(event: PointerEvent) {
  if (event.target instanceof Node && !exportOptions.value?.contains(event.target)) closeExportOptions();
}

type BackupPreview = NonNullable<Awaited<ReturnType<typeof state.previewWatchBackup>>>;
type Panel = { kind: 'list'; list?: WatchList; ids?: string[] }
  | { kind: 'delete-list'; list: WatchList }
  | { kind: 'clear'; id: string }
  | { kind: 'assign' | 'status' | 'archive'; ids: string[] }
  | { kind: 'import'; preview: BackupPreview };
const action = shallowRef<Panel>();
const listName = ref(''), listDescription = ref(''), listPinned = ref(false);
const destination = ref(''), batchStatus = ref<WatchStatus>('wanted');
const busy = ref(false), panelError = ref('');
let opener: HTMLElement | undefined;
let importRequest = 0;
onMounted(() => document.addEventListener('pointerdown', exportPointerDown, true));
onUnmounted(() => { importRequest++; document.removeEventListener('pointerdown', exportPointerDown, true); });
const panelTitle = computed(() => {
  switch (action.value?.kind) {
    case 'list': return action.value.list ? '编辑清单' : '新建清单';
    case 'delete-list': return '删除清单';
    case 'clear': return '清除观看记录';
    case 'assign': return '加入清单';
    case 'status': return '修改观看状态';
    case 'archive': return '归档作品';
    case 'import': return '预览备份';
    default: return '';
  }
});
const panelIcon = computed(() => {
  if (action.value?.kind === 'assign') return 'bookmark';
  if (action.value?.kind === 'list') return 'grid';
  if (action.value?.kind === 'import') return 'upload';
  return 'info';
});
const submitLabel = computed(() => {
  switch (action.value?.kind) {
    case 'import': return '合并导入';
    case 'delete-list': return '删除清单';
    case 'clear': return '清除记录';
    case 'archive': return '确认归档';
    case 'assign': return '加入清单';
    default: return '保存';
  }
});
const destructive = computed(() => action.value?.kind === 'clear' || action.value?.kind === 'delete-list');
function open(value: Panel, source?: HTMLElement) {
  if (panel.value?.open || busy.value) return;
  opener = source ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  panelError.value = '';
  action.value = value;
  if (value.kind === 'list') {
    listName.value = value.list?.name ?? '';
    listDescription.value = value.list?.description ?? '';
    listPinned.value = value.list?.pinned ?? false;
  }
  destination.value = lists.value.length === 1 ? lists.value[0]!.id : '';
  batchStatus.value = value.kind === 'status' ? record(value.ids[0]).status : 'wanted';
  void nextTick(() => {
    if (!panel.value || panel.value.open || !panel.value.isConnected) return;
    panel.value.showModal();
    panel.value.querySelector<HTMLElement>('[data-panel-heading]')?.focus({ preventScroll: true });
  });
}
function closePanel() { if (!busy.value) panel.value?.close(); }
function restoreFocus() {
  action.value = undefined;
  const target = opener;
  opener = undefined;
  void nextTick(() => (target?.isConnected && !target.matches(':disabled') ? target : resultsHeading.value ?? heading.value)?.focus({ preventScroll: true }));
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const request = ++importRequest;
  const preview = await state.previewWatchBackup(file);
  if (request === importRequest && preview) open({ kind: 'import', preview }, fileInput.value);
}
async function applyPanel() {
  const value = action.value;
  if (!value || busy.value) return;
  busy.value = true;
  panelError.value = '';
  try {
    let ok: boolean;
    switch (value.kind) {
      case 'list': ok = await state.saveWatchList({ id: value.list?.id, name: listName.value.trim(), description: listDescription.value.trim(), pinned: listPinned.value, memberIds: value.ids }); break;
      case 'delete-list': ok = await state.deleteWatchList(value.list.id); break;
      case 'clear': ok = await state.clearWatchRecord(value.id); break;
      case 'assign': ok = await state.addWatchListMembers(destination.value, value.ids); break;
      case 'status': ok = await state.updateWatchRecords(value.ids, { status: batchStatus.value }); break;
      case 'archive': ok = await state.updateWatchRecords(value.ids, { archived: true }); break;
      case 'import': ok = await state.applyWatchBackup(value.preview); break;
    }
    if (!ok) {
      panelError.value = state.notice.value?.kind === 'error' ? state.notice.value.text : '未保存，请重试。';
      return;
    }
    if ('ids' in value) selected.value = new Set();
    panel.value?.close();
  } finally { busy.value = false; }
}
function openAssign(ids: string[]) { open(lists.value.length ? { kind: 'assign', ids } : { kind: 'list', ids }); }
</script>

<template>
  <section class="favorites-page watchlist-page" aria-labelledby="watchlist-heading">
    <header class="view-heading collection-heading watchlist-heading">
      <div>
        <h1 id="watchlist-heading" ref="heading" tabindex="-1">我的追番<span class="heading-dot">.</span></h1>
        <p><span>{{ state.favorites.value.length }} 部收藏</span><span class="watch-header-divider" aria-hidden="true" /><span>{{ watchingCount }} 部在看</span></p>
      </div>
      <div class="backup-buttons watch-backup">
        <label class="button import-label" title="导入备份"><Icon name="upload" :size="16" /><span class="watch-backup-label">导入备份</span><input ref="fileInput" type="file" accept=".json,application/json" aria-label="导入追番备份" @change="importFile" /></label>
        <button class="button" type="button" aria-label="导出备份" title="导出备份" @click="state.downloadWatchBackup"><Icon name="download" :size="16" /><span class="watch-backup-label">导出备份</span></button>
        <details ref="exportOptions" class="watch-export-options" @keydown.esc.stop.prevent="closeExportOptions(true)" @focusout="exportFocusOut">
          <summary class="button" aria-label="备份选项" title="备份选项"><span aria-hidden="true">···</span></summary>
          <div><p>追番数据保存在当前浏览器。</p><button type="button" class="text-button" @click="state.downloadFavorites(); closeExportOptions(true)">导出仅收藏备份</button></div>
        </details>
      </div>
    </header>

    <div v-if="state.watchStorageError.value" class="watch-notice"><Icon name="info" :size="17" /><span role="status">{{ state.watchStorageError.value }}</span><button type="button" class="button" @click="state.ensureWatchLibrary">重试读取记录</button></div>
    <div class="watchlist-shell">
      <aside class="watch-sidebar" aria-label="追番工作区">
        <nav class="watch-nav" aria-label="我的追番分区">
          <button v-for="item in navigation" :key="item.id" type="button" :aria-current="browse.section === item.id ? 'page' : undefined" @click="show(item.id)">
            <svg v-if="item.id === 'archive'" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h18v4H3zm2 4v12h14V8m-10 4h6" /></svg>
            <Icon v-else :name="item.icon" :size="17" /><span>{{ item.label }}</span><small v-if="'count' in item" aria-hidden="true">{{ item.count }}</small>
          </button>
        </nav>
        <div class="watch-side-lists">
          <div class="watch-side-label"><span>自定义清单</span><button type="button" aria-label="新建自定义清单" title="新建清单" :disabled="!localEditable" @click="open({ kind: 'list' })">+</button></div>
          <button v-for="list in lists.slice(0, 12)" :key="list.id" class="watch-side-list" type="button" :aria-current="browse.section === 'lists' && browse.listId === list.id ? 'page' : undefined" @click="show('lists', list.id)">
            <Icon :name="list.pinned ? 'star' : 'bookmark'" :size="14" /><span :title="list.name">{{ list.name }}</span><small>{{ listMembers(list.id).length }}</small>
          </button>
          <p v-if="!lists.length">把想补的作品放进同一份清单。</p>
          <button v-if="lists.length > 12" type="button" class="text-button" @click="show('lists')">查看全部清单</button>
        </div>
      </aside>

      <div class="watch-workspace">
        <div v-if="!state.watchReady.value" role="status" class="collection-loading watch-notice"><Icon name="refresh" :size="17" class="spinning" />正在读取追番记录…</div>
        <template v-else>
          <div v-if="browse.section === 'lists' && lists.length" class="watch-mobile-lists"><WatchSelect :model-value="browse.listId" :options="listChoices" label="选择清单" icon="bookmark" @update:model-value="show('lists', $event)" /></div>
          <section v-if="browse.section === 'plan'" class="watch-plan" aria-labelledby="watch-plan-heading">
            <header class="watch-work-heading watch-updates-heading">
              <div>
                <h2 id="watch-plan-heading" ref="resultsHeading" tabindex="-1">近期排期</h2>
                <p>{{ dateLabel(referenceDays[0]) }} — {{ dateLabel(referenceDays[6]) }} · {{ state.timezone.value === 'Asia/Tokyo' ? '日本时间' : '北京时间' }}</p>
              </div>
              <span v-if="reference.length" class="watch-update-count">{{ reference.length }} 部有排期</span>
            </header>
            <div v-if="state.watchReferenceError.value" class="watch-notice" role="status"><span>{{ state.watchReferenceError.value }}</span><button type="button" class="text-button" @click="state.retryWatchCatalog">重试</button></div>
            <p v-else-if="state.watchReferenceLoading.value && !reference.length" class="watch-notice" role="status"><Icon name="refresh" :size="16" class="spinning" />正在读取排期…</p>
            <div v-else-if="!reference.length" class="watch-blank">
              <span class="watch-blank-icon"><Icon name="calendar" :size="23" /></span>
              <h3>{{ savedIds.size ? '未来七天暂无收藏作品的更新排期' : '还没有收藏作品' }}</h3>
              <p v-if="!savedIds.size"><a href="#/season" class="text-button">去季度目录看看</a></p>
            </div>
            <section v-for="[day, ids] in referenceGroups" :key="day" class="watch-plan-day">
              <h3><time :datetime="day">{{ dateLabel(day) }}</time><span>{{ day === referenceDays[0] ? '今天' : weekday(day) }}</span></h3>
              <div class="watch-record-grid watch-reference-grid">
                <WatchEntry v-for="id in ids" :key="id" :id="id" :title="title(id)" :record="record(id)" :next="state.watchReference.value.get(id)" saved reference />
              </div>
            </section>
          </section>

          <template v-else-if="browse.section === 'lists' && !activeList">
            <div class="watch-work-heading"><div><h2 ref="resultsHeading" tabindex="-1">我的清单</h2><p>{{ lists.length }} 份清单</p></div><button type="button" class="button primary" :disabled="!localEditable" @click="open({ kind: 'list' })">新建清单</button></div>
            <div v-if="lists.length" class="watch-list-gallery">
              <article v-for="list in lists" :key="list.id" class="watch-list-tile">
                <button type="button" class="watch-list-open" :aria-label="`${list.name}，${listMembers(list.id).length} 部作品${list.pinned ? '，已置顶' : ''}`" @click="show('lists', list.id)">
                  <span class="watch-list-cover" :data-count="listMembers(list.id).slice(0, 3).length">
                    <template v-if="listMembers(list.id).length"><Poster v-for="id in listMembers(list.id).slice(0, 3)" :key="id" :id="title(id) ? id : undefined" :title="name(id)" size="thumb" :theme="state.appearance.theme.value" /></template>
                    <Icon v-else name="bookmark" :size="36" />
                    <span v-if="list.pinned" class="watch-list-pin"><Icon name="star" :size="12" />已置顶</span>
                  </span>
                  <span class="watch-list-caption">
                    <span class="watch-list-name" :title="list.name">{{ list.name }}</span>
                    <span class="watch-list-count">{{ listMembers(list.id).length }} 部作品</span>
                    <span v-if="list.description" class="watch-list-description" :title="list.description">{{ list.description }}</span>
                  </span>
                </button>
                <button type="button" class="button watch-list-edit" :aria-label="`编辑${list.name}清单`" :disabled="!localEditable" @click="open({ kind: 'list', list })">编辑</button>
              </article>
            </div>
            <div v-else class="watch-blank"><span class="watch-blank-icon"><Icon name="grid" :size="27" /></span><h3>还没有自定义清单</h3><p>给补番计划、系列作品或想重看的番剧留一份清单。</p></div>
          </template>

          <section v-else class="watch-library" aria-labelledby="watch-library-heading">
            <div class="watch-work-heading">
              <div><button v-if="browse.section === 'lists' && activeList" type="button" class="text-button watch-list-back" @click="show('lists')"><Icon name="back" :size="13" />我的清单</button><h2 id="watch-library-heading" ref="resultsHeading" tabindex="-1">{{ listTitle }}</h2><p v-if="browse.section === 'lists' && activeList?.description" class="watch-active-description">{{ activeList.description }}</p></div>
              <div v-if="browse.section === 'lists' && activeList" class="watch-list-heading-actions">
                <button type="button" class="button" :disabled="!localEditable" @click="open({ kind: 'list', list: activeList })">编辑清单</button>
                <button type="button" class="button" :disabled="!localEditable" @click="open({ kind: 'delete-list', list: activeList })">删除清单</button>
              </div>
              <a v-else-if="browse.section === 'all'" href="#/season" class="button">去季度目录添加<Icon name="chevron" :size="14" /></a>
            </div>
            <div class="watch-filters">
              <label class="watch-search"><Icon name="search" :size="17" /><input ref="searchInput" v-model="browse.query" type="search" maxlength="120" aria-label="搜索追番作品" placeholder="搜索标题、原名或别名" /></label>
              <div class="watch-filter-pickers">
                <WatchSelect v-model="browse.season" :options="quarterChoices" label="筛选追番季度" icon="calendar" />
                <WatchSelect :model-value="browse.sort" :options="sortChoices" label="追番排序" icon="rows" @update:model-value="changeSort" />
              </div>
              <div class="watch-status-filters" role="group" aria-label="筛选观看状态">
                <button type="button" :aria-pressed="browse.status === ''" @click="browse.status = ''">全部状态</button>
                <button v-for="status in WATCH_STATUSES" :key="status" type="button" :aria-pressed="browse.status === status" @click="browse.status = status">{{ WATCH_STATUS_LABELS[status] }}</button>
              </div>
            </div>
            <p v-if="indexing" class="collection-loading watch-indexing" role="status"><Icon name="refresh" :size="15" class="spinning" />正在补齐作品资料，搜索结果会陆续更新。</p>
            <div class="watch-result-bar">
              <div class="watch-result-summary">
                <span role="status">{{ match.length }} 部作品</span>
                <small v-if="sortHint" class="watch-sort-hint">{{ sortHint }}</small>
              </div>
              <div v-if="pages > 1 || hasFilters || pageIds.length && batchAllowed" class="watch-result-actions">
                <button v-if="hasFilters" type="button" class="text-button watch-reset-filters" @click="resetFilters">清除筛选</button>
                <button v-if="pageIds.length && batchAllowed" ref="pageSelection" type="button" class="text-button watch-page-select" :aria-pressed="allPageSelected" @click="togglePage">{{ allPageSelected ? '取消本页选择' : '选择本页' }}</button>
                <nav v-if="pages > 1" class="watch-pagination-quick" aria-label="顶部追番分页">
                  <button type="button" aria-label="上一页" title="上一页" :disabled="browse.page <= 1" @click="pageTo(browse.page - 1, $event.currentTarget)"><Icon name="back" :size="14" /></button>
                  <span class="watch-pagination-page" role="status" aria-label="页码"><strong>{{ browse.page }}</strong><span class="watch-pagination-separator"> / </span>{{ pages }}</span>
                  <button type="button" aria-label="下一页" title="下一页" :disabled="browse.page >= pages" @click="pageTo(browse.page + 1, $event.currentTarget)"><Icon name="chevron" :size="14" /></button>
                </nav>
              </div>
            </div>
            <div v-if="selected.size" class="watch-batch" aria-label="批量管理">
              <div class="watch-batch-count">
                <span class="watch-batch-mark" aria-hidden="true"><Icon name="check" :size="15" /></span>
                <strong role="status">已选 {{ selected.size }} 部</strong>
              </div>
              <div class="watch-batch-actions" role="group" aria-label="批量操作">
                <button type="button" :disabled="!localEditable" @click="openAssign([...selected])"><Icon name="bookmark" :size="15" />加入清单</button>
                <button type="button" :disabled="!localEditable" @click="open({ kind: 'status', ids: [...selected] })"><Icon name="rows" :size="15" />修改状态</button>
                <button type="button" :disabled="!localEditable" @click="open({ kind: 'archive', ids: [...selected] })"><Icon name="archive" :size="15" />归档</button>
              </div>
              <button type="button" class="watch-clear-selection" aria-label="取消选择" title="取消选择" @click="clearSelection"><Icon name="close" :size="16" /></button>
            </div>
            <div v-if="pageIds.length" ref="entries">
              <section v-for="group in visibleGroups" :key="group.label" class="watch-result-group">
                <h3 v-if="group.label" class="watch-group-heading">{{ group.label }}</h3>
                <div class="collection-grid watch-record-grid" :data-size="group.ids.length > 3 ? 'regular' : 'featured'">
                  <WatchEntry v-for="id in group.ids" :key="id" :id="id" :title="title(id)" :record="record(id)" :next="next(id)"
                    :saved="savedIds.has(id)" :selectable="batchAllowed" :selected="selected.has(id)" :in-list="browse.section === 'lists' && !!activeList"
                    :availability="availability(id)" @select="toggleSelection" @assign="openAssign([$event])" @clear="open({ kind: 'clear', id: $event })"
                    @remove-from-list="activeList && state.removeWatchListMembers(activeList.id, [$event])" />
                </div>
              </section>
            </div>
            <div v-else class="watch-blank">
              <span class="watch-blank-icon"><Icon :name="hasFilters ? 'search' : 'bookmark'" :size="27" /></span>
              <h3 v-if="hasFilters && indexing">正在查找匹配的作品</h3>
              <h3 v-else-if="hasFilters">没有符合条件的作品</h3>
              <h3 v-else-if="browse.section === 'inbox'">收藏已整理完毕</h3>
              <h3 v-else-if="browse.section === 'lists'">清单里还没有作品</h3>
              <h3 v-else-if="browse.section === 'archive'">暂时没有归档记录</h3>
              <h3 v-else>还没有追番作品</h3>
              <p v-if="!hasFilters && browse.section === 'lists'"><button class="text-button" type="button" @click="show('all')">从全部作品中加入</button></p>
              <p v-else-if="!hasFilters && browse.section === 'all'"><a class="text-button" href="#/season">去季度目录看看</a></p>
            </div>
            <nav v-if="pages > 1" class="pagination watch-pagination" aria-label="追番分页">
              <button class="button" type="button" :disabled="browse.page <= 1" @click="pageTo(browse.page - 1)"><Icon name="back" :size="14" />上一页</button>
              <span>{{ browse.page }} / {{ pages }}</span>
              <button class="button" type="button" :disabled="browse.page >= pages" @click="pageTo(browse.page + 1)">下一页<Icon name="chevron" :size="14" /></button>
            </nav>
          </section>

          <div v-if="browse.section !== 'plan' && (catalogIssue.failed.length || catalogIssue.missing.length)" class="watch-catalog-notices">
            <section v-if="catalogIssue.missing.length" class="watch-notice-group" aria-labelledby="watch-missing-heading">
              <div><h3 id="watch-missing-heading">暂时无法关联的收藏</h3><p>{{ catalogIssue.missing.length }} 部作品暂未收录，个人记录已保留。</p></div>
              <button v-if="browse.section !== 'all'" type="button" class="text-button" @click="show('all')">查看全部作品</button>
            </section>
            <section v-if="catalogIssue.failed.length" class="watch-notice-group" aria-labelledby="watch-failed-heading">
              <div><h3 id="watch-failed-heading">暂时无法读取的收藏</h3><p>{{ catalogIssue.failed.length }} 部作品资料读取失败，仍可编辑个人记录。</p></div>
              <button type="button" class="text-button" @click="state.retryWatchCatalog">重试获取</button>
            </section>
          </div>
        </template>
      </div>
    </div>

    <Teleport to="body">
      <dialog ref="panel" class="watch-panel" aria-labelledby="watch-panel-title" @close="restoreFocus" @cancel="busy && $event.preventDefault()">
        <form v-if="action" @submit.prevent="applyPanel">
          <div class="watch-panel-heading">
            <span class="watch-panel-symbol" aria-hidden="true"><Icon :name="panelIcon" :size="19" /></span>
            <h2 id="watch-panel-title" tabindex="-1" data-panel-heading>{{ panelTitle }}</h2>
            <button type="button" class="watch-panel-close" aria-label="关闭" :disabled="busy" @click="closePanel"><Icon name="close" :size="19" /></button>
          </div>
          <div class="watch-panel-body">
            <template v-if="action.kind === 'list'">
              <p v-if="action.ids?.length">新建清单并加入 {{ action.ids.length }} 部作品。</p>
              <label>清单名称<input v-model="listName" type="text" required :maxlength="WATCH_LIMITS.listName" placeholder="例如：秋天补番" /></label>
              <label>简介<textarea v-model="listDescription" rows="3" :maxlength="WATCH_LIMITS.listDescription" placeholder="这份清单想收录哪些作品？" /></label>
              <label class="checkbox-label watch-list-pin-choice"><input v-model="listPinned" type="checkbox" /><span>置顶清单</span></label>
            </template>
            <p v-else-if="action.kind === 'delete-list'">删除「{{ action.list.name }}」后，作品及其观看记录仍会保留。</p>
            <p v-else-if="action.kind === 'clear'">清除「{{ name(action.id) }}」的状态、进度、计划日期、个人评分、备注和清单归属。已有收藏会保留。</p>
            <template v-else-if="action.kind === 'assign'">
              <p class="watch-panel-description">为 {{ action.ids.length }} 部作品选择清单。</p>
              <fieldset class="watch-choice-group watch-list-choices" :disabled="busy" aria-label="选择清单">
                <label v-for="list in lists" :key="list.id" class="watch-choice watch-list-choice">
                  <input v-model="destination" name="watch-destination" type="radio" :value="list.id" :aria-label="list.name" />
                  <span class="watch-choice-icon" aria-hidden="true"><Icon :name="list.pinned ? 'star' : 'bookmark'" :size="17" /></span>
                  <span class="watch-choice-copy"><strong :title="list.name">{{ list.name }}</strong><small>{{ listMembers(list.id).length }} 部作品</small></span>
                  <span class="watch-choice-indicator" aria-hidden="true"><Icon name="check" :size="13" /></span>
                </label>
              </fieldset>
            </template>
            <template v-else-if="action.kind === 'status'">
              <p class="watch-panel-description">更新 {{ action.ids.length }} 部作品的观看状态。</p>
              <fieldset class="watch-choice-group watch-status-choices" :disabled="busy" aria-label="观看状态">
                <label v-for="status in WATCH_STATUSES" :key="status" class="watch-choice watch-status-choice">
                  <input v-model="batchStatus" name="watch-batch-status" type="radio" :value="status" />
                  <span>{{ WATCH_STATUS_LABELS[status] }}</span>
                  <span class="watch-choice-indicator" aria-hidden="true"><Icon name="check" :size="12" /></span>
                </label>
              </fieldset>
            </template>
            <p v-else-if="action.kind === 'archive'">将 {{ action.ids.length }} 部作品移到归档，可以随时恢复。</p>
            <template v-else-if="action.kind === 'import'">
              <p>{{ action.preview.version === 1 ? '收藏备份' : '完整追番备份' }}已通过检查，合并后保留已有记录。</p>
              <dl class="watch-import-counts"><div><dt>新增收藏</dt><dd>{{ action.preview.addedFavorites }}</dd></div><div><dt>新增记录</dt><dd>{{ action.preview.addedRecords }}</dd></div><div><dt>新增清单</dt><dd>{{ action.preview.addedLists }}</dd></div><div><dt>保留本机记录</dt><dd>{{ action.preview.conflicts }}</dd></div></dl>
            </template>
            <p v-if="panelError" class="watch-panel-error" role="alert">{{ panelError }}</p>
          </div>
          <div class="watch-panel-actions">
            <button class="button" type="button" :disabled="busy" @click="closePanel">取消</button>
            <button class="button" :class="destructive ? 'watch-danger' : 'primary'" type="submit" :disabled="busy || action.kind === 'list' && !listName.trim() || action.kind === 'assign' && !destination">{{ busy ? '正在保存…' : submitLabel }}</button>
          </div>
        </form>
      </dialog>
    </Teleport>
  </section>
</template>

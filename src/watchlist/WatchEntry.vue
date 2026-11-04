<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { AiringEvent } from '../../shared/types';
import { dateKey, formatClock } from '../../shared/schedule';
import Icon from '../components/Icon.vue';
import Poster from '../components/Poster.vue';
import RatingBadge from '../components/RatingBadge.vue';
import { resolveRatingSummary } from '../rating-display';
import { useAppState } from '../state';
import { WATCH_LIMITS, WATCH_STATUS_LABELS, type WatchRecord, type WatchTitle } from './model';

const props = defineProps<{
  id: string;
  title?: WatchTitle;
  record: WatchRecord;
  next?: AiringEvent;
  saved: boolean;
  selectable?: boolean;
  selected?: boolean;
  inList?: boolean;
  availability?: 'missing' | 'failed';
  reference?: boolean;
}>();
const emit = defineEmits<{
  select: [id: string];
  assign: [id: string];
  removeFromList: [id: string];
  clear: [id: string];
}>();
const state = useAppState();
const element = ref<HTMLElement>();
const menu = ref<HTMLDetailsElement>();
const menuPanel = ref<HTMLElement>();
const visible = ref(false);
const busy = ref(false);
const recordedCount = ref<number | null>(null);
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
const name = computed(() => props.title?.title || props.id);
const longTitle = computed(() => props.title?.originalTitle && props.title.originalTitle !== name.value ? `${name.value} / ${props.title.originalTitle}` : name.value);
const detail = computed(() => state.details.get(props.id));
const episodeTotal = computed(() => detail.value?.episodes ?? props.title?.episodes ?? null);
const measuredProgress = computed(() => {
  const total = episodeTotal.value;
  const watched = props.record.watched;
  return total && total > 0 && watched !== null ? { total, value: Math.min(watched, total) } : null;
});
const rating = computed(() => resolveRatingSummary(undefined, state.ratingSummaries.get(props.id), detail.value?.rating, `https://bgm.tv/subject/${props.id.slice(4)}`, detail.value?.detailFetchedAt));
const editable = computed(() => state.watchReady.value && !state.watchStorageError.value);
const airingEnded = computed(() => !props.availability && state.watchCatalog.airingEnded(props.id, state.now.value));
const nextDay = computed(() => props.next && dateKey(props.next.at, state.timezone.value));
const nextDate = computed(() => {
  const day = nextDay.value;
  return day === dateKey(state.now.value, state.timezone.value) ? '今天' : day ? `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日` : '';
});
let observer: IntersectionObserver | undefined;
onMounted(() => {
  observer = new IntersectionObserver(entries => {
    visible.value = entries.some(entry => entry.isIntersecting);
  }, { rootMargin: '120px' });
  if (element.value) observer.observe(element.value);
});
onUnmounted(() => {
  disposed = true;
  clearTimeout(feedbackTimer);
  observer?.disconnect();
  detachMenuListeners();
});
watch(() => visible.value && !!props.title && props.availability === undefined, shouldLoad => {
  if (shouldLoad && !props.reference) void state.loadDetail(props.id);
});

async function run(action: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = true;
  try { await action(); } finally { busy.value = false; }
}

async function increment() {
  if (!editable.value || props.record.watched === WATCH_LIMITS.watched) return;
  await run(async () => {
    clearTimeout(feedbackTimer);
    recordedCount.value = null;
    if (!await state.incrementWatch(props.id)) return;
    await nextTick();
    if (disposed) return;
    recordedCount.value = props.record.watched;
    feedbackTimer = setTimeout(() => { recordedCount.value = null; }, 1200);
  });
}

function closeMenu(restoreFocus = false) {
  if (!menu.value?.open) return;
  menu.value.open = false;
  if (restoreFocus) menu.value.querySelector('summary')?.focus();
}
function menuFocusOut(event: FocusEvent) {
  if (event.relatedTarget instanceof Node && !menu.value?.contains(event.relatedTarget)) closeMenu();
}

function menuPointerDown(event: PointerEvent) {
  if (event.target instanceof Node && !menu.value?.contains(event.target)) closeMenu();
}

function placeMenu() {
  const trigger = menu.value?.querySelector('summary');
  const panel = menuPanel.value;
  if (!menu.value?.open || !trigger || !panel) return;

  const anchor = trigger.getBoundingClientRect();
  const header = document.querySelector('.site-header');
  const nav = header?.querySelector('.main-nav');
  const bottom = nav && getComputedStyle(nav).position === 'fixed' ? nav.getBoundingClientRect().top : window.innerHeight;
  const top = Math.max(0, header?.getBoundingClientRect().bottom ?? 0);
  const availableBelow = bottom - anchor.bottom - 12;
  const availableAbove = anchor.top - top - 12;
  const above = availableBelow < panel.scrollHeight && availableAbove > availableBelow;

  menu.value.dataset.placement = above ? 'above' : 'below';
  menu.value.dataset.align = anchor.right - panel.offsetWidth < 12 ? 'start' : 'end';
  panel.style.maxHeight = `${Math.max(48, above ? availableAbove : availableBelow)}px`;
}

function detachMenuListeners() {
  document.removeEventListener('pointerdown', menuPointerDown, true);
  window.removeEventListener('resize', placeMenu);
  window.removeEventListener('scroll', placeMenu);
}

function menuToggled() {
  if (!menu.value?.open) { detachMenuListeners(); return; }
  placeMenu();
  document.addEventListener('pointerdown', menuPointerDown, true);
  window.addEventListener('resize', placeMenu);
  window.addEventListener('scroll', placeMenu, { passive: true });
}
</script>

<template>
  <article ref="element" class="anime-card watch-entry" :data-anime-id="id" :data-status="record.status" :class="{ 'watch-entry-reference': reference, 'watch-entry-selected': selected }">
    <component :is="title && availability !== 'missing' ? 'a' : 'div'" class="anime-link watch-entry-main"
      :href="title && availability !== 'missing' ? `#/anime/${id}` : undefined"
      :aria-label="title && availability !== 'missing' ? `查看${name}详情` : undefined" :title="longTitle">
      <div class="poster-frame watch-entry-poster">
        <Poster :id="visible && availability === undefined && title ? id : undefined" :image="detail?.image" :revision="detail?.detailFetchedAt"
          size="thumb" :title="name" :theme="state.appearance.theme.value" />
      </div>
      <div class="watch-entry-content">
        <div v-if="!reference" class="watch-entry-meta">
          <span class="watch-state-chip">{{ WATCH_STATUS_LABELS[record.status] }}</span>
          <span v-if="record.archived">已归档</span>
          <span v-if="title">{{ title.type.toUpperCase() }}</span>
          <RatingBadge v-if="rating?.score != null" class="card-rating" :summary="rating" />
        </div>
        <h3>{{ name }}</h3>
        <p v-if="title?.originalTitle && title.originalTitle !== name && !reference" class="watch-original">{{ title.originalTitle }}</p>
        <div v-if="!reference" class="watch-entry-progress">
          <span>{{ record.watched === null ? '未记录进度' : `已看 ${record.watched} 集` }}</span>
          <span v-if="episodeTotal !== null && episodeTotal > 0">条目收录 {{ episodeTotal }} 集</span>
        </div>
        <progress v-if="!reference && measuredProgress" class="watch-progress-meter" :max="measuredProgress.total" :value="measuredProgress.value" aria-hidden="true" />
        <p v-if="record.plannedDate && !reference" class="watch-entry-plan"><Icon name="calendar" :size="14" /><span>计划观看</span><time :datetime="record.plannedDate">{{ record.plannedDate }}</time></p>
        <p v-if="record.note && !reference" class="watch-entry-note" :title="record.note">{{ record.note }}</p>
        <p v-if="record.personalScore !== null && !reference" class="watch-entry-personal">个人评分 {{ record.personalScore }} / 10</p>
        <p v-if="availability" class="watch-entry-unavailable">{{ availability === 'missing' ? '暂未收录' : '资料暂不可用' }}<code v-if="title">{{ id }}</code></p>
        <p v-else-if="!title" class="watch-entry-unavailable">{{ saved ? '正在匹配作品' : '作品资料暂缺' }}</p>
      </div>
      <div v-if="next" class="next-airing watch-next-airing">
        <span v-if="!reference">下次参考放送</span>
        <p><span>{{ nextDate }}</span> <time :datetime="next.at">{{ formatClock(next.at, state.timezone.value) }}</time></p>
      </div>
      <p v-else-if="title && !reference" class="next-airing watch-next-empty">{{ airingEnded ? '已完结' : state.watchReferenceLoading.value ? '正在核对参考放送…' : state.watchReferenceError.value ? '参考放送暂不可用' : '14天内暂无排期' }}</p>
    </component>
    <label v-if="selectable" class="watch-selection" :class="{ selected }">
      <input type="checkbox" :aria-label="`选择${name}`" :checked="selected" @change="emit('select', id)" />
    </label>
    <div v-if="!reference" class="watch-entry-actions">
      <button v-if="saved && !record.archived && (record.status === 'wanted' || record.status === 'watching')" type="button"
        class="watch-increment" :disabled="!editable || record.watched === WATCH_LIMITS.watched" :aria-disabled="busy || undefined" :aria-label="`为${name}记录一集`"
        :data-recorded="recordedCount !== null || undefined" @click="increment">
        <Icon v-if="recordedCount !== null" name="check" :size="14" />
        {{ recordedCount !== null ? '已记录' : '+1 集' }}
      </button>
      <span class="watch-entry-announcement" role="status">{{ recordedCount === null ? '' : `${name}，已看 ${recordedCount} 集` }}</span>
      <button v-if="saved" type="button" :disabled="!editable" :aria-label="`编辑${name}追番记录`" @click="state.openWatchEditor(id)">编辑</button>
      <button v-if="saved && record.plannedDate && !record.archived" type="button" :disabled="!editable" :aria-label="`调整${name}计划日期`" @click="state.openWatchEditor(id, 'date')">改期</button>
      <button v-if="saved && record.archived" type="button" :disabled="!editable" :aria-disabled="busy || undefined" @click="run(() => state.updateWatchRecords([id], { archived: false }))">恢复归档</button>
      <button v-if="!saved" type="button" :aria-disabled="busy || undefined" @click="run(() => state.toggleFavorite(id))">重新收藏</button>
      <details v-if="!record.archived || record.updatedAt || !saved" ref="menu" class="watch-entry-menu" @toggle="menuToggled" @keydown.esc.stop.prevent="closeMenu(true)" @focusout="menuFocusOut">
        <summary :aria-label="`${name}的更多操作`" title="更多操作"><span aria-hidden="true">···</span></summary>
        <div ref="menuPanel" class="watch-entry-menu-body">
          <button v-if="saved && !record.archived" type="button" :disabled="!editable" :aria-label="`将${name}加入清单`" @click="closeMenu(true); emit('assign', id)">加到清单</button>
          <button v-if="saved && inList" type="button" :disabled="!editable" @click="closeMenu(true); emit('removeFromList', id)">移出清单</button>
          <button v-if="saved && !record.archived" type="button" :disabled="!editable" @click="closeMenu(true); run(() => state.updateWatchRecords([id], { archived: true }))">归档作品</button>
          <button v-if="record.updatedAt || !saved" type="button" :disabled="!editable" @click="closeMenu(true); emit('clear', id)">清除记录</button>
        </div>
      </details>
      <button v-if="saved" type="button" class="save-card saved" :aria-disabled="busy || undefined" :aria-label="availability && !title ? `移除${id}` : `取消追番${name}`" aria-pressed="true"
        @click="run(() => state.toggleFavorite(id))"><Icon name="bookmark" :size="17" /></button>
    </div>
  </article>
</template>

<style scoped>
.watch-entry:not(.watch-entry-reference) > .watch-entry-main {
  grid-template-columns: 62px minmax(0, 1fr);
  align-items: start;
  gap: 7px 13px;
  padding: 13px;
}
.watch-entry:not(.watch-entry-reference) .watch-entry-poster {
  width: 100%;
  border-radius: 7px;
}
.watch-entry:not(.watch-entry-reference) .watch-entry-content h3 {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  margin-top: 5px;
  font-size: 17px;
  line-height: 1.34;
}
.watch-entry:not(.watch-entry-reference) .watch-original {
  margin-top: 2px;
  font-size: 12px;
}
.watch-entry-progress {
  margin-top: 6px;
  font-size: 12px;
}
.watch-entry-progress > span:first-child { font-size: 13px; }
.watch-progress-meter {
  display: block;
  width: min(100%, 150px);
  height: 3px;
  margin: 4px 0 0;
  appearance: none;
  overflow: hidden;
  border: 0;
  border-radius: 5px;
  color: var(--accent);
  background: var(--line);
}
.watch-progress-meter::-webkit-progress-bar { background: var(--line); }
.watch-progress-meter::-webkit-progress-value { background: var(--accent); }
.watch-progress-meter::-moz-progress-bar { background: var(--accent); }
.watch-entry-plan {
  margin-top: 5px;
  gap: 2px 5px;
}
.watch-entry-plan > span { color: var(--muted); }
.watch-entry-plan > time { font-weight: 600; }
.watch-entry:not(.watch-entry-reference) .watch-next-airing { font-size: 12px; }
.watch-entry-actions {
  padding: 4px 8px;
  border-radius: 0 0 11px 11px;
  background: color-mix(in srgb, var(--watch-paper) 92%, var(--soft));
}
.watch-entry-announcement {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.watch-entry-actions > button.watch-increment {
  min-inline-size: 70px;
  gap: 5px;
  white-space: nowrap;
}
.watch-entry-actions > button.watch-increment[data-recorded] {
  color: color-mix(in srgb, var(--mint) 40%, var(--ink));
}
.watch-increment[data-recorded] > svg { animation: watch-record-check 150ms ease-out; }
@keyframes watch-record-check { from { opacity: .25; transform: scale(.8); } to { opacity: 1; transform: scale(1); } }
.watch-entry-menu-body { overflow-y: auto; overscroll-behavior: contain; }
.watch-entry-menu[data-placement='above'] .watch-entry-menu-body { top: auto; bottom: 100%; }
.watch-entry-menu[data-align='start'] .watch-entry-menu-body { right: auto; left: 0; }
@media (min-width: 1220px) {
  .watch-entry:not(.watch-entry-reference) > .watch-entry-main {
    grid-template-columns: 70px minmax(0, 1fr) minmax(88px, auto);
    align-items: center;
    gap: 8px 15px;
  }
  .watch-entry:not(.watch-entry-reference) .watch-entry-poster { align-self: start; }
}
@media (max-width: 720px) {
  .watch-entry:not(.watch-entry-reference) > .watch-entry-main {
    grid-template-columns: 54px minmax(0, 1fr);
    gap: 6px 10px;
    padding: 10px;
  }
  .watch-entry:not(.watch-entry-reference) .watch-entry-content h3 { font-size: 16px; }
  .watch-entry-actions { gap: 1px 3px; padding: 3px 6px; }
}
@media (prefers-reduced-motion: reduce) {
  .watch-increment[data-recorded] > svg { animation: none; }
}
</style>

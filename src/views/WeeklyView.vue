<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue';
import { buildSchedule, dateKey, effectiveActiveIds, weekWindow } from '../../shared/schedule';
import { useAppState } from '../state';
import AnimeCard from '../components/AnimeCard.vue';
import Icon from '../components/Icon.vue';
import FeaturedHero from '../components/FeaturedHero.vue';
import { useListMotion } from '../motion';
import '../calendar.css';

const state = useAppState();
const scheduleHelp = ref<HTMLDetailsElement>();
function closeHelpOutside(event: PointerEvent) {
  const help = scheduleHelp.value;
  if (help?.open && event.target instanceof Node && !help.contains(event.target)) help.open = false;
}
function closeHelpOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape' && scheduleHelp.value?.open) scheduleHelp.value.open = false;
}
onMounted(() => { document.addEventListener('pointerdown', closeHelpOutside, true); document.addEventListener('keydown', closeHelpOnEscape); });
onUnmounted(() => { document.removeEventListener('pointerdown', closeHelpOutside, true); document.removeEventListener('keydown', closeHelpOnEscape); });
const onlyFavorites = computed({ get: () => state.browse.weekly.onlyFavorites, set: value => { state.browse.weekly.onlyFavorites = value; } });
const selectedDay = computed({ get: () => state.browse.weekly.selectedDay, set: value => { state.browse.weekly.selectedDay = value; } });
if (!selectedDay.value) selectedDay.value = dateKey(state.now.value, state.timezone.value);
const window = computed(() => weekWindow(state.now.value, state.timezone.value));
const weekdays = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
const today = computed(() => dateKey(state.now.value, state.timezone.value));
watch(() => state.timezone.value, () => { selectedDay.value = today.value; });
const days = computed(() => Array.from({ length: 7 }, (_, index) => {
  const at = new Date(Date.parse(window.value.start) + index * 86_400_000).toISOString(), key = dateKey(at, state.timezone.value);
  return { key, name: weekdays[index], day: Number(key.slice(8)), short: `${Number(key.slice(5, 7))}月${Number(key.slice(8))}日` };
}));
watch(window, () => { if (!days.value.some(day => day.key === selectedDay.value)) selectedDay.value = today.value; }, { immediate: true });
const calendarElement = ref<HTMLElement>();
const calendarMotion = useListMotion(calendarElement, () => [state.weeklyLayout.value, selectedDay.value, onlyFavorites.value]);
const active = computed(() => state.catalog.value ? effectiveActiveIds(state.catalog.value) : new Set<string>());
const inactive = computed(() => new Set(state.catalog.value?.overrides.active.filter(item => !item.active).map(item => item.animeId)));
const items = computed(() => new Map(state.catalog.value?.items.map(x => [x.id, x])));
const events = computed(() => state.catalog.value ? buildSchedule(state.catalog.value, window.value).filter(x => !onlyFavorites.value || state.favorites.value.includes(x.animeId)) : []);
const grouped = computed(() => days.value.map(day => ({ ...day, entries: events.value.filter(x => dateKey(x.at, state.timezone.value) === day.key) })));
const todayPosters = computed(() => {
  const current = events.value.filter(event => event.status !== 'cancelled' && dateKey(event.at, state.timezone.value) === today.value);
  return [...new Set(current.map(event => event.animeId))].slice(0, 4).map(id => items.value.get(id)!);
});
const pending = computed(() => (state.catalog.value?.items ?? []).filter(item =>
  !inactive.value.has(item.id) && (item.season === state.currentSeason.value || active.value.has(item.id)) &&
  (!onlyFavorites.value || state.favorites.value.includes(item.id)) &&
  (!item.rule.end || Date.parse(item.rule.end) >= Date.parse(state.now.value)) &&
  (!item.rule.anchor || item.rule.frequency === 'unsupported' || ((item.rule.frequency === 'weekly' || item.rule.frequency === 'daily') && !active.value.has(item.id)))
));

const horizontalMedia = globalThis.matchMedia('(max-width: 767px)');
const horizontalViewport = ref(horizontalMedia.matches);
const horizontalView = () => ({ timezone: state.timezone.value, day: selectedDay.value, layout: state.weeklyLayout.value, favorites: onlyFavorites.value });
type HorizontalView = ReturnType<typeof horizontalView>;
const horizontalKey = (view: HorizontalView) => `${view.timezone}|${view.day}|rows|${view.favorites ? 'favorites' : 'all'}`;
const horizontalElement = () => calendarElement.value?.querySelector<HTMLElement>('.mobile-selected .day-entries');
// Schedule and view watchers can run in either order; save with the rendered view.
let renderedHorizontalView = horizontalView();
let pendingHorizontal: { key: string; left: number } | undefined;
let horizontalTimer: ReturnType<typeof setTimeout> | undefined, horizontalFrame = 0, horizontalVersion = 0;
let restoringHorizontal = false, horizontalDisposed = false;
function flushHorizontal() {
  clearTimeout(horizontalTimer); horizontalTimer = undefined;
  if (!pendingHorizontal) return;
  const { key, left } = pendingHorizontal; pendingHorizontal = undefined;
  const positions = state.browse.weekly.horizontalScroll ??= {};
  if (positions[key] !== left) positions[key] = left;
}
function rememberHorizontal(view: HorizontalView) {
  if (restoringHorizontal || !horizontalViewport.value || view.layout !== 'rows') return;
  const element = horizontalElement();
  if (!element || element.closest<HTMLElement>('.day-column')?.dataset.day !== view.day || element.scrollWidth <= element.clientWidth) return;
  pendingHorizontal = { key: horizontalKey(view), left: element.scrollLeft };
}
function horizontalScrolled(event: Event) {
  if (event.currentTarget !== horizontalElement()) return;
  rememberHorizontal(horizontalView());
  if (pendingHorizontal && !horizontalTimer) horizontalTimer = setTimeout(flushHorizontal, 120);
}
function cancelHorizontalRestore(event: Event) {
  if (!restoringHorizontal || event.currentTarget !== horizontalElement()) return;
  horizontalVersion++; cancelAnimationFrame(horizontalFrame); horizontalFrame = 0;
  renderedHorizontalView = horizontalView(); restoringHorizontal = false;
}
function restoreHorizontal() {
  const version = ++horizontalVersion;
  cancelAnimationFrame(horizontalFrame); restoringHorizontal = true;
  void nextTick(async () => {
    if (horizontalDisposed || version !== horizontalVersion) return;
    await calendarMotion.settled();
    if (horizontalDisposed || version !== horizontalVersion) return;
    horizontalFrame = requestAnimationFrame(() => {
      horizontalFrame = 0;
      if (horizontalDisposed || version !== horizontalVersion) return;
      const view = horizontalView(), element = horizontalElement();
      if (horizontalViewport.value && view.layout === 'rows' && element) {
        const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
        element.scrollLeft = Math.min(state.browse.weekly.horizontalScroll?.[horizontalKey(view)] ?? 0, maximum);
      }
      renderedHorizontalView = view;
      restoringHorizontal = false;
    });
  });
}
function saveVisibleHorizontal() { rememberHorizontal(renderedHorizontalView); flushHorizontal(); }
function horizontalViewportChanged() {
  flushHorizontal(); horizontalViewport.value = horizontalMedia.matches; restoreHorizontal();
}
watch(horizontalView, () => { saveVisibleHorizontal(); restoreHorizontal(); }, { flush: 'pre' });
watch(events, () => { saveVisibleHorizontal(); restoreHorizontal(); }, { flush: 'pre' });
onMounted(() => {
  horizontalMedia.addEventListener('change', horizontalViewportChanged);
  globalThis.addEventListener('pagehide', saveVisibleHorizontal);
  restoreHorizontal();
});
onBeforeUnmount(() => {
  saveVisibleHorizontal(); horizontalDisposed = true; horizontalVersion++;
  cancelAnimationFrame(horizontalFrame);
  horizontalMedia.removeEventListener('change', horizontalViewportChanged);
  globalThis.removeEventListener('pagehide', saveVisibleHorizontal);
});
</script>
<template>
  <section class="weekly-page" aria-label="本周网络更新参考">
    <FeaturedHero />
    <div class="view-heading weekly-heading"><div><h1>本周番表<span class="heading-dot">.</span></h1><p>{{ days[0]?.short }} — {{ days[6]?.short }}</p></div><div class="weekly-controls"><div class="weekly-layout-switch" role="group" aria-label="番表布局"><button aria-label="竖列番表" :aria-pressed="state.weeklyLayout.value === 'columns'" @click="state.setWeeklyLayout('columns')"><Icon name="columns" :size="16" /><span>竖列</span></button><button aria-label="横排番表" :aria-pressed="state.weeklyLayout.value === 'rows'" @click="state.setWeeklyLayout('rows')"><Icon name="rows" :size="16" /><span>横排</span></button></div><label class="checkbox-label"><input v-model="onlyFavorites" type="checkbox" />仅看收藏</label></div></div>
    <div class="week-meta"><span class="weekly-count">{{ events.length }} 条排期</span><details ref="scheduleHelp" class="schedule-help"><summary><Icon name="info" :size="14" />排期说明</summary><p>采用已收录的网络配信排期，含跨季续播。周期推算不代表平台已更新；未核实网络时间的作品列为待定。</p></details></div>
    <div class="day-tabs" role="group" aria-label="选择日期"><button v-for="day in days" :key="day.key" :aria-label="`${day.name} ${day.short}`" :aria-pressed="selectedDay === day.key" :class="{ selected: selectedDay === day.key, today: today === day.key }" @click="selectedDay = day.key"><span>{{ day.name.slice(2) }}</span><strong>{{ day.day }}</strong></button></div>
    <div ref="calendarElement" class="weekly-grid" :data-layout="state.weeklyLayout.value">
      <section v-for="day in grouped" :key="day.key" class="day-column" :class="{ today: day.key === today, 'mobile-selected': day.key === selectedDay }" :data-day="day.key" :aria-label="day.name">
        <header class="day-heading"><div class="day-heading-date"><time :datetime="day.key"><strong>{{ day.day }}</strong><span class="day-month">{{ Number(day.key.slice(5, 7)) }}月</span></time><span>{{ day.name.replace('星期', '周') }}</span></div><div class="day-heading-meta"><span>{{ day.entries.length }} 条</span><small v-if="day.key === today">今天</small></div></header>
        <div class="day-entries" @scroll.passive="horizontalScrolled" @pointerdown.passive="cancelHorizontalRestore" @touchstart.passive="cancelHorizontalRestore"><AnimeCard v-for="event in day.entries" :key="`${event.animeId}-${event.at}`" :anime="items.get(event.animeId)!" :event="event" compact lightframe /><div v-if="!day.entries.length" class="day-empty"><span>—</span><p>{{ onlyFavorites ? '暂无收藏排期' : '暂无参考排期' }}</p></div></div>
      </section>
    </div>
    <section v-if="pending.length" class="pending-section"><div class="section-heading"><h2>排期待定 <span>{{ pending.length }}</span></h2></div><div class="pending-links"><a v-for="anime in pending" :key="anime.id" :href="`#/anime/${anime.id}`">{{ anime.title }}<Icon name="chevron" :size="14" /></a></div></section>
    <section v-if="todayPosters.length" class="today-posters" aria-label="今日片单"><div class="section-heading"><h2>今日片单</h2><span>{{ days.find(day => day.key === today)?.short }}</span></div><div class="poster-grid"><AnimeCard v-for="anime in todayPosters" :key="anime.id" :anime="anime" showcase /></div></section>
  </section>
</template>

<style scoped>
.today-posters{margin-top:42px;padding:28px 0 0;border-top:1px solid var(--line)}
.today-posters>.section-heading{display:flex;justify-content:space-between;align-items:center;flex-direction:row}
.today-posters h2{font:24px/1.5 WenKai,serif;letter-spacing:1px}.today-posters>.section-heading>span{font-size:12px;color:var(--muted)}
.today-posters>.poster-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px}
.weekly-page .weekly-heading{margin-bottom:10px}.weekly-page .week-meta{margin-bottom:16px}
@media(max-width:767px){.today-posters{margin-top:30px;padding-top:22px}.today-posters>.poster-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 12px}.today-posters h2{font-size:23px}.weekly-page .week-meta{margin-bottom:8px}.weekly-page .weekly-heading{gap:8px;margin-bottom:8px}.weekly-page .day-tabs{margin-bottom:12px}.weekly-heading>div:first-child{display:flex;align-items:baseline;justify-content:space-between;gap:4px 12px;flex-wrap:wrap}.weekly-heading>div:first-child p{margin-top:0}}
</style>

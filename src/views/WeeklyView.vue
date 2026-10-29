<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { buildSchedule, dateKey, effectiveActiveIds, weekWindow } from '../../shared/schedule';
import { useAppState } from '../state';
import AnimeCard from '../components/AnimeCard.vue';
import Icon from '../components/Icon.vue';
import FeaturedHero from '../components/FeaturedHero.vue';

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
const active = computed(() => state.catalog.value ? effectiveActiveIds(state.catalog.value) : new Set<string>());
const inactive = computed(() => new Set(state.catalog.value?.overrides.active.filter(item => !item.active).map(item => item.animeId)));
const items = computed(() => new Map(state.catalog.value?.items.map(x => [x.id, x])));
const events = computed(() => state.catalog.value ? buildSchedule(state.catalog.value, window.value).filter(x => !onlyFavorites.value || state.favorites.value.includes(x.animeId)) : []);
const grouped = computed(() => days.value.map(day => ({ ...day, entries: events.value.filter(x => dateKey(x.at, state.timezone.value) === day.key) })));
const pending = computed(() => (state.catalog.value?.items ?? []).filter(item =>
  !inactive.value.has(item.id) && (item.season === state.currentSeason.value || active.value.has(item.id)) &&
  (!onlyFavorites.value || state.favorites.value.includes(item.id)) &&
  (!item.rule.end || Date.parse(item.rule.end) >= Date.parse(state.now.value)) &&
  (!item.rule.anchor || item.rule.frequency === 'unsupported' || ((item.rule.frequency === 'weekly' || item.rule.frequency === 'daily') && !active.value.has(item.id)))
));
</script>
<template>
  <section aria-label="本周日本放送参考">
    <FeaturedHero />
    <div class="view-heading weekly-heading"><div><h1>本周番表<span class="heading-dot">.</span></h1><p>{{ days[0]?.short }} — {{ days[6]?.short }}</p></div><div class="weekly-controls"><div class="weekly-layout-switch" role="group" aria-label="番表布局"><button aria-label="竖列番表" :aria-pressed="state.weeklyLayout.value === 'columns'" @click="state.setWeeklyLayout('columns')"><Icon name="columns" :size="16" /><span>竖列</span></button><button aria-label="横排番表" :aria-pressed="state.weeklyLayout.value === 'rows'" @click="state.setWeeklyLayout('rows')"><Icon name="rows" :size="16" /><span>横排</span></button></div><label class="checkbox-label"><input v-model="onlyFavorites" type="checkbox" />仅看收藏</label></div></div>
    <div class="week-meta"><span class="weekly-count">{{ events.length }} 条排期</span><details ref="scheduleHelp" class="schedule-help"><summary><Icon name="info" :size="14" />排期说明</summary><p>网络先行优先，含跨季续播。部分排期为周期推算；时间已过不代表平台已更新。待定作品暂缺可推算排期。</p></details></div>
    <div class="day-tabs" role="group" aria-label="选择日期"><button v-for="day in days" :key="day.key" :aria-label="`${day.name} ${day.short}`" :aria-pressed="selectedDay === day.key" :class="{ selected: selectedDay === day.key, today: today === day.key }" @click="selectedDay = day.key"><span>{{ day.name.slice(2) }}</span><strong>{{ day.day }}</strong></button></div>
    <div class="weekly-grid" :data-layout="state.weeklyLayout.value">
      <section v-for="day in grouped" :key="day.key" class="day-column" :class="{ today: day.key === today, 'mobile-selected': day.key === selectedDay }" :data-day="day.key" :aria-label="day.name">
        <header class="day-heading"><div class="day-heading-date"><strong>{{ day.day }}</strong><span>{{ day.name.replace('星期', '周') }}</span></div><div class="day-heading-meta"><span>{{ day.entries.length }} 部</span><small v-if="day.key === today">今天</small></div></header>
        <div class="day-entries"><AnimeCard v-for="event in day.entries" :key="`${event.animeId}-${event.at}`" :anime="items.get(event.animeId)!" :event="event" compact /><div v-if="!day.entries.length" class="day-empty"><span>—</span><p>{{ onlyFavorites ? '暂无收藏排期' : '暂无参考排期' }}</p></div></div>
      </section>
    </div>
    <section v-if="pending.length" class="pending-section"><div class="section-heading"><h2>排期待定 <span>{{ pending.length }}</span></h2></div><div class="pending-links"><a v-for="anime in pending" :key="anime.id" :href="`#/anime/${anime.id}`">{{ anime.title }}<Icon name="chevron" :size="14" /></a></div></section>
  </section>
</template>

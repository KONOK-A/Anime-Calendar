<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { buildSchedule, dateKey, effectiveActiveIds, weekWindow } from '../../shared/schedule';
import { useAppState } from '../state';
import AnimeCard from '../components/AnimeCard.vue';
import Icon from '../components/Icon.vue';

const state = useAppState(), onlyFavorites = ref(false);
const selectedDay = ref(dateKey(state.now.value, state.timezone.value));
const window = computed(() => weekWindow(state.now.value, state.timezone.value));
const weekdays = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
const today = computed(() => dateKey(state.now.value, state.timezone.value));
watch(() => state.timezone.value, () => { selectedDay.value = today.value; });
const days = computed(() => Array.from({ length: 7 }, (_, index) => {
  const at = new Date(Date.parse(window.value.start) + index * 86_400_000).toISOString(), key = dateKey(at, state.timezone.value);
  return { key, name: weekdays[index], day: Number(key.slice(8)), short: `${Number(key.slice(5, 7))}月${Number(key.slice(8))}日` };
}));
watch(window, () => { if (!days.value.some(day => day.key === selectedDay.value)) selectedDay.value = today.value; });
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
    <div class="view-heading"><div><h1>本周番表<span class="heading-dot">.</span></h1><p>{{ days[0]?.short }} — {{ days[6]?.short }} <span class="subtle-separator">/</span> 跟上每一个期待的故事</p></div><label class="checkbox-label"><input v-model="onlyFavorites" type="checkbox" />仅看收藏<Icon name="bookmark" :size="16" /></label></div>
    <div class="week-meta"><span class="live-dot" /><span>{{ events.length }} 条参考排期</span><span class="meta-divider" /><span>网络先行优先</span><span class="estimate-note">含跨季续播；周期推算标为“预计”，具体安排以官网为准</span></div>
    <div class="day-tabs" role="group" aria-label="选择日期"><button v-for="day in days" :key="day.key" :aria-label="`${day.name} ${day.short}`" :aria-pressed="selectedDay === day.key" :class="{ selected: selectedDay === day.key, today: today === day.key }" @click="selectedDay = day.key"><span>{{ day.name.slice(2) }}</span><strong>{{ day.day }}</strong></button></div>
    <div class="weekly-grid">
      <section v-for="day in grouped" :key="day.key" class="day-column" :class="{ today: day.key === today, 'mobile-selected': day.key === selectedDay }" :data-day="day.key" :aria-label="day.name">
        <header class="day-heading"><span>{{ day.name }}<small v-if="day.key === today">今天</small></span><div><strong>{{ day.day }}</strong><span>{{ day.entries.length }} 部</span></div></header>
        <div class="day-entries"><AnimeCard v-for="event in day.entries" :key="`${event.animeId}-${event.at}`" :anime="items.get(event.animeId)!" :event="event" compact /><div v-if="!day.entries.length" class="day-empty"><span>—</span><p>{{ onlyFavorites ? '暂无收藏排期' : '暂无参考排期' }}</p></div></div>
      </section>
    </div>
    <section v-if="pending.length" class="pending-section"><div class="section-heading"><h2>排期待定 <span>{{ pending.length }}</span></h2><p>来源缺少时间、在播依据或支持的周期</p></div><div class="pending-links"><a v-for="anime in pending" :key="anime.id" :href="`#/anime/${anime.id}`">{{ anime.title }}<Icon name="chevron" :size="14" /></a></div></section>
    <p class="schedule-disclaimer"><Icon name="clock" :size="15" /> 时间已过表示计划时间已过，并不代表平台已更新。</p>
  </section>
</template>

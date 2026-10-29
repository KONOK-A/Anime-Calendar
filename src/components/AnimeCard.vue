<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { AiringEvent, Anime } from '../../shared/types';
import { dateKey, formatClock } from '../../shared/schedule';
import { useAppState } from '../state';
import Poster from './Poster.vue';
import Icon from './Icon.vue';
const props = defineProps<{ anime: Anime; event?: AiringEvent; compact?: boolean; showNextAiring?: boolean; nextEvent?: AiringEvent }>();
const state = useAppState(), element = ref<HTMLElement>();
const detail = computed(() => state.details.get(props.anime.id));
const saved = computed(() => state.favorites.value.includes(props.anime.id));
const eventNote = computed(() => {
  if (!props.event) return '';
  return props.event.note || (props.event.status === 'cancelled' ? '本次休播' : props.anime.networkAiring ? '网络先行' : '');
});
const nextLabel = computed(() => {
  if (!props.nextEvent) return '14天内暂无排期';
  const key = dateKey(props.nextEvent.at, state.timezone.value), today = dateKey(state.now.value, state.timezone.value);
  const day = key === today ? '今天' : `${Number(key.slice(5, 7))}月${Number(key.slice(8))}日`;
  return `${day} ${formatClock(props.nextEvent.at, state.timezone.value)}`;
});
const beginDate = computed(() => {
  const begin = props.anime.networkAiring?.begin ?? props.anime.begin;
  return begin.includes('T') && Number.isFinite(Date.parse(begin)) ? dateKey(begin, state.timezone.value) : begin || '日期待定';
});
let observer: IntersectionObserver | undefined;
onMounted(() => {
  observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { void state.loadDetail(props.anime.id); observer?.disconnect(); } }, { rootMargin: '180px' });
  if (element.value) observer.observe(element.value);
});
onUnmounted(() => observer?.disconnect());
</script>
<template>
  <article ref="element" class="anime-card" :data-anime-id="anime.id" :class="{ compact, cancelled: event?.status === 'cancelled' }">
    <div v-if="event" class="event-time"><time :datetime="event.at">{{ formatClock(event.at, state.timezone.value) }}</time><span v-if="event.status === 'cancelled' || event.basis !== 'estimated'" class="basis" :class="{ official: event.basis === 'official', hiatus: event.status === 'cancelled' }">{{ event.status === 'cancelled' ? '休播' : event.basis === 'official' ? '公告' : '来源排期' }}</span></div>
    <a :href="`#/anime/${anime.id}`" :aria-label="`查看${anime.title}详情`" class="anime-link">
      <div class="poster-frame"><Poster :image="detail?.image" :title="anime.title" :theme="state.appearance.theme.value" /><span v-if="!compact && detail?.rating" class="card-rating" :aria-label="`Bangumi评分 ${detail.rating.score.toFixed(1)}`"><Icon name="star" :size="12" />{{ detail.rating.score.toFixed(1) }}</span></div>
      <div class="card-copy"><h3>{{ anime.title }}</h3><p v-if="!compact && anime.originalTitle !== anime.title" class="original-title">{{ anime.originalTitle }}</p><div class="card-tags"><span>{{ anime.type.toUpperCase() }}</span><span v-if="event && anime.season !== state.currentSeason.value" class="continuing">续播</span><span v-if="!event && !showNextAiring">{{ beginDate.replaceAll('-', '.') }}</span><span v-if="compact && detail?.rating" class="card-rating compact-rating" :aria-label="`Bangumi评分 ${detail.rating.score.toFixed(1)}`"><Icon name="star" :size="11" />{{ detail.rating.score.toFixed(1) }}</span></div><div v-if="showNextAiring" class="next-airing" :class="{ pending: !nextEvent }"><span><Icon name="clock" :size="13" />{{ nextEvent ? '下次参考' : '排期参考' }}</span><p>{{ nextLabel }}<small v-if="nextEvent && nextEvent.basis !== 'estimated'">{{ nextEvent.basis === 'official' ? '公告' : '来源排期' }}</small></p></div></div>
    </a>
    <div v-if="eventNote" class="event-footnote">{{ eventNote }}</div>
    <button class="save-card" :class="{ saved }" :aria-label="`${saved ? '取消追番' : '追番'}${anime.title}`" :aria-pressed="saved" @click="state.toggleFavorite(anime.id)"><Icon name="bookmark" :size="17" /></button>
  </article>
</template>

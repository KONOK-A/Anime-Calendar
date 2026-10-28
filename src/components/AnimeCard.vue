<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { AiringEvent, Anime } from '../../shared/types';
import { dateKey, formatClock } from '../../shared/schedule';
import { useAppState } from '../state';
import Poster from './Poster.vue';
import Icon from './Icon.vue';
const props = defineProps<{ anime: Anime; event?: AiringEvent; compact?: boolean }>();
const state = useAppState(), element = ref<HTMLElement>();
const detail = computed(() => state.details.get(props.anime.id));
const saved = computed(() => state.favorites.value.includes(props.anime.id));
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
  <article ref="element" class="anime-card" :class="{ compact, cancelled: event?.status === 'cancelled' }">
    <div v-if="event" class="event-time"><time :datetime="event.at">{{ formatClock(event.at, state.timezone.value) }}</time><span class="basis" :class="{ official: event.basis === 'official', hiatus: event.status === 'cancelled' }">{{ event.status === 'cancelled' ? '休播' : event.basis === 'estimated' ? '预计' : event.basis === 'official' ? '公告' : '来源排期' }}</span></div>
    <a :href="`#/anime/${anime.id}`" :aria-label="`查看${anime.title}详情`" class="anime-link">
      <Poster :image="detail?.image" :title="anime.title" />
      <div class="card-copy"><h3>{{ anime.title }}</h3><p v-if="!compact" class="original-title">{{ anime.originalTitle }}</p><div class="card-tags"><span>{{ anime.type.toUpperCase() }}</span><span v-if="event && anime.season !== state.currentSeason.value" class="continuing">续播</span><span v-if="!event">{{ beginDate.replaceAll('-', '.') }}</span></div></div>
    </a>
    <div v-if="event" class="event-footnote">{{ event.note || (event.status === 'cancelled' ? '本次停播' : event.at < state.now.value ? '计划时间已过' : anime.networkAiring ? `网络先行 · ${anime.networkAiring.platform}` : '日本放送参考') }}</div>
    <button class="save-card" :class="{ saved }" :aria-label="`${saved ? '取消追番' : '追番'}${anime.title}`" :aria-pressed="saved" @click="state.toggleFavorite(anime.id)"><Icon name="bookmark" :size="17" /></button>
  </article>
</template>

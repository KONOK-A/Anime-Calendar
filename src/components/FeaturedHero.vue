<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { buildSchedule, dateKey, formatClock, weekWindow } from '../../shared/schedule';
import { featuredEvents, initialFeatured } from '../presentation';
import { useAppState } from '../state';
import SceneBackdrop from './SceneBackdrop.vue';
import Poster from './Poster.vue';
import Icon from './Icon.vue';
const state = useAppState(), selected = ref('');
const todayKey = computed(() => `${state.timezone.value}:${dateKey(state.now.value, state.timezone.value)}`);
const candidates = computed(() => state.catalog.value ? featuredEvents(buildSchedule(state.catalog.value, weekWindow(state.now.value, state.timezone.value)), state.favorites.value, state.now.value, state.timezone.value) : []);
const candidateKeys = computed(() => candidates.value.map(x => `${x.animeId}:${x.at}`).join('|'));
watch([todayKey, candidateKeys], (value, previous) => {
  if (value[0] !== previous?.[0] || !candidates.value.some(x => x.animeId === selected.value)) selected.value = initialFeatured(candidates.value, state.now.value)?.animeId ?? '';
}, { immediate: true });
const event = computed(() => candidates.value.find(x => x.animeId === selected.value));
const anime = computed(() => state.catalog.value?.items.find(x => x.id === selected.value));
const detail = computed(() => state.details.get(selected.value));
const index = computed(() => candidates.value.findIndex(x => x.animeId === selected.value));
const saved = computed(() => state.favorites.value.includes(selected.value));
watch(selected, id => { if (id) void state.loadDetail(id); }, { immediate: true });
function change(direction: number) { const item = candidates.value[(index.value + direction + candidates.value.length) % candidates.value.length]; if (item) selected.value = item.animeId; }
function hidePrevious(element: Element) { element.setAttribute('hidden', ''); }
function showCurrent(element: Element) { element.removeAttribute('hidden'); }
const date = computed(() => new Intl.DateTimeFormat('zh-CN', { timeZone: state.timezone.value, month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(state.now.value)));
</script>
<template>
  <section class="featured-hero" :class="{ 'is-empty': !anime }" aria-label="今日作品">
    <SceneBackdrop animate />
    <div class="hero-copy"><p class="hero-date"><span class="small-sun"><Icon :name="state.appearance.theme.value === 'dark' ? 'moon' : 'sun'" :size="15" /></span>{{ date }}<span class="hero-today">今日放送</span></p>
      <template v-if="anime && event">
        <Transition name="feature" :duration="{ enter: 180, leave: 0 }" @before-leave="hidePrevious" @before-enter="showCurrent"><div :key="anime.id" class="hero-work"><h2 :title="anime.title">{{ anime.title }}</h2><p class="hero-original">{{ anime.originalTitle }}</p><p class="hero-time"><time :datetime="event.at">{{ formatClock(event.at, state.timezone.value) }}</time><span v-if="event.basis !== 'estimated'">{{ event.basis === 'official' ? '公告排期' : '来源排期' }}</span><span class="hero-source">{{ anime.networkAiring ? '网络先行' : '日本放送参考' }}</span></p><div class="hero-actions"><a class="button primary" :href="`#/anime/${anime.id}`" aria-label="打开今日作品详情">查看作品<Icon name="chevron" :size="15" /></a><button class="hero-save" :aria-label="`${saved ? '取消今日追番' : '追番今日作品'}`" :aria-pressed="saved" @click="state.toggleFavorite(anime.id)"><Icon :name="saved ? 'check' : 'bookmark'" :size="17" /><span>{{ saved ? '已在追番' : '加入追番' }}</span></button></div></div></Transition>
      </template>
      <div v-else class="hero-work hero-empty"><h2>今日暂无参考排期</h2><a href="#/season" class="button primary">浏览季度新番<Icon name="chevron" :size="15" /></a></div>
    </div>
    <a v-if="anime" class="hero-poster" :href="`#/anime/${anime.id}`" :aria-label="`打开${anime.title}作品页`"><Poster :image="detail?.image" :title="anime.title" :theme="state.appearance.theme.value" /><span>{{ anime.type.toUpperCase() }}<span>{{ saved ? '你的今日追番' : '今日相遇' }}</span></span></a>
    <div v-if="candidates.length > 1" class="hero-pagination"><button aria-label="上一部今日作品" @click="change(-1)"><Icon name="back" :size="16" /></button><span>{{ index + 1 }}<i>/</i>{{ candidates.length }}</span><button aria-label="下一部今日作品" @click="change(1)"><Icon name="chevron" :size="16" /></button></div>
  </section>
</template>

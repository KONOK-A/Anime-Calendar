<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { buildSchedule, dateKey, formatClock, weekWindow } from '../../shared/schedule';
import { featuredEvents, initialFeatured } from '../presentation';
import { useAppState } from '../state';
import { animateSaved, useMotionScope, usePointerLight } from '../motion';
import SceneBackdrop from './SceneBackdrop.vue';
import Poster from './Poster.vue';
import { posterSource } from '../poster-source';
import Icon from './Icon.vue';

const state = useAppState(), selected = ref(''), element = ref<HTMLElement>(), saveButton = ref<HTMLElement>();
const active = useMotionScope(element), pointer = usePointerLight(element, () => active.value);
const direction = ref(1);
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
const imageFailed = ref(false);
watch(() => detail.value?.image, () => { imageFailed.value = false; });
watch(selected, id => { imageFailed.value = false; if (id) void state.loadDetail(id); }, { immediate: true });
function washImageFailed(event: Event) {
  const image = event.currentTarget;
  if (image instanceof HTMLImageElement && image.dataset.animeId === selected.value && image.getAttribute('src') === detail.value?.image) imageFailed.value = true;
}
function change(value: number) { direction.value = value; const item = candidates.value[(index.value + value + candidates.value.length) % candidates.value.length]; if (item) selected.value = item.animeId; }
function leave(element: Element) { element.setAttribute('inert', ''); element.setAttribute('aria-hidden', 'true'); }
function enter(element: Element) { element.removeAttribute('inert'); element.removeAttribute('aria-hidden'); }
function leaveTitle(element: Element) { leave(element); element.setAttribute('hidden', ''); }
function enterTitle(element: Element) { enter(element); element.removeAttribute('hidden'); }
let feedback: Animation | undefined;
async function toggleSaved() {
  const id = selected.value, previous = saved.value;
  await state.toggleFavorite(id);
  if (id === selected.value && previous !== saved.value) { feedback?.cancel(); feedback = animateSaved(saveButton.value, state.appearance.reducedMotion.value); }
}
watch(() => state.appearance.reducedMotion.value, reduced => { if (reduced) feedback?.cancel(); });
watch(active, running => { if (!running) pointer.reset(); });
onUnmounted(() => feedback?.cancel());
const date = computed(() => new Intl.DateTimeFormat('zh-CN', { timeZone: state.timezone.value, year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(state.now.value)));
const transitionDuration = computed(() => state.appearance.reducedMotion.value ? 0 : { enter: 420, leave: 180 });
const titleDuration = computed(() => state.appearance.reducedMotion.value ? 0 : { enter: 240, leave: 0 });
</script>
<template>
  <section ref="element" class="featured-hero frame-hero" :class="{ 'is-empty': !anime }" :data-motion="active ? 'running' : 'paused'" :data-direction="direction" aria-label="今日作品" @pointermove="pointer.move" @pointerleave="pointer.reset">
    <div class="frame-wash-window" aria-hidden="true"><Transition name="frame-wash" :duration="transitionDuration" @before-leave="leave" @before-enter="enter"><div v-if="anime" :key="anime.id" class="frame-wash"><img v-if="detail?.image && !imageFailed" :src="posterSource(anime.id, 'card', detail.image, detail.detailFetchedAt) ?? undefined" :data-anime-id="anime.id" alt="" @error="washImageFailed" /></div></Transition></div>
    <div class="frame-copy">
      <p class="frame-eyebrow"><span class="frame-airing-mark" /><span>今日放送</span><i />{{ date }}</p>
      <div class="frame-title-stage">
        <Transition name="frame-copy" appear :duration="titleDuration" @before-leave="leaveTitle" @before-enter="enterTitle">
          <div v-if="anime" :key="anime.id" class="hero-work"><h2><a class="frame-title-link" :href="`#/anime/${anime.id}`" :title="anime.title">{{ anime.title }}</a></h2><p v-if="anime.originalTitle !== anime.title" class="frame-original">{{ anime.originalTitle }}</p></div>
          <div v-else class="hero-work frame-empty"><h2>今日暂无参考排期</h2></div>
        </Transition>
      </div>
      <div v-if="anime && event" class="frame-airing"><time :datetime="event.at">{{ formatClock(event.at, state.timezone.value) }}</time><span>{{ anime.networkAiring ? '网络先行' : '日本放送参考' }}</span><span v-if="event.basis !== 'estimated'" class="frame-basis">{{ event.basis === 'official' ? '公告排期' : '来源排期' }}</span></div>
      <div class="frame-actions"><a class="button primary" :href="anime ? `#/anime/${anime.id}` : '#/season'" :aria-label="anime ? '打开今日作品详情' : '浏览季度新番'">{{ anime ? '查看作品' : '浏览季度新番' }}<Icon name="chevron" :size="15" /></a><button v-if="anime" ref="saveButton" class="hero-save" :class="{ saved }" :aria-label="saved ? '取消今日追番' : '追番今日作品'" :aria-pressed="saved" @click="toggleSaved"><Icon name="bookmark" :size="17" /><span>{{ saved ? '已在追番' : '加入追番' }}</span></button></div>
    </div>
    <div class="frame-visual-stage">
      <SceneBackdrop animate />
      <div class="frame-poster-stage"><Transition name="frame-poster" appear :duration="transitionDuration" @before-leave="leave" @before-enter="enter"><a v-if="anime" :key="anime.id" class="hero-poster" :href="`#/anime/${anime.id}`" :aria-label="`打开${anime.title}作品页`"><div class="frame-poster-image"><Poster :id="anime.id" :revision="detail?.detailFetchedAt" size="hero" :image="detail?.image" :title="anime.title" :theme="state.appearance.theme.value" priority /><span class="frame-image-sheen" /></div><span class="frame-poster-caption"><span>{{ anime.type.toUpperCase() }}</span><span v-if="saved">已追番</span></span></a></Transition></div>
      <div v-if="candidates.length > 1" class="hero-pagination" role="group" :aria-label="`切换今日作品：第${index + 1}部，共${candidates.length}部`"><button aria-label="上一部今日作品" @click="change(-1)"><Icon name="back" :size="16" /></button><span class="hero-slide-track" aria-hidden="true" :style="{ '--hero-slide': (index + 1) / candidates.length }" /><button aria-label="下一部今日作品" @click="change(1)"><Icon name="chevron" :size="16" /></button></div>
    </div>
    <span class="frame-edge-light" aria-hidden="true" />
  </section>
</template>

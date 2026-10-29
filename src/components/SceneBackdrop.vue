<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { dateKey, seasonLabel } from '../../shared/schedule';
import { useAppState } from '../state';

const props = withDefaults(defineProps<{ animate?: boolean; variant?: 'feature' | 'detail'; mediaType?: 'tv' | 'web'; season?: string }>(), { animate: false, variant: 'feature' });
const state = useAppState(), element = ref<HTMLElement>(), inView = ref(false), visible = ref(!document.hidden);
const active = computed(() => props.animate && inView.value && visible.value && !state.appearance.reducedMotion.value);
const calendar = computed(() => {
  const [year, month, day] = dateKey(state.now.value, state.timezone.value).split('-');
  const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: state.timezone.value, weekday: 'long' }).format(new Date(state.now.value));
  return { year, month, day, weekday };
});
const ticks = Array.from({ length: 24 }, (_, index) => {
  const angle = index * Math.PI / 12;
  return { x1: 1000 + Math.cos(angle) * 169, y1: 160 + Math.sin(angle) * 169, x2: 1000 + Math.cos(angle) * (index % 3 ? 175 : 181), y2: 160 + Math.sin(angle) * (index % 3 ? 175 : 181) };
});
const visibility = () => { visible.value = !document.hidden; };
let observer: IntersectionObserver | undefined;
onMounted(() => {
  observer = new IntersectionObserver(entries => { inView.value = entries.some(entry => entry.isIntersecting); });
  if (element.value) observer.observe(element.value);
  document.addEventListener('visibilitychange', visibility);
});
onUnmounted(() => { observer?.disconnect(); document.removeEventListener('visibilitychange', visibility); });
</script>

<template>
  <div ref="element" class="scene-backdrop" :data-variant="variant" :data-motion="active ? 'running' : 'paused'" aria-hidden="true">
    <svg class="broadcast-geometry" viewBox="0 0 1280 320" preserveAspectRatio="xMaxYMid slice" fill="none">
      <path class="broadcast-plane" d="M728 0H1280V320H586Z" />
      <path class="broadcast-rule" d="M698 0 556 320M730 42H1280M627 278H1280" />
      <ellipse class="broadcast-orbit outer" cx="1000" cy="160" rx="247" ry="217" transform="rotate(-18 1000 160)" />
      <circle class="broadcast-orbit" cx="1000" cy="160" r="154" />
      <g class="broadcast-ticks"><line v-for="(tick, index) in ticks" :key="index" v-bind="tick" /></g>
      <g class="broadcast-phase"><circle class="broadcast-arc" cx="1000" cy="160" r="181" stroke-dasharray="150 990" stroke-dashoffset="-610" /><circle class="broadcast-dot" cx="1138" cy="43" r="5" /></g>
    </svg>
    <div v-if="variant === 'feature'" class="broadcast-date"><span>{{ calendar.year }} / {{ calendar.month }}</span><strong>{{ calendar.day }}</strong><span>{{ calendar.weekday }}</span></div>
    <div v-else-if="mediaType" class="broadcast-edition"><strong>{{ mediaType.toUpperCase() }}</strong><span v-if="season">{{ seasonLabel(season) }}</span></div>
    <span class="broadcast-edge" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { dateKey, seasonLabel } from '../../shared/schedule';
import { useAppState } from '../state';
import { useMotionScope } from '../motion';

const props = withDefaults(defineProps<{ animate?: boolean; variant?: 'feature' | 'detail'; mediaType?: 'tv' | 'web'; season?: string }>(), { animate: false, variant: 'feature' });
const state = useAppState(), element = ref<HTMLElement>();
const gradient = `broadcast-light-${useId()}`;
const inMotion = useMotionScope(element);
const active = computed(() => props.animate && inMotion.value);
const calendar = computed(() => {
  const [year, month, day] = dateKey(state.now.value, state.timezone.value).split('-');
  const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: state.timezone.value, weekday: 'long' }).format(new Date(state.now.value));
  return { year, month, day, weekday };
});
</script>

<template>
  <div ref="element" class="scene-backdrop" :data-variant="variant" :data-motion="active ? 'running' : 'paused'" aria-hidden="true">
    <svg v-if="variant === 'detail'" class="broadcast-geometry" viewBox="0 0 380 360" fill="none">
      <defs><linearGradient :id="gradient" x1="0" y1="0" x2="1" y2="1"><stop class="frame-stop-blue" /><stop class="frame-stop-violet" offset=".52" /><stop class="frame-stop-rose" offset="1" /></linearGradient></defs>
      <g :stroke="`url(#${gradient})`">
        <ellipse class="broadcast-orbit outer" cx="190" cy="180" rx="171" ry="145" transform="rotate(-22 190 180)" />
        <circle class="broadcast-orbit" cx="190" cy="180" r="137" />
        <path class="broadcast-arc" d="M58 256a152 152 0 0 1 69-215M322 104a152 152 0 0 1-69 215" />
        <path class="broadcast-guide" d="M61 299h34M285 61h34" />
      </g>
      <circle class="broadcast-dot start" cx="127" cy="41" r="3" /><circle class="broadcast-dot end" cx="253" cy="319" r="3" />
    </svg>
    <div v-if="variant === 'feature'" class="broadcast-date">
      <strong class="frame-date-art"><svg class="frame-geometry" viewBox="0 0 420 300" fill="none">
        <defs><linearGradient :id="`${gradient}-date`" x1="25" y1="25" x2="242" y2="239" gradientUnits="userSpaceOnUse"><stop class="frame-stop-blue" /><stop class="frame-stop-violet" offset=".52" /><stop class="frame-stop-rose" offset="1" /></linearGradient></defs>
        <g :stroke="`url(#${gradient}-date)`">
          <circle class="frame-date-orbit" cx="270" cy="146" r="142" />
          <path class="frame-date-trace" d="M147 217A142 142 0 0 1 282 4" />
          <text class="frame-date-number" x="4" y="190" textLength="114" lengthAdjust="spacingAndGlyphs">{{ calendar.day }}</text>
          <path class="frame-date-rule" d="M4 234h38" />
        </g>
        <circle class="frame-date-dot start" cx="282" cy="4" r="2.5" />
        <text class="frame-date-meta" x="4" y="94">{{ calendar.year }} / {{ calendar.month }}</text>
        <text class="frame-date-weekday" x="4" y="219">{{ calendar.weekday }}</text>
      </svg></strong>
      <span class="broadcast-short-date"><svg class="frame-mini-geometry" viewBox="0 0 96 22" fill="none">
        <defs><linearGradient :id="`${gradient}-mini`" x1="18" y1="0" x2="78" y2="0" gradientUnits="userSpaceOnUse"><stop class="frame-stop-blue" /><stop class="frame-stop-violet" offset=".52" /><stop class="frame-stop-rose" offset="1" /></linearGradient></defs>
        <text x="48" y="14" text-anchor="middle" :fill="`url(#${gradient}-mini)`">{{ calendar.month }} / {{ calendar.day }}</text><path d="M22 21h52" :stroke="`url(#${gradient}-mini)`" opacity=".65" />
      </svg></span>
    </div>
    <div v-else-if="mediaType" class="broadcast-edition">
      <svg class="broadcast-symbol" viewBox="0 0 108 88" fill="none" :stroke="`url(#${gradient})`" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <g v-if="mediaType === 'tv'"><rect x="17" y="20" width="74" height="49" rx="9" /><path d="m40 10 14 10 14-10M41 77h26M33 61h42" /><path class="broadcast-symbol-detail" d="M25 39v-9a2 2 0 0 1 2-2h12M83 49v9a3 3 0 0 1-3 3" /></g>
        <g v-else><rect x="14" y="16" width="80" height="58" rx="9" /><path d="M14 33h80M29 48h50M29 58h31" /><circle cx="25" cy="25" r="1" /><circle cx="32" cy="25" r="1" /><circle cx="39" cy="25" r="1" /></g>
      </svg>
      <strong>{{ mediaType.toUpperCase() }}</strong><span v-if="season">{{ seasonLabel(season) }}</span>
    </div>
    <span class="broadcast-edge" />
  </div>
</template>

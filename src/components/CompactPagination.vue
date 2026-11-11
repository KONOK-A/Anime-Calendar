<script setup lang="ts">
import { nextTick, ref } from 'vue';
import Icon from './Icon.vue';

const props = defineProps<{ page: number; pages: number; label: string }>();
const emit = defineEmits<{ change: [page: number] }>();
const previousButton = ref<HTMLButtonElement>();
const nextButton = ref<HTMLButtonElement>();

async function step(direction: -1 | 1) {
  const trigger = direction === -1 ? previousButton : nextButton;
  const opposite = direction === -1 ? nextButton : previousButton;
  emit('change', props.page + direction);
  await nextTick();
  (trigger.value?.disabled ? opposite.value : trigger.value)?.focus({ preventScroll: true });
}
</script>

<template>
  <nav class="compact-pagination" :aria-label="label">
    <button ref="previousButton" type="button" aria-label="上一页" title="上一页" :disabled="page <= 1" @click="step(-1)"><Icon name="back" :size="14" /></button>
    <span class="page-number" role="status" aria-label="页码"><strong>{{ page }}</strong><span> / </span>{{ pages }}</span>
    <button ref="nextButton" type="button" aria-label="下一页" title="下一页" :disabled="page >= pages" @click="step(1)"><Icon name="chevron" :size="14" /></button>
  </nav>
</template>

<style scoped>
.compact-pagination { position: relative; isolation: isolate; display: inline-grid; grid-template-columns: 44px auto 44px; flex: 0 0 auto; align-items: center; }
.compact-pagination::before { content: ''; position: absolute; z-index: -1; inset: 5px 0; border: 1px solid color-mix(in srgb, var(--line) 88%, var(--muted)); border-radius: 999px; background: color-mix(in srgb, var(--surface) 89%, var(--bg)); }
.compact-pagination button { position: relative; isolation: isolate; display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 999px; background: transparent; color: var(--ink); }
.compact-pagination button::before { content: ''; position: absolute; z-index: -1; inset: 8px 6px; border-radius: 999px; background: color-mix(in srgb, var(--frame-violet) 11%, var(--surface)); opacity: 0; }
.compact-pagination button:not(:disabled):is(:hover, :focus-visible)::before { opacity: 1; }
.compact-pagination button:focus-visible { outline: 1px solid color-mix(in srgb, var(--frame-violet) 57%, var(--muted)); outline-offset: -6px; }
.compact-pagination button:disabled { color: var(--muted); opacity: .42; }
.page-number { min-width: 4ch; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; line-height: 1; text-align: center; white-space: nowrap; }
.page-number strong { color: var(--ink); font-weight: 650; }
.page-number > span { opacity: .68; }
</style>

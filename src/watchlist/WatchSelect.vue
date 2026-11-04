<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import Icon from '../components/Icon.vue';

const props = defineProps<{
  modelValue: string;
  options: { value: string; label: string }[];
  label: string;
  icon?: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const list = ref<HTMLElement>();
const open = ref(false);
const active = ref(0);
const opensUp = ref(false);
const placement = ref({ left: '0px', width: '100%', maxHeight: '260px' });
const id = useId();
const listId = `${id}-options`;
const valueId = `${id}-value`;
const optionId = (index: number) => `${listId}-${index}`;
const selectedIndex = computed(() => props.options.findIndex(option => option.value === props.modelValue));
const selected = computed(() => props.options[selectedIndex.value]);
const unavailable = computed(() => props.disabled || !props.options.length);
let typed = '', lastKey = 0;

function placeList() {
  const container = root.value?.getBoundingClientRect();
  const anchor = trigger.value?.getBoundingClientRect();
  if (!container || !anchor) return;

  const gutter = 12, gap = 6;
  const viewportWidth = document.documentElement.clientWidth;
  const width = Math.min(Math.max(anchor.width, 194), viewportWidth - gutter * 2);
  const left = Math.max(gutter, Math.min(anchor.left, viewportWidth - width - gutter));
  const header = document.querySelector('.site-header')?.getBoundingClientRect();
  const nav = document.querySelector('.main-nav');
  const bottom = nav && getComputedStyle(nav).position === 'fixed' ? nav.getBoundingClientRect().top : innerHeight;
  const top = header && header.top <= 1 ? Math.max(gutter, header.bottom + gutter) : gutter;
  const below = bottom - anchor.bottom - gap - gutter;
  const above = anchor.top - gap - top;
  const ideal = Math.min(props.options.length * 48 + 12, 288);
  opensUp.value = below < ideal && above > below;
  placement.value = {
    left: `${left - container.left}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(48, Math.min(288, opensUp.value ? above : below))}px`,
  };
}

async function highlight(index: number) {
  active.value = Math.max(0, Math.min(props.options.length - 1, index));
  await nextTick();
  const panel = list.value;
  const option = document.getElementById(optionId(active.value));
  if (!open.value || !panel || !option) return;
  const menuRect = panel.getBoundingClientRect(), optionRect = option.getBoundingClientRect();
  if (optionRect.top < menuRect.top + 5) panel.scrollTop += optionRect.top - menuRect.top - 5;
  if (optionRect.bottom > menuRect.bottom - 5) panel.scrollTop += optionRect.bottom - menuRect.bottom + 5;
}

function close() {
  open.value = false;
  typed = '';
  lastKey = 0;
}

function reveal(index = Math.max(0, selectedIndex.value)) {
  if (unavailable.value) return;
  placeList();
  open.value = true;
  trigger.value?.focus({ preventScroll: true });
  void highlight(index);
}

function choose(index: number) {
  const option = props.options[index];
  if (option && option.value !== props.modelValue) emit('update:modelValue', option.value);
  close();
}

const searchLabel = (label: string) => label.normalize('NFKC').toLocaleLowerCase();

function typeAhead(key: string) {
  if (!open.value) reveal();
  const now = performance.now();
  typed = now - lastKey < 700 ? typed + searchLabel(key) : searchLabel(key);
  lastKey = now;
  const chars = Array.from(typed);
  const repeating = chars.every(char => char === chars[0]);
  const query = repeating ? chars[0]! : typed;
  const start = active.value + (repeating ? 1 : 0);
  for (let offset = 0; offset < props.options.length; offset++) {
    const index = (start + offset) % props.options.length;
    if (searchLabel(props.options[index]!.label).startsWith(query)) {
      void highlight(index);
      return;
    }
  }
}

function onKeydown(event: KeyboardEvent) {
  if (unavailable.value || event.isComposing || event.ctrlKey || event.metaKey) return;
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      if (!open.value) reveal(selectedIndex.value < 0 && step === -1 ? props.options.length - 1 : Math.max(0, selectedIndex.value));
      else if (event.altKey && step === -1) choose(active.value);
      else if (!event.altKey) void highlight(active.value + step);
      return;
    }
    case 'Home':
    case 'End': {
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : props.options.length - 1;
      if (open.value) void highlight(index); else reveal(index);
      return;
    }
    case 'Enter':
    case ' ':
      event.preventDefault();
      if (!event.repeat) {
        if (open.value) choose(active.value); else reveal();
      }
      return;
    case 'Escape':
      if (open.value) { event.preventDefault(); event.stopPropagation(); close(); }
      return;
    case 'Tab':
      if (open.value) choose(active.value);
      return;
    default:
      if (!event.altKey && Array.from(event.key).length === 1) {
        event.preventDefault();
        typeAhead(event.key);
      }
  }
}

function dismissOutside(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) close();
}

function onBlur(event: FocusEvent) {
  if (event.relatedTarget instanceof Node && !root.value?.contains(event.relatedTarget)) close();
}

function reposition(event: Event) {
  if (event.target instanceof Node && list.value?.contains(event.target)) return;
  if (open.value) placeList();
}

function removeListeners() {
  document.removeEventListener('pointerdown', dismissOutside, true);
  window.removeEventListener('resize', reposition);
  window.removeEventListener('scroll', reposition, true);
}

watch(open, value => {
  if (value) {
    document.addEventListener('pointerdown', dismissOutside, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, { capture: true, passive: true });
  } else removeListeners();
});
watch([unavailable, () => props.options.length], () => {
  if (unavailable.value) close();
  else if (open.value) { placeList(); void highlight(active.value); }
});
onBeforeUnmount(removeListeners);
</script>

<template>
  <div ref="root" class="watch-select" :data-open="open || undefined" :data-up="opensUp || undefined">
    <button
      ref="trigger"
      type="button"
      class="watch-select-trigger"
      role="combobox"
      :aria-label="label"
      :aria-describedby="valueId"
      :aria-controls="listId"
      :aria-expanded="open"
      :aria-activedescendant="open && options[active] ? optionId(active) : undefined"
      :disabled="unavailable"
      @click="open ? close() : reveal()"
      @keydown="onKeydown"
      @blur="onBlur"
    >
      <Icon v-if="icon" class="watch-select-leading" :name="icon" :size="15" />
      <span :id="valueId" class="watch-select-label" :title="selected?.label">{{ selected?.label ?? label }}</span>
      <Icon class="watch-select-chevron" name="chevron" :size="14" />
    </button>
    <div v-show="open" :id="listId" ref="list" class="watch-select-list" role="listbox" :aria-label="label" :style="placement">
      <div
        v-for="(option, index) in options"
        :id="optionId(index)"
        :key="option.value"
        role="option"
        :aria-selected="index === selectedIndex"
        :data-active="index === active || undefined"
        @mousedown.prevent
        @click="choose(index); trigger?.focus({ preventScroll: true })"
      >
        <span>{{ option.label }}</span>
        <Icon v-if="index === selectedIndex" name="check" :size="15" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.watch-select { position: relative; min-width: 0; max-width: 100%; }
.watch-select[data-open] { z-index: 8; }
.watch-select-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 6px 10px;
  border: 1px solid var(--watch-control-line, var(--line));
  border-radius: 9px;
  background: var(--watch-control-surface, var(--surface));
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  text-align: start;
}
.watch-select-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.watch-select-leading, .watch-select-chevron { color: var(--muted); }
.watch-select-chevron { transform: rotate(90deg); transition: transform 130ms ease; }
.watch-select[data-open] .watch-select-chevron { transform: rotate(-90deg); }
.watch-select-trigger:not(:disabled):hover, .watch-select[data-open] .watch-select-trigger { border-color: var(--watch-focus, var(--muted)); }
.watch-select .watch-select-trigger:focus-visible {
  outline: 1px solid var(--watch-focus, var(--muted));
  outline-offset: 1px;
  box-shadow: 0 0 0 3px var(--watch-focus-halo, var(--soft));
}
.watch-select-list {
  position: absolute;
  top: calc(100% + 6px);
  box-sizing: border-box;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 5px;
  border: 1px solid var(--watch-control-line, var(--line));
  border-radius: 11px;
  background: var(--surface);
  color: var(--ink);
  box-shadow: 0 9px 23px color-mix(in srgb, var(--ink) 11%, transparent), 0 2px 5px color-mix(in srgb, var(--ink) 6%, transparent);
}
.watch-select[data-up] .watch-select-list { top: auto; bottom: calc(100% + 6px); }
.watch-select-list [role='option'] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 15px;
  align-items: center;
  min-height: 44px;
  gap: 6px;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  cursor: pointer;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.watch-select-list [role='option'] + [role='option'] { margin-top: 2px; }
.watch-select-list [aria-selected='true'] { background: var(--watch-selected, var(--soft)); color: var(--ink); font-weight: 630; }
.watch-select-list [aria-selected='true'] > svg { color: var(--watch-focus, var(--accent)); }
.watch-select-list [data-active], .watch-select-list [role='option']:hover { border-color: var(--watch-control-line, var(--line)); }
.watch-select-list [aria-selected='false']:is([data-active], :hover) { background: color-mix(in srgb, var(--soft) 52%, var(--surface)); }
@media (prefers-reduced-motion: reduce) { .watch-select-chevron { transition: none; } }
@media (forced-colors: active) { .watch-select-list [data-active] { outline: 1px solid Highlight; outline-offset: -1px; } }
</style>

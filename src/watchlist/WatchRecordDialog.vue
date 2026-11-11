<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import Icon from '../components/Icon.vue';
import Poster from '../components/Poster.vue';
import { useAppState } from '../state';
import { defaultWatchRecord, WATCH_LIMITS, WATCH_STATUSES, WATCH_STATUS_LABELS, type WatchRecord, type WatchRecordPatch, type WatchStatus } from './model';

const props = defineProps<{ id: string; focus?: 'date'; pointerOpened?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const state = useAppState();
const dialog = ref<HTMLDialogElement>(), heading = ref<HTMLElement>(), dateField = ref<HTMLInputElement>();
const busy = ref(false), initialized = ref(false), failure = ref(false);
const status = ref<WatchStatus>('wanted'), watched = ref<number | string>(''), plannedDate = ref(''), score = ref<number | string>(''), note = ref('');
const membership = ref<string[]>([]);
const title = computed(() => state.details.get(props.id) ?? state.watchCatalog.titles.get(props.id) ?? state.catalog.value?.items.find(item => item.id === props.id));
const episodes = computed(() => state.details.get(props.id)?.episodes ?? state.watchCatalog.titles.get(props.id)?.episodes ?? null);
const watchedCount = computed(() => watched.value === '' ? null : Number(watched.value));
const countIsValid = computed(() => watchedCount.value === null || Number.isSafeInteger(watchedCount.value) && watchedCount.value >= 0 && watchedCount.value <= WATCH_LIMITS.watched);
const canDecrease = computed(() => countIsValid.value && (watchedCount.value ?? 0) > 0);
const canIncrease = computed(() => countIsValid.value && (watchedCount.value ?? 0) < WATCH_LIMITS.watched);
const completion = computed(() => episodes.value && watchedCount.value !== null && countIsValid.value ? Math.min(100, watchedCount.value / episodes.value * 100) : null);
let returnFocus: HTMLElement | null = null, original: WatchRecord, originalMembership: string[] = [];

watch(() => state.watchReady.value && !state.watchStorageError.value, async ready => {
  if (!ready || initialized.value) return;
  original = state.watchlist.value.records.find(record => record.id === props.id) ?? defaultWatchRecord(props.id);
  originalMembership = state.watchlist.value.memberships.filter(row => row.animeId === props.id).map(row => row.listId);
  status.value = original.status;
  watched.value = original.watched ?? '';
  plannedDate.value = original.plannedDate ?? '';
  score.value = original.personalScore ?? '';
  note.value = original.note;
  membership.value = [...originalMembership];
  initialized.value = true;
  if (props.focus === 'date') {
    await nextTick();
    dateField.value?.focus();
  }
}, { immediate: true });

function close() {
  if (busy.value) return;
  dialog.value?.close();
  emit('close');
}

function stepCount(delta: -1 | 1) {
  if (busy.value || !(delta === 1 ? canIncrease.value : canDecrease.value)) return;
  watched.value = (watchedCount.value ?? 0) + delta;
}

function clearPlanDate() {
  dateField.value?.focus();
  plannedDate.value = '';
}

async function submit() {
  if (!initialized.value || busy.value) return;
  const patch: WatchRecordPatch = {};
  const count = watchedCount.value;
  const personalScore = score.value === '' ? null : Number(score.value);
  if (status.value !== original.status) patch.status = status.value;
  if (count !== original.watched) patch.watched = count;
  if ((plannedDate.value || null) !== original.plannedDate) patch.plannedDate = plannedDate.value || null;
  if (personalScore !== original.personalScore) patch.personalScore = personalScore;
  if (note.value !== original.note) patch.note = note.value;
  busy.value = true;
  failure.value = false;
  const saved = await state.saveWatchRecord(props.id, patch, membership.value, originalMembership);
  busy.value = false;
  if (saved) { state.notify('追番记录已保存。'); close(); }
  else failure.value = true;
}

onMounted(() => {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.value?.showModal();
  heading.value?.focus({ preventScroll: true });
});
onUnmounted(() => {
  dialog.value?.close();
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  else (document.querySelector<HTMLElement>('.watch-workspace h2[tabindex="-1"]') ?? document.getElementById('content'))?.focus({ preventScroll: true });
});
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="watch-record-dialog" :data-pointer-open="pointerOpened || undefined" aria-labelledby="watch-record-heading" @cancel.prevent="close" @click.self="close">
      <form class="watch-record-form" @submit.prevent="submit">
        <header class="watch-record-head">
          <div class="watch-record-cover" aria-hidden="true">
            <Poster v-if="title" :id="props.id" :title="title.title" :theme="state.appearance.theme.value" size="thumb" />
            <Icon v-else name="bookmark" :size="19" />
          </div>
          <div class="watch-record-caption">
            <h2 id="watch-record-heading" ref="heading" tabindex="-1">编辑追番记录</h2>
            <p>{{ title?.title ?? props.id }}</p>
          </div>
          <button type="button" class="watch-record-close" aria-label="关闭编辑" :disabled="busy" @click="close"><Icon name="close" :size="19" /></button>
        </header>
        <div class="watch-record-body">
          <p v-if="!initialized" role="status">{{ state.watchStorageError.value ?? '正在读取追番记录…' }}</p>
          <button v-if="!initialized && state.watchStorageError.value" type="button" class="button watch-record-retry" @click="state.ensureWatchLibrary">重试读取</button>
          <fieldset v-if="initialized" class="watch-record-fields" :disabled="busy">
            <fieldset class="watch-record-wide watch-record-status">
              <legend>观看状态</legend>
              <div class="watch-record-status-options">
                <label v-for="value in WATCH_STATUSES" :key="value">
                  <input v-model="status" type="radio" name="watch-record-status" :value="value" />
                  <span>{{ WATCH_STATUS_LABELS[value] }}</span>
                </label>
              </div>
            </fieldset>
            <div class="watch-record-wide watch-record-progress">
              <div class="watch-record-field watch-record-progress-caption">
                <label for="watch-record-watched">已看集数</label>
                <div v-if="episodes" class="watch-record-total">
                  <small id="watch-record-total">条目收录 {{ episodes }} 集</small>
                  <span v-if="completion !== null" class="watch-record-track" aria-hidden="true"><i :style="{ width: `${completion}%` }" /></span>
                </div>
              </div>
              <div class="watch-record-stepper">
                <button type="button" aria-label="已看集数减一" aria-controls="watch-record-watched" :aria-disabled="!canDecrease || undefined" @click="stepCount(-1)">−</button>
                <input id="watch-record-watched" v-model="watched" type="number" inputmode="numeric" min="0" :max="WATCH_LIMITS.watched" step="1" placeholder="未记录" :aria-describedby="episodes ? 'watch-record-total' : undefined" />
                <button type="button" aria-label="已看集数加一" aria-controls="watch-record-watched" :aria-disabled="!canIncrease || undefined" @click="stepCount(1)">+</button>
              </div>
            </div>
            <div class="watch-record-field watch-record-date">
              <label for="watch-record-date">计划观看日期</label>
              <div class="watch-record-date-control">
                <input id="watch-record-date" ref="dateField" v-model="plannedDate" type="date" min="0001-01-01" max="9999-12-31" />
                <button v-if="plannedDate" type="button" class="watch-record-clear" aria-label="清空计划日期" title="清空计划日期" @click="clearPlanDate"><Icon name="close" :size="16" /></button>
              </div>
            </div>
            <label class="watch-record-field"><span>个人评分</span><input v-model="score" type="number" min="0.5" max="10" step="0.5" placeholder="满分 10" /></label>
            <label class="watch-record-field watch-record-wide"><span>备注</span><textarea v-model="note" rows="3" :maxlength="WATCH_LIMITS.note" placeholder="留给自己的一点记录" /></label>
            <div v-if="state.watchlist.value.lists.length" class="watch-record-wide watch-record-memberships" role="group" aria-label="所属清单">
              <span>所属清单</span>
              <div class="watch-record-list-options"><label v-for="list in state.watchlist.value.lists" :key="list.id"><input v-model="membership" type="checkbox" :value="list.id" /><span>{{ list.name }}</span></label></div>
            </div>
          </fieldset>
        </div>
        <footer class="watch-record-actions">
          <p v-if="failure" class="watch-record-error" role="alert">记录未保存，编辑内容已保留。请重试。</p>
          <button type="button" class="button" :disabled="busy" @click="close">取消</button>
          <button type="submit" class="button primary" :disabled="!initialized || busy">{{ busy ? '保存中…' : '保存记录' }}</button>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.watch-record-dialog {
  --watch-dialog-height: calc(100dvh - 32px);
  --watch-dialog-gutter: 24px;
  --record-control-surface: var(--watch-control-surface, color-mix(in srgb, var(--surface) 80%, var(--bg)));
  --record-control-line: var(--watch-control-line, color-mix(in srgb, var(--line) 85%, var(--ink)));
  --record-focus: var(--watch-focus, color-mix(in srgb, var(--accent) 54%, var(--muted)));
  --record-focus-halo: var(--watch-focus-halo, color-mix(in srgb, var(--record-focus) 16%, transparent));
  --record-selected: var(--watch-selected, color-mix(in srgb, var(--soft) 76%, var(--surface)));
  width: min(510px, calc(100% - 32px));
  max-height: var(--watch-dialog-height);
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--surface);
  color: var(--ink);
  box-shadow: 0 22px 68px #0c14294a;
}
.watch-record-dialog::backdrop { background: #111b37a0; }
.watch-record-dialog[open][data-pointer-open] {
  transition: opacity 200ms cubic-bezier(.22,1,.36,1), transform 200ms cubic-bezier(.22,1,.36,1);
}
@starting-style {
  .watch-record-dialog[open][data-pointer-open] { opacity: .65; transform: translateY(8px); }
}
@media (prefers-reduced-motion: reduce) {
  .watch-record-dialog[open][data-pointer-open] { transition: opacity 100ms cubic-bezier(.22,1,.36,1) !important; }
  @starting-style {
    .watch-record-dialog[open][data-pointer-open] { opacity: .85; transform: none; }
  }
}
.watch-record-form {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  max-height: calc(var(--watch-dialog-height) - 2px);
}
.watch-record-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 15px var(--watch-dialog-gutter);
  border-bottom: 1px solid var(--line);
  background: linear-gradient(104deg, var(--record-selected), var(--surface) 71%);
}
.watch-record-cover { display: grid; place-items: center; width: 39px; height: 53px; overflow: hidden; border: 1px solid var(--record-control-line); border-radius: 7px; color: var(--record-focus); background: var(--surface); }
.watch-record-cover .poster { width: 100%; height: 100%; object-fit: cover; border-radius: 0; }
.watch-record-caption { min-width: 0; }
.watch-record-head h2 { color: var(--muted); font-size: 12px; font-weight: 650; line-height: 1.4; outline: 0; }
.watch-record-head p { margin-top: 4px; font: 22px/1.25 WenKai, 'Microsoft YaHei', sans-serif; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.watch-record-close, .watch-record-clear, .watch-record-stepper button { display: grid; place-items: center; min-width: 44px; min-height: 44px; color: var(--muted); background: transparent; }
.watch-record-close, .watch-record-clear { flex: 0 0 44px; border-radius: 8px; }
.watch-record-close:hover, .watch-record-clear:hover, .watch-record-stepper button:not([aria-disabled='true']):hover { color: var(--ink); background: var(--record-selected); }
.watch-record-body { min-height: 0; padding: 15px var(--watch-dialog-gutter) 16px; overflow-y: auto; overscroll-behavior: contain; scroll-padding-block: 12px; }
.watch-record-retry { margin-top: 12px; }
.watch-record-fields { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 12px 14px; min-width: 0; margin: 0; padding: 0; border: 0; }
.watch-record-wide { grid-column: 1/-1; }
.watch-record-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.watch-record-field > span, .watch-record-field > label, .watch-record-memberships > span, .watch-record-status legend { font-size: 13px; font-weight: 650; }
.watch-record-dialog button:focus-visible { outline: 1px solid var(--record-focus); outline-offset: 2px; box-shadow: 0 0 0 3px var(--record-focus-halo); }
.watch-record-fields input:not([type='checkbox'], [type='radio']), .watch-record-fields textarea { font: inherit; width: 100%; min-width: 0; min-height: 44px; padding: 8px 10px; border: 1px solid var(--record-control-line); border-radius: 8px; color: var(--ink); background: var(--record-control-surface); }
.watch-record-fields textarea { resize: vertical; min-height: 64px; }
.watch-record-fields input:not([type='checkbox'], [type='radio']):focus, .watch-record-fields textarea:focus { outline: none; border-color: var(--record-focus); background: var(--surface); box-shadow: 0 0 0 2px var(--record-focus-halo); }
.watch-record-status { min-width: 0; margin: 0; padding: 0; border: 0; }
.watch-record-status legend { margin-bottom: 5px; padding: 0; }
.watch-record-status-options { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 5px; }
.watch-record-status-options label { display: flex; align-items: center; justify-content: center; gap: 5px; min-width: 0; min-height: 44px; padding: 3px 2px; border: 1px solid transparent; border-radius: 8px; color: var(--muted); background: var(--record-control-surface); cursor: pointer; font-size: 13px; white-space: nowrap; }
.watch-record-status-options label:hover { border-color: var(--record-control-line); color: var(--ink); }
.watch-record-status-options label:has(input:checked) { border-color: var(--record-control-line); color: var(--ink); background: var(--record-selected); font-weight: 650; }
.watch-record-status-options input { appearance: none; display: grid; place-items: center; flex: 0 0 11px; width: 11px; height: 11px; margin: 0; border: 1px solid var(--muted); border-radius: 50%; cursor: inherit; }
.watch-record-status-options input:checked { border-color: var(--record-focus); }
.watch-record-status-options input:checked::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--record-focus); }
.watch-record-status-options input:focus-visible, .watch-record-list-options input:focus-visible { outline: none; }
.watch-record-status-options label:has(input:focus-visible), .watch-record-list-options label:has(input:focus-visible) { outline: 1px solid var(--record-focus); outline-offset: 1px; box-shadow: 0 0 0 2px var(--record-focus-halo); }
.watch-record-progress { display: grid; grid-template-columns: minmax(0, 1fr) minmax(128px, 172px); align-items: center; gap: 10px; padding: 5px 0 9px; border-bottom: 1px solid var(--line); }
.watch-record-stepper { display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; gap: 1px; padding: 1px; border: 1px solid var(--record-control-line); border-radius: 8px; background: var(--record-control-surface); }
.watch-record-stepper button { border-radius: 6px; font-size: 18px; line-height: 1; }
.watch-record-stepper button[aria-disabled='true'] { opacity: .56; cursor: default; }
.watch-record-fields .watch-record-stepper input[type='number'] { padding-inline: 1px; border: 0; appearance: textfield; text-align: center; font-variant-numeric: tabular-nums; }
.watch-record-stepper input::-webkit-inner-spin-button, .watch-record-stepper input::-webkit-outer-spin-button { appearance: none; margin: 0; }
.watch-record-fields .watch-record-stepper input[type='number']:focus { box-shadow: inset 0 0 0 1px var(--record-focus); }
.watch-record-total { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; color: var(--muted); }
.watch-record-track { flex: 0 1 60px; min-width: 25px; height: 3px; border-radius: 4px; background: var(--line); }
.watch-record-track i { display: block; height: 100%; border-radius: inherit; background: var(--frame-gradient, var(--accent)); }
.watch-record-date-control { display: flex; gap: 5px; }
.watch-record-date-control input { flex: 1; }
.watch-record-list-options { display: flex; flex-wrap: wrap; gap: 5px; max-height: 132px; margin-top: 5px; padding: 4px; overflow: auto; overscroll-behavior: contain; }
.watch-record-list-options label { display: inline-flex; align-items: center; min-height: 44px; max-width: 100%; gap: 6px; padding: 4px 9px; border: 1px solid var(--record-control-line); border-radius: 8px; cursor: pointer; }
.watch-record-list-options label:has(input:checked) { background: var(--record-selected); color: var(--ink); }
.watch-record-list-options input { flex: 0 0 auto; margin: 0; accent-color: var(--record-focus); }
.watch-record-list-options span { overflow-wrap: anywhere; }
.watch-record-actions { display: grid; grid-template-columns: auto auto; justify-content: end; gap: 8px; padding: 12px var(--watch-dialog-gutter); border-top: 1px solid var(--line); background: var(--surface); }
.watch-record-error { grid-column: 1/-1; color: var(--error); font-size: 13px; }
@media (max-width: 599px) {
  .watch-record-dialog { --watch-dialog-height: calc(100dvh - 12px); --watch-dialog-gutter: 16px; width: 100%; max-width: 100%; margin: auto 0 0; border-radius: 17px 17px 0 0; }
  .watch-record-head { padding-block: 12px; }
  .watch-record-actions { grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr); justify-content: stretch; padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)); }
  .watch-record-fields input:not([type='checkbox'], [type='radio']), .watch-record-fields textarea { font-size: 16px; }
}
@media (max-width: 359px) {
  .watch-record-fields { grid-template-columns: minmax(0, 1fr); }
  .watch-record-status-options { gap: 3px; }
  .watch-record-status-options label { gap: 3px; font-size: 12px; }
  .watch-record-progress { grid-template-columns: minmax(0, 1fr) minmax(128px, 148px); gap: 7px; }
}
@media (forced-colors: active) {
  .watch-record-status-options input { appearance: auto; }
  .watch-record-status-options input::before { content: none; }
  .watch-record-fields input:focus, .watch-record-fields textarea:focus { outline: 1px solid Highlight; outline-offset: 1px; }
}
</style>

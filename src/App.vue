<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import { appKey, createAppState } from './state';
import SiteHeader from './components/SiteHeader.vue';
import AmbientBackdrop from './components/AmbientBackdrop.vue';
import Icon from './components/Icon.vue';
import WeeklyView from './views/WeeklyView.vue';
import SeasonView from './views/SeasonView.vue';
import FavoritesView from './views/FavoritesView.vue';
import DetailView from './views/DetailView.vue';
import './styles.css';
import './collection.css';
import './scene-visual.css';
import './visual-refresh.css';
import './header-controls.css';
import './feedback.css';
import { isListRoute } from './browse';

const state = createAppState(); provide(appKey, state);
let noticeOrigin: HTMLElement | undefined;
watch(state.notice, value => { const active = document.activeElement; if (value && active instanceof HTMLElement && !active.closest('.notice')) noticeOrigin = active; });
function closeNotice() { state.notice.value = null; void nextTick(() => { if (noticeOrigin?.isConnected) noticeOrigin.focus({ preventScroll: true }); }); }
function retireFeedback(element: Element) { element.setAttribute('inert', ''); element.setAttribute('aria-hidden', 'true'); }
const hash = ref(window.location.hash || '#/weekly');
const previousScrollRestoration = history.scrollRestoration;
history.scrollRestoration = 'manual';
let scrollFrame = 0, scrollTimer: ReturnType<typeof setTimeout> | undefined;
let pendingScroll: { route: string; top: number } | undefined;
function rememberPosition() { if (isListRoute(hash.value)) state.browse.scroll[hash.value] = window.scrollY; }
function savePendingScroll() {
  clearTimeout(scrollTimer);
  if (pendingScroll && isListRoute(pendingScroll.route)) state.browse.scroll[pendingScroll.route] = pendingScroll.top;
  pendingScroll = undefined;
}
async function restorePosition(focusContent = false) {
  const target = hash.value;
  await nextTick();
  const season = selectedSeason.value ?? state.currentSeason.value;
  if (target.startsWith('#/season') && state.browse.seasons[season]?.sort === 'rating') await state.seasonRatings.ready();
  if (target !== hash.value) return;
  cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(() => {
    if (target !== hash.value) return;
    if (focusContent) document.getElementById('content')?.focus({ preventScroll: true });
    window.scrollTo({ top: isListRoute(target) ? state.browse.scroll[target] ?? 0 : 0, behavior: 'instant' });
  });
}
function rememberNavigation(event: MouseEvent) {
  const anchor = (event.target as Element).closest?.('a[href^="#/"]');
  if (anchor && !event.ctrlKey && !event.metaKey && event.button === 0) rememberPosition();
}
function changeHash() {
  savePendingScroll();
  const next = window.location.hash || '#/weekly';
  const viewChanged = next.split('/')[1] !== hash.value.split('/')[1];
  if (next.startsWith('#/anime/') && isListRoute(hash.value)) state.browse.detailFrom = hash.value;
  if (next.startsWith('#/season') && isListRoute(next)) state.browse.lastSeason = next;
  hash.value = next;
  void state.loadPage(next).then(() => { if (hash.value === next) void restorePosition(viewChanged); });
}
function hideLeavingPage(element: Element) { element.setAttribute('hidden', ''); element.setAttribute('inert', ''); element.setAttribute('aria-hidden', 'true'); }
function showEnteringPage(element: Element) { element.removeAttribute('hidden'); element.removeAttribute('inert'); element.removeAttribute('aria-hidden'); }
function skipToContent() { const content = document.getElementById('content'); content?.focus({ preventScroll: true }); content?.scrollIntoView({ block: 'start', behavior: 'instant' }); }
function trackScroll() { pendingScroll = { route: hash.value, top: window.scrollY }; clearTimeout(scrollTimer); scrollTimer = setTimeout(savePendingScroll, 120); }
let fieldVisibilityFrame = 0;
const visualViewport = window.visualViewport;
function keepFocusedFieldVisible() {
  cancelAnimationFrame(fieldVisibilityFrame); fieldVisibilityFrame = 0;
  const field = document.activeElement;
  if (document.hidden || !(field instanceof HTMLElement) || !field.matches('input[type="search"],input[type="text"],input:not([type]),textarea')) return;
  fieldVisibilityFrame = requestAnimationFrame(() => {
    fieldVisibilityFrame = 0;
    if (document.hidden || !field.isConnected || document.activeElement !== field) return;
    const box = field.getBoundingClientRect(), viewTop = visualViewport?.offsetTop ?? 0;
    const viewBottom = viewTop + (visualViewport?.height ?? window.innerHeight);
    if (!box.height || box.bottom <= viewTop || box.top >= viewBottom) return;
    const header = document.querySelector('.site-header')?.getBoundingClientRect();
    const navigation = document.querySelector<HTMLElement>('.main-nav');
    const nav = navigation && getComputedStyle(navigation).position === 'fixed' ? navigation.getBoundingClientRect() : undefined;
    const top = Math.max(viewTop, header?.bottom ?? viewTop) + 8;
    const bottom = Math.min(viewBottom, nav && nav.bottom > viewTop && nav.top < viewBottom ? nav.top : viewBottom) - 8;
    if (bottom - top < box.height) return;
    const delta = box.bottom > bottom ? box.bottom - bottom : box.top < top ? box.top - top : 0;
    if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: 'instant' });
  });
}
window.addEventListener('resize', keepFocusedFieldVisible, { passive: true });
visualViewport?.addEventListener('resize', keepFocusedFieldVisible, { passive: true });
onUnmounted(() => { cancelAnimationFrame(fieldVisibilityFrame); window.removeEventListener('resize', keepFocusedFieldVisible); visualViewport?.removeEventListener('resize', keepFocusedFieldVisible); });
window.addEventListener('scroll', trackScroll, { passive: true }); window.addEventListener('pagehide', rememberPosition);
onUnmounted(() => { savePendingScroll(); cancelAnimationFrame(scrollFrame); history.scrollRestoration = previousScrollRestoration; window.removeEventListener('scroll', trackScroll); window.removeEventListener('pagehide', rememberPosition); });
window.addEventListener('hashchange', changeHash); onUnmounted(() => window.removeEventListener('hashchange', changeHash));
onMounted(async () => { if (hash.value.startsWith('#/season') && isListRoute(hash.value)) state.browse.lastSeason = hash.value; await state.initialize(); void restorePosition(); });
const route = computed(() => hash.value.replace(/^#/, ''));
const page = computed(() => route.value.startsWith('/anime/') ? 'detail' : route.value.startsWith('/season') ? 'season' : route.value === '/favorites' ? 'favorites' : route.value === '/weekly' || route.value === '/' ? 'weekly' : 'not-found');
const animeId = computed(() => { try { return decodeURIComponent(route.value.slice('/anime/'.length)); } catch { return ''; } });
const selectedSeason = computed(() => { const match = route.value.match(/^\/season\/(\d{4})\/([1-4])$/); return match ? `${match[1]}-${match[2]}` : undefined; });
const sourceErrors = computed(() => state.status.value ? Object.entries(state.status.value.sources).filter(([, source]) => source.error).map(([name, source]) => `${name === 'catalog' ? '基础目录' : '在播名单'}：${source.error}`) : []);
const expired = computed(() => state.status.value ? Object.values(state.status.value.sources).some(source => source.fetchedAt && Date.parse(state.now.value) - Date.parse(source.fetchedAt) > 24 * 3_600_000) : false);
function fetchedLabel(value: string | null | undefined) { return value ? new Intl.DateTimeFormat('zh-CN', { timeZone: state.timezone.value, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : '尚未获取'; }
</script>
<template>
  <a href="#content" class="skip-link" @click.prevent="skipToContent">跳转到内容</a>
  <div class="app-shell" @click.capture="rememberNavigation">
    <AmbientBackdrop />
    <SiteHeader :page="page" />
    <div class="workspace">
      <main id="content" class="main-content" tabindex="-1">
        <Transition name="feedback" :duration="{ enter: 180, leave: 120 }" @before-leave="retireFeedback" @before-enter="showEnteringPage"><div v-if="state.notice.value" class="notice" :class="state.notice.value.kind" :role="state.notice.value.kind === 'error' ? 'alert' : 'status'"><Icon name="info" :size="19" /><span>{{ state.notice.value.text }}</span><button aria-label="关闭提示" @click="closeNotice"><Icon name="close" :size="16" /></button></div></Transition>
        <div v-if="sourceErrors.length" class="source-error"><strong>部分数据更新失败，正在使用缓存。</strong><span v-for="message in sourceErrors" :key="message">{{ message }}</span><button class="text-button" :disabled="state.status.value?.refreshing" @click="state.refresh">重试获取</button></div>
        <p v-if="expired" class="stale-note">数据超过24小时未更新，请刷新核对。</p>
        <Transition name="page" :duration="{ enter: 200, leave: 0 }" @before-leave="hideLeavingPage" @before-enter="showEnteringPage"><div :key="page" class="page-view">
        <FavoritesView v-if="page === 'favorites'" />
        <SeasonView v-else-if="page === 'season'" :key="selectedSeason ?? state.currentSeason.value" :season="selectedSeason" />
        <DetailView v-else-if="page === 'detail'" :id="animeId" />
        <WeeklyView v-else-if="page === 'weekly' && state.catalog.value" />
        <div v-else-if="page === 'not-found'" class="empty-state"><h1>页面不存在</h1><a class="button" href="#/weekly">返回本周番表</a></div>
        <div v-else class="empty-state initial-state"><Icon :name="state.status.value?.refreshing || state.loading.value ? 'refresh' : 'calendar'" :size="42" :class="{ spinning: state.status.value?.refreshing }" /><h1>{{ state.status.value?.refreshing || state.loading.value ? '正在准备你的番表' : '尚无可用数据' }}</h1><p>{{ state.status.value?.refreshing ? '首次获取需要联网。完成后会自动显示番表，稍后打开会优先使用本地缓存。' : '请确认可以连接数据源，然后点击重试获取。' }}</p><button class="button primary" :disabled="state.status.value?.refreshing" @click="state.status.value ? state.refresh() : state.initialize()">{{ state.status.value?.refreshing ? '正在获取…' : '重试获取' }}</button></div>
        </div></Transition>
        <footer class="app-footer"><div class="footer-overview"><div class="footer-brand"><Icon name="calendar" :size="18" /><span>番时记</span></div><div class="footer-attribution">数据：<a href="https://bgm.tv" target="_blank" rel="noopener noreferrer">Bangumi</a><span> / </span><a href="https://github.com/bangumi-data/bangumi-data" target="_blank" rel="noopener noreferrer">bangumi-data</a><span> · </span><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a><span>（已整理）</span></div><details class="data-source"><summary>数据与来源</summary><div class="data-source-body"><dl><div><dt>目录获取</dt><dd>{{ fetchedLabel(state.status.value?.sources.catalog.fetchedAt) }}</dd></div><div><dt>在播名单获取</dt><dd>{{ fetchedLabel(state.status.value?.sources.calendar.fetchedAt) }}</dd></div></dl><p>网络先行优先；周期排期仅供参考，时间已过不代表平台已更新。播放与地区以平台为准。</p><p>目录经筛选及人工修正，历史收录不保证完整。</p><ul v-if="state.status.value?.warnings.length"><li v-for="warning in state.status.value.warnings" :key="warning">{{ warning }}</li></ul></div></details></div></footer>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref } from 'vue';
import { appKey, createAppState } from './state';
import type { Timezone } from '../shared/types';
import { seasonLabel } from '../shared/schedule';
import Icon from './components/Icon.vue';
import WeeklyView from './views/WeeklyView.vue';
import SeasonView from './views/SeasonView.vue';
import FavoritesView from './views/FavoritesView.vue';
import DetailView from './views/DetailView.vue';
import './styles.css';

const state = createAppState(); provide(appKey, state);
const hash = ref(window.location.hash || '#/weekly');
function changeHash() { hash.value = window.location.hash || '#/weekly'; }
window.addEventListener('hashchange', changeHash); onUnmounted(() => window.removeEventListener('hashchange', changeHash));
onMounted(() => { void state.initialize(); });
const route = computed(() => hash.value.replace(/^#/, ''));
const page = computed(() => route.value.startsWith('/anime/') ? 'detail' : route.value.startsWith('/season') ? 'season' : route.value === '/favorites' ? 'favorites' : route.value === '/weekly' || route.value === '/' ? 'weekly' : 'not-found');
const animeId = computed(() => { try { return decodeURIComponent(route.value.slice('/anime/'.length)); } catch { return ''; } });
const selectedSeason = computed(() => { const match = route.value.match(/^\/season\/(\d{4})\/([1-4])$/); return match ? `${match[1]}-${match[2]}` : undefined; });
const links = [{ id: 'weekly', name: '本周番表', icon: 'calendar', href: '#/weekly' }, { id: 'season', name: '季度目录', icon: 'grid', href: '#/season' }, { id: 'favorites', name: '我的追番', icon: 'bookmark', href: '#/favorites' }];
const today = computed(() => new Intl.DateTimeFormat('zh-CN', { timeZone: state.timezone.value, year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(state.now.value)));
const sourceErrors = computed(() => state.status.value ? Object.entries(state.status.value.sources).filter(([, source]) => source.error).map(([name, source]) => `${name === 'catalog' ? '基础目录' : '在播名单'}：${source.error}`) : []);
const expired = computed(() => state.status.value ? Object.values(state.status.value.sources).some(source => source.fetchedAt && Date.parse(state.now.value) - Date.parse(source.fetchedAt) > 24 * 3_600_000) : false);
function timezoneChanged(event: Event) { state.setTimezone((event.target as HTMLSelectElement).value as Timezone); }
function fetchedLabel(value: string | null | undefined) { return value ? new Intl.DateTimeFormat('zh-CN', { timeZone: state.timezone.value, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : '尚未获取'; }
</script>
<template>
  <a href="#content" class="skip-link">跳转到内容</a>
  <div class="app-shell">
    <aside class="sidebar"><a class="brand" href="#/weekly" aria-label="番时记首页"><img src="/favicon.svg" alt="" /><span>番时记<small>日本新番日历</small></span></a><div class="sidebar-section-label">发现故事</div><nav aria-label="主导航"><a v-for="link in links" :key="link.id" :href="link.href" :aria-label="link.name" :class="{ active: page === link.id }" :aria-current="page === link.id ? 'page' : undefined"><Icon :name="link.icon" :size="20" /><span>{{ link.name }}</span><span v-if="link.id === 'favorites' && state.favorites.value.length" class="nav-count">{{ state.favorites.value.length }}</span></a></nav><div class="sidebar-season"><Icon name="calendar" :size="19" /><div><strong>{{ seasonLabel(state.currentSeason.value) }}</strong><span>每一季都有新期待</span></div></div><div class="sidebar-bottom"><span class="local-dot" /><span>仅在本机运行</span><small>版本 1.0</small></div></aside>
    <div class="workspace"><header class="global-toolbar"><span class="header-date">{{ today }}</span><div class="toolbar-controls"><label class="timezone-control"><Icon name="clock" :size="16" /><select aria-label="显示时区" :value="state.timezone.value" @change="timezoneChanged"><option value="Asia/Shanghai">北京时间 UTC+8</option><option value="Asia/Tokyo">日本时间 UTC+9</option></select></label><button class="button refresh-button" aria-label="刷新数据" :disabled="state.status.value?.refreshing" @click="state.refresh"><Icon name="refresh" :size="17" :class="{ spinning: state.status.value?.refreshing }" /><span>{{ state.status.value?.refreshing ? '正在更新' : '刷新数据' }}</span></button></div></header>
      <main id="content" class="main-content" tabindex="-1">
        <div v-if="state.notice.value" class="notice" :class="state.notice.value.kind" :role="state.notice.value.kind === 'error' ? 'alert' : 'status'"><span>{{ state.notice.value.text }}</span><button aria-label="关闭提示" @click="state.notice.value = null"><Icon name="close" :size="16" /></button></div>
        <div v-if="sourceErrors.length" class="source-error"><strong>部分数据未能更新，已有数据仍可使用。</strong><span v-for="message in sourceErrors" :key="message">{{ message }}</span><button class="text-button" :disabled="state.status.value?.refreshing" @click="state.refresh">重试获取</button></div>
        <p v-if="expired" class="stale-note">数据超过24小时未成功获取，可能已经过期，请刷新后核对。</p>
        <FavoritesView v-if="page === 'favorites'" />
        <template v-else-if="state.catalog.value"><WeeklyView v-if="page === 'weekly'" /><SeasonView v-else-if="page === 'season'" :season="selectedSeason" /><DetailView v-else-if="page === 'detail'" :id="animeId" /><div v-else class="empty-state"><h1>页面不存在</h1><a class="button" href="#/weekly">返回本周番表</a></div></template>
        <div v-else class="empty-state initial-state"><Icon :name="state.status.value?.refreshing || state.loading.value ? 'refresh' : 'calendar'" :size="42" :class="{ spinning: state.status.value?.refreshing }" /><h1>{{ state.status.value?.refreshing || state.loading.value ? '正在准备你的番表' : '尚无可用数据' }}</h1><p>{{ state.status.value?.refreshing ? '首次获取需要联网。完成后会自动显示番表，稍后打开会优先使用本地缓存。' : '请确认可以连接数据源，然后点击重试获取。' }}</p><button class="button primary" :disabled="state.status.value?.refreshing" @click="state.status.value ? state.refresh() : state.initialize()">{{ state.status.value?.refreshing ? '正在获取…' : '重试获取' }}</button></div>
        <footer class="app-footer"><div><span>日本放送参考</span><span>目录获取：{{ fetchedLabel(state.status.value?.sources.catalog.fetchedAt) }}</span><span>在播名单：{{ fetchedLabel(state.status.value?.sources.calendar.fetchedAt) }}</span></div><p>数据：<a href="https://github.com/bangumi-data/bangumi-data" target="_blank" rel="noopener noreferrer">bangumi-data</a>（<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>，筛选及人工修正）与 <a href="https://bgm.tv" target="_blank" rel="noopener noreferrer">Bangumi</a>。获取时间不等于源站编辑时间。</p><details v-if="state.status.value?.warnings.length"><summary>数据说明（{{ state.status.value.warnings.length }}）</summary><ul><li v-for="warning in state.status.value.warnings" :key="warning">{{ warning }}</li></ul></details></footer>
      </main>
    </div>
  </div>
</template>

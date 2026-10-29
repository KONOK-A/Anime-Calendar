<script setup lang="ts">
import { computed } from 'vue';
import { useAppState } from '../state';
import { buildSchedule } from '../../shared/schedule';
import AnimeCard from '../components/AnimeCard.vue';
import Icon from '../components/Icon.vue';
const state = useAppState();
const preparing = computed(() => state.loading.value && !state.catalog.value);
const nextEvents = computed(() => {
  const events = state.catalog.value ? buildSchedule(state.catalog.value, { start: state.now.value, end: new Date(Date.parse(state.now.value) + 14 * 86_400_000).toISOString() }).filter(event => event.status !== 'cancelled') : [];
  return new Map(events.slice().reverse().map(event => [event.animeId, event]));
});
const items = computed(() => (state.catalog.value?.items ?? []).filter(x => state.favorites.value.includes(x.id)).sort((a, b) => (nextEvents.value.get(a.id)?.at ?? 'z').localeCompare(nextEvents.value.get(b.id)?.at ?? 'z') || a.title.localeCompare(b.title, 'zh-CN')));
const unknown = computed(() => state.favorites.value.filter(id => !state.catalog.value?.items.some(x => x.id === id)));
async function importFile(event: Event) { const input = event.target as HTMLInputElement; if (input.files?.[0]) await state.importFavorites(input.files[0]); input.value = ''; }
</script>
<template>
  <section class="favorites-page"><div class="view-heading collection-heading"><div><h1>我的追番<span class="heading-dot">.</span></h1></div><div class="backup-buttons"><label class="button import-label"><Icon name="upload" :size="16" />导入备份<input type="file" accept=".json,application/json" aria-label="导入追番备份" @change="importFile" /></label><button class="button" @click="state.downloadFavorites"><Icon name="download" :size="16" />导出备份</button></div></div>
    <div class="collection-note"><Icon name="bookmark" :size="17" /><span>{{ state.favorites.value.length }} 部追番</span><details class="backup-help"><summary>备份说明</summary><p>收藏保存在当前浏览器，可导出迁移。</p></details></div>
    <p v-if="preparing && state.favorites.value.length" class="collection-loading" role="status"><Icon name="refresh" :size="16" class="spinning" />正在准备追番列表…</p>
    <p v-else-if="!state.catalog.value" class="stale-note">目录暂不可用，可继续导出备份。</p>
    <div v-if="items.length" class="poster-grid collection-grid"><AnimeCard v-for="anime in items" :key="anime.id" :anime="anime" show-next-airing :next-event="nextEvents.get(anime.id)" /></div>
    <div v-if="!state.favorites.value.length" class="empty-state"><Icon name="bookmark" :size="42" /><h2>还没有追番作品</h2><a href="#/season" class="button primary">去季度目录看看</a></div>
    <section v-if="unknown.length && !preparing" class="orphan-list"><h2>暂时无法关联的收藏</h2><p>这些 ID 暂未匹配，已保留。</p><div v-for="id in unknown" :key="id"><code>{{ id }}</code><button class="button" :aria-label="`移除${id}`" @click="state.toggleFavorite(id)">移除</button></div></section>
  </section>
</template>

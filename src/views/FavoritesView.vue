<script setup lang="ts">
import { computed } from 'vue';
import { useAppState } from '../state';
import { buildSchedule } from '../../shared/schedule';
import AnimeCard from '../components/AnimeCard.vue';
import Icon from '../components/Icon.vue';
const state = useAppState();
const nextEvents = computed(() => state.catalog.value ? buildSchedule(state.catalog.value, { start: state.now.value, end: new Date(Date.parse(state.now.value) + 14 * 86_400_000).toISOString() }) : []);
const items = computed(() => (state.catalog.value?.items ?? []).filter(x => state.favorites.value.includes(x.id)).sort((a, b) => (nextEvents.value.find(x => x.animeId === a.id)?.at ?? 'z').localeCompare(nextEvents.value.find(x => x.animeId === b.id)?.at ?? 'z')));
const unknown = computed(() => state.favorites.value.filter(id => !state.catalog.value?.items.some(x => x.id === id)));
async function importFile(event: Event) { const input = event.target as HTMLInputElement; if (input.files?.[0]) await state.importFavorites(input.files[0]); input.value = ''; }
</script>
<template>
  <section><div class="view-heading"><div><h1>我的追番<span class="heading-dot">.</span></h1><p>把喜欢的故事，放在一起</p></div><div class="backup-buttons"><label class="button import-label"><Icon name="upload" :size="16" />导入备份<input type="file" accept=".json,application/json" aria-label="导入追番备份" @change="importFile" /></label><button class="button" @click="state.downloadFavorites"><Icon name="download" :size="16" />导出备份</button></div></div>
    <div class="collection-note"><Icon name="bookmark" :size="17" /><span>{{ state.favorites.value.length }} 部追番，保存在当前浏览器。导出备份可用于迁移和恢复。</span></div>
    <p v-if="!state.catalog.value" class="stale-note">目录暂不可用，仍可备份收藏和管理已保存的 ID。获取目录后会恢复作品信息。</p>
    <div v-if="items.length" class="poster-grid"><AnimeCard v-for="anime in items" :key="anime.id" :anime="anime" /></div>
    <div v-if="!state.favorites.value.length" class="empty-state"><Icon name="bookmark" :size="42" /><h2>还没有追番作品</h2><p>在作品卡片或详情中点击追番，喜欢的故事就会出现在这里。</p><a href="#/season" class="button primary">去季度目录看看</a></div>
    <section v-if="unknown.length" class="orphan-list"><h2>暂时无法关联的收藏</h2><p>这些 ID 未在当前目录找到，仍保留在备份中。</p><div v-for="id in unknown" :key="id"><code>{{ id }}</code><button class="button" :aria-label="`移除${id}`" @click="state.toggleFavorite(id)">移除</button></div></section>
  </section>
</template>

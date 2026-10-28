<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { seasonLabel } from '../../shared/schedule';
import { useAppState } from '../state';
import AnimeCard from '../components/AnimeCard.vue';
import Icon from '../components/Icon.vue';
const props = defineProps<{ season?: string }>(), state = useAppState();
const season = computed(() => props.season ?? state.currentSeason.value);
const year = computed(() => season.value.split('-')[0]), quarter = computed(() => season.value.split('-')[1]);
const years = computed(() => [...new Set([String(new Date(state.now.value).getUTCFullYear()), String(new Date(state.now.value).getUTCFullYear() + 1), ...(state.catalog.value?.items.map(x => x.season.split('-')[0]).filter(x => /^\d{4}$/.test(x)) ?? [])])].sort((a, b) => Number(b) - Number(a)));
const query = ref(''), type = ref(''), page = ref(1);
const matching = computed(() => (state.catalog.value?.items ?? []).filter(item => item.season === season.value && (!type.value || item.type === type.value) && (!query.value || item.aliases.concat(item.title).some(name => name.normalize('NFKC').toLocaleLowerCase().includes(query.value.normalize('NFKC').trim().toLocaleLowerCase())))).sort((a, b) => a.begin.localeCompare(b.begin) || a.id.localeCompare(b.id)));
const pages = computed(() => Math.max(1, Math.ceil(matching.value.length / 24))), visible = computed(() => matching.value.slice((page.value - 1) * 24, page.value * 24));
watch([query, type, season], () => { page.value = 1; });
function changeYear(event: Event) { window.location.hash = `#/season/${(event.target as HTMLSelectElement).value}/${quarter.value}`; }
function changeQuarter(event: Event) { window.location.hash = `#/season/${year.value}/${(event.target as HTMLSelectElement).value}`; }
</script>
<template>
  <section>
    <div class="view-heading"><div><h1>季度目录<span class="heading-dot">.</span></h1><p>从这个季度，找到你的下一部期待</p></div><span class="season-count">{{ matching.length }} <small>部作品</small></span></div>
    <div class="season-toolbar"><div class="season-switch"><select aria-label="年份" :value="year" @change="changeYear"><option v-for="value in years" :key="value" :value="value">{{ value }} 年</option></select><select aria-label="季度" :value="quarter" @change="changeQuarter"><option value="1">冬季 · 1—3月</option><option value="2">春季 · 4—6月</option><option value="3">夏季 · 7—9月</option><option value="4">秋季 · 10—12月</option></select></div><div class="catalog-filters"><label class="search-field"><Icon name="search" :size="18" /><input v-model="query" type="search" aria-label="搜索作品" placeholder="搜索标题或别名" /></label><select v-model="type" aria-label="作品类型"><option value="">全部类型</option><option value="tv">TV 动画</option><option value="web">Web 动画</option></select></div></div>
    <div class="section-heading"><h2>{{ seasonLabel(season) }}</h2><p>已收录的日本 TV / Web 动画，按首播日期排列</p></div>
    <div v-if="visible.length" class="poster-grid"><AnimeCard v-for="anime in visible" :key="anime.id" :anime="anime" /></div>
    <div v-else class="empty-state"><Icon name="search" :size="36" /><h2>{{ query || type ? '没有匹配的作品' : '这个季度暂无数据' }}</h2><p>{{ query || type ? '试试其他标题、别名，或调整筛选条件。' : '可能尚未公布或数据源尚未收录，可切换季度或刷新数据。' }}</p><button v-if="query || type" class="button" @click="query = ''; type = ''">清除筛选</button><button v-else class="button" :disabled="state.status.value?.refreshing" @click="state.refresh">刷新数据</button></div>
    <nav v-if="pages > 1" class="pagination" aria-label="作品分页"><button class="button" :disabled="page <= 1" @click="page--"><Icon name="back" :size="15" />上一页</button><span>{{ page }} / {{ pages }}</span><button class="button" :disabled="page >= pages" @click="page++">下一页<Icon name="chevron" :size="15" /></button></nav>
    <p class="schedule-disclaimer">历史目录反映数据源已收录内容，不代表完整历史库；不重建历史逐集排期。</p>
  </section>
</template>

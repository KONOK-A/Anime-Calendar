<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { seasonLabel } from '../../shared/schedule';
import { useAppState } from '../state';
import type { CatalogColumns } from '../presentation';
import AnimeCard from '../components/AnimeCard.vue';
import Icon from '../components/Icon.vue';
const props = defineProps<{ season?: string }>(), state = useAppState();
const resultsHeading = ref<HTMLElement>();
const columnOptions: { count: CatalogColumns; label: string; columns: number; rows: number }[] = [
  { count: 4, label: '舒展布局', columns: 2, rows: 2 },
  { count: 5, label: '标准布局', columns: 3, rows: 2 },
  { count: 6, label: '紧凑布局', columns: 3, rows: 3 },
];
const season = computed(() => props.season ?? state.currentSeason.value);
const year = computed(() => season.value.split('-')[0]), quarter = computed(() => season.value.split('-')[1]);
const years = computed(() => [...new Set([String(new Date(state.now.value).getUTCFullYear()), String(new Date(state.now.value).getUTCFullYear() + 1), ...(state.catalog.value?.items.map(x => x.season.split('-')[0]).filter(x => /^\d{4}$/.test(x)) ?? [])])].sort((a, b) => Number(b) - Number(a)));
watch(season, value => { state.browse.seasons[value] ??= { query: '', type: '', page: 1 }; }, { immediate: true });
const view = computed(() => state.browse.seasons[season.value]!);
const query = computed({ get: () => view.value.query, set: value => { view.value.query = value; } });
const type = computed({ get: () => view.value.type, set: value => { view.value.type = value; } });
const page = computed({ get: () => view.value.page, set: value => { view.value.page = value; } });
const matching = computed(() => (state.catalog.value?.items ?? []).filter(item => item.season === season.value && (!type.value || item.type === type.value) && (!query.value || item.aliases.concat(item.title).some(name => name.normalize('NFKC').toLocaleLowerCase().includes(query.value.normalize('NFKC').trim().toLocaleLowerCase())))).sort((a, b) => a.begin.localeCompare(b.begin) || a.id.localeCompare(b.id)));
const pages = computed(() => Math.max(1, Math.ceil(matching.value.length / 24))), visible = computed(() => matching.value.slice((page.value - 1) * 24, page.value * 24));
watch([query, type, season], (value, previous) => { if (value[2] === previous[2]) page.value = 1; });
watch([season, pages, page], () => {
  const valid = Math.max(1, Math.min(pages.value, page.value));
  if (page.value !== valid) page.value = valid;
}, { immediate: true });
function changeYear(event: Event) { window.location.hash = `#/season/${(event.target as HTMLSelectElement).value}/${quarter.value}`; }
function changeQuarter(event: Event) { window.location.hash = `#/season/${year.value}/${(event.target as HTMLSelectElement).value}`; }
async function changePage(value: number) {
  page.value = Math.max(1, Math.min(pages.value, value));
  await nextTick();
  resultsHeading.value?.focus({ preventScroll: true });
  resultsHeading.value?.scrollIntoView({ block: 'start', behavior: 'instant' });
}
</script>
<template>
  <section class="catalog-page">
    <div class="view-heading catalog-heading"><div><h1>季度目录<span class="heading-dot">.</span></h1></div><span class="season-count">{{ matching.length }} <small>部作品</small></span></div>
    <div class="season-toolbar">
      <div class="season-switch">
        <select class="catalog-picker year-picker" aria-label="年份" :value="year" @change="changeYear"><option v-for="value in years" :key="value" :value="value">{{ value }} 年</option></select>
        <select class="catalog-picker quarter-picker" aria-label="季度" :value="quarter" @change="changeQuarter"><option value="1">冬季 · 1—3月</option><option value="2">春季 · 4—6月</option><option value="3">夏季 · 7—9月</option><option value="4">秋季 · 10—12月</option></select>
      </div>
      <div class="catalog-filters">
        <label class="search-field"><Icon name="search" :size="18" /><input v-model="query" type="search" aria-label="搜索作品" placeholder="搜索本季度标题或别名" /></label>
        <select v-model="type" class="catalog-picker type-picker" aria-label="作品类型"><option value="">全部类型</option><option value="tv">TV 动画</option><option value="web">Web 动画</option></select>
        <div class="catalog-density" role="group" aria-label="每行作品数量">
          <button v-for="option in columnOptions" :key="option.count" type="button" :aria-label="`每行显示${option.count}部`" :title="option.label" :aria-pressed="state.catalogColumns.value === option.count" @click="state.setCatalogColumns(option.count)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><g v-for="row in option.rows" :key="row"><rect v-for="column in option.columns" :key="column" :x="3 + (column - 1) * (21 / option.columns)" :y="3 + (row - 1) * (21 / option.rows)" :width="21 / option.columns - 3" :height="21 / option.rows - 3" rx="1" /></g></svg>
          </button>
        </div>
      </div>
    </div>
    <div class="catalog-results"><div class="section-heading"><h2 id="season-results" ref="resultsHeading" tabindex="-1">{{ seasonLabel(season) }}</h2><p>首播顺序<span v-if="pages > 1"> · {{ page }} / {{ pages }}</span></p></div>
    <div v-if="visible.length" class="poster-grid" :style="{ '--catalog-columns': state.catalogColumns.value }"><AnimeCard v-for="anime in visible" :key="anime.id" :anime="anime" /></div>
    <div v-else class="empty-state"><Icon name="search" :size="36" /><h2>{{ query || type ? '没有匹配的作品' : '这个季度暂无数据' }}</h2><button v-if="query || type" class="button" @click="query = ''; type = ''">清除筛选</button><button v-else class="button" :disabled="state.status.value?.refreshing" @click="state.refresh">刷新数据</button></div>
    </div>
    <nav v-if="pages > 1" class="pagination" aria-label="作品分页"><button class="button" :disabled="page <= 1" @click="changePage(page - 1)"><Icon name="back" :size="15" />上一页</button><span>{{ page }} / {{ pages }}</span><button class="button" :disabled="page >= pages" @click="changePage(page + 1)">下一页<Icon name="chevron" :size="15" /></button></nav>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { RatingSummary } from '../../shared/scores';
import { ratingSourceRows } from '../rating-display';
import Icon from './Icon.vue';
import '../ratings.css';

const props = defineProps<{ summary?: RatingSummary | null; loading?: boolean; error?: string | null }>();
defineEmits<{ retry: [] }>();
const rows = computed(() => ratingSourceRows(props.summary));
const failed = computed(() => !!props.error || !!props.summary?.sources.some(source => source.status === 'unavailable'));
const notes = computed(() => rows.value.filter(row => row.note));
</script>
<template>
  <section class="rating-panel" aria-label="作品评分" :aria-busy="!!loading">
    <div class="rating-panel-heading"><h2>评分来源</h2><span v-if="loading" class="rating-panel-status" role="status">{{ summary ? '更新中' : '读取中' }}</span><span v-else-if="summary?.revalidating" class="rating-panel-status">正在更新缓存</span><button class="text-button rating-refresh" :disabled="loading" @click="$emit('retry')"><Icon name="refresh" :size="12" />{{ failed ? '重试评分' : '刷新评分' }}</button></div>
    <div class="rating-sources">
      <div v-for="row in rows" :key="row.provider" class="rating-source" :data-provider="row.provider" :class="{ 'is-missing': row.score === null }">
        <a v-if="row.url" class="rating-provider" :href="row.url" target="_blank" rel="noopener noreferrer" :title="row.note || `${row.name} 原始评分`">{{ row.name }}<Icon name="external" :size="11" /></a><span v-else class="rating-provider" :title="row.note">{{ row.name }}</span>
        <strong class="rating-source-score">{{ row.scoreLabel }}</strong><span class="rating-source-votes">{{ row.votesLabel }}</span>
      </div>
    </div>
    <p v-if="error" class="rating-load-error" role="status" :title="error">{{ summary?.count ? '评分更新失败，已保留现有评分。' : '评分暂不可用，请重试。' }}</p>
    <details class="rating-explanation"><summary>评分说明</summary><p>各站评分统一为 10 分制后等权平均，仅纳入有评分的来源。评分人数分别展示，不合并；缺少可靠人数时标为暂缺。</p><p>MAL 评分通过官方接口或作品公开页缓存读取，可能存在更新延迟。</p><p v-if="summary?.fetchedAt">资料更新于 {{ new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' }).format(new Date(summary.fetchedAt)) }}（北京时间）。</p><p v-for="row in notes" :key="row.provider">{{ row.name }}：{{ row.note }}</p><p v-if="error">{{ error }}</p></details>
  </section>
</template>

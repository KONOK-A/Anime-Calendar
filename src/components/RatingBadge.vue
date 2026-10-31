<script setup lang="ts">
import { computed } from 'vue';
import type { RatingSummary } from '../../shared/scores';
import Icon from './Icon.vue';
import '../ratings.css';

const props = withDefaults(defineProps<{ summary?: RatingSummary | null; variant?: 'card' | 'hero' | 'detail'; loading?: boolean }>(), { variant: 'card' });
const available = computed(() => props.summary?.score !== null && props.summary?.score !== undefined);
const label = computed(() => available.value ? `综合评分 ${props.summary!.score!.toFixed(1)} / 10` : props.loading ? '综合评分载入中' : '暂无综合评分');
</script>
<template>
  <span class="rating-badge" :class="[`rating-badge-${variant}`, { 'is-unrated': !available }]" :aria-label="label" :title="label">
    <Icon name="star" :size="variant === 'card' ? 11 : variant === 'hero' ? 13 : 15" />
    <strong class="rating-badge-score">{{ available ? summary!.score!.toFixed(1) : '—' }}</strong>
    <span v-if="variant === 'detail'" class="rating-badge-label">综合评分</span>
  </span>
</template>

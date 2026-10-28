<script setup lang="ts">
import { computed, ref, watch } from 'vue';
const props = defineProps<{ image?: string | null; title: string }>();
const failed = ref(false); watch(() => props.image, () => { failed.value = false; });
const source = computed(() => props.image && !failed.value ? props.image : '/poster-placeholder.svg');
</script>
<template><img class="poster" :src="source" :alt="`${title}海报`" loading="lazy" @error="failed = true" /></template>

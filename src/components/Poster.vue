<script setup lang="ts">
import { computed, ref, watch } from 'vue';
const props = defineProps<{ image?: string | null; title: string; theme?: 'light' | 'dark' }>();
const failed = ref(false); watch(() => props.image, () => { failed.value = false; });
const loaded = ref(false); watch(() => props.image, () => { loaded.value = false; });
const source = computed(() => props.image && !failed.value ? props.image : props.theme === 'dark' ? '/poster-placeholder-dark.svg' : '/poster-placeholder.svg');
const placeholder = computed(() => props.theme === 'dark' ? '/poster-placeholder-dark.svg' : '/poster-placeholder.svg');
</script>
<template><img class="poster" :class="{ 'poster-ready': loaded }" :style="{ backgroundImage: loaded ? 'none' : `url(${placeholder})`, backgroundSize: 'cover', backgroundPosition: 'center' }" :src="source" :alt="`${title}海报`" loading="lazy" @load="loaded = true" @error="failed = true; loaded = false" /></template>

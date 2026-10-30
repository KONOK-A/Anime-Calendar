<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { posterSource, type PosterSize } from '../poster-source';
const props = defineProps<{ id?: string; image?: string | null; revision?: string | null; size?: PosterSize; title: string; theme?: 'light' | 'dark'; priority?: boolean }>();
const failed = ref(false), loaded = ref(false), attempts = ref(0);
let retry: ReturnType<typeof setTimeout> | undefined;
watch([() => props.id, () => props.image, () => props.revision], () => { clearTimeout(retry); failed.value = false; loaded.value = false; attempts.value = 0; });
onUnmounted(() => clearTimeout(retry));
const remote = computed(() => posterSource(props.id, props.size ?? 'card', props.image, props.revision));
const source = computed(() => remote.value && !failed.value ? `${remote.value}${attempts.value ? `${remote.value.includes('?') ? '&' : '?'}retry=1` : ''}` : placeholder.value);
const placeholder = computed(() => props.theme === 'dark' ? '/poster-placeholder-dark.svg' : '/poster-placeholder.svg');
const highDensity = computed(() => {
  if (failed.value || props.size === 'hero' || !remote.value?.startsWith('/media/')) return undefined;
  const high = posterSource(props.id, props.size === 'thumb' ? 'card' : 'hero', props.image, props.revision)!;
  return `${source.value} 1x, ${high}${attempts.value ? `${high.includes('?') ? '&' : '?'}retry=1` : ''} 2x`;
});
function fail() {
  failed.value = true; loaded.value = false;
  if (remote.value && attempts.value === 0) retry = setTimeout(() => { attempts.value = 1; failed.value = false; }, 1500);
}
</script>
<template><img class="poster" :class="{ 'poster-ready': loaded }" :style="{ backgroundImage: loaded ? 'none' : `url(${placeholder})`, backgroundSize: 'cover', backgroundPosition: 'center' }" :src="source" :srcset="highDensity" :alt="`${title}海报`" :loading="priority ? 'eager' : 'lazy'" :fetchpriority="priority ? 'high' : 'auto'" decoding="async" @load="loaded = true" @error="fail" /></template>

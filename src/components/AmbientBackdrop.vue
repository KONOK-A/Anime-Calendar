<script setup lang="ts">
import { ref } from 'vue';
import { useMotionScope } from '../motion';
const windowElement = ref<HTMLElement>();
const active = useMotionScope(windowElement);
</script>

<template>
  <div class="ambient-backdrop" :data-motion="active ? 'running' : 'paused'" aria-hidden="true">
    <div ref="windowElement" class="ambient-window"><span class="ambient-light blue" /><span class="ambient-light rose" /><span class="ambient-beam" /></div>
    <div class="ambient-grain" /><div class="ambient-edge" />
  </div>
</template>

<style scoped>
.ambient-backdrop{position:absolute;inset:0;z-index:-1;overflow:clip;pointer-events:none;background:linear-gradient(180deg,color-mix(in srgb,var(--bg) 88%,#d6e4ff) 0,var(--bg) 900px)}
.ambient-window{position:absolute;inset:0 0 auto;height:760px;overflow:hidden;mask-image:linear-gradient(180deg,#000 48%,transparent 100%)}
.ambient-light{position:absolute;display:block;width:900px;height:760px;border-radius:50%;animation:light-drift 28s ease-in-out infinite alternate;animation-play-state:paused}
.blue{left:-300px;top:-350px;background:radial-gradient(ellipse,color-mix(in srgb,var(--frame-blue) 26%,transparent),transparent 67%)}
.rose{right:-260px;top:10px;width:1100px;height:900px;background:radial-gradient(ellipse,color-mix(in srgb,var(--frame-rose) 20%,transparent),transparent 65%);animation-duration:36s;animation-direction:alternate-reverse}
.ambient-beam{position:absolute;left:30%;top:-180px;width:440px;height:1100px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.57),transparent);transform:rotate(32deg);opacity:.8}
.ambient-grain{position:absolute;inset:0;opacity:.2;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='84' height='84'%3E%3Cg fill='%237284aa' opacity='.3'%3E%3Ccircle cx='11' cy='17' r='.5'/%3E%3Ccircle cx='47' cy='8' r='.5'/%3E%3Ccircle cx='70' cy='39' r='.5'/%3E%3Ccircle cx='29' cy='63' r='.5'/%3E%3Ccircle cx='6' cy='77' r='.5'/%3E%3Ccircle cx='61' cy='70' r='.5'/%3E%3C/g%3E%3C/svg%3E")}
.ambient-edge{position:fixed;left:0;right:0;bottom:0;height:300px;background:radial-gradient(ellipse at 70% 130%,color-mix(in srgb,var(--accent) 8%,transparent),transparent 70%)}
.ambient-backdrop[data-motion='running'] .ambient-light{animation-play-state:running}
:global([data-theme='dark'] .ambient-backdrop){background:linear-gradient(180deg,#19233d 0,var(--bg) 900px)}
:global([data-theme='dark'] .ambient-backdrop .blue){background:radial-gradient(ellipse,color-mix(in srgb,var(--frame-blue) 17%,transparent),transparent 67%)}
:global([data-theme='dark'] .ambient-backdrop .rose){background:radial-gradient(ellipse,color-mix(in srgb,var(--frame-violet) 15%,transparent),transparent 65%)}
:global([data-theme='dark'] .ambient-backdrop .ambient-beam){opacity:.13}
@keyframes light-drift{to{transform:translate(12px,10px) scale(1.035)}}
@media(max-width:767px){.ambient-window{height:650px}.blue{width:600px;left:-300px}.rose{width:650px;right:-430px}.ambient-beam{left:15%;width:180px;opacity:.35}}
@media(prefers-reduced-motion:reduce){.ambient-light{animation:none}}
</style>

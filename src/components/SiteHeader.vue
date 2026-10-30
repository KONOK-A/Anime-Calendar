<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Timezone } from '../../shared/types';
import type { ThemePreference } from '../presentation';
import { useAppState } from '../state';
import Icon from './Icon.vue';

const props = defineProps<{ page: string }>();
const state = useAppState(), navigation = ref<HTMLElement>(), sentinel = ref<HTMLElement>(), scrolled = ref(false);
const links = computed(() => [{ id: 'weekly', name: '本周番表', icon: 'calendar', href: '#/weekly' }, { id: 'season', name: '季度目录', icon: 'grid', href: state.browse.lastSeason }, { id: 'favorites', name: '我的追番', icon: 'bookmark', href: '#/favorites' }]);
const activePage = computed(() => props.page === 'detail' ? state.browse.detailFrom.split('/')[1] : props.page);
let resize: ResizeObserver | undefined, observer: IntersectionObserver | undefined, frame = 0, disposed = false;
function updateIndicator() {
  if (disposed) return;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    if (disposed) return;
    const nav = navigation.value, selected = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav) return;
    nav.style.setProperty('--indicator-visible', selected ? '1' : '0');
    if (!selected) return;
    const origin = nav.getBoundingClientRect(), box = selected.getBoundingClientRect();
    const inset = Number.parseFloat(getComputedStyle(nav).getPropertyValue('--indicator-inset')) || 0;
    nav.style.setProperty('--indicator-x', `${box.left - origin.left + inset}px`);
    nav.style.setProperty('--indicator-scale', String(Math.max(0, box.width - inset * 2) / 100));
  });
}
watch([activePage, () => state.favorites.value.length], () => { void nextTick(updateIndicator); }, { flush: 'post' });
onMounted(() => {
  resize = new ResizeObserver(updateIndicator); if (navigation.value) resize.observe(navigation.value);
  observer = new IntersectionObserver(entries => { scrolled.value = !entries.some(entry => entry.isIntersecting); });
  if (sentinel.value) observer.observe(sentinel.value);
  void document.fonts.ready.then(() => { if (!disposed) updateIndicator(); }); updateIndicator();
});
onUnmounted(() => { disposed = true; resize?.disconnect(); observer?.disconnect(); cancelAnimationFrame(frame); });
function timezoneChanged(event: Event) { state.setTimezone((event.target as HTMLSelectElement).value as Timezone); }
function themeChanged(event: Event) { state.appearance.setTheme((event.target as HTMLSelectElement).value as ThemePreference); }
</script>

<template>
  <span ref="sentinel" class="header-sentinel" aria-hidden="true" />
  <header class="site-header lightframe-header" :class="{ 'is-scrolled': scrolled }"><div class="header-inner">
    <a class="brand" href="#/weekly" aria-label="番时记首页"><span class="brand-mark"><Icon name="calendar" :size="23" /><i /></span><span>番时记<small>日本新番日历</small></span></a>
    <nav ref="navigation" class="main-nav" aria-label="主导航"><span class="nav-indicator" aria-hidden="true" /><a v-for="link in links" :key="link.id" :href="link.href" :aria-label="link.name" :class="{ active: activePage === link.id }" :aria-current="activePage === link.id ? 'page' : undefined"><Icon :name="link.icon" :size="19" /><span>{{ link.name }}</span><span v-if="link.id === 'favorites' && state.favorites.value.length" class="nav-count">{{ state.favorites.value.length }}</span></a></nav>
    <div class="toolbar-controls"><label class="timezone-control"><Icon name="clock" :size="16" /><select aria-label="显示时区" :value="state.timezone.value" @change="timezoneChanged"><option value="Asia/Shanghai">北京 UTC+8</option><option value="Asia/Tokyo">日本 UTC+9</option></select></label><label class="theme-control"><Icon :name="state.appearance.theme.value === 'dark' ? 'moon' : 'sun'" :size="17" /><select aria-label="页面主题" :value="state.appearance.preference.value" @change="themeChanged"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label><button class="button refresh-button" aria-label="刷新数据" :disabled="state.status.value?.refreshing" @click="state.refresh"><Icon name="refresh" :size="17" :class="{ spinning: state.status.value?.refreshing }" /><span>{{ state.status.value?.refreshing ? '正在更新' : '刷新数据' }}</span></button></div>
  </div></header>
</template>

<style scoped>
.header-sentinel{position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none}
.lightframe-header{height:76px;background:color-mix(in srgb,var(--surface) 76%,transparent);border-bottom:1px solid color-mix(in srgb,var(--line) 75%,transparent);backdrop-filter:blur(18px);box-shadow:none;transition:background-color .2s,box-shadow .2s}
.lightframe-header.is-scrolled{background:var(--glass);box-shadow:0 5px 24px color-mix(in srgb,var(--ink) 5%,transparent)}
.header-inner{min-height:76px;height:76px;gap:32px;max-width:1600px;padding:0 40px}
.brand{gap:11px}
.brand-mark{position:relative;width:39px;height:43px;border-radius:12px;border-color:color-mix(in srgb,var(--accent) 45%,var(--surface));background:linear-gradient(145deg,var(--surface),var(--soft));box-shadow:inset 0 1px 0 var(--surface-glint),0 4px 10px color-mix(in srgb,var(--accent) 9%,transparent);transform:rotate(-7deg)}
.brand-mark i{position:absolute;right:-3px;top:-3px;width:7px;height:7px;border:2px solid var(--surface);border-radius:50%;background:var(--warm)}
.brand>span:last-child{font-size:29px;letter-spacing:3px}.brand small{font-size:10px;letter-spacing:1.5px;margin-top:5px}
.main-nav{--indicator-inset:12;position:relative;display:flex;gap:4px;height:76px;min-height:0;padding:0;align-self:stretch;background:transparent;border:0}
.main-nav>a{z-index:1;gap:7px;padding:0 13px;min-height:0;font-size:14px;font-weight:550;transition:color .16s}
.main-nav>a:hover{color:var(--accent)}.main-nav>a.active:after{display:none}
.nav-indicator{position:absolute;left:0;bottom:12px;width:100px;height:3px;border-radius:3px;background:var(--frame-gradient);transform:translateX(var(--indicator-x,0px)) scaleX(var(--indicator-scale,0));transform-origin:left;opacity:var(--indicator-visible,0);transition:transform .24s cubic-bezier(.22,1,.36,1),opacity .16s;pointer-events:none}
.nav-count{font-size:10px;padding:0 5px;background:var(--soft)}
.toolbar-controls{gap:7px}.toolbar-controls>label{height:38px;border-radius:10px;background:color-mix(in srgb,var(--surface) 85%,transparent)}
.toolbar-controls select{height:36px;color:var(--muted)}.toolbar-controls .refresh-button{height:38px;min-height:38px;border-radius:10px;padding:6px 12px}
@media(min-width:901px) and (max-width:1199px){.header-inner{padding:0 28px;gap:16px}.main-nav>a{padding:0 9px;font-size:13px}.toolbar-controls{gap:5px}.toolbar-controls .refresh-button span{display:none}.toolbar-controls .refresh-button{padding:6px 10px}}
@media(max-width:900px){
  .lightframe-header{backdrop-filter:none}
  .header-inner{padding:0 28px;gap:12px}.main-nav{--indicator-inset:6;position:fixed;left:12px;right:12px;bottom:calc(10px + var(--safe-area-bottom));top:auto;width:auto;height:64px;min-height:64px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));padding:6px;gap:0;border:1px solid var(--line);border-radius:20px;background:var(--glass);backdrop-filter:blur(18px);box-shadow:0 8px 32px color-mix(in srgb,var(--ink) 12%,transparent);z-index:40}
  .main-nav>a{min-height:50px;padding:4px;flex-direction:column;justify-content:center;gap:2px;font-size:12px}.main-nav svg{width:18px;height:18px}.nav-count{top:3px;left:calc(50% + 10px)}
  .nav-indicator{height:50px;bottom:6px;border-radius:13px;background:var(--soft);box-shadow:inset 0 1px 0 var(--overlay-line)}
}
@media(max-width:767px){
  .lightframe-header,.header-inner{height:68px;min-height:68px}.header-inner{padding:0 16px;gap:8px}.brand{gap:7px}.brand-mark{width:28px;height:32px;border-radius:9px}.brand>span:last-child{font-size:24px;letter-spacing:1px}.brand small{display:none}
  .toolbar-controls{gap:5px}.toolbar-controls>label{height:44px}.toolbar-controls select{height:42px;font-size:11px}.toolbar-controls .timezone-control select{width:94px}.toolbar-controls .theme-control select{width:76px}.toolbar-controls .refresh-button{height:44px;min-height:44px;min-width:40px;padding:6px;border:0}.refresh-button span{display:none}
}
@media(max-width:379px){.brand-mark{display:none}.brand>span:last-child{font-size:22px}.header-inner{gap:6px}.toolbar-controls{gap:4px}.toolbar-controls .timezone-control select{width:84px}.toolbar-controls .theme-control select{width:76px;padding-left:8px}.toolbar-controls .theme-control>svg{display:none}.toolbar-controls .refresh-button{min-width:40px}}
@media(prefers-reduced-motion:reduce){.nav-indicator,.lightframe-header{transition:none}}
</style>

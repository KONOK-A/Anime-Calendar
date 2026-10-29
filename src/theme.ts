import { computed, onUnmounted, ref, watch } from 'vue';
import { readThemePreference, resolveTheme, type ThemePreference } from './presentation';

export function useTheme(notify: (text: string) => void) {
  const preference = ref(readThemePreference(document.documentElement.dataset.themePreference ?? null));
  const media = window.matchMedia('(prefers-color-scheme: dark)'), reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const systemDark = ref(media.matches), reducedMotion = ref(reduced.matches);
  const theme = computed(() => resolveTheme(preference.value, systemDark.value));
  const updateSystem = () => { systemDark.value = media.matches; }, updateMotion = () => { reducedMotion.value = reduced.matches; };
  media.addEventListener('change', updateSystem); reduced.addEventListener('change', updateMotion);
  watch(theme, value => {
    document.documentElement.dataset.theme = value;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value === 'dark' ? '#121D30' : '#F4F8FB');
  }, { immediate: true, flush: 'sync' });
  function setTheme(value: ThemePreference) {
    preference.value = value; document.documentElement.dataset.themePreference = value;
    try { window.localStorage.setItem('anime-calendar:theme', value); }
    catch { notify('主题已切换，但偏好未保存；下次打开将使用原设置。'); }
  }
  onUnmounted(() => { media.removeEventListener('change', updateSystem); reduced.removeEventListener('change', updateMotion); });
  return { preference, theme, reducedMotion, setTheme };
}

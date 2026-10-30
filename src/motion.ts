import { computed, nextTick, onMounted, onUnmounted, ref, watch, type Ref, type WatchSource } from 'vue';
import { useAppState } from './state';

export function useMotionScope(element: Ref<HTMLElement | undefined>) {
  const state = useAppState(), inView = ref(false), visible = ref(!document.hidden);
  const active = computed(() => inView.value && visible.value && !state.appearance.reducedMotion.value);
  let observer: IntersectionObserver | undefined;
  const visibilityChanged = () => { visible.value = !document.hidden; };
  onMounted(() => {
    observer = new IntersectionObserver(entries => { inView.value = entries.some(entry => entry.isIntersecting); });
    if (element.value) observer.observe(element.value);
    document.addEventListener('visibilitychange', visibilityChanged);
  });
  onUnmounted(() => { observer?.disconnect(); document.removeEventListener('visibilitychange', visibilityChanged); });
  return active;
}

export function usePointerLight(element: Ref<HTMLElement | undefined>, enabled: () => boolean) {
  const state = useAppState();
  let frame = 0, point: { x: number; y: number } | undefined;
  function reset() {
    cancelAnimationFrame(frame); frame = 0; point = undefined;
    element.value?.style.removeProperty('--pointer-x');
    element.value?.style.removeProperty('--pointer-y');
    element.value?.style.removeProperty('--tilt-x');
    element.value?.style.removeProperty('--tilt-y');
    element.value?.removeAttribute('data-pointer');
  }
  function move(event: PointerEvent) {
    if (!enabled() || state.appearance.reducedMotion.value || event.pointerType === 'touch' || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    point = { x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const target = element.value;
      if (!target || !point) return;
      const box = target.getBoundingClientRect();
      const x = Math.max(0, Math.min(box.width, point.x - box.left)), y = Math.max(0, Math.min(box.height, point.y - box.top));
      target.style.setProperty('--pointer-x', `${x}px`); target.style.setProperty('--pointer-y', `${y}px`);
      target.style.setProperty('--tilt-x', `${(0.5 - y / box.height) * 1.6}deg`);
      target.style.setProperty('--tilt-y', `${(x / box.width - 0.5) * 1.6}deg`);
      target.setAttribute('data-pointer', 'active');
    });
  }
  watch(() => state.appearance.reducedMotion.value, reduced => { if (reduced) reset(); });
  onUnmounted(reset);
  return { move, reset };
}

export function animateSaved(button: HTMLElement | undefined, reduced: boolean): Animation | undefined {
  if (!button || reduced) return;
  return button.animate([
    { transform: 'scale(1)' }, { transform: 'scale(.82)', offset: .25 },
    { transform: 'scale(1.12)', offset: .65 }, { transform: 'scale(1)' },
  ], { duration: 300, easing: 'cubic-bezier(.22,1,.36,1)' });
}

/** Animate the visible part of a keyed list; data and interaction update immediately. */
export function useListMotion(element: Ref<HTMLElement | undefined>, source: WatchSource) {
  const state = useAppState(), animations = new Set<Animation>();
  let revision = 0, disposed = false;
  function cancel() { for (const animation of animations) animation.cancel(); animations.clear(); }
  function visible() {
    const result: { card: HTMLElement; box: DOMRect }[] = [];
    for (const card of element.value?.querySelectorAll<HTMLElement>('.anime-card') ?? []) {
      const box = card.getBoundingClientRect();
      if (box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight) result.push({ card, box });
      if (result.length === 20) break;
    }
    return result;
  }
  watch(source, async () => {
    const current = ++revision;
    if (state.appearance.reducedMotion.value || document.hidden) { cancel(); return; }
    const before = new Map(visible().map(({ card, box }) => [card, box]));
    cancel();
    await nextTick();
    if (disposed || current !== revision || document.hidden || state.appearance.reducedMotion.value) return;
    let entering = 0;
    const targets = visible().map(({ card, box }) => ({ card, box, old: before.get(card) }));
    for (const { card, box, old } of targets) {
      if (typeof card.animate !== 'function') continue;
      let frames: Keyframe[], delay = 0;
      if (old) {
        const dx = old.left - box.left, dy = old.top - box.top;
        const sx = old.width / box.width, sy = old.height / box.height;
        if (Math.abs(dx) < .5 && Math.abs(dy) < .5 && Math.abs(sx - 1) < .005 && Math.abs(sy - 1) < .005) continue;
        frames = [{ transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})`, transformOrigin: 'top left' }, { transform: 'none', transformOrigin: 'top left' }];
      } else {
        delay = Math.min(entering++, 7) * 12;
        frames = [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }];
      }
      const animation = card.animate(frames, { duration: 220, delay, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' });
      animations.add(animation);
      void animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
    }
  }, { flush: 'pre' });
  watch(() => state.appearance.reducedMotion.value, reduced => { if (reduced) cancel(); });
  const hidden = () => { if (document.hidden) cancel(); };
  onMounted(() => document.addEventListener('visibilitychange', hidden));
  onUnmounted(() => { disposed = true; revision++; cancel(); document.removeEventListener('visibilitychange', hidden); });
  return { settled: () => Promise.allSettled([...animations].map(animation => animation.finished)) };
}

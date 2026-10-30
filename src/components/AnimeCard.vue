<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { AiringEvent, Anime, AnimeRating } from '../../shared/types';
import { dateKey, formatClock } from '../../shared/schedule';
import { useAppState } from '../state';
import Poster from './Poster.vue';
import Icon from './Icon.vue';
import { animateSaved, usePointerLight } from '../motion';
const props = defineProps<{ anime: Anime; ratingOverride?: AnimeRating | null; event?: AiringEvent; compact?: boolean; showNextAiring?: boolean; nextEvent?: AiringEvent; lightframe?: boolean; showcase?: boolean }>();
const state = useAppState(), element = ref<HTMLElement>();
const saveButton = ref<HTMLElement>();
const framed = computed(() => !!(props.lightframe || props.showcase || !props.compact));
const pointer = usePointerLight(element, () => framed.value);
let feedback: Animation | undefined;
watch(() => state.appearance.reducedMotion.value, reduced => { if (reduced) feedback?.cancel(); });
async function toggleSaved() {
  const previous = saved.value;
  await state.toggleFavorite(props.anime.id);
  if (previous !== saved.value && framed.value) { feedback?.cancel(); feedback = animateSaved(saveButton.value, state.appearance.reducedMotion.value); }
}
const detail = computed(() => state.details.get(props.anime.id));
const rating = computed(() => props.ratingOverride === undefined ? detail.value?.rating : props.ratingOverride);
const saved = computed(() => state.favorites.value.includes(props.anime.id));
const eventNote = computed(() => {
  if (!props.event) return '';
  return props.event.note || (props.event.status === 'cancelled' ? '本次休播' : props.anime.networkAiring ? '网络先行' : '');
});
const nextLabel = computed(() => {
  if (!props.nextEvent) return '14天内暂无排期';
  const key = dateKey(props.nextEvent.at, state.timezone.value), today = dateKey(state.now.value, state.timezone.value);
  const day = key === today ? '今天' : `${Number(key.slice(5, 7))}月${Number(key.slice(8))}日`;
  return `${day} ${formatClock(props.nextEvent.at, state.timezone.value)}`;
});
const nextWeekday = computed(() => props.nextEvent ? new Intl.DateTimeFormat('zh-CN', { timeZone: state.timezone.value, weekday: 'long' }).format(new Date(props.nextEvent.at)).replace('星期', '周') : '');
const beginDate = computed(() => {
  const begin = props.anime.networkAiring?.begin ?? props.anime.begin;
  return begin.includes('T') && Number.isFinite(Date.parse(begin)) ? dateKey(begin, state.timezone.value) : begin || '日期待定';
});
let observer: IntersectionObserver | undefined;
onMounted(() => {
  observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { void state.loadDetail(props.anime.id); observer?.disconnect(); } }, { rootMargin: '180px' });
  if (element.value) observer.observe(element.value);
});
onUnmounted(() => { observer?.disconnect(); feedback?.cancel(); });
</script>
<template>
  <article ref="element" class="anime-card" :data-anime-id="anime.id" :class="{ compact, cancelled: event?.status === 'cancelled', 'lightframe-schedule': lightframe, 'lightframe-poster': !compact && !showNextAiring, 'lightframe-collection': showNextAiring }" @pointermove="pointer.move" @pointerleave="pointer.reset">
    <span v-if="framed" class="card-edge-glow" aria-hidden="true" />
    <div v-if="event" class="event-time"><time :datetime="event.at">{{ formatClock(event.at, state.timezone.value) }}</time><span v-if="event.status === 'cancelled' || event.basis !== 'estimated'" class="basis" :class="{ official: event.basis === 'official', hiatus: event.status === 'cancelled' }">{{ event.status === 'cancelled' ? '休播' : event.basis === 'official' ? '公告' : '来源排期' }}</span></div>
    <a :href="`#/anime/${anime.id}`" :aria-label="`查看${anime.title}${showcase ? '海报' : ''}详情`" class="anime-link">
      <div class="poster-frame"><Poster :id="anime.id" :revision="detail?.detailFetchedAt" :size="compact ? 'thumb' : 'card'" :image="detail?.image" :title="anime.title" :theme="state.appearance.theme.value" /><span v-if="!compact && rating" class="card-rating" :aria-label="`Bangumi评分 ${rating.score.toFixed(1)}`"><Icon name="star" :size="12" />{{ rating.score.toFixed(1) }}</span></div>
      <div class="card-copy"><h3 :title="anime.title">{{ anime.title }}</h3><p v-if="!compact && anime.originalTitle !== anime.title" class="original-title" :title="anime.originalTitle">{{ anime.originalTitle }}</p><div class="card-tags"><span>{{ anime.type.toUpperCase() }}</span><span v-if="event && anime.season !== state.currentSeason.value" class="continuing">续播</span><span v-if="!event && !showNextAiring">{{ beginDate.replaceAll('-', '.') }}</span><span v-if="compact && rating" class="card-rating compact-rating" :aria-label="`Bangumi评分 ${rating.score.toFixed(1)}`"><Icon name="star" :size="11" />{{ rating.score.toFixed(1) }}</span></div></div>
      <div v-if="showNextAiring" class="next-airing" :class="{ pending: !nextEvent }"><span><Icon name="clock" :size="13" />{{ nextEvent ? '下次放送' : '排期参考' }}</span><p v-if="nextEvent"><span class="next-date">{{ nextLabel.split(' ')[0] }}</span>{{ ' ' }}<time :datetime="nextEvent.at">{{ formatClock(nextEvent.at, state.timezone.value) }}</time></p><p v-else>{{ nextLabel }}</p><small v-if="nextEvent" class="next-weekday">{{ nextWeekday }}<span v-if="nextEvent.basis !== 'estimated'"> · {{ nextEvent.basis === 'official' ? '公告' : '来源排期' }}</span></small></div>
    </a>
    <div v-if="eventNote" class="event-footnote">{{ eventNote }}</div>
    <button ref="saveButton" class="save-card" :class="{ saved }" :aria-label="`${saved ? '取消追番' : '追番'}${anime.title}`" :aria-pressed="saved" @click="toggleSaved"><Icon name="bookmark" :size="17" /></button>
  </article>
</template>

<style scoped>
.card-edge-glow{display:none;position:absolute;inset:0;pointer-events:none;border:1px solid transparent;border-radius:inherit;overflow:hidden;z-index:3;opacity:0;transition:opacity .18s,display .18s allow-discrete;mask:linear-gradient(#fff 0 0) padding-box,linear-gradient(#fff 0 0);mask-composite:exclude}
.card-edge-glow:before{content:'';position:absolute;left:0;top:0;width:220px;height:220px;background:radial-gradient(circle,var(--frame-blue),var(--frame-violet) 25%,var(--frame-rose) 42%,transparent 65%);transform:translate(calc(var(--pointer-x,0px) - 110px),calc(var(--pointer-y,0px) - 110px))}
[data-pointer='active']>.card-edge-glow{display:block;opacity:1}
@starting-style{[data-pointer='active']>.card-edge-glow{opacity:0}}
.anime-card.lightframe-poster{padding:var(--poster-inset,8px) var(--poster-inset,8px) 0;border-radius:20px;border:1px solid var(--line);background:linear-gradient(150deg,var(--surface),color-mix(in srgb,var(--surface) 92%,var(--accent)));box-shadow:0 10px 24px -15px color-mix(in srgb,var(--accent) 30%,transparent),inset 0 1px 0 var(--surface-glint);overflow:hidden;transition:transform .18s cubic-bezier(.22,1,.36,1),border-color .18s,box-shadow .18s}
.lightframe-poster .anime-link{display:flex;flex-direction:column;height:100%}
.lightframe-poster .poster-frame{border-radius:12px;overflow:hidden;position:relative;aspect-ratio:5/7;transform:perspective(900px) rotateX(var(--tilt-x,0deg)) rotateY(var(--tilt-y,0deg));transition:transform .22s ease-out}
.lightframe-poster .poster{width:100%;height:100%;object-fit:cover;border-radius:0;transition:transform .36s cubic-bezier(.22,1,.36,1),opacity .2s}
.lightframe-poster .poster-frame:after{content:'';position:absolute;inset:0;background:linear-gradient(125deg,rgba(255,255,255,.14),transparent 35%,transparent 74%,rgba(255,255,255,.09));pointer-events:none}
.lightframe-poster .card-copy{padding:var(--poster-copy-padding,16px 9px 14px);display:flex;flex-direction:column;flex:1;position:relative}
.lightframe-poster .card-copy h3{font-size:var(--poster-title-size,16px);line-height:1.55;font-weight:650;min-height:3.1em;margin:0}
.lightframe-poster .original-title{font-size:12px;margin:7px 0 14px;line-height:1.6}
.lightframe-poster .card-tags{padding:11px 0 0;margin-top:auto;background:none;border-top:1px solid var(--line);border-radius:0;gap:10px;font-size:12px;align-items:center}
.lightframe-poster .card-tags>span:first-child{background:var(--soft);padding:1px 5px;border-radius:4px;font-size:11px;color:var(--accent)}
.lightframe-poster .save-card{right:calc(var(--poster-inset,8px) + 8px);top:calc(var(--poster-inset,8px) + 8px);width:36px;height:36px;border-radius:10px;background:var(--glass);border:1px solid var(--overlay-line);color:var(--ink);box-shadow:0 3px 12px rgba(20,33,60,.13)}
.lightframe-poster .save-card.saved{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.lightframe-poster .card-rating{left:8px;top:8px;background:var(--glass);padding:5px 7px;border:1px solid var(--overlay-line);font-size:12px;border-radius:8px}
.lightframe-poster .anime-link:focus-visible{outline-offset:-3px;border-radius:12px}
.anime-card.lightframe-schedule{position:relative;min-width:0;margin:0;display:block;padding:var(--schedule-padding,12px);border:1px solid color-mix(in srgb,var(--accent) 10%,var(--line));border-radius:13px;background:linear-gradient(145deg,var(--surface) 70%,color-mix(in srgb,var(--surface) 96%,var(--accent)));box-shadow:0 7px 18px -12px color-mix(in srgb,var(--accent) 18%,transparent);transition:transform .18s,border-color .18s,box-shadow .18s}
.lightframe-schedule .event-time{display:flex;flex-wrap:wrap;align-items:center;gap:5px;min-height:27px;margin-bottom:var(--schedule-time-gap,12px);padding-right:30px}
.lightframe-schedule .event-time time{color:var(--accent);font-weight:650;letter-spacing:-.6px;font-size:var(--schedule-clock-size,20px);margin-right:auto;line-height:1.65}
.lightframe-schedule .event-time:before{content:'';width:3px;height:14px;background:linear-gradient(var(--frame-blue),var(--frame-violet) 52%,var(--frame-rose));border-radius:2px;margin-right:2px;flex-shrink:0}
.lightframe-schedule .anime-link{display:flex;gap:9px;align-items:flex-start}
.lightframe-schedule .poster-frame{width:var(--schedule-poster-size,48px);min-width:var(--schedule-poster-size,48px);flex:0 0 var(--schedule-poster-size,48px);border-radius:6px;overflow:hidden;background:var(--soft);box-shadow:0 3px 6px rgba(26,46,88,.09)}
.lightframe-schedule .poster{width:var(--schedule-poster-size,48px);min-width:var(--schedule-poster-size,48px);aspect-ratio:5/7;border-radius:0}
.lightframe-schedule .card-copy{min-width:0}.lightframe-schedule .card-copy h3{font-size:13px;font-weight:550;line-height:1.6;margin:0;-webkit-line-clamp:3}
.lightframe-schedule .card-tags{margin-top:5px;gap:4px;font-size:10px}
.lightframe-schedule .basis{font-size:10px;color:var(--muted)}.lightframe-schedule .basis.official{color:var(--accent)}.lightframe-schedule .basis.hiatus{color:var(--error)}
.lightframe-schedule .save-card{position:absolute;right:10px;top:11px;bottom:auto;left:auto;display:grid;place-items:center;width:26px;height:26px;margin:0;padding:0;border:0;border-radius:7px;background:var(--soft);color:var(--muted)}
.lightframe-schedule .save-card svg{width:15px;height:15px}.lightframe-schedule .save-card.saved{background:var(--accent);color:var(--accent-ink);box-shadow:0 2px 6px color-mix(in srgb,var(--accent) 24%,transparent)}.lightframe-schedule .save-card.saved svg{fill:currentColor}
.lightframe-schedule .event-footnote{font-size:11px;line-height:1.7;margin-top:9px;padding:0;color:var(--muted)}
.lightframe-schedule:focus-within{border-color:var(--accent)}
.anime-card.lightframe-collection{position:relative;min-width:0;overflow:hidden;border:1px solid var(--line);border-radius:19px;background:linear-gradient(140deg,var(--surface),color-mix(in srgb,var(--surface) 94%,var(--accent)));box-shadow:0 12px 28px -20px color-mix(in srgb,var(--accent) 32%,transparent),inset 0 1px 0 var(--surface-glint);transition:transform .18s,border-color .18s,box-shadow .18s}
.lightframe-collection .anime-link{display:grid;grid-template-columns:96px minmax(0,1fr);gap:0 18px;align-items:center;padding:16px}
.lightframe-collection .poster-frame{grid-column:1;grid-row:1 / span 2;position:relative;aspect-ratio:5/7;padding:4px;border:1px solid var(--line);border-radius:11px;background:var(--surface);box-shadow:0 5px 10px rgba(22,47,91,.09);overflow:hidden;align-self:center}
.lightframe-collection .poster{width:100%;height:100%;border-radius:6px;object-fit:cover}
.lightframe-collection .card-copy{min-width:0;padding:0 38px 0 0}.lightframe-collection .card-copy h3{font-size:17px;line-height:1.5;font-weight:650;margin:0;-webkit-line-clamp:2}
.lightframe-collection .original-title{font-size:12px;line-height:1.6;margin-top:7px}.lightframe-collection .card-tags{font-size:11px;margin-top:7px}
.lightframe-collection .card-rating{position:absolute;left:7px;top:7px;display:flex;align-items:center;gap:3px;padding:3px 5px;border-radius:6px;font-size:11px;font-weight:650;color:var(--rating);background:var(--glass)}
.lightframe-collection .save-card{position:absolute;right:15px;top:15px;display:grid;place-items:center;width:32px;height:32px;border:1px solid var(--accent);border-radius:10px;background:var(--accent);color:var(--accent-ink)}.lightframe-collection .save-card.saved svg{fill:currentColor}
.lightframe-collection .next-airing{grid-column:2;min-width:0;margin:12px 0 0;padding:10px 0 0;border-top:1px solid var(--line)}
.lightframe-collection .next-airing>span{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted)}
.lightframe-collection .next-airing p{display:flex;align-items:baseline;flex-wrap:wrap;gap:0 10px;margin:3px 0 0;line-height:1.5;font-size:13px;color:var(--ink);font-variant-numeric:tabular-nums}
.lightframe-collection .next-airing time{font-size:23px;font-weight:650;letter-spacing:-.6px;color:var(--accent)}
.lightframe-collection .next-weekday{display:block;font-size:11px;color:var(--muted);margin-top:3px}.lightframe-collection .next-airing.pending p{font-size:13px;color:var(--muted)}
.collection-grid[data-size='featured'] .lightframe-collection .anime-link{grid-template-columns:148px minmax(0,1fr) minmax(210px,.38fr);gap:24px;padding:18px}
.collection-grid[data-size='featured'] .lightframe-collection .card-copy{padding:0}
.collection-grid[data-size='featured'] .lightframe-collection .poster-frame{grid-row:1}
.lightframe-collection .anime-link{scroll-margin-block:12px}
.collection-grid[data-size='featured'] .lightframe-collection .card-copy h3{font-size:24px;line-height:1.45}
.collection-grid[data-size='featured'] .lightframe-collection .original-title{font-size:13px;margin-top:12px}
.collection-grid[data-size='featured'] .lightframe-collection .next-airing{grid-column:3;grid-row:1;margin:0;padding:18px 20px 18px 28px;border-top:0;border-left:1px solid var(--line)}
.collection-grid[data-size='featured'] .lightframe-collection .next-airing p{display:block;margin-top:9px}.collection-grid[data-size='featured'] .next-date{display:block;font-size:14px}.collection-grid[data-size='featured'] .lightframe-collection .next-airing time{display:block;font-size:36px;line-height:1.4}
.collection-grid[data-size='featured'] .lightframe-collection .save-card{top:18px;right:18px;width:36px;height:36px}
.lightframe-collection:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--soft)}
@media(hover:hover) and (pointer:fine){.anime-card.lightframe-collection:hover{transform:translateY(-3px);border-color:var(--accent);box-shadow:0 0 16px color-mix(in srgb,var(--accent) 13%,transparent),0 12px 24px -18px var(--accent)}}
@media(max-width:1099px){.collection-grid[data-size='featured'] .lightframe-collection .poster-frame{grid-row:1 / span 2}.collection-grid[data-size='featured'] .lightframe-collection .anime-link{grid-template-columns:124px minmax(0,1fr);gap:0 18px;padding:16px}.collection-grid[data-size='featured'] .lightframe-collection .card-copy{padding-right:38px}.collection-grid[data-size='featured'] .lightframe-collection .card-copy h3{font-size:20px}.collection-grid[data-size='featured'] .lightframe-collection .next-airing{grid-column:2;grid-row:2;border-left:0;border-top:1px solid var(--line);padding:10px 0 0;margin-top:12px}.collection-grid[data-size='featured'] .lightframe-collection .next-airing p{display:flex;margin-top:3px}.collection-grid[data-size='featured'] .lightframe-collection .next-airing time{font-size:26px}.collection-grid[data-size='featured'] .next-date{display:inline;font-size:13px}}
.anime-card.lightframe-poster:active{transform:scale(.985)}
@media(hover:hover) and (pointer:fine){
  .anime-card.lightframe-poster:hover{transform:translateY(-4px);border-color:var(--accent);box-shadow:0 0 18px color-mix(in srgb,var(--accent) 17%,transparent),0 15px 28px -14px color-mix(in srgb,var(--accent) 34%,transparent)}
  .lightframe-poster:hover .poster{transform:scale(1.025)}
  .lightframe-poster:hover h3{color:var(--accent)}
  .lightframe-schedule:hover{border-color:var(--accent);transform:translateY(-2px)}
}
@media(max-width:767px){
  .lightframe-poster .save-card:after,.lightframe-schedule .save-card:after,.lightframe-collection .save-card:after{content:'';position:absolute;inset:-8px;border-radius:inherit}
  .anime-card.lightframe-poster{--poster-inset:6px;padding:6px 6px 0;border-radius:15px}.lightframe-poster .poster-frame{border-radius:9px}.lightframe-poster .card-copy{padding:12px 5px}.lightframe-poster .card-copy h3{font-size:14px}.lightframe-poster .original-title{font-size:11px;margin:6px 0 10px}.lightframe-poster .card-tags{font-size:11px;gap:6px}.lightframe-poster .save-card{width:32px;height:32px}.lightframe-poster .card-rating{font-size:11px;padding:3px 5px}
  .lightframe-schedule .poster-frame,.lightframe-schedule .poster{width:54px;min-width:54px;flex-basis:54px}.lightframe-schedule .event-time time{font-size:22px}.lightframe-schedule .save-card{width:28px;height:28px}.lightframe-schedule .anime-link{gap:12px}.lightframe-schedule .card-copy h3{font-size:14px;-webkit-line-clamp:2}.lightframe-schedule .card-tags{font-size:11px;margin-top:6px}
}
@media(max-width:767px){
  .anime-card.lightframe-collection{border-radius:15px}
  .lightframe-collection .anime-link,.collection-grid[data-size='featured'] .lightframe-collection .anime-link{grid-template-columns:88px minmax(0,1fr);gap:0 13px;padding:12px}
  .lightframe-collection .card-copy,.collection-grid[data-size='featured'] .lightframe-collection .card-copy{padding-right:31px}
  .lightframe-collection .card-copy h3,.collection-grid[data-size='featured'] .lightframe-collection .card-copy h3{font-size:16px;line-height:1.5}
  .lightframe-collection .original-title,.collection-grid[data-size='featured'] .lightframe-collection .original-title{font-size:11px;margin-top:5px}
  .lightframe-collection .card-tags{margin-top:5px;font-size:10px}
  .lightframe-collection .next-airing,.collection-grid[data-size='featured'] .lightframe-collection .next-airing{margin-top:9px;padding-top:8px}
  .lightframe-collection .next-airing time,.collection-grid[data-size='featured'] .lightframe-collection .next-airing time{font-size:21px}
  .lightframe-collection .next-airing p{font-size:12px;gap:0 7px}
  .lightframe-collection .next-weekday{font-size:10px;margin-top:2px}
  .lightframe-collection .save-card,.collection-grid[data-size='featured'] .lightframe-collection .save-card{top:11px;right:10px;width:28px;height:28px;border-radius:8px}.lightframe-collection .save-card svg{width:15px;height:15px}
}
@media(prefers-reduced-motion:reduce){.lightframe-collection{transition:none!important;transform:none!important}
.lightframe-poster,.lightframe-schedule,.lightframe-poster *,.card-edge-glow{transition:none!important;animation:none!important}.lightframe-poster .poster-frame,.lightframe-poster:hover .poster,.anime-card.lightframe-poster:hover,.anime-card.lightframe-poster:active{transform:none!important}.card-edge-glow{display:none}}
</style>

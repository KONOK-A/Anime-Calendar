<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useAppState } from '../state';
import { dateKey, formatClock, seasonLabel } from '../../shared/schedule';
import { splitSynopsis } from '../../shared/synopsis';
import type { AiringRule } from '../../shared/types';
import Poster from '../components/Poster.vue';
import { posterSource } from '../poster-source';
import Icon from '../components/Icon.vue';
import SceneBackdrop from '../components/SceneBackdrop.vue';
import { animateSaved } from '../motion';
import '../detail-credits.css';
const props = defineProps<{ id: string }>(), state = useAppState();
const anime = computed(() => state.catalog.value?.items.find(x => x.id === props.id));
const detail = computed(() => state.details.get(props.id));
const detailError = computed(() => state.detailErrors.get(props.id) || detail.value?.detailError);
const ratingStatus = computed(() => state.detailLoading.has(props.id) ? '评分载入中' : detail.value?.rating === undefined && detail.value ? '请重启本地服务获取评分' : detailError.value ? '评分暂不可用' : '暂无评分');
const synopsis = computed(() => splitSynopsis(detail.value?.summary ?? ''));
const credits = computed(() => state.credits.get(props.id));
const staff = computed(() => credits.value?.staff ?? detail.value?.staff ?? []);
const cast = computed(() => credits.value?.cast ?? []);
const creditsError = computed(() => state.creditsErrors.get(props.id) || Object.values(credits.value?.sources ?? {}).map(source => source.error).filter(Boolean).join(' '));
const saved = computed(() => state.favorites.value.includes(props.id));
const backLabel = computed(() => state.browse.detailFrom.startsWith('#/season') ? '返回季度目录' : state.browse.detailFrom === '#/favorites' ? '返回我的追番' : '返回番表');
const allCharacters = ref(false);
const platformsHeading = ref<HTMLElement>();
const followButton = ref<HTMLElement>();
let feedback: Animation | undefined;
const entryReady = ref(false);
let entryVersion = 0, entryTimer: ReturnType<typeof setTimeout> | undefined;
async function toggleSaved() { const id = props.id, before = saved.value; await state.toggleFavorite(id); if (id === props.id && before !== saved.value) { feedback?.cancel(); feedback = animateSaved(followButton.value, state.appearance.reducedMotion.value); } }
watch(() => state.appearance.reducedMotion.value, reduced => { if (reduced) feedback?.cancel(); });
onUnmounted(() => { feedback?.cancel(); clearTimeout(entryTimer); entryVersion++; });
function hideWash(event: Event) { if (event.currentTarget instanceof HTMLImageElement) event.currentTarget.hidden = true; }
function showPlatforms() { platformsHeading.value?.focus({ preventScroll: true }); platformsHeading.value?.scrollIntoView({ block: 'start', behavior: 'instant' }); }
watch([() => props.id, () => anime.value?.id], ([id]) => {
  allCharacters.value = false; clearTimeout(entryTimer);
  const version = ++entryVersion;
  entryReady.value = state.details.has(id) || state.detailErrors.has(id);
  if (!anime.value) return;
  const task = state.detailErrors.has(id) ? Promise.resolve() : state.loadDetail(id);
  if (!entryReady.value) {
    const reveal = () => { if (version === entryVersion && props.id === id) { clearTimeout(entryTimer); entryReady.value = true; } };
    // Coalesce cached data into the first paint; slow upstream data never blocks base information.
    entryTimer = setTimeout(reveal, 160); void task.then(reveal);
  }
  void state.loadCredits(id);
}, { immediate: true });
function dateLabel(value: string) { return value.includes('T') ? `${dateKey(value, state.timezone.value)} ${formatClock(value, state.timezone.value)}` : value || '待定'; }
function describeRule(rule: AiringRule | undefined) {
  if (!rule?.anchor) return '时间待定';
  const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: state.timezone.value, weekday: 'long' }).format(new Date(rule.anchor));
  return rule.frequency === 'weekly' ? `每${weekday} ${formatClock(rule.anchor, state.timezone.value)}` : rule.frequency === 'daily' ? `每天 ${formatClock(rule.anchor, state.timezone.value)}` : rule.frequency === 'once' ? '仅有单次 / 首播排期' : '来源周期暂不支持自动推算';
}
const ruleLabel = computed(() => describeRule(anime.value?.rule));
const broadcastLabel = computed(() => describeRule(anime.value?.broadcastRule));
async function retryDetail() {
  const id = props.id;
  await state.loadDetail(id, true);
  if (!state.detailErrors.has(id) && !state.details.get(id)?.detailError) await state.loadCredits(id, true);
}
function expandCharacters(event: Event) {
  allCharacters.value = (event.target as HTMLDetailsElement).open;
  if (allCharacters.value) void state.loadCharacterNames(props.id, true);
}
</script>
<template>
  <section class="detail-page"><a :href="state.browse.detailFrom" class="back-link"><Icon name="back" :size="16" />{{ backLabel }}</a>
    <div v-if="anime && entryReady" class="detail-layout">
      <header class="detail-hero"><div class="detail-image-wash" aria-hidden="true"><img v-if="detail?.image" :key="`${id}:${detail.image}`" :src="posterSource(id, 'hero', detail.image, detail.detailFetchedAt) ?? undefined" alt="" @error="hideWash" /></div><SceneBackdrop variant="detail" :media-type="anime.type" :season="anime.season" /><div class="detail-cover"><Poster :id="id" :revision="detail?.detailFetchedAt" size="hero" :image="detail?.image" :title="anime.title" :theme="state.appearance.theme.value" priority /></div>
        <div class="detail-heading"><div class="detail-kicker"><span class="type-badge">{{ anime.type.toUpperCase() }}</span><span>{{ seasonLabel(anime.season) }}</span><span v-if="detail?.episodes">{{ detail.episodes }} 集</span></div><h1>{{ anime.title }}</h1><p class="detail-original">{{ anime.originalTitle }}</p><div class="detail-rating-row"><a v-if="detail?.rating" class="detail-rating" :href="anime.sourceUrl" target="_blank" rel="noopener noreferrer" title="Bangumi 评分"><Icon name="star" :size="17" /><strong>{{ detail.rating.score.toFixed(1) }}</strong><span class="rating-scale">/10</span><span>Bangumi评分</span><span class="rating-votes">{{ detail.rating.total.toLocaleString('zh-CN') }} 人</span><span v-if="detail.rating.rank" class="rating-rank">排名 {{ detail.rating.rank }}</span></a><span v-else class="detail-rating unrated"><Icon name="star" :size="15" />{{ ratingStatus }}</span></div><p class="detail-airing-summary"><Icon name="clock" :size="17" />{{ ruleLabel }}<span v-if="anime.networkAiring" class="network-badge">网络先行</span></p>
          <div class="detail-actions"><button ref="followButton" class="button primary follow-button" :class="{ followed: saved }" :aria-pressed="saved" @click="toggleSaved"><Icon :name="saved ? 'check' : 'bookmark'" :size="18" />{{ saved ? '已在追番' : '加入追番' }}</button><button v-if="anime.platforms.length" class="button website-button" @click="showPlatforms">查看播放平台<Icon name="chevron" :size="15" /></button><a v-if="anime.officialSite" class="button website-button" :href="anime.officialSite" target="_blank" rel="noopener noreferrer">作品官网<Icon name="external" :size="15" /></a></div>
          <div class="detail-tags"><span v-for="tag in (detail?.tags ?? [])" :key="tag">{{ tag }}</span></div>
        </div>
      </header>
      <div class="detail-content">
        <section class="detail-section story-section"><h2>故事简介</h2><p v-if="synopsis.summary" class="synopsis">{{ synopsis.summary }}</p><details v-if="synopsis.original" :key="`original-${id}`" class="synopsis-original"><summary>简介原文</summary><p class="synopsis" lang="ja">{{ synopsis.original }}</p></details><div v-if="!detail?.summary && state.detailLoading.has(id)" class="loading-copy">正在读取作品信息…</div><p v-else-if="!detail?.summary && !detailError" class="muted">暂无简介。</p><div v-if="detailError" class="inline-error"><p>{{ detailError }}</p><button class="text-button" :disabled="state.detailLoading.has(id)" @click="retryDetail">重试详情</button></div></section>
        <aside class="detail-reference" aria-label="放送与播放平台">
        <section class="detail-section airing-section"><h2>放送信息</h2><dl class="detail-facts"><div><dt>默认播出时间</dt><dd>{{ ruleLabel }}</dd></div><div v-if="anime.networkAiring"><dt>采用平台</dt><dd><a :href="anime.networkAiring.sourceUrl" target="_blank" rel="noopener noreferrer">{{ anime.networkAiring.platform }}</a>（{{ anime.networkAiring.regions.length ? anime.networkAiring.regions.join(' / ') : '地区以平台为准' }}）</dd></div><div v-if="anime.networkAiring"><dt>网络开播日期</dt><dd>{{ dateLabel(anime.networkAiring.begin) }}</dd></div><div v-if="anime.networkAiring"><dt>原放送参考</dt><dd>{{ broadcastLabel }}</dd></div><div><dt>原来源开播日期</dt><dd>{{ dateLabel(anime.begin) }}</dd></div><div><dt>当前显示时区</dt><dd>{{ state.timezone.value === 'Asia/Shanghai' ? '北京时间 UTC+8' : '日本时间 UTC+9' }}</dd></div><div><dt>条目收录集数</dt><dd>{{ detail?.episodes ? `${detail.episodes} 集` : '尚未收录' }}</dd></div></dl><details class="schedule-basis"><summary>排期依据</summary><p>周期排期按来源推算，实际安排以官网为准。</p><p v-if="anime.scheduleNote" class="source-note">{{ anime.scheduleNote }} <a :href="anime.scheduleSource" target="_blank" rel="noopener noreferrer">查看依据</a></p></details></section>
        <section class="detail-section platforms-section"><h2 ref="platformsHeading" tabindex="-1">播放平台 <span class="heading-count">{{ anime.platforms.length }}</span></h2><div v-if="anime.platforms.length" class="platform-list"><a v-for="platform in anime.platforms" :key="`${platform.name}:${platform.url}:${platform.regions.join(',')}`" :href="platform.url" target="_blank" rel="noopener noreferrer"><span><strong>{{ platform.name }}</strong><small>{{ platform.regions.length ? `地区：${platform.regions.join(' / ')}` : '地区限制以平台为准' }}</small></span><Icon name="external" :size="16" /></a></div><p v-else class="muted">尚未收录播放平台，可前往作品官网查看。</p></section>
        </aside>
        <section class="detail-section credits-section" aria-label="制作与角色配音">
          <div class="credit-columns"><section><h2>制作阵容</h2><dl v-if="staff.length" class="staff-list"><div v-for="entry in staff" :key="entry.role"><dt>{{ entry.role }}</dt><dd>{{ entry.names.join('、') }}</dd></div></dl><p v-else class="muted">{{ state.creditsLoading.has(id) ? '正在读取制作资料…' : '暂未收录制作资料。' }}</p></section>
            <section><h2>主要角色与 CV <span v-if="cast.length" class="heading-count">{{ cast.length }}</span></h2><ul v-if="cast.length" class="cast-list"><li v-for="character in cast.slice(0, 8)" :key="character.id"><span class="cast-character"><a :href="`https://bgm.tv/character/${character.id}`" :title="character.originalName" target="_blank" rel="noopener noreferrer">{{ character.name }}</a><small>{{ character.relation }}</small></span><span class="cast-actors"><template v-for="(actor, index) in character.actors" :key="actor.id"><span v-if="index"> / </span><a :href="`https://bgm.tv/person/${actor.id}`" target="_blank" rel="noopener noreferrer">{{ actor.name }}</a></template><span v-if="!character.actors.length" class="muted">CV 暂未收录</span></span></li></ul>
              <details v-if="cast.length > 8" :key="`cast-${id}`" class="more-cast" @toggle="expandCharacters"><summary>展开其余 {{ cast.length - 8 }} 名角色</summary><ul class="cast-list"><li v-for="character in cast.slice(8)" :key="character.id"><span class="cast-character"><a :href="`https://bgm.tv/character/${character.id}`" :title="character.originalName" target="_blank" rel="noopener noreferrer">{{ character.name }}</a><small>{{ character.relation }}</small></span><span class="cast-actors"><template v-for="(actor, index) in character.actors" :key="actor.id"><span v-if="index"> / </span><a :href="`https://bgm.tv/person/${actor.id}`" target="_blank" rel="noopener noreferrer">{{ actor.name }}</a></template><span v-if="!character.actors.length" class="muted">CV 暂未收录</span></span></li></ul></details>
              <p v-if="!cast.length" class="muted">{{ state.creditsLoading.has(id) ? '正在读取角色配音…' : '暂未收录主要角色的配音信息。' }}</p>
              <p v-if="state.characterNamesLoading.has(id)" class="muted small">正在补充中文角色名…</p><div v-if="state.characterNameErrors.get(id)" class="inline-error"><p>{{ state.characterNameErrors.get(id) }}</p><button class="text-button" :disabled="state.characterNamesLoading.has(id)" @click="state.loadCharacterNames(id, allCharacters)">重试中文角色名</button></div>
            </section></div>
          <div v-if="creditsError" class="inline-error"><p>{{ creditsError }}</p><button class="text-button" :disabled="state.creditsLoading.has(id)" @click="state.loadCredits(id, true)">重试制作与配音资料</button></div>
        </section>
        <p class="detail-source"><a :href="anime.sourceUrl" target="_blank" rel="noopener noreferrer">来源条目</a></p>
      </div></div>
    <div v-else-if="anime" class="detail-entry-loading" role="status"><span class="entry-cover" aria-hidden="true" /><div><p>正在读取作品信息…</p><i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" /></div></div>
    <div v-else-if="state.loading.value" class="detail-entry-loading" role="status"><span class="entry-cover" aria-hidden="true" /><div><p>正在读取作品信息…</p><i aria-hidden="true" /><i aria-hidden="true" /></div></div>
    <div v-else-if="state.viewError.value && !state.catalog.value" class="empty-state"><h1>暂时无法读取作品</h1><button class="button" @click="state.retryView">重试获取</button></div>
    <div v-else class="empty-state"><Icon name="search" :size="36" /><h1>没有找到这部作品</h1><p>当前目录未收录该作品。</p><a class="button" href="#/season">返回季度目录</a></div>
  </section>
</template>

<style scoped>
.detail-entry-loading{display:grid;grid-template-columns:184px minmax(0,1fr);align-items:center;gap:34px;min-height:350px;padding:30px 36px;border:1px solid var(--line);border-radius:23px;background:linear-gradient(120deg,var(--surface),var(--soft));color:var(--muted);font-size:13px}.entry-cover{display:block;width:184px;aspect-ratio:5/7;border-radius:12px;background:linear-gradient(140deg,var(--soft),var(--surface))}.detail-entry-loading i{display:block;height:12px;margin-top:20px;border-radius:4px;background:var(--soft)}.detail-entry-loading i:nth-of-type(2){width:80%}.detail-entry-loading i:nth-of-type(3){width:55%}
.back-link{display:inline-flex;align-items:center;gap:7px;min-height:36px;padding:5px 0;color:var(--muted);font-size:13px}.back-link:hover{color:var(--accent)}
.detail-hero{position:relative;isolation:isolate;min-height:350px;padding:30px 36px;gap:34px;border-radius:23px;border:1px solid color-mix(in srgb,var(--accent) 20%,var(--line));background:linear-gradient(115deg,var(--surface) 25%,var(--soft));box-shadow:0 16px 40px -28px var(--accent)}
.detail-image-wash{position:absolute;z-index:0;inset:0;overflow:hidden;border-radius:inherit;opacity:.24;mask-image:linear-gradient(90deg,transparent 25%,#000 100%);pointer-events:none}
.detail-image-wash img{position:absolute;inset:-8% -4% -8% 34%;width:70%;height:116%;object-fit:cover;filter:blur(2.2px) saturate(1.08)}
.detail-hero:after{content:'';position:absolute;inset:0;z-index:0;background:linear-gradient(90deg,color-mix(in srgb,var(--surface) 98%,transparent) 28%,color-mix(in srgb,var(--surface) 75%,transparent) 64%,transparent);pointer-events:none}
.detail-hero :deep(.scene-backdrop){z-index:1;opacity:1;background:transparent;pointer-events:none;mask-image:linear-gradient(90deg,transparent 48%,#000 76%)}
.detail-cover{position:relative;z-index:1;width:184px;padding:7px;border:1px solid color-mix(in srgb,var(--surface) 85%,var(--line));border-radius:13px;transform:rotate(-2deg);box-shadow:0 15px 24px -10px color-mix(in srgb,var(--ink) 27%,transparent);background:var(--surface)}
.detail-cover :deep(.poster){border-radius:7px}
.detail-heading{position:relative;z-index:1;max-width:850px}.detail-heading h1{font-size:34px;line-height:1.45;letter-spacing:.2px}
.detail-kicker{font-size:12px;gap:12px}.detail-kicker .type-badge{padding:2px 7px;border-radius:5px;background:var(--surface);border:1px solid var(--line)}
.detail-original{font-size:13px;overflow-wrap:anywhere}.detail-rating-row{margin-top:13px}.detail-rating strong{font-size:26px}.detail-airing-summary{margin-top:15px}
.detail-actions{gap:9px;margin-top:18px}.detail-actions .button{border-radius:10px;min-height:44px;background:var(--glass)}.detail-actions .primary{background:var(--accent)}
.detail-tags{min-height:24px;gap:6px;margin-top:14px}.detail-tags>span{max-width:100%;overflow-wrap:anywhere;font-size:11px;line-height:1.65;padding:2px 7px;border-radius:5px;background:var(--glass)}
.detail-section h2{display:flex;align-items:center;gap:8px}.detail-section h2:before{content:'';width:3px;height:17px;flex-shrink:0;border-radius:2px;background:linear-gradient(180deg,var(--frame-blue),var(--frame-violet) 52%,var(--frame-rose))}
.synopsis{font-size:15px;line-height:2.05}.detail-facts{font-size:13px;gap:14px}.detail-facts>div{grid-template-columns:108px minmax(0,1fr)}
.platform-list a{border-radius:11px;padding:13px;background:var(--surface);box-shadow:0 5px 13px -12px var(--accent);transition:border-color .16s,transform .16s,box-shadow .16s}.platform-list a:hover{border-color:var(--accent);transform:translateY(-2px)}
.platform-list strong{font-size:13px;font-weight:550}.platform-list small{font-size:11px;line-height:1.75}
.synopsis-original,.more-cast{border-radius:11px}.synopsis-original[open]>.synopsis,.more-cast[open]>.cast-list{animation:detail-reveal .18s ease-out}
@keyframes detail-reveal{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
@media(max-width:1199px){.detail-hero{padding:26px 28px;gap:26px}.detail-cover{width:162px}.detail-heading h1{font-size:29px}}
@media(max-width:767px){
 .detail-entry-loading{grid-template-columns:92px minmax(0,1fr);gap:16px;min-height:230px;padding:20px 17px;border-radius:18px}.entry-cover{width:92px}
 .detail-hero :deep(.scene-backdrop){z-index:0;opacity:.55}.detail-hero :deep(.broadcast-edition){display:none}
 .detail-hero{display:grid;grid-template-columns:92px minmax(0,1fr);padding:20px 17px;gap:6px 16px;min-height:0;align-items:start;border-radius:18px}.detail-cover{grid-column:1;grid-row:1 / span 4;width:92px;padding:4px;margin-top:0;border-radius:10px}.detail-cover :deep(.poster){border-radius:5px}
 .detail-heading{display:contents}.detail-heading>*{position:relative;z-index:1}.detail-kicker{grid-column:2;grid-row:1}.detail-heading h1{grid-column:2;grid-row:2}.detail-original{grid-column:2;grid-row:3}.detail-rating-row{grid-column:2;grid-row:4}.detail-airing-summary{grid-column:1 / -1;grid-row:5}.detail-actions{grid-column:1 / -1;grid-row:6}.detail-tags{grid-column:1 / -1;grid-row:7}
 .detail-heading h1{font-size:23px;line-height:1.5}.detail-kicker{font-size:10px;gap:6px;margin-bottom:8px}.detail-original{font-size:11px}.detail-rating-row{margin-top:8px}.detail-rating strong{font-size:23px}.detail-airing-summary{font-size:11px;margin-top:12px;gap:5px}
 .detail-actions{margin-top:14px;gap:7px}.detail-actions .button{min-height:44px;padding:7px 10px;font-size:11px;gap:5px}.detail-tags{gap:5px;min-height:24px;margin-top:12px}.detail-tags>span{font-size:10px;padding:1px 5px}
 .detail-kicker,.detail-original,.detail-rating-row{margin:0}.detail-airing-summary{margin-top:4px}.detail-airing-summary>svg{display:block}.detail-actions{margin-top:6px}.detail-tags{margin-top:2px}
 .detail-section h2{font-size:23px}.synopsis{font-size:14px;line-height:2}.detail-facts>div{grid-template-columns:102px minmax(0,1fr)}.platform-list a{padding:11px;gap:6px}.platform-list strong{font-size:12px}
}
@media(prefers-reduced-motion:reduce){.platform-list a:hover{transform:none}.synopsis-original[open]>.synopsis,.more-cast[open]>.cast-list{animation:none}}
</style>

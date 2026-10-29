<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useAppState } from '../state';
import { dateKey, formatClock, seasonLabel } from '../../shared/schedule';
import { splitSynopsis } from '../../shared/synopsis';
import type { AiringRule } from '../../shared/types';
import Poster from '../components/Poster.vue';
import Icon from '../components/Icon.vue';
import SceneBackdrop from '../components/SceneBackdrop.vue';
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
function showPlatforms() { platformsHeading.value?.focus({ preventScroll: true }); platformsHeading.value?.scrollIntoView({ block: 'start', behavior: 'instant' }); }
watch(() => props.id, id => { allCharacters.value = false; if (anime.value) { void state.loadDetail(id); void state.loadCredits(id); } }, { immediate: true });
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
    <div v-if="anime" class="detail-layout">
      <header class="detail-hero"><SceneBackdrop variant="detail" :media-type="anime.type" :season="anime.season" /><div class="detail-cover"><Poster :image="detail?.image" :title="anime.title" :theme="state.appearance.theme.value" /></div>
        <div class="detail-heading"><div class="detail-kicker"><span class="type-badge">{{ anime.type.toUpperCase() }}</span><span>{{ seasonLabel(anime.season) }}</span><span v-if="detail?.episodes">{{ detail.episodes }} 集</span></div><h1>{{ anime.title }}</h1><p class="detail-original">{{ anime.originalTitle }}</p><div class="detail-rating-row"><a v-if="detail?.rating" class="detail-rating" :href="anime.sourceUrl" target="_blank" rel="noopener noreferrer" title="Bangumi 评分"><Icon name="star" :size="17" /><strong>{{ detail.rating.score.toFixed(1) }}</strong><span class="rating-scale">/10</span><span>Bangumi评分</span><span class="rating-votes">{{ detail.rating.total.toLocaleString('zh-CN') }} 人</span><span v-if="detail.rating.rank" class="rating-rank">排名 {{ detail.rating.rank }}</span></a><span v-else class="detail-rating unrated"><Icon name="star" :size="15" />{{ ratingStatus }}</span></div><p class="detail-airing-summary"><Icon name="clock" :size="17" />{{ ruleLabel }}<span v-if="anime.networkAiring" class="network-badge">网络先行</span></p>
          <div class="detail-actions"><button class="button primary follow-button" :class="{ followed: saved }" @click="state.toggleFavorite(anime.id)"><Icon :name="saved ? 'check' : 'bookmark'" :size="18" />{{ saved ? '已在追番' : '加入追番' }}</button><button v-if="anime.platforms.length" class="button website-button" @click="showPlatforms">查看播放平台<Icon name="chevron" :size="15" /></button><a v-if="anime.officialSite" class="button website-button" :href="anime.officialSite" target="_blank" rel="noopener noreferrer">作品官网<Icon name="external" :size="15" /></a></div>
          <div v-if="detail?.tags.length" class="detail-tags"><span v-for="tag in detail.tags" :key="tag">{{ tag }}</span></div>
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
    <div v-else class="empty-state"><Icon name="search" :size="36" /><h1>没有找到这部作品</h1><p>当前目录未收录该作品。</p><a class="button" href="#/season">返回季度目录</a></div>
  </section>
</template>

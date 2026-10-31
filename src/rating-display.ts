import type { AnimeRating } from '../shared/types';
import { ratingProviders, type ProviderRating, type RatingSummary } from '../shared/scores';

export interface RatingSourceRow extends ProviderRating { name: string; scoreLabel: string; votesLabel: string; note: string }

export function resolveRatingSummary(override: RatingSummary | null | undefined, live: RatingSummary | null | undefined, rating: AnimeRating | null | undefined, url: string, fetchedAt: string | null | undefined): RatingSummary | null {
  if (override !== undefined) return override;
  if (live) return live;
  if (!rating || !Number.isFinite(rating.score) || rating.score <= 0 || rating.score > 10) return null;
  return { score: rating.score, count: 1, fetchedAt: fetchedAt ?? null, sources: [{ provider: 'bangumi', score: rating.score, maxScore: 10, votes: rating.total, url, fetchedAt: fetchedAt ?? null, status: 'ready' }] };
}

const providers = {
  bangumi: { name: 'Bangumi', maxScore: 10 },
  mal: { name: 'MyAnimeList', maxScore: 10 },
  filmarks: { name: 'Filmarks', maxScore: 5 },
  anilist: { name: 'AniList', maxScore: 100 },
} as const;
const statuses = { ready: '', unrated: '暂无评分', unlinked: '未关联', unavailable: '暂不可用', disabled: '未启用' };

export function ratingSourceRows(summary: RatingSummary | null | undefined): RatingSourceRow[] {
  return ratingProviders.map(provider => {
    const info = providers[provider], actual = summary?.sources.find(source => source.provider === provider);
    const source: ProviderRating = actual ?? { provider, score: null, maxScore: info.maxScore, votes: null, url: null, fetchedAt: null, status: 'unavailable' };
    const note = source.status === 'disabled' && provider === 'anilist' ? 'AniList 当前未启用，暂不参与综合评分。' : source.error || (!actual ? '该来源的评分资料尚未取得。' : '');
    const score = source.score !== null && Number.isInteger(source.score) && source.maxScore !== 100 ? source.score.toFixed(1) : String(source.score);
    return { ...source, name: info.name, scoreLabel: source.status === 'ready' && source.score !== null ? `${score} / ${source.maxScore}` : actual ? statuses[source.status] : '待获取', votesLabel: source.votes === null ? '评分人数暂缺' : `${source.votes.toLocaleString('zh-CN')} 人评分`, note };
  });
}

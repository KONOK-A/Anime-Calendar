import type { Anime } from '../shared/types.js';
import { isRecord } from './normalize.js';

interface ExternalLink { id: number; sourceUrl: string }
export interface RatingLink {
  filmarks?: { seriesId: number; seasonId: number };
  mal?: ExternalLink; aniList?: ExternalLink;
}
const validId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** Reviewed identities only. Resolving a score never performs a title search. */
export function normalizeRatingLinks(input: unknown): Map<string, RatingLink> {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.links)) throw new Error('关联格式无效');
  const links = new Map<string, RatingLink>();
  for (const entry of input.links) {
    if (!isRecord(entry) || typeof entry.animeId !== 'string' || !/^bgm:[1-9]\d*$/.test(entry.animeId) || links.has(entry.animeId)) throw new Error('评分关联条目无效');
    const link: RatingLink = {};
    if (entry.filmarks !== undefined) {
      if (!isRecord(entry.filmarks)) throw new Error('Filmarks 评分关联无效');
      const { seriesId, seasonId } = entry.filmarks;
      if (!validId(seriesId) || !validId(seasonId) || entry.sourceUrl !== `https://filmarks.com/animes/${seriesId}/${seasonId}`) throw new Error('Filmarks 评分关联来源不符');
      link.filmarks = { seriesId, seasonId };
    }
    for (const provider of ['mal', 'aniList'] as const) {
      if (entry[provider] === undefined) continue;
      const value = entry[provider], origin = provider === 'mal' ? 'https://myanimelist.net/anime/' : 'https://anilist.co/anime/';
      if (!isRecord(value) || !validId(value.id) || value.sourceUrl !== `${origin}${value.id}`) throw new Error('评分关联ID或来源不符');
      link[provider] = { id: value.id, sourceUrl: value.sourceUrl };
    }
    if (!link.filmarks && !link.mal && !link.aniList) throw new Error('评分关联缺少来源');
    links.set(entry.animeId, link);
  }
  return links;
}

export function applyRatingLinks(items: Anime[], links: ReadonlyMap<string, RatingLink>, warnings: string[]): Anime[] {
  return items.map(item => {
    const link = links.get(item.id); if (!link) return item;
    const conflict = (['mal', 'aniList'] as const).find(provider => item.externalIds?.[provider] && link[provider] && item.externalIds[provider] !== link[provider]!.id);
    if (conflict) { warnings.push(`评分关联冲突：${item.title}（${conflict}），已保留基础目录的条目，暂不补齐其他评分关联。`); return item; }
    let added = false;
    const externalIds = { ...item.externalIds };
    for (const provider of ['mal', 'aniList'] as const) {
      const id = link[provider]?.id; if (!id) continue;
      if (!externalIds[provider]) { externalIds[provider] = id; added = true; }
    }
    return added ? { ...item, externalIds } : item;
  });
}

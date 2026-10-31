import { isRecord } from './normalize.js';

export interface ParsedRating { score: number | null; votes: number | null }
export interface FilmarksLink { seriesId: number; seasonId: number }
const votes = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
function score(value: unknown, max: number): number | null {
  if (value === undefined || value === null || value === 0) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new Error('评分数值无效');
  return value;
}
export function parseMalRating(raw: unknown, id: number, mode: 'official' | 'jikan'): ParsedRating {
  const data = mode === 'jikan' && isRecord(raw) ? raw.data : raw;
  if (!isRecord(data) || data[mode === 'jikan' ? 'mal_id' : 'id'] !== id) throw new Error('MAL 作品身份不匹配');
  const count = votes(data[mode === 'jikan' ? 'scored_by' : 'num_scoring_users']);
  return { score: count === 0 ? null : score(data[mode === 'jikan' ? 'score' : 'mean'], 10), votes: count };
}
export function parseAniListRating(raw: unknown, id: number): ParsedRating {
  if (!isRecord(raw) || raw.errors !== undefined || !isRecord(raw.data) || !isRecord(raw.data.Media) || raw.data.Media.id !== id || raw.data.Media.type !== 'ANIME') throw new Error('AniList 作品响应无效');
  const media = raw.data.Media, stats = isRecord(media.stats) ? media.stats : {};
  let count: number | null = null;
  if (Array.isArray(stats.scoreDistribution) && stats.scoreDistribution.length) {
    const seen = new Set<number>(); let total = 0, valid = true;
    for (const entry of stats.scoreDistribution) {
      if (!isRecord(entry) || typeof entry.score !== 'number' || !Number.isInteger(entry.score) || entry.score < 10 || entry.score > 100 || entry.score % 10 !== 0 || seen.has(entry.score) || votes(entry.amount) === null) { valid = false; break; }
      seen.add(entry.score); total += Number(entry.amount);
    }
    if (valid && Number.isSafeInteger(total)) count = total;
  }
  return { score: count === 0 ? null : score(media.averageScore, 100), votes: count };
}
const attributes = (tag: string) => new Map([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(match => [match[1].toLowerCase(), match[2] ?? match[3]]));
export function parseMalPageRating(html: string, id: number): ParsedRating {
  if (html.length > 2 * 1024 * 1024) throw new Error('MAL 页面过大');
  const content = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const title = content.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? '';
  if (/\b(?:just a moment|verify you are human|access denied|attention required|login|log in|sign in)\b/i.test(title) || /<form\b[^>]*\bid=["']challenge-form["']/i.test(content)) throw new Error('MAL 页面需要验证或登录');
  const canonicals = [...content.matchAll(/<link\b[^>]*>/gi)].map(match => attributes(match[0])).filter(attrs => attrs.get('rel')?.toLowerCase() === 'canonical');
  if (!Number.isSafeInteger(id) || id <= 0 || canonicals.length !== 1) throw new Error('MAL 作品身份不匹配');
  let canonical: URL;
  try { canonical = new URL(canonicals[0].get('href') ?? ''); } catch { throw new Error('MAL 作品身份不匹配'); }
  if (canonical.protocol !== 'https:' || canonical.hostname !== 'myanimelist.net' || canonical.port || canonical.username || canonical.password || canonical.search || canonical.hash || !new RegExp(`^/anime/${id}(?:/[^/]+)?/?$`).test(canonical.pathname)) throw new Error('MAL 作品身份不匹配');
  const aggregates = [...content.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)].filter(match => attributes(match[0]).get('itemprop') === 'aggregateRating');
  if (!aggregates.length) throw new Error('MAL 页面缺少作品聚合评分，保留已有资料');
  if (aggregates.length !== 1) throw new Error('MAL 聚合评分结构无效');
  const aggregate = aggregates[0], attrs = attributes(aggregate[0]);
  if (aggregate[1].toLowerCase() !== 'div' || !/^https?:\/\/schema\.org\/AggregateRating$/.test(attrs.get('itemtype') ?? '') || !/\sitemscope(?:\s|=|\/?>)/i.test(aggregate[0])) throw new Error('MAL 聚合评分结构无效');
  const start = aggregate.index! + aggregate[0].length;
  let depth = 1, end = -1;
  for (const tag of content.slice(start).matchAll(/<\/?div\b[^>]*>/gi)) {
    depth += /^<\//.test(tag[0]) ? -1 : 1;
    if (depth === 0) { end = start + tag.index!; break; }
  }
  if (end < 0) throw new Error('MAL 聚合评分结构无效');
  const body = content.slice(start, end);
  // Nested microdata can belong to a user review rather than the anime aggregate.
  if (/<[^>]*\sitemscope(?:\s|=|\/?>)/i.test(body)) throw new Error('MAL 聚合评分结构无效');
  const values = (property: string) => [...body.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span\s*>/gi)].filter(match => attributes(match[1]).get('itemprop') === property).map(match => match[2].trim());
  const ratings = values('ratingValue'), counts = values('ratingCount');
  if (ratings.length !== 1 || counts.length !== 1 || !/^\d+$/.test(counts[0])) throw new Error('MAL 聚合评分结构无效');
  const count = votes(Number(counts[0]));
  if (count === null) throw new Error('MAL 评分人数无效');
  const value = ratings[0] === 'N/A' ? null : /^\d+(?:\.\d+)?$/.test(ratings[0]) ? score(Number(ratings[0]), 10) : undefined;
  if (value === undefined || value === null && count > 0) throw new Error('MAL 评分数值无效');
  return { score: count === 0 ? null : value, votes: count };
}
export function parseFilmarksRating(html: string, link: FilmarksLink): ParsedRating {
  const expected = `https://filmarks.com/animes/${link.seriesId}/${link.seasonId}`;
  if (html.length > 2 * 1024 * 1024) throw new Error('Filmarks 页面过大');
  const canonicals = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => attributes(match[0])).filter(attrs => attrs.get('rel')?.toLowerCase() === 'canonical');
  if (canonicals.length !== 1 || canonicals[0].get('href') !== expected) throw new Error('Filmarks 作品身份不匹配');
  const nodes: unknown[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) if (attributes(match[1]).get('type')?.toLowerCase() === 'application/ld+json') {
    let json: unknown; try { json = JSON.parse(match[2]); } catch { continue; }
    const entries = Array.isArray(json) ? json : [json];
    for (const entry of entries) { nodes.push(entry); if (isRecord(entry) && Array.isArray(entry['@graph'])) nodes.push(...entry['@graph']); }
  }
  const candidates = nodes.filter(isRecord).filter(node => ['TVSeason', 'TVSeries'].includes(String(node['@type'])));
  for (const node of candidates) {
    if (node.url !== undefined && node.url !== expected || node['@id'] !== undefined && node['@id'] !== expected) throw new Error('Filmarks 作品身份不匹配');
    if (!isRecord(node.aggregateRating)) continue;
    const rating = node.aggregateRating;
    const numeric = (value: unknown) => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
    if (numeric(rating.bestRating) !== 5) throw new Error('Filmarks 满分格式无效');
    // reviewCount counts written reviews; it is not a reliable count of scored users.
    return { score: score(numeric(rating.ratingValue), 5), votes: null };
  }
  const matchingBreadcrumb = nodes.filter(isRecord).some(node => node['@type'] === 'BreadcrumbList' && Array.isArray(node.itemListElement) && node.itemListElement.some(entry => isRecord(entry) && isRecord(entry.item) && entry.item['@id'] === expected));
  if (candidates.length || matchingBreadcrumb) return { score: null, votes: null };
  throw new Error('Filmarks 缺少作品结构化评分');
}

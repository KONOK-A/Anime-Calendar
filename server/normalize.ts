import { createHash } from 'node:crypto';
import type { AiringRule, Anime, CatalogBase, NetworkAiring } from '../shared/types.js';
import { seasonFrom } from '../shared/schedule.js';

export function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function airingKey(site: Record<string, unknown>, anchor: string): string {
  return JSON.stringify([site.site, text(site.url) || text(site.id), anchor]);
}
export function instant(value: unknown): string | null {
  const raw = text(value);
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(raw) && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null;
}
export function parseRule(broadcast: string, begin: string, end: string): AiringRule {
  const parts = broadcast.split('/');
  const anchor = broadcast ? instant(parts[1]) : instant(begin);
  const period = parts[0] === 'R' && parts.length === 3 ? parts[2] : '';
  const frequency = broadcast ? ({ P0D: 'once', P1D: 'daily', P7D: 'weekly' } as const)[period as 'P0D'] ?? 'unsupported' : anchor ? 'once' : 'unknown';
  const final = instant(end) ?? (/^\d{4}-\d\d-\d\d$/.test(end) ? new Date(`${end}T23:59:59.999+08:00`).toISOString() : null);
  return { anchor, frequency, raw: broadcast, end: final };
}

export function parseNetworkRule(broadcast: string, begin: string, end: string, originalBegin: string, originalRule: AiringRule): AiringRule {
  const rule = parseRule(broadcast, begin, end);
  if (rule.end || !originalRule.end || !rule.anchor || rule.frequency !== originalRule.frequency) return rule;
  const networkBegin = instant(begin) ?? rule.anchor, sourceBegin = instant(originalBegin);
  if (!sourceBegin) return rule;
  // No independent network end: project the source cutoff by the initial lead/lag,
  // then align to the current network cycle. This remains an estimated boundary.
  const projectedEnd = Date.parse(originalRule.end) + Date.parse(networkBegin) - Date.parse(sourceBegin);
  const interval = rule.frequency === 'weekly' ? 7 * 86_400_000 : rule.frequency === 'daily' ? 86_400_000 : 0;
  const anchor = Date.parse(rule.anchor);
  const cutoff = interval ? anchor + Math.round((projectedEnd - anchor) / interval) * interval : projectedEnd;
  return { ...rule, end: new Date(cutoff).toISOString() };
}

export function normalizeCatalog(input: unknown): CatalogBase {
  if (!isRecord(input) || !isRecord(input.siteMeta) || !Array.isArray(input.items) || !input.items.length) throw new Error('目录响应结构无效，旧数据已保留');
  const meta = input.siteMeta;
  const items: Anime[] = [], warnings: string[] = [], ids = new Set<string>();
  const sharedAnchors = new Map<string, number[]>();
  for (const raw of input.items) {
    if (!isRecord(raw) || !Array.isArray(raw.sites)) continue;
    const premiere = instant(raw.begin); if (!premiere) continue;
    for (const site of raw.sites.filter(isRecord)) {
      const entry = meta[String(site.site)], anchor = instant(text(site.broadcast).split('/')[1]);
      if (!isRecord(entry) || entry.type !== 'onair' || !anchor) continue;
      const key = airingKey(site, anchor), premieres = sharedAnchors.get(key) ?? [];
      premieres.push(Date.parse(premiere)); sharedAnchors.set(key, premieres);
    }
  }
  for (const raw of input.items) {
    if (!isRecord(raw)) { warnings.push('目录含无效条目'); continue; }
    if (raw.lang !== 'ja' || (raw.type !== 'tv' && raw.type !== 'web')) continue;
    const originalTitle = text(raw.title);
    if (!originalTitle || !Array.isArray(raw.sites)) { warnings.push(`条目缺少标题或站点：${originalTitle || '未知'}`); continue; }
    const sites = raw.sites.filter(isRecord);
    const bgm = sites.find(x => x.site === 'bangumi');
    const bangumiId = bgm && /^\d+$/.test(String(bgm.id)) && Number(bgm.id) > 0 ? Number(bgm.id) : null;
    const officialSite = safeUrl(raw.officialSite);
    const id = bangumiId ? `bgm:${bangumiId}` : `bd:${createHash('sha256').update(JSON.stringify([raw.type, originalTitle, text(raw.officialSite)])).digest('hex').slice(0, 24)}`;
    if (ids.has(id)) { warnings.push(`重复或冲突ID：${id}，保留首条`); continue; }
    ids.add(id);
    const translate = isRecord(raw.titleTranslate) ? raw.titleTranslate : {};
    const translations = Object.values(translate).flatMap(value => Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string' && Boolean(s.trim())) : []);
    const chinese = Array.isArray(translate['zh-Hans']) ? translate['zh-Hans'].find(x => typeof x === 'string' && x.trim()) : null;
    const begin = text(raw.begin), premiere = instant(begin), broadcastRule = parseRule(text(raw.broadcast), begin, text(raw.end));
    const candidates: NetworkAiring[] = [];
    const platforms = sites.flatMap(site => {
      const entry = meta[String(site.site)];
      if (!isRecord(entry) || entry.type !== 'onair') return [];
      const explicit = text(site.url);
      const url = safeUrl(explicit || text(entry.urlTemplate).replaceAll('{{id}}', encodeURIComponent(text(site.id))));
      if (!url) return [];
      const regions = Array.isArray(site.regions) ? site.regions : Array.isArray(entry.regions) ? entry.regions : [];
      const name = site.site === 'gamer' ? '巴哈姆特动画疯（台湾）' : site.site === 'gamer_hk' ? '巴哈姆特动画疯（港澳）' : text(entry.title) || text(site.site);
      const platform = { name, url, regions: regions.filter((x): x is string => typeof x === 'string') };
      const rawPeriod = text(site.broadcast);
      const rule = parseNetworkRule(rawPeriod, text(site.begin), text(site.end), begin, broadcastRule);
      const networkBegin = instant(site.begin) ?? rule.anchor;
      if (rawPeriod.startsWith('R/') && rule.anchor && networkBegin && premiere && Date.parse(networkBegin) < Date.parse(premiere) && rule.frequency !== 'unknown') {
        const distance = Math.abs(Date.parse(networkBegin) - Date.parse(premiere));
        const reused = sharedAnchors.get(airingKey(site, rule.anchor))?.some(other => Math.abs(Date.parse(networkBegin) - other) < distance);
        if (reused) warnings.push(`${id} ${platform.name} 的周期疑似来自共用播放页的旧季，未采用。`);
        else candidates.push({ platform: platform.name, regions: platform.regions, begin: networkBegin, rule, sourceUrl: url });
      }
      return [platform];
    });
    const networkAiring = candidates.sort((a, b) => Date.parse(a.begin) - Date.parse(b.begin))[0];
    items.push({ id, bangumiId, title: typeof chinese === 'string' ? chinese : originalTitle, originalTitle, aliases: [...new Set([originalTitle, ...translations])], type: raw.type, begin, season: seasonFrom(begin), officialSite, platforms, rule: networkAiring?.rule ?? broadcastRule, broadcastRule: { ...broadcastRule }, ...(networkAiring ? { networkAiring } : {}), sourceUrl: bangumiId ? `https://bgm.tv/subject/${bangumiId}` : 'https://github.com/bangumi-data/bangumi-data' });
  }
  if (!items.length) throw new Error('目录中没有有效的日语TV/Web条目，旧数据已保留');
  return { items, warnings };
}

export function normalizeCalendar(input: unknown): string[] {
  if (!Array.isArray(input) || !input.length || !input.every(group => isRecord(group) && Array.isArray(group.items))) throw new Error('当前放送名单结构无效，旧名单已保留');
  const ids = input.flatMap(group => (group as { items: unknown[] }).items).filter(isRecord).filter(x => x.type === 2 && Number.isSafeInteger(x.id) && Number(x.id) > 0).map(x => `bgm:${x.id}`);
  if (!ids.length) throw new Error('当前放送名单为空，旧名单已保留');
  return [...new Set(ids)];
}

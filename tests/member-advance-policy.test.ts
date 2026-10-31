import { describe, expect, it } from 'vitest';
import { normalizeCatalog, parseRule } from '../server/normalize.js';
import { applyStreamingSchedules, normalizeStreamingData, type StreamingScheduleRecord } from '../server/streaming-sources.js';
import { buildSchedule } from '../shared/schedule.js';
import type { ReleaseKind, RuleOverride } from '../shared/types.js';
import { rawCatalog } from './fixtures.js';

const earlyUrl = 'https://example.com/member/1';
const earlyBroadcast = 'R/2026-10-19T13:00:00Z/P7D';
const regularBroadcast = 'R/2026-10-19T17:00:00Z/P7D';
function site(broadcast: string, releaseKind?: ReleaseKind, url = earlyUrl) {
  return { site: 'bilibili', id: '10', url, begin: broadcast.split('/')[1], broadcast, ...(releaseKind ? { releaseKind } : {}) };
}
function catalog(sites: object[], extra: object = {}) {
  return { ...rawCatalog, siteMeta: structuredClone(rawCatalog.siteMeta), items: [{ ...rawCatalog.items[0], ...extra, sites: [{ site: 'bangumi', id: '1' }, ...sites] }] };
}
function exclusions(broadcast?: string): RuleOverride[] {
  return [{ animeId: 'bgm:1', sourceUrl: 'https://example.com/official-onair', note: '官网分别列出会员先行与普通配信。', candidateExclusions: [{ sourceUrl: earlyUrl, ...(broadcast ? { broadcast } : {}) }] }];
}
function record(releaseKind?: ReleaseKind, sourceUrl = 'https://www.video.unext.jp/season_anime/autumn', broadcast = earlyBroadcast): StreamingScheduleRecord {
  const begin = broadcast.split('/')[1]!;
  return { title: rawCatalog.items[0]!.title, season: '2026-4', begin, premiereDate: '2026-10-19', premiereAt: begin, rule: parseRule(broadcast, begin, ''), platform: 'U-NEXT', regions: ['JP'], sourceUrl, note: '官网网络配信时间。', ...(releaseKind ? { releaseKind } : {}) };
}

describe('会员专属抢先候选排除', () => {
  it('聚合候选先排除明确会员抢先，再采用较晚常规配信', () => {
    const result = normalizeCatalog(catalog([site(earlyBroadcast, 'member-advance'), site(regularBroadcast, 'regular', 'https://example.com/regular/1')]));
    expect(result.items[0]!.rule.anchor).toBe('2026-10-19T17:00:00.000Z');
    expect(result.items[0]!.networkAiring?.releaseKind).toBe('regular');
  });

  it('只有会员抢先时保留电视参考并进入待定', () => {
    const result = normalizeCatalog(catalog([site(earlyBroadcast, 'member-advance')]));
    expect(result.items[0]!.networkAiring).toBeUndefined();
    expect(result.items[0]!.rule.anchor).toBeNull();
    expect(result.items[0]!.broadcastRule.anchor).toBe('2026-10-19T15:30:00.000Z');
  });

  it('WEB不能在排除唯一会员候选后用原上线规则重新造出时间', () => {
    const result = normalizeCatalog(catalog([site(earlyBroadcast, 'member-advance')], { type: 'web' }));
    expect(result.items[0]!.networkAiring).toBeUndefined();
    expect(result.items[0]!.rule.anchor).toBeNull();
  });

  it('WEB自身上线规则明确为会员抢先时不生成官方网络发行', () => {
    const result = normalizeCatalog(catalog([], { type: 'web', releaseKind: 'member-advance' }));
    expect(result.items[0]!.networkAiring).toBeUndefined();
    expect(result.items[0]!.rule.anchor).toBeNull();
  });
  it('WEB独立普通发行已明确时，仍可作为被排除会员平台的正常替代', () => {
    const result = normalizeCatalog(catalog([site(earlyBroadcast, 'member-advance')], { type: 'web', releaseKind: 'regular' }));
    expect(result.items[0]!.networkAiring?.releaseKind).toBe('regular');
    expect(result.items[0]!.networkAiring?.platform).toBe('官方网络发行');
    expect(result.items[0]!.rule.anchor).toBe('2026-10-19T15:30:00.000Z');
  });

  it('人工排除周期锚点调到下一周后仍匹配同一候选', () => {
    const result = normalizeCatalog(catalog([{ ...site('R/2026-10-26T13:00:00Z/P7D'), begin: '2026-10-19T13:00:00Z' }, site(regularBroadcast, 'regular', 'https://example.com/regular/1')]), exclusions(earlyBroadcast));
    expect(result.items[0]!.networkAiring?.sourceUrl).toBe('https://example.com/regular/1');
  });

  it.each([
    ['每周同一相位', 'R/2026-10-26T13:00:00Z/P7D', earlyBroadcast, true],
    ['每周不同时分', 'R/2026-10-26T14:00:00Z/P7D', earlyBroadcast, false],
    ['同一瞬间的不同时区', 'R/2026-10-26T22:00:00+09:00/P7D', earlyBroadcast, true],
    ['日播同一相位', 'R/2026-10-20T13:00:00Z/P1D', 'R/2026-10-19T13:00:00Z/P1D', true],
    ['日播不同时分', 'R/2026-10-20T14:00:00Z/P1D', 'R/2026-10-19T13:00:00Z/P1D', false],
    ['频率不同', 'R/2026-10-20T13:00:00Z/P1D', earlyBroadcast, false],
    ['单次同一瞬间', 'R/2026-10-19T22:00:00+09:00/P0D', 'R/2026-10-19T13:00:00Z/P0D', true],
    ['单次不同日期', 'R/2026-10-20T13:00:00Z/P0D', 'R/2026-10-19T13:00:00Z/P0D', false],
  ])('候选排除按周期判断：%s', (_label, broadcast, excluded, rejected) => {
    const result = normalizeCatalog(catalog([site(broadcast)]), exclusions(excluded));
    expect(result.items[0]!.networkAiring === undefined).toBe(rejected);
  });

  it('排除限定具体作品和精确来源URL，未给周期时排除该作该来源', () => {
    const policy = exclusions();
    expect(normalizeCatalog(catalog([site(earlyBroadcast)]), policy).items[0]!.networkAiring).toBeUndefined();
    expect(normalizeCatalog(catalog([site(earlyBroadcast, undefined, `${earlyUrl}0`)]), policy).items[0]!.networkAiring?.sourceUrl).toBe(`${earlyUrl}0`);
    policy[0]!.animeId = 'bgm:2';
    expect(normalizeCatalog(catalog([site(earlyBroadcast)]), policy).items[0]!.networkAiring?.sourceUrl).toBe(earlyUrl);
  });

  it('WEB官方发行也检查来源排除，会员平台没有可用周期时仍不生成fallback', () => {
    const policy = exclusions();
    policy[0]!.candidateExclusions![0]!.sourceUrl = 'https://example.com/anime';
    expect(normalizeCatalog(catalog([], { type: 'web' }), policy).items[0]!.networkAiring).toBeUndefined();
    const member = { ...site(earlyBroadcast, 'member-advance'), broadcast: '' };
    expect(normalizeCatalog(catalog([member], { type: 'web' })).items[0]!.networkAiring).toBeUndefined();
  });

  it('WEB来源已人工排除且未给周期时，不用原上线时间绕过来源排除', () => {
    const excluded = { ...site(earlyBroadcast), broadcast: '' };
    expect(normalizeCatalog(catalog([excluded], { type: 'web' }), exclusions()).items[0]!.networkAiring).toBeUndefined();
  });

  it('未分级候选保持未知，不因平台名或早于电视而猜为抢先', () => {
    const input = catalog([site(earlyBroadcast)]);
    input.siteMeta.bilibili.title = 'ABEMA Premium / Netflix / Disney+ / dアニメストア';
    const result = normalizeCatalog(input);
    expect(result.items[0]!.rule.anchor).toBe('2026-10-19T13:00:00.000Z');
    expect(result.items[0]!.networkAiring?.releaseKind).toBeUndefined();
  });
});

describe('官方补充与持久来源缓存的会员抢先边界', () => {
  it('忽略明确会员抢先记录，仍可采用另一个正式订阅来源', () => {
    const base = normalizeCatalog(catalog([]));
    const result = applyStreamingSchedules(base, [record('member-advance'), record('regular', 'https://animestore.docomo.ne.jp/animestore/ci_pc?workId=1', regularBroadcast)]);
    expect(result.items[0]!.rule.anchor).toBe('2026-10-19T17:00:00.000Z');
    expect(result.items[0]!.networkAiring?.releaseKind).toBe('regular');
  });

  it('补充只含会员抢先时保留已有普通网络候选', () => {
    const base = normalizeCatalog(catalog([site(regularBroadcast, 'regular', 'https://example.com/regular/1')]));
    const result = applyStreamingSchedules(base, [record('member-advance')]);
    expect(result.items[0]!.networkAiring?.sourceUrl).toBe('https://example.com/regular/1');
    expect(result.items[0]!.rule.anchor).toBe('2026-10-19T17:00:00.000Z');
  });

  it('官方记录同样使用每作的候选排除，不退回电视排期', () => {
    const base = normalizeCatalog(catalog([]));
    const policy = exclusions(earlyBroadcast);
    policy[0]!.candidateExclusions![0]!.sourceUrl = 'https://www.video.unext.jp/season_anime/autumn';
    const result = applyStreamingSchedules(base, [record()], policy);
    expect(result.items[0]!.networkAiring).toBeUndefined();
    expect(result.items[0]!.rule.anchor).toBeNull();
  });

  it.each([
    ['移除主周期', earlyBroadcast, ''],
    ['仅移除补充周期', regularBroadcast, '2026-10-19T17:00:00Z'],
    ['完整多周期表不含旧主周期', 'R/2026-10-19T21:00:00Z/P7D', ''],
  ])('官方多周期逐条筛选：%s，事件与详情一致且不伪造常规首播', (_label, primaryBroadcast, expectedBegin) => {
    const base = normalizeCatalog(catalog([]));
    base.items[0]!.broadcastRule.end = '2026-12-28T15:30:00Z';
    const source = record(undefined, undefined, primaryBroadcast);
    source.rules = [parseRule(earlyBroadcast, '', ''), parseRule(regularBroadcast, '', '')];
    const previous = structuredClone(source);
    const policy = exclusions(earlyBroadcast);
    policy[0]!.candidateExclusions![0]!.sourceUrl = source.sourceUrl;
    const result = applyStreamingSchedules(base, [source], policy);
    const item = result.items[0]!;
    expect(item.rule.anchor).toBe('2026-10-19T17:00:00.000Z');
    expect(item.networkAiring?.rule.anchor).toBe('2026-10-19T17:00:00.000Z');
    expect(item.networkAiring?.rules?.map(rule => rule.raw)).toEqual([regularBroadcast]);
    expect(item.networkAiring?.begin).toBe(expectedBegin);
    if (!expectedBegin) expect(item.rule.end).toBeNull();
    const snapshot = { ...result, schemaVersion: 1 as const, activeIds: ['bgm:1'], fetchedAt: { catalog: null, calendar: null }, overrides: { version: 1 as const, active: [], events: [], rules: policy } };
    expect(buildSchedule(snapshot, { start: '2026-10-19T00:00:00Z', end: '2026-10-20T00:00:00Z' }).map(event => event.at)).toEqual(['2026-10-19T17:00:00.000Z']);
    expect(source).toEqual(previous);
  });

  it('官方多周期全部排除后保留原普通来源，整条会员抢先记录也不能保留任何补充周期', () => {
    const base = normalizeCatalog(catalog([site(regularBroadcast, 'regular', 'https://example.com/regular/1')]));
    const source = record();
    source.rules = [parseRule(earlyBroadcast, '', ''), parseRule(regularBroadcast, '', '')];
    const policy = exclusions();
    policy[0]!.candidateExclusions![0]!.sourceUrl = source.sourceUrl;
    expect(applyStreamingSchedules(base, [source], policy).items[0]).toEqual(base.items[0]);
    expect(applyStreamingSchedules(base, [{ ...source, releaseKind: 'member-advance' }]).items[0]).toEqual(base.items[0]);
  });

  it('移除主周期后仍保留独立合格单次规则证实的首播，常规周播作为新主周期', () => {
    const source = record();
    source.begin = '2026-10-19T11:00:00Z';
    source.premiereAt = source.begin;
    source.rules = [parseRule('R/2026-10-19T11:00:00Z/P0D', '', ''), source.rule, parseRule(regularBroadcast, '', '')];
    const policy = exclusions(earlyBroadcast);
    policy[0]!.candidateExclusions![0]!.sourceUrl = source.sourceUrl;
    const item = applyStreamingSchedules(normalizeCatalog(catalog([])), [source], policy).items[0]!;
    expect(item.rule.anchor).toBe('2026-10-19T17:00:00.000Z');
    expect(item.networkAiring?.begin).toBe('2026-10-19T11:00:00Z');
    expect(item.networkAiring?.rules?.map(rule => rule.anchor)).toEqual(['2026-10-19T11:00:00.000Z', '2026-10-19T17:00:00.000Z']);
  });

  it('正规缓存保留明确分类，未知仍为未知，非法分类不能进入缓存', () => {
    const known = { season: '2026-4', records: [record('member-advance')] };
    expect(normalizeStreamingData(known).records[0]!.releaseKind).toBe('member-advance');
    expect(normalizeStreamingData({ season: '2026-4', records: [record()] }).records[0]!.releaseKind).toBeUndefined();
    expect(() => normalizeStreamingData({ season: '2026-4', records: [{ ...record(), releaseKind: 'free' }] })).toThrow();
  });
  it('普通主周期保留时，也移除已被排除单次首播的时间元数据', () => {
    const source = record(undefined, undefined, regularBroadcast), first = 'R/2026-10-19T13:00:00Z/P0D';
    source.begin = '2026-10-19T13:00:00Z'; source.premiereAt = source.begin;
    source.rules = [parseRule(first, '', ''), source.rule];
    const policy = exclusions(first); policy[0]!.candidateExclusions![0]!.sourceUrl = source.sourceUrl;
    const item = applyStreamingSchedules(normalizeCatalog(catalog([])), [source], policy).items[0]!;
    expect(item.rule.anchor).toBe('2026-10-19T17:00:00.000Z');
    expect(item.networkAiring?.rules?.map(rule => rule.anchor)).toEqual(['2026-10-19T17:00:00.000Z']);
    expect(item.networkAiring?.begin).toBe('');
  });
  it('首播未知的过滤结果仍按合格周期与其他正常来源比较', () => {
    const source = record(); source.rules = [source.rule, parseRule(regularBroadcast, '', '')];
    const normal = record('regular', 'https://animestore.docomo.ne.jp/animestore/ci_pc?workId=2', 'R/2026-10-19T15:00:00Z/P7D');
    const policy = exclusions(earlyBroadcast); policy[0]!.candidateExclusions![0]!.sourceUrl = source.sourceUrl;
    const item = applyStreamingSchedules(normalizeCatalog(catalog([])), [source, normal], policy).items[0]!;
    expect(item.networkAiring?.sourceUrl).toBe(normal.sourceUrl);
    expect(item.rule.anchor).toBe('2026-10-19T15:00:00.000Z');
  });
});

import { describe, expect, it } from 'vitest';
import { applyStreamingSchedules, normalizeStreamingSchedulePage } from '../server/streaming-sources.js';
import { normalizeCatalog } from '../server/normalize.js';
import { buildSchedule } from '../shared/schedule.js';
import { rawCatalog } from './fixtures.js';

const sourceUrl = 'https://www.video.unext.jp/season_anime/autumn';
const html = `<html><script src="runtime.js"></script><title>2026年秋アニメ 配信ラインアップ｜U-NEXT</title>
<div id="autumn_tuesday"></div><h2>火曜日</h2>
<p class="any__lead">10/6 23:45配信開始 以降毎週火曜23:30更新★</p><h4>超巡！超条先輩</h4>
<div id="autumn_saturday"></div><h2>土曜日</h2>
<p class="any__lead">【地上波先行・独占配信】10/3配信開始 以降21:00更新</p><h4>ロメリア戦記</h4>
<p class="any__lead">10/3配信開始</p><h4>時刻未定作品</h4>
<div id="autumn_sunday"></div><h2>日曜日</h2>
<p class="any__lead">10/4配信開始 以降17:00更新</p><h4>アオのハコ Season2</h4></html>`;

function base(title: string, begin = '2026-10-04T07:30:00Z') {
  return normalizeCatalog({ ...rawCatalog, items: [{ ...rawCatalog.items[0], title, titleTranslate: {}, begin, sites: [{ site: 'bangumi', id: '1' }] }] });
}

describe('官方网络常规排期', () => {
  it('从年份和星期段解析JST，采用普通网络后发时刻并保留原放送', () => {
    const page = normalizeStreamingSchedulePage(html);
    expect(page.season).toBe('2026-4');
    expect(page.records).toHaveLength(3);
    expect(page.records.find(x => x.title === 'ロメリア戦記')?.rule.anchor).toBe('2026-10-10T12:00:00.000Z');
    const result = applyStreamingSchedules(base('アオのハコ Season2'), page.records);
    expect(result.items[0].rule.anchor).toBe('2026-10-11T08:00:00.000Z');
    expect(result.items[0].networkAiring).toMatchObject({ platform: 'U-NEXT', regions: ['JP'], sourceUrl });
    expect(result.items[0].broadcastRule.anchor).toBe('2026-10-19T15:30:00.000Z');
  });
  it('区分首日23:45和以后每周23:30，不将首日例外展开成周播', () => {
    const page = normalizeStreamingSchedulePage(html);
    const result = applyStreamingSchedules(base('超巡！超条先輩', '2026-10-06T14:00:00Z'), page.records);
    const snapshot = { ...result, schemaVersion: 1 as const, activeIds: ['bgm:1'], fetchedAt: { catalog: null, calendar: null }, overrides: { version: 1 as const, active: [], events: [] } };
    expect(buildSchedule(snapshot, { start: '2026-10-05T16:00:00Z', end: '2026-10-18T16:00:00Z' }).map(x => x.at)).toEqual(['2026-10-06T14:45:00.000Z', '2026-10-13T14:30:00.000Z']);
  });
  it('首话提前播出时，不在首日常规分钟重复生成第二次更新', () => {
    const page = normalizeStreamingSchedulePage(html.replace('23:45配信開始', '20:00配信開始'));
    const result = applyStreamingSchedules(base('超巡！超条先輩', '2026-10-06T14:00:00Z'), page.records);
    const snapshot = { ...result, schemaVersion: 1 as const, activeIds: ['bgm:1'], fetchedAt: { catalog: null, calendar: null }, overrides: { version: 1 as const, active: [], events: [] } };
    expect(buildSchedule(snapshot, { start: '2026-10-05T16:00:00Z', end: '2026-10-18T16:00:00Z' }).map(x => x.at)).toEqual(['2026-10-06T11:00:00.000Z', '2026-10-13T14:30:00.000Z']);
  });
  it('缺时刻不推断，季别不符和无唯一对应的作品不套用', () => {
    const records = normalizeStreamingSchedulePage(html).records;
    expect(applyStreamingSchedules(base('時刻未定作品'), records).items[0].rule.frequency).toBe('unknown');
    expect(applyStreamingSchedules(base('アオのハコ Season2', '2025-10-04T07:30:00Z'), records).items[0].rule.frequency).toBe('unknown');
    const catalog = base('別作品'); catalog.items[0].aliases = ['アオのハコ Season2'];
    catalog.items.push({ ...catalog.items[0], id: 'bgm:2' });
    expect(applyStreamingSchedules(catalog, records).items.every(x => x.rule.frequency === 'unknown')).toBe(true);
  });
  it('只有常规时刻且网络首发未知时，不把电视日期或校准锚点伪装成网络开播', () => {
    const catalog = base('テストの旅');
    catalog.items[0].broadcastRule.end = '2026-12-28T15:30:00Z';
    const sample = normalizeStreamingSchedulePage(html).records[0]!;
    const record = { ...sample, title: 'テストの旅', begin: '', premiereDate: null, premiereAt: null, rule: { anchor: '2026-10-28T13:00:00Z', frequency: 'weekly' as const, raw: 'R/2026-10-28T13:00:00Z/P7D', end: null }, rules: undefined };
    const anime = applyStreamingSchedules(catalog, [record]).items[0]!;
    expect(anime.networkAiring?.begin).toBe('');
    expect(anime.rule.end).toBeNull();
    record.begin = '2026-10-06';
    expect(applyStreamingSchedules(catalog, [record]).items[0]!.rule.end).toBeNull();
  });
  it('官网周期优于聚合旧周期且留下冲突来源', () => {
    const catalog = base('アオのハコ Season2');
    catalog.items[0].networkAiring = { platform: '聚合平台', regions: ['JP'], begin: '2026-10-04T07:30:00Z', rule: { anchor: '2026-10-04T07:30:00Z', frequency: 'weekly', raw: 'R/2026-10-04T07:30:00Z/P7D', end: null }, sourceUrl: 'https://example.com/old' };
    catalog.items[0].rule = catalog.items[0].networkAiring.rule;
    const result = applyStreamingSchedules(catalog, normalizeStreamingSchedulePage(html).records);
    expect(result.items[0].rule.anchor).toBe('2026-10-11T08:00:00.000Z');
    expect(result.items[0].scheduleNote).toContain('https://example.com/old');
    expect(result.warnings.join(' ')).toContain('来源冲突');
  });
  it('同一周播星期时分但锚点相差整周时，不误报来源冲突', () => {
    const catalog = base('アオのハコ Season2');
    catalog.items[0].networkAiring = { platform: '正规平台', regions: ['JP'], begin: '2026-10-04T08:00:00Z', rule: { anchor: '2026-10-04T08:00:00Z', frequency: 'weekly', raw: 'R/2026-10-04T08:00:00Z/P7D', end: null }, sourceUrl: 'https://example.com/confirmed' };
    expect(applyStreamingSchedules(catalog, normalizeStreamingSchedulePage(html).records).warnings).toEqual([]);
  });
  it('解析失败显式拒绝，不能将空页面当作成功更新', () => {
    expect(() => normalizeStreamingSchedulePage('<title>2026年秋アニメ</title>')).toThrow();
    expect(() => normalizeStreamingSchedulePage(html.replace('2026年', ''))).toThrow();
    expect(() => normalizeStreamingSchedulePage(html, 'https://example.com/fake')).toThrow();
  });
  it('冬季页的十二月网络开播属于上一公历年，深夜24时先跨日', () => {
    const winter = '<title>2027年冬アニメ 配信ラインアップ</title><div id="winter_thursday"></div><p class="x__lead">12/31配信開始 以降24:30更新</p><h4>冬の作品</h4>';
    const record = normalizeStreamingSchedulePage(winter, 'https://www.video.unext.jp/season_anime/winter').records[0]!;
    expect(record.premiereDate).toBe('2026-12-31');
    expect(record.rule.anchor).toBe('2027-01-07T15:30:00.000Z');
    expect(record.premiereAt).toBeNull();
  });
});


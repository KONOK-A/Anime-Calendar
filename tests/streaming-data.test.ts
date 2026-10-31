import { describe, expect, it } from 'vitest';
import { mergeStreamingRecords, normalizeStreamingData, normalizeStreamingSchedulePage } from '../server/streaming-sources.js';
const page = () => normalizeStreamingSchedulePage('<title>2026年秋アニメ</title><div id="autumn_saturday"></div><p class="x__lead">10/3配信開始 以降21:00更新</p><h4>ロメリア戦記</h4>');
describe('官方网络缓存数据边界', () => {
  it('同一季同源标题新规则替代静态种子，同时保留其他正规来源', () => {
    const first = page().records[0]!;
    const other = { ...first, sourceUrl: 'https://animestore.docomo.ne.jp/animestore/ci_pc?workId=29261', platform: 'dアニメストア' };
    const latest = { ...first, note: '更新后的公告', rule: { ...first.rule, anchor: '2026-10-10T13:00:00.000Z', raw: 'R/2026-10-10T13:00:00.000Z/P7D' } };
    expect(mergeStreamingRecords([first, other], [latest])).toEqual([latest, other]);
  });
  it('验证并保留正规缓存，包括未知首发日期的空begin', () => {
    const original = page(); original.records[0] = { ...original.records[0]!, begin: '', premiereDate: null, premiereAt: null };
    expect(normalizeStreamingData(JSON.parse(JSON.stringify(original)))).toEqual(original);
  });
  it.each(['https://example.com/season_anime/autumn', 'https://video.unext.jp.attacker.test/season_anime/autumn', 'https://animestore.docomo.ne.jp/redirect?url=bad'])('拒绝未授权来源%s', sourceUrl => {
    const original = page(); original.records[0]!.sourceUrl = sourceUrl;
    expect(() => normalizeStreamingData(original)).toThrow();
  });
  it('拒绝记录季度与页面不符、无效日期及伪造周期', () => {
    const original = page();
    expect(() => normalizeStreamingData({ ...original, season: '2026-3' })).toThrow();
    const record = original.records[0]!;
    expect(() => normalizeStreamingData({ ...original, records: [{ ...record, begin: '2026-02-31' }] })).toThrow();
    expect(() => normalizeStreamingData({ ...original, records: [{ ...record, rule: { ...record.rule, frequency: 'daily' } }] })).toThrow();
    expect(() => normalizeStreamingData({ ...original, records: [] })).toThrow();
  });
});

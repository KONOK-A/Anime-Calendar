import { describe, expect, it } from 'vitest';
import { normalizeCatalog } from '../server/normalize.js';
import { buildSchedule } from '../shared/schedule.js';
import { rawCatalog } from './fixtures.js';

function catalog(streams: object[]) {
  return {
    siteMeta: { ...rawCatalog.siteMeta,
      early: { title: '先行平台', type: 'onair', urlTemplate: 'https://early.example/{{id}}', regions: ['JP'] },
      second: { title: '另一个平台', type: 'onair', urlTemplate: 'https://second.example/{{id}}', regions: ['TW'] },
    },
    items: [{ ...rawCatalog.items[0], sites: [{ site: 'bangumi', id: '1' }, ...streams] }],
  };
}

describe('网络先行默认排期', () => {
  it('为所有作品选择早于原开播的正规网络周期，并保留原放送及地区', () => {
    const data = catalog([
      { site: 'early', id: '1', begin: '2026-10-17T12:00:00Z', broadcast: 'R/2026-10-17T12:00:00Z/P7D' },
      { site: 'second', id: '1', begin: '2026-10-17T13:00:00Z', broadcast: 'R/2026-10-17T13:00:00Z/P7D' },
      { site: 'resource', id: '1', begin: '2026-10-16T01:00:00Z', broadcast: 'R/2026-10-16T01:00:00Z/P7D' },
    ]);
    const first = normalizeCatalog(data).items[0];
    expect(first.rule.anchor).toBe('2026-10-17T12:00:00.000Z');
    expect(first.networkAiring).toMatchObject({ platform: '先行平台', regions: ['JP'], sourceUrl: 'https://early.example/1' });
    expect(first.broadcastRule.anchor).toBe('2026-10-19T15:30:00.000Z');
    expect(first.begin).toBe('2026-10-19T15:30:00Z'); expect(first.season).toBe('2026-4');
    data.items[0].sites = [{ site: 'bangumi', id: '99' }, { site: 'early', id: '99', begin: '2026-10-17T12:00:00Z', broadcast: 'R/2026-10-17T12:00:00Z/P7D' }];
    expect(normalizeCatalog(data).items[0].rule.anchor).toBe('2026-10-17T12:00:00.000Z');
  });
  it('实际番表移动到网络星期六时段，并引用采用的平台', () => {
    const base = normalizeCatalog(catalog([{ site: 'early', id: '1', begin: '2026-10-17T12:00:00Z', broadcast: 'R/2026-10-17T12:00:00Z/P7D' }]));
    const snapshot = { ...base, schemaVersion: 1 as const, activeIds: ['bgm:1'], fetchedAt: { catalog: null, calendar: null }, overrides: { version: 1 as const, active: [], events: [] } };
    expect(buildSchedule(snapshot, { start: '2026-10-25T16:00:00Z', end: '2026-11-01T16:00:00Z' })).toEqual([
      { animeId: 'bgm:1', at: '2026-10-31T12:00:00.000Z', basis: 'estimated', status: 'scheduled', sourceUrl: 'https://early.example/1' },
    ]);
  });
  it('没有周期的页面上架日期、晚于原放送的网播和无效时间不作为先行', () => {
    const base = normalizeCatalog(catalog([
      { site: 'early', id: '1', begin: '2026-09-01T00:00:00Z' },
      { site: 'second', id: '1', begin: '2026-10-20T00:00:00Z', broadcast: 'R/2026-10-20T00:00:00Z/P7D' },
    ]));
    expect(base.items[0].networkAiring).toBeUndefined();
    expect(base.items[0].rule.anchor).toBe('2026-10-19T15:30:00.000Z');
  });
  it('更新后的网络周期用当前anchor，不能一直使用初始begin的旧时刻', () => {
    const anime = normalizeCatalog(catalog([{ site: 'early', id: '1', begin: '2026-10-17T12:00:00Z', broadcast: 'R/2026-10-31T13:00:00Z/P7D' }])).items[0];
    expect(anime.rule.anchor).toBe('2026-10-31T13:00:00.000Z');
    expect(anime.networkAiring?.begin).toBe('2026-10-17T12:00:00.000Z');
  });
  it('跨季共用播放页时，不使用明显属于旧季的同一周期锚点', () => {
    const data = catalog([{ site: 'early', id: 'series', begin: '2024-10-05T00:00:00Z', broadcast: 'R/2024-10-05T00:00:00Z/P7D' }]);
    data.items.push({ ...data.items[0], title: '旧季', begin: '2024-10-05T00:00:00Z', broadcast: 'R/2024-10-05T00:00:00Z/P7D', sites: [{ site: 'bangumi', id: '3' }, { site: 'early', id: 'series', begin: '2024-10-05T00:00:00Z', broadcast: 'R/2024-10-05T00:00:00Z/P7D' }] });
    const result = normalizeCatalog(data);
    expect(result.items[0].networkAiring).toBeUndefined();
    expect(result.warnings.join(' ')).toContain('旧季');
  });
  it('网络自己的已知完结时间限制展开', () => {
    const anime = normalizeCatalog(catalog([{ site: 'early', id: '1', begin: '2026-10-17T12:00:00Z', broadcast: 'R/2026-10-17T12:00:00Z/P7D', end: '2026-10-24T12:00:00Z' }])).items[0];
    expect(anime.rule.end).toBe('2026-10-24T12:00:00.000Z');
  });
  it('已知网络先行采用尚未支持的周期时保持待定，不能回退成电视周播', () => {
    const base = normalizeCatalog(catalog([{ site: 'early', id: '1', begin: '2026-10-17T12:00:00Z', broadcast: 'R/2026-10-17T12:00:00Z/P14D' }]));
    expect(base.items[0].networkAiring?.platform).toBe('先行平台');
    expect(base.items[0].rule.frequency).toBe('unsupported');
    const snapshot = { ...base, schemaVersion: 1 as const, activeIds: ['bgm:1'], fetchedAt: { catalog: null, calendar: null }, overrides: { version: 1 as const, active: [], events: [] } };
    expect(buildSchedule(snapshot, { start: '2026-10-25T16:00:00Z', end: '2026-11-01T16:00:00Z' })).toEqual([]);
  });
});

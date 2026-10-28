import { describe, expect, it } from 'vitest';
import { buildSchedule, dateKey, effectiveActiveIds, formatClock, weekWindow } from '../shared/schedule.js';
import { normalizeCatalog } from '../server/normalize.js';
import { rawCatalog } from './fixtures.js';

function snapshot() {
  return { ...normalizeCatalog(rawCatalog), schemaVersion: 1 as const, activeIds: ['bgm:1'], fetchedAt: { catalog: null, calendar: null }, overrides: { version: 1 as const, active: [], events: [] } };
}
const window = { start: '2026-10-25T16:00:00Z', end: '2026-11-01T16:00:00Z' };

describe('排期与时区', () => {
  it('人工在播修正同时供排期和待定区使用', () => {
    const data = snapshot(); data.overrides.active = [{ animeId: 'bgm:1', active: false, sourceUrl: 'https://example.com/news' }, { animeId: 'bgm:2', active: true, sourceUrl: 'https://example.com/news' }];
    expect([...effectiveActiveIds(data)]).toEqual(['bgm:2']);
    expect(buildSchedule(data, window).filter(x => x.animeId === 'bgm:1')).toHaveLength(0);
  });
  it('日本周二00:30转换为北京时间周一23:30，并保留原季度', () => {
    expect(formatClock('2026-10-26T15:30:00Z', 'Asia/Tokyo')).toBe('00:30');
    expect(formatClock('2026-10-26T15:30:00Z', 'Asia/Shanghai')).toBe('23:30');
    expect(dateKey('2026-10-26T15:30:00Z', 'Asia/Tokyo')).toBe('2026-10-27');
    expect(snapshot().items[0].season).toBe('2026-4');
  });
  it('从显示时区的周一零点建立窗口，包含本周已经过去的排期', () => {
    expect(weekWindow('2026-10-29T04:00:00Z', 'Asia/Shanghai')).toMatchObject(window);
    expect(buildSchedule(snapshot(), window).map(x => x.at)).toEqual(['2026-10-26T15:30:00.000Z', '2026-10-30T10:00:00.000Z']);
  });
  it('周期排期必须有当前在播依据，时间差不会产生已更新集数', () => {
    const data = snapshot(); data.activeIds = [];
    expect(buildSchedule(data, window).map(x => x.animeId)).toEqual(['bgm:2']);
    expect(buildSchedule(snapshot(), window)[0]).toMatchObject({ basis: 'estimated', status: 'scheduled' });
    expect(buildSchedule(snapshot(), window)[0]).not.toHaveProperty('episode');
  });
  it('未知周期不按周播，已知结束日期限制展开，窗口最多14天', () => {
    const data = snapshot(); data.items[0].rule.frequency = 'unsupported';
    expect(buildSchedule(data, window)).toHaveLength(1);
    data.items[0].rule.frequency = 'weekly'; data.items[0].rule.end = '2026-10-25T00:00:00Z';
    expect(buildSchedule(data, window)).toHaveLength(1);
    expect(() => buildSchedule(data, { start: window.start, end: '2027-01-01T00:00:00Z' })).toThrow();
  });
  it('休播和跨窗口改档覆盖周期，不丢失从窗口外移入的公告', () => {
    const data = snapshot();
    data.overrides.events = [{ animeId: 'bgm:1', originalAt: '2026-10-26T15:30:00Z', at: '2026-10-26T15:30:00Z', status: 'cancelled', sourceUrl: 'https://example.com/news' }];
    expect(buildSchedule(data, window)[0].status).toBe('cancelled');
    data.overrides.events = [{ animeId: 'bgm:1', originalAt: '2026-10-19T15:30:00Z', at: '2026-10-28T15:30:00Z', status: 'scheduled', sourceUrl: 'https://example.com/news' }];
    expect(buildSchedule(data, window).find(x => x.at === '2026-10-28T15:30:00.000Z')?.basis).toBe('official');
  });
});

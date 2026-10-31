import { describe, expect, it } from 'vitest';
import { buildSchedule } from '../shared/schedule.js';
import { normalizeCatalog } from '../server/normalize.js';
import { rawCatalog } from './fixtures.js';

it('同作一周多播同时展开，重叠规则只产生一个时间点', () => {
  const base = normalizeCatalog(rawCatalog), anime = base.items[0]!;
  const monday = { anchor: '2026-10-05T07:00:00Z', frequency: 'weekly' as const, raw: 'R/2026-10-05T07:00:00Z/P7D', end: null };
  const friday = { ...monday, anchor: '2026-10-09T07:00:00Z', raw: 'R/2026-10-09T07:00:00Z/P7D' };
  anime.rule = monday;
  anime.networkAiring = { platform: 'YouTube', regions: ['JP'], begin: monday.anchor, rule: monday, rules: [monday, friday, { ...monday }], sourceUrl: 'https://yusanchi-anime.jp/' };
  const snapshot = { ...base, items: [anime], schemaVersion: 1 as const, activeIds: ['bgm:1'], fetchedAt: { catalog: null, calendar: null }, overrides: { version: 1 as const, active: [], events: [] } };
  expect(buildSchedule(snapshot, { start: '2026-10-25T16:00:00Z', end: '2026-11-01T16:00:00Z' }).map(x => x.at)).toEqual(['2026-10-26T07:00:00.000Z', '2026-10-30T07:00:00.000Z']);
});

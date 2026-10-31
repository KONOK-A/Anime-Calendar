import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnimeService } from '../server/service.js';
import { CacheStore } from '../server/cache.js';
import { rawCatalog } from './fixtures.js';
import { buildSchedule } from '../shared/schedule.js';
import { STREAMING_ACCESS_POLICY } from '../shared/airing-policy.js';
import type { CatalogSnapshot, Overrides } from '../shared/types.js';

const directories: string[] = [], services: AnimeService[] = [];
afterEach(async () => { for (const service of services.splice(0)) { service.close(); await service.drain(); } for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const early = 'https://early.example/1', normal = 'https://normal.example/1';
const earlyPeriod = 'R/2026-10-19T09:00:00Z/P7D', normalPeriod = 'R/2026-10-20T10:00:00Z/P7D';
const exclusion = { animeId: 'bgm:1', sourceUrl: 'https://official.example/onair', note: '已核实的普通配信规则', candidateExclusions: [{ sourceUrl: early, broadcast: earlyPeriod }] };
async function setup(rules: unknown[], seed = false, events: unknown[] = []) {
  const directory = await mkdtemp(join(tmpdir(), 'regular-airing-')); directories.push(directory);
  const data = join(directory, 'data'); await mkdir(data); const overridesPath = join(data, 'overrides.json');
  await writeFile(overridesPath, JSON.stringify({ version: 1, active: [], events, rules }));
  const source = { siteMeta: { ...rawCatalog.siteMeta, early: { type: 'onair', title: '抢先平台', urlTemplate: 'https://early.example/{{id}}' }, normal: { type: 'onair', title: '普通订阅平台', urlTemplate: 'https://normal.example/{{id}}' } }, items: [{ ...rawCatalog.items[0], sites: [{ site: 'bangumi', id: '1' }, { site: 'early', id: '1', begin: '2026-10-19T09:00:00Z', broadcast: earlyPeriod }, { site: 'normal', id: '1', begin: '2026-10-20T10:00:00Z', broadcast: normalPeriod }] }] };
  const store = new CacheStore(directory); await store.write('catalog', source, '2026-10-29T00:00:00Z');
  await store.write('calendar', [{ weekday: { id: 2 }, items: [{ id: 1, type: 2 }] }], '2026-10-29T00:00:00Z');
  if (seed) await writeFile(join(data, 'streaming-schedules.json'), JSON.stringify({ season: '2026-4', records: [{ title: 'テストの旅', season: '2026-4', begin: '2026-10-19T09:00:00Z', premiereDate: '2026-10-19', premiereAt: '2026-10-19T09:00:00Z', rule: { anchor: '2026-10-19T09:00:00Z', frequency: 'weekly', raw: earlyPeriod, end: null }, platform: 'U-NEXT', regions: ['JP'], sourceUrl: 'https://www.video.unext.jp/season_anime/autumn', note: '待排除的抢先周期' }] }));
  const service = new AnimeService({ directory, overridesPath, now: () => new Date('2026-10-29T00:00:00Z'), fetcher: async url => Response.json(url.includes('/calendar') ? [{ items: [{ id: 1, type: 2 }] }] : source) });
  services.push(service); await service.initialize(); return { service, directory, overridesPath };
}

describe('普通网络配信政策贯穿服务', () => {
  it('启动读取人工排除信息后才规范化原始目录，刷新与重启不恢复抢先候选', async () => {
    const { service, directory, overridesPath } = await setup([exclusion]);
    expect(service.item('bgm:1')?.networkAiring?.sourceUrl).toBe(normal);
    expect(service.catalog()?.streamingAccessPolicy).toBe(STREAMING_ACCESS_POLICY);
    await service.refresh(); expect(service.item('bgm:1')?.rule.anchor).toBe('2026-10-20T10:00:00.000Z');
    const restart = new AnimeService({ directory, overridesPath }); services.push(restart); await restart.initialize();
    expect(restart.item('bgm:1')?.networkAiring?.sourceUrl).toBe(normal);
  });
  it('会员专属人工周期不能覆盖已有普通候选', async () => {
    const { service } = await setup([{ ...exclusion, kind: 'network', broadcast: earlyPeriod, platform: '专属抢先', releaseKind: 'member-advance' }]);
    expect(service.item('bgm:1')?.networkAiring?.sourceUrl).toBe(normal);
    expect(service.status().warnings.some(value => value.includes('人工修正未加载'))).toBe(false);
  });
  it('静态及缓存官方记录也应用相同的精确候选排除', async () => {
    const { service } = await setup([{ ...exclusion, candidateExclusions: [...exclusion.candidateExclusions, { sourceUrl: 'https://www.video.unext.jp/season_anime/autumn', broadcast: earlyPeriod }] }], true);
    expect(service.item('bgm:1')?.networkAiring?.sourceUrl).toBe(normal);
  });
  it.each(['invented', ['regular'], ['member-advance']])('非法权限标记不能默认为普通修正：%j', async releaseKind => {
    const { service } = await setup([{ ...exclusion, kind: 'network', broadcast: normalPeriod, platform: '平台', releaseKind }]);
    expect(service.status().warnings.some(value => value.includes('人工修正未加载'))).toBe(true);
  });
  it('单次事件权限也不能把数组强制转换成有效类别', async () => {
    const { service } = await setup([], false, [{ animeId: 'bgm:1', at: '2026-10-26T09:00:00Z', status: 'scheduled', sourceUrl: early, releaseKind: ['member-advance'] }]);
    expect(service.status().warnings.some(value => value.includes('人工修正未加载'))).toBe(true);
  });
  it('会员单次事件不抑制同刻普通周期，也不独立加入番表', async () => {
    const { service } = await setup([]), snapshot = service.catalog()!;
    const memberEvent = { animeId: 'bgm:1', at: '2026-10-26T09:00:00Z', status: 'scheduled' as const, sourceUrl: early, releaseKind: 'member-advance' as const };
    const overrides: Overrides = { ...snapshot.overrides, events: [memberEvent, { ...memberEvent, at: '2026-10-27T08:00:00Z' }] };
    const modified: CatalogSnapshot = { ...snapshot, overrides };
    const events = buildSchedule(modified, { start: '2026-10-25T16:00:00Z', end: '2026-11-01T16:00:00Z' });
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ at: '2026-10-26T09:00:00.000Z', basis: 'estimated' });
  });
  it('人工多周期仅剔除命中的抢先副周期，保留正常主周期', async () => {
    const sourceUrl = exclusion.sourceUrl;
    const { service } = await setup([{ ...exclusion, kind: 'network', platform: '正常配信', releaseKind: 'regular', broadcast: normalPeriod, broadcasts: [earlyPeriod], candidateExclusions: [{ sourceUrl, broadcast: earlyPeriod }] }]);
    const item = service.item('bgm:1')!;
    expect(item.rule.anchor).toBe('2026-10-20T10:00:00.000Z');
    expect(item.networkAiring?.rules?.map(rule => rule.anchor)).toEqual(['2026-10-20T10:00:00.000Z']);
    expect(buildSchedule(service.catalog()!, { start: '2026-10-25T16:00:00Z', end: '2026-11-01T16:00:00Z' }).map(event => event.at)).toEqual(['2026-10-27T10:00:00.000Z']);
  });
  it('人工主周期被排除时选用合格副周期，未核实的正常首播不保留抢先日期', async () => {
    const sourceUrl = exclusion.sourceUrl;
    const { service } = await setup([{ ...exclusion, kind: 'network', platform: '正常配信', releaseKind: 'regular', broadcast: earlyPeriod, broadcasts: [normalPeriod], begin: '2026-10-19T09:00:00Z', candidateExclusions: [{ sourceUrl, broadcast: earlyPeriod }] }]);
    const item = service.item('bgm:1')!;
    expect(item.rule.anchor).toBe('2026-10-20T10:00:00.000Z');
    expect(item.networkAiring?.begin).toBe('');
    expect(item.networkAiring?.rules?.map(rule => rule.anchor)).toEqual(['2026-10-20T10:00:00.000Z']);
  });
  it('人工主周期被排除时仍保留独立单次规则证实的普通首播', async () => {
    const sourceUrl = exclusion.sourceUrl, begin = '2026-10-18T10:00:00Z';
    const { service } = await setup([{ ...exclusion, kind: 'network', platform: '正常配信', releaseKind: 'regular', broadcast: earlyPeriod, broadcasts: [normalPeriod, `R/${begin}/P0D`], begin, candidateExclusions: [{ sourceUrl, broadcast: earlyPeriod }] }]);
    expect(service.item('bgm:1')?.rule.anchor).toBe('2026-10-20T10:00:00.000Z');
    expect(service.item('bgm:1')?.networkAiring?.begin).toBe(begin);
  });
  it('普通人工主周期保留时，被排除的单次首播日期也不显示', async () => {
    const sourceUrl = exclusion.sourceUrl, begin = '2026-10-19T09:00:00Z', first = `R/${begin}/P0D`;
    const { service } = await setup([{ ...exclusion, kind: 'network', platform: '正常配信', releaseKind: 'regular', broadcast: normalPeriod, broadcasts: [first], begin, candidateExclusions: [{ sourceUrl, broadcast: first }] }]);
    expect(service.item('bgm:1')?.rule.anchor).toBe('2026-10-20T10:00:00.000Z');
    expect(service.item('bgm:1')?.networkAiring?.begin).toBe('');
  });
});

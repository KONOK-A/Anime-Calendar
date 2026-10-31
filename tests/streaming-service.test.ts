import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnimeService } from '../server/service.js';
import { CacheStore } from '../server/cache.js';
import { normalizeStreamingData, normalizeStreamingSchedulePage } from '../server/streaming-sources.js';
import { buildSchedule } from '../shared/schedule.js';
import { rawCalendar, rawCatalog } from './fixtures.js';

const directories: string[] = [], services: AnimeService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) { await service.drain(); service.close(); }
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
const html = (clock: number) => `<title>2026年秋アニメ 配信ラインアップ</title><div id="autumn_saturday"></div><p class="x__lead">10/3配信開始 以降${clock}:00更新</p><h4>ロメリア戦記</h4>`;
const currentWeek = { start: '2026-10-25T16:00:00Z', end: '2026-11-01T16:00:00Z' };
function raw() {
  return { siteMeta: { ...rawCatalog.siteMeta, unext: { type: 'onair', title: 'U-NEXT', urlTemplate: 'https://video.unext.jp/title/{{id}}' } }, items: [{ ...rawCatalog.items[0], title: 'ロメリア戦記', titleTranslate: {}, begin: '2026-10-10T13:00:00Z', broadcast: 'R/2026-10-10T13:00:00Z/P7D', sites: [{ site: 'bangumi', id: '1' }, { site: 'unext', id: 'SID0000001' }] }] };
}
async function setup(options: { time?: { value: string }; clock?: number; overrides?: object; cachedClock?: number; sourceFailure?: { value: boolean } } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'anime-streaming-test-')); directories.push(directory);
  const overridesPath = join(directory, 'overrides.json'), store = new CacheStore(directory), source = raw(), time = options.time ?? { value: '2026-10-29T04:00:00Z' };
  await writeFile(overridesPath, JSON.stringify(options.overrides ?? { version: 1, active: [], events: [] }));
  await writeFile(join(directory, 'streaming-schedules.json'), JSON.stringify(normalizeStreamingSchedulePage(html(21))));
  await store.write('catalog', source, time.value); await store.write('calendar', rawCalendar, time.value);
  if (options.cachedClock) await store.write('streaming-2026-4', normalizeStreamingSchedulePage(html(options.cachedClock)), time.value);
  let officialReads = 0;
  const service = new AnimeService({ directory, overridesPath, now: () => new Date(time.value), fetcher: async url => {
    if (url === 'https://www.video.unext.jp/season_anime/autumn') { officialReads++; return options.sourceFailure?.value ? new Response('temporary failure', { status: 400 }) : new Response(html(options.clock ?? 23)); }
    if (url.includes('/calendar')) return new Response(JSON.stringify(rawCalendar));
    if (url.includes('bangumi-data')) return new Response(JSON.stringify(source));
    throw new Error(`Unexpected upstream: ${url}`);
  } });
  services.push(service); await service.initialize();
  return { service, directory, officialReads: () => officialReads };
}

describe('官方网络排期服务接合', () => {
  it('自动失败退避保留种子，手动刷新可在来源恢复后立即重试', async () => {
    const sourceFailure = { value: true };
    const { service, officialReads } = await setup({ sourceFailure });
    await service.refresh('stale');
    const failedReads = officialReads(); expect(failedReads).toBe(1);
    expect(service.catalog()!.items[0]!.networkAiring?.platform).toBe('U-NEXT');
    sourceFailure.value = false;
    await service.refresh('stale'); expect(officialReads()).toBe(failedReads);
    await service.refresh(); expect(officialReads()).toBe(failedReads + 1);
    expect(service.catalog()!.items[0]!.rule.anchor).toBe('2026-10-10T14:00:00.000Z');
  });
  it('启动直接使用种子展示网络时刻，原电视参考保留，无上游读取', async () => {
    const { service, officialReads } = await setup();
    expect(buildSchedule(service.catalog()!, currentWeek).map(event => event.at)).toEqual(['2026-10-31T12:00:00.000Z']);
    expect(service.catalog()!.items[0]!.broadcastRule.anchor).toBe('2026-10-10T13:00:00.000Z');
    expect(officialReads()).toBe(0);
  });
  it('同源缓存替换种子，24小时内复用，过期后仅读取一次官方页并保存新周期', async () => {
    const time = { value: '2026-10-29T04:00:00Z' };
    const { service, directory, officialReads } = await setup({ time, cachedClock: 22, clock: 23 });
    expect(service.catalog()!.items[0]!.rule.anchor).toBe('2026-10-10T13:00:00.000Z');
    expect(service.needsRefresh()).toBe(false);
    time.value = '2026-10-30T03:00:00Z'; await service.refresh('stale');
    expect(officialReads()).toBe(0);
    time.value = '2026-10-30T05:00:00Z'; await service.refresh('stale');
    expect(officialReads()).toBe(1);
    expect(service.catalog()!.items[0]!.rule.anchor).toBe('2026-10-10T14:00:00.000Z');
    const refreshed = await new CacheStore(directory).read('streaming-2026-4', normalizeStreamingData);
    expect(refreshed?.data.records[0]!.rule.anchor).toBe('2026-10-10T14:00:00.000Z');
  });
  it('官方刷新后仍保留人工一周两播，未知首次日期保持待定', async () => {
    const { service, officialReads } = await setup({ overrides: { version: 1, active: [], events: [], rules: [{ animeId: 'bgm:1', kind: 'network', begin: '', broadcast: 'R/2026-10-05T07:00:00Z/P7D', broadcasts: ['R/2026-10-05T07:00:00Z/P7D', 'R/2026-10-09T07:00:00Z/P7D'], platform: 'YouTube / FOD / TVer', regions: ['JP'], sourceUrl: 'https://yusanchi-anime.jp/', note: '官网周一、五日本16:00配信。' }] } });
    await service.refresh();
    expect(officialReads()).toBe(1);
    expect(service.catalog()!.items[0]!.networkAiring?.begin).toBe('');
    expect(buildSchedule(service.catalog()!, currentWeek).map(event => event.at)).toEqual(['2026-10-26T07:00:00.000Z', '2026-10-30T07:00:00.000Z']);
  });
});

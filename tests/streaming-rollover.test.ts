import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnimeService } from '../server/service.js';
import { CacheStore } from '../server/cache.js';
import { normalizeStreamingSchedulePage, type StreamingSchedulePage } from '../server/streaming-sources.js';
import { buildSchedule } from '../shared/schedule.js';
import { rawCatalog } from './fixtures.js';

const directories: string[] = [], services: AnimeService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) { await service.drain(); service.close(); }
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

const officialUrl = (quarter: string) => `https://www.video.unext.jp/season_anime/${quarter}`;
const autumnHtml = '<title>2026年秋アニメ 配信ラインアップ</title><div id="autumn_saturday"></div><p class="x__lead">10/3 23:00配信開始 以降23:00更新</p><h4>Autumn work</h4>';
const winterHtml = '<title>2027年冬アニメ 配信ラインアップ</title><div id="winter_monday"></div><p class="x__lead">1/4 23:00配信開始 以降23:00更新</p><h4>Winter work</h4>';
const autumnPage = () => normalizeStreamingSchedulePage(autumnHtml, officialUrl('autumn'));
function work(id: number, title: string, begin: string) {
  return { ...rawCatalog.items[0], title, titleTranslate: {}, begin, broadcast: `R/${begin}/P7D`, sites: [{ site: 'bangumi', id: String(id) }, { site: 'unext', id: `SID${String(id).padStart(7, '0')}` }] };
}
function catalog() {
  return { siteMeta: { ...rawCatalog.siteMeta, unext: { type: 'onair', title: 'U-NEXT', urlTemplate: 'https://video.unext.jp/title/{{id}}' } }, items: [
    work(1, 'Autumn work', '2026-10-03T13:00:00Z'),
    work(3, 'Winter work', '2027-01-04T13:00:00Z'),
  ] };
}
const calendar = (ids: number[]) => [{ weekday: { id: 1, cn: '星期一' }, items: ids.map(id => ({ id, type: 2 })) }];
function page(season: string, title: string, anchor: string, end: string | null = null): StreamingSchedulePage {
  return { season, records: [{ season, title, begin: anchor, premiereDate: anchor.slice(0, 10), premiereAt: anchor,
    rule: { anchor, end, raw: `R/${anchor}/P7D`, frequency: 'weekly' }, platform: 'U-NEXT', regions: ['JP'],
    sourceUrl: officialUrl(['winter', 'spring', 'summer', 'autumn'][Number(season.split('-')[1]) - 1]!), note: 'Fixture publisher schedule' }] };
}
async function setup(at: string, options: { source?: object; ids?: number[]; active?: { animeId: string; active: boolean; sourceUrl: string }[] } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'anime-streaming-rollover-')); directories.push(directory);
  const overridesPath = join(directory, 'overrides.json'), store = new CacheStore(directory), source = options.source ?? catalog(), active = calendar(options.ids ?? [1, 3]);
  await writeFile(overridesPath, JSON.stringify({ version: 1, active: options.active ?? [], events: [] }));
  await store.write('catalog', source, at); await store.write('calendar', active, at);
  return { directory, overridesPath, store, source, active };
}
async function start(setup: { directory: string; overridesPath: string }, time: { value: string }, fetcher: (url: string) => Promise<Response> = async () => { throw new Error('Offline fixture only'); }) {
  const service = new AnimeService({ directory: setup.directory, overridesPath: setup.overridesPath, now: () => new Date(time.value), fetcher });
  services.push(service); await service.initialize(); return service;
}

describe('官方网络排期跨季与快照边界', () => {
  it('旧季度24小时内的新鲜缓存不会阻挡北京时间新季度的后台更新', async () => {
    const time = { value: '2026-12-31T15:00:00Z' }, fixture = await setup(time.value);
    await fixture.store.write('streaming-2026-4', autumnPage(), time.value);
    const reads: string[] = [];
    const service = await start(fixture, time, async url => {
      reads.push(url);
      if (url === officialUrl('winter')) return new Response(winterHtml);
      throw new Error(`Unexpected fixture upstream: ${url}`);
    });
    expect(service.item('bgm:1')?.networkAiring?.platform).toBe('U-NEXT');
    time.value = '2026-12-31T15:30:00Z'; expect(service.needsRefresh()).toBe(false);
    time.value = '2026-12-31T16:00:00.001Z'; expect(service.needsRefresh()).toBe(true);
    await service.refresh('stale');
    expect(service.item('bgm:3')?.rule).toMatchObject({ frequency: 'weekly', anchor: '2027-01-04T14:00:00.000Z' });
    expect(reads).toEqual([officialUrl('winter')]);
    expect(service.needsRefresh()).toBe(false);
    expect(JSON.parse(await readFile(join(fixture.directory, 'streaming-2027-1.json'), 'utf8')).data.season).toBe('2027-1');
  });

  it('跨年时旧季度失败冷却不会阻挡新季度，旧季度内仍复用冷却', async () => {
    const time = { value: '2026-12-31T15:50:00Z' }, fixture = await setup(time.value);
    await fixture.store.write('streaming-2026-4', autumnPage(), '2026-12-30T14:00:00Z');
    const reads: string[] = [];
    const service = await start(fixture, time, async url => {
      reads.push(url);
      if (url === officialUrl('autumn')) return new Response('temporary failure', { status: 400 });
      if (url === officialUrl('winter')) return new Response(winterHtml);
      throw new Error(`Unexpected fixture upstream: ${url}`);
    });
    await service.refresh('stale'); await service.refresh('stale');
    expect(reads).toEqual([officialUrl('autumn')]);
    time.value = '2026-12-31T16:01:00Z'; expect(service.needsRefresh()).toBe(true);
    await service.refresh('stale');
    expect(service.item('bgm:3')?.networkAiring?.platform).toBe('U-NEXT');
    expect(reads).toEqual([officialUrl('autumn'), officialUrl('winter')]);
  });

  it.each([
    { title: '上一季度在播作品', season: '2026-4', begin: '2026-10-03T13:00:00Z', anchor: '2026-10-03T14:00:00Z', id: 1 },
    { title: '跨越多个季度的长篇在播作品', season: '2026-2', begin: '2026-04-06T13:00:00Z', anchor: '2026-04-06T14:00:00Z', id: 4 },
  ])('跨季重启离线恢复：$title', async ({ season, begin, anchor, id }) => {
    const source = catalog(); if (id !== 1) source.items.push(work(id, 'Long-running work', begin));
    const time = { value: '2026-12-31T16:01:00Z' }, fixture = await setup(time.value, { source, ids: [id] });
    await fixture.store.write(`streaming-${season}`, page(season, id === 1 ? 'Autumn work' : 'Long-running work', anchor), '2026-12-31T15:00:00Z');
    const service = await start(fixture, time);
    expect(service.item(`bgm:${id}`)?.networkAiring?.platform).toBe('U-NEXT');
    expect(buildSchedule(service.catalog()!, { start: '2027-01-04T00:00:00Z', end: '2027-01-11T00:00:00Z' })).toEqual([
      expect.objectContaining({ animeId: `bgm:${id}`, at: id === 1 ? '2027-01-09T14:00:00.000Z' : '2027-01-04T14:00:00.000Z' }),
    ]);
  });

  it('长篇在播的必要季度缓存超过90天仍可在连续重启后恢复', async () => {
    const source = catalog(); source.items.push(work(4, 'Long-running work', '2026-04-06T13:00:00Z'));
    const time = { value: '2026-12-31T16:01:00Z' }, fixture = await setup(time.value, { source, ids: [4] });
    await fixture.store.write('streaming-2026-2', page('2026-2', 'Long-running work', '2026-04-06T14:00:00Z'), '2026-04-07T00:00:00Z');
    const path = join(fixture.directory, 'streaming-2026-2.json'), old = new Date(Date.now() - 91 * 86_400_000);
    await utimes(path, old, old);
    const first = await start(fixture, time);
    expect(first.item('bgm:4')?.networkAiring?.platform).toBe('U-NEXT');
    await first.drain(); first.close(); services.splice(services.indexOf(first), 1);
    const restarted = await start(fixture, time);
    expect(restarted.item('bgm:4')?.networkAiring?.platform).toBe('U-NEXT');
    expect(buildSchedule(restarted.catalog()!, { start: '2027-01-04T00:00:00Z', end: '2027-01-11T00:00:00Z' })).toEqual([
      expect.objectContaining({ animeId: 'bgm:4', at: '2027-01-04T14:00:00.000Z' }),
    ]);
  });

  it('重启时人工确认在播的旧作也恢复缓存，人工停止在播的作品不继续排期', async () => {
    const source = catalog(); source.items.push(work(5, 'Manual active work', '2026-07-04T13:00:00Z'));
    const time = { value: '2026-12-31T16:01:00Z' }, fixture = await setup(time.value, { source, ids: [1], active: [
      { animeId: 'bgm:5', active: true, sourceUrl: 'https://example.com/onair' },
      { animeId: 'bgm:1', active: false, sourceUrl: 'https://example.com/onair' },
    ] });
    await fixture.store.write('streaming-2026-3', page('2026-3', 'Manual active work', '2026-07-04T14:00:00Z'), '2026-12-31T15:00:00Z');
    await fixture.store.write('streaming-2026-4', autumnPage(), '2026-12-31T15:00:00Z');
    const service = await start(fixture, time);
    expect(service.item('bgm:5')?.networkAiring?.platform).toBe('U-NEXT');
    expect(buildSchedule(service.catalog()!, { start: '2027-01-04T00:00:00Z', end: '2027-01-11T00:00:00Z' })).toEqual([
      expect.objectContaining({ animeId: 'bgm:5', at: '2027-01-09T14:00:00.000Z' }),
    ]);
  });

  it('启动时旧季度作品尚未在播，刷新名单后补读新需要的季度缓存', async () => {
    const time = { value: '2027-01-04T01:00:00Z' }, fixture = await setup(time.value, { ids: [3] });
    await fixture.store.write('streaming-2026-4', autumnPage(), '2027-01-04T00:00:00Z');
    const service = await start(fixture, time, async url => {
      if (url === 'https://api.bgm.tv/calendar') return new Response(JSON.stringify(calendar([1, 3])));
      if (url.includes('bangumi-data')) return new Response(JSON.stringify(fixture.source));
      if (url === officialUrl('winter')) return new Response(winterHtml);
      throw new Error(`Unexpected fixture upstream: ${url}`);
    });
    expect(service.item('bgm:1')?.networkAiring).toBeUndefined();
    expect(service.item('bgm:1')?.rule.frequency).toBe('unknown');
    await service.refresh();
    expect(service.catalog()?.activeIds).toContain('bgm:1');
    expect(service.item('bgm:1')?.rule).toMatchObject({ frequency: 'weekly', anchor: '2026-10-03T14:00:00.000Z' });
    expect(buildSchedule(service.catalog()!, { start: '2027-01-04T00:00:00Z', end: '2027-01-11T00:00:00Z' }).filter(event => event.animeId === 'bgm:1')).toEqual([
      expect.objectContaining({ animeId: 'bgm:1', at: '2027-01-09T14:00:00.000Z' }),
    ]);
  });

  it('当前季度缓存损坏时保留基础目录和其他有效在播季度缓存', async () => {
    const time = { value: '2026-12-31T16:01:00Z' }, fixture = await setup(time.value);
    await fixture.store.write('streaming-2026-4', autumnPage(), '2026-12-31T15:00:00Z');
    await writeFile(join(fixture.directory, 'streaming-2027-1.json'), '{broken', 'utf8');
    const service = await start(fixture, time);
    expect(service.catalog()?.items).toHaveLength(2);
    expect(service.item('bgm:1')?.networkAiring?.platform).toBe('U-NEXT');
    expect(service.item('bgm:3')?.rule.frequency).toBe('unknown');
    expect(service.status().warnings.join(' ')).toContain('缓存');
    expect(await readFile(join(fixture.directory, 'streaming-2027-1.json'), 'utf8')).toBe('{broken');
  });

  it('跨季重启后刷新失败仍保留过期旧网络缓存，未确认的作品不回退电视排期', async () => {
    const time = { value: '2027-01-04T01:00:00Z' }, fixture = await setup(time.value);
    await fixture.store.write('streaming-2026-4', autumnPage(), '2026-12-30T14:00:00Z');
    const previous = await readFile(join(fixture.directory, 'streaming-2026-4.json'), 'utf8');
    const service = await start(fixture, time, async url => {
      if (url.startsWith('https://www.video.unext.jp/season_anime/')) return new Response('temporary failure', { status: 400 });
      throw new Error(`Unexpected fixture upstream: ${url}`);
    });
    await service.refresh('stale');
    expect(service.item('bgm:1')?.rule).toMatchObject({ frequency: 'weekly', anchor: '2026-10-03T14:00:00.000Z' });
    expect(service.item('bgm:3')?.broadcastRule.frequency).toBe('weekly');
    expect(service.item('bgm:3')?.rule.frequency).toBe('unknown');
    expect(buildSchedule(service.catalog()!, { start: '2027-01-04T00:00:00Z', end: '2027-01-11T00:00:00Z' })).toEqual([
      expect.objectContaining({ animeId: 'bgm:1', at: '2027-01-09T14:00:00.000Z' }),
    ]);
    expect(service.status().warnings.join(' ')).toContain('保留已有参考');
    expect(await readFile(join(fixture.directory, 'streaming-2026-4.json'), 'utf8')).toBe(previous);
  });

  it('越过多个结束边界重建快照时保留官方来源冲突且结束提示不重复累加', async () => {
    const source = structuredClone(rawCatalog); source.items[1]!.type = 'tv';
    const time = { value: '2026-10-26T14:00:00Z' }, fixture = await setup(time.value, { source, ids: [1, 2] });
    const first = page('2026-4', 'テストの旅', '2026-10-19T14:30:00Z', '2026-10-26T14:30:00Z');
    const second = page('2026-4', '帰り道', '2026-10-19T14:35:00Z', '2026-10-26T14:35:00Z');
    await writeFile(join(fixture.directory, 'streaming-schedules.json'), JSON.stringify({ season: '2026-4', records: [...first.records, ...second.records] }));
    const service = await start(fixture, time);
    const before = service.catalog()!;
    expect(before.warnings.filter(warning => warning.includes('采用官方网络排期'))).toHaveLength(1);
    expect(before.warnings.filter(warning => warning.includes('已有结束日期'))).toHaveLength(0);
    time.value = '2026-10-26T14:30:00Z';
    expect(service.catalog()!.warnings.filter(warning => warning.includes('已有结束日期'))).toHaveLength(0);
    time.value = '2026-10-26T14:30:00.001Z';
    const firstBoundary = service.catalog()!;
    expect(firstBoundary.warnings.filter(warning => warning.includes('采用官方网络排期'))).toHaveLength(1);
    expect(firstBoundary.warnings.filter(warning => warning.includes('已有结束日期'))).toHaveLength(1);
    time.value = '2026-10-26T14:35:00.001Z';
    const secondBoundary = service.catalog()!;
    expect(secondBoundary.warnings.filter(warning => warning.includes('采用官方网络排期'))).toHaveLength(1);
    expect(secondBoundary.warnings.filter(warning => warning.includes('已有结束日期'))).toHaveLength(2);
    expect(new Set(secondBoundary.warnings).size).toBe(secondBoundary.warnings.length);
    expect(firstBoundary.warnings.filter(warning => warning.includes('已有结束日期'))).toHaveLength(1);
    expect(before.warnings.filter(warning => warning.includes('已有结束日期'))).toHaveLength(0);
  });
});

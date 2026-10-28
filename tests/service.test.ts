import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnimeService } from '../server/service.js';
import { rawCalendar, rawCatalog } from './fixtures.js';
import { buildSchedule } from '../shared/schedule.js';

const directories: string[] = [];
async function directory() { const value = await mkdtemp(join(tmpdir(), 'anime-calendar-test-')); directories.push(value); return value; }
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
const now = () => new Date('2026-10-29T04:00:00Z');
function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }); }

describe('数据缓存与刷新', () => {
  it('官方网络修正优先于错误的页面时间，原电视周期保留，刷新不会覆盖修正', async () => {
    const dir = await directory(), overridesPath = join(dir, 'overrides.json');
    await writeFile(overridesPath, JSON.stringify({ version: 1, active: [], events: [], rules: [{ animeId: 'bgm:1', kind: 'network', platform: '官方先行平台', regions: ['JP'], broadcast: 'R/2026-10-17T12:00:00Z/P7D', sourceUrl: 'https://example.com/onair', note: '官网网络先行' }] }));
    const data = structuredClone(rawCatalog);
    data.items[0].sites.push({ site: 'bilibili', id: '11', begin: '2026-09-01T00:00:00Z', broadcast: 'R/2026-09-01T00:00:00Z/P7D', end: '2026-09-30T00:00:00Z' });
    const service = new AnimeService({ directory: dir, overridesPath, now, fetcher: async url => response(url.includes('/calendar') ? rawCalendar : data) });
    await service.initialize(); await service.refresh();
    expect(service.catalog()?.items[0].networkAiring).toMatchObject({ platform: '官方先行平台', sourceUrl: 'https://example.com/onair' });
    expect(service.catalog()?.items[0].broadcastRule.anchor).toBe('2026-10-19T15:30:00.000Z');
    expect(service.catalog()?.items[0].rule.end).toBeNull();
    await service.refresh(); expect(service.catalog()?.items[0].rule.anchor).toBe('2026-10-17T12:00:00.000Z');
  });
  it('官方标明平台先行但晚于AT-X时，也按指定网络时段显示', async () => {
    const dir = await directory(), overridesPath = join(dir, 'overrides.json');
    await writeFile(overridesPath, JSON.stringify({ version: 1, active: [], events: [], rules: [{ animeId: 'bgm:1', kind: 'network', platform: '网络先行平台', regions: ['JP'], broadcast: 'R/2026-10-19T16:00:00Z/P7D', sourceUrl: 'https://example.com/onair', note: '晚于AT-X但先于普通网络平台' }] }));
    const service = new AnimeService({ directory: dir, overridesPath, now, fetcher: async url => response(url.includes('/calendar') ? rawCalendar : rawCatalog) });
    await service.initialize(); await service.refresh();
    expect(service.catalog()?.items[0].rule.anchor).toBe('2026-10-19T16:00:00.000Z');
    expect(service.catalog()?.items[0].broadcastRule.anchor).toBe('2026-10-19T15:30:00.000Z');
  });
  it('网络晚于电视时不会被电视完结时刻截掉末集', async () => {
    const dir = await directory(), overridesPath = join(dir, 'overrides.json');
    await writeFile(overridesPath, JSON.stringify({ version: 1, active: [], events: [], rules: [{ animeId: 'bgm:1', kind: 'network', platform: '官方网络', broadcast: 'R/2026-10-19T16:00:00Z/P7D', sourceUrl: 'https://example.com/onair', note: '电视后30分钟网络先行' }] }));
    const data = structuredClone(rawCatalog); data.items[0].end = '2026-11-02T15:30:00Z';
    const service = new AnimeService({ directory: dir, overridesPath, now, fetcher: async url => response(url.includes('/calendar') ? rawCalendar : data) });
    await service.initialize(); await service.refresh();
    const snapshot = service.catalog()!;
    expect(snapshot.items[0].rule.end).toBe('2026-11-02T16:00:00.000Z');
    expect(buildSchedule(snapshot, { start: '2026-11-02T00:00:00Z', end: '2026-11-09T00:00:00Z' }).map(x => x.at)).toEqual(['2026-11-02T16:00:00.000Z']);
  });
  it('提前一周的网络完结后不再沿电视时间多生成一集', async () => {
    const dir = await directory(), overridesPath = join(dir, 'overrides.json');
    await writeFile(overridesPath, JSON.stringify({ version: 1, active: [], events: [], rules: [{ animeId: 'bgm:1', kind: 'network', platform: '官方网络', broadcast: 'R/2026-10-12T15:30:00Z/P7D', sourceUrl: 'https://example.com/onair', note: '一周先行' }] }));
    const data = structuredClone(rawCatalog); data.items[0].end = '2026-11-02T15:30:00Z';
    const service = new AnimeService({ directory: dir, overridesPath, now, fetcher: async url => response(url.includes('/calendar') ? rawCalendar : data) });
    await service.initialize(); await service.refresh();
    expect(service.catalog()?.items[0].rule.end).toBe('2026-10-26T15:30:00.000Z');
    expect(buildSchedule(service.catalog()!, { start: '2026-11-02T00:00:00Z', end: '2026-11-09T00:00:00Z' })).toEqual([]);
  });
  it('独立核实的网络结束时间优先于电视截止时间', async () => {
    const dir = await directory(), overridesPath = join(dir, 'overrides.json');
    await writeFile(overridesPath, JSON.stringify({ version: 1, active: [], events: [], rules: [{ animeId: 'bgm:1', kind: 'network', platform: '官方网络', broadcast: 'R/2026-10-19T16:00:00Z/P7D', end: '2026-11-09T16:00:00Z', sourceUrl: 'https://example.com/onair', note: '网络有单独完结公告' }] }));
    const data = structuredClone(rawCatalog); data.items[0].end = '2026-11-02T15:30:00Z';
    const service = new AnimeService({ directory: dir, overridesPath, now, fetcher: async url => response(url.includes('/calendar') ? rawCalendar : data) });
    await service.initialize(); await service.refresh();
    expect(service.catalog()?.items[0].rule.end).toBe('2026-11-09T16:00:00.000Z');
  });
  it('官方确认并非先行时忽略错误平台记录，保留更新中的原放送规则', async () => {
    const dir = await directory(), overridesPath = join(dir, 'overrides.json');
    await writeFile(overridesPath, JSON.stringify({ version: 1, active: [], events: [], rules: [{ animeId: 'bgm:1', kind: 'broadcast', sourceUrl: 'https://example.com/onair', note: '官网说明网络在电视之后；源页面日期错误' }] }));
    const data = structuredClone(rawCatalog);
    data.items[0].sites.push({ site: 'bilibili', id: '11', begin: '2026-10-17T00:00:00Z', broadcast: 'R/2026-10-17T00:00:00Z/P7D' });
    const service = new AnimeService({ directory: dir, overridesPath, now, fetcher: async url => response(url.includes('/calendar') ? rawCalendar : data) });
    await service.initialize(); await service.refresh();
    expect(service.status().warnings.join(' ')).not.toContain('人工修正未加载');
    expect(service.catalog()?.items[0].networkAiring).toBeUndefined();
    expect(service.catalog()?.items[0].rule.anchor).toBe('2026-10-19T15:30:00.000Z');
  });
  it('刷新去重，完成后可从磁盘重启读取，六小时内无需重新获取', async () => {
    const dir = await directory();
    const service = new AnimeService({ directory: dir, now, fetcher: async url => response(url.includes('/calendar') ? rawCalendar : rawCatalog) });
    await service.initialize();
    const first = service.refresh(), second = service.refresh(); expect(first).toBe(second); await first;
    expect(service.catalog()?.items).toHaveLength(2);
    expect(service.status()).toMatchObject({ refreshing: false, sources: { catalog: { fetchedAt: '2026-10-29T04:00:00.000Z', error: null } } });
    const restored = new AnimeService({ directory: dir, now, fetcher: async () => { throw new Error('offline'); } });
    await restored.initialize(); expect(restored.catalog()?.activeIds).toContain('bgm:1'); expect(restored.needsRefresh()).toBe(false);
  });
  it('单源失败不会覆盖其有效快照，也不阻止另一个来源更新', async () => {
    const dir = await directory(); let broken = false;
    const service = new AnimeService({ directory: dir, now, fetcher: async url => response(url.includes('/calendar') ? rawCalendar : broken ? { error: 'bad response' } : rawCatalog) });
    await service.initialize(); await service.refresh(); const old = await readFile(join(dir, 'catalog.json'), 'utf8'); broken = true; await service.refresh();
    expect(await readFile(join(dir, 'catalog.json'), 'utf8')).toBe(old);
    expect(service.catalog()?.items).toHaveLength(2);
    expect(service.status().sources.catalog.error).toBeTruthy(); expect(service.status().sources.calendar.error).toBeNull();
  });
  it('首次损坏缓存可报告并恢复，读取时不删除原始文件', async () => {
    const dir = await directory(); await writeFile(join(dir, 'catalog.json'), '{broken', 'utf8');
    const service = new AnimeService({ directory: dir, now, fetcher: async url => response(url.includes('/calendar') ? rawCalendar : rawCatalog) });
    await service.initialize(); expect(service.catalog()).toBeNull(); expect(service.status().warnings.join(' ')).toContain('缓存');
    expect(await readFile(join(dir, 'catalog.json'), 'utf8')).toBe('{broken'); await service.refresh(); expect(service.catalog()?.items).toHaveLength(2);
  });
  it('详情缓存24小时，离线时继续返回旧详情和错误提示', async () => {
    const dir = await directory(); let time = now(), offline = false;
    const service = new AnimeService({ directory: dir, now: () => time, fetcher: async url => {
      if (offline) throw new Error('network offline');
      return response(url.includes('/subjects/') ? { id: 1, name: 'テストの旅', name_cn: '星旅', summary: '旅途简介', images: { large: 'https://example.com/cover.jpg' }, total_episodes: 12, tags: [{ name: '冒险' }] } : url.includes('/calendar') ? rawCalendar : rawCatalog);
    } });
    await service.initialize(); await service.refresh(); expect((await service.detail('bgm:1'))?.summary).toBe('旅途简介');
    offline = true; expect((await service.detail('bgm:1'))?.detailError).toBeNull();
    time = new Date('2026-10-31T04:00:00Z');
    expect(await service.detail('bgm:1')).toMatchObject({ summary: '旅途简介', detailError: expect.any(String) });
    expect(service.catalog()?.items).toHaveLength(2);
  });
  it('所有上游请求共享两个并发名额', async () => {
    const dir = await directory(); let active = 0, peak = 0;
    const service = new AnimeService({ directory: dir, now, fetcher: async url => {
      active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 10)); active--;
      const id = Number(url.split('/').at(-1));
      return response(url.includes('/subjects/') ? { id, name: 'sample', summary: '', images: {} } : url.includes('/calendar') ? rawCalendar : rawCatalog);
    } });
    await service.initialize(); await service.refresh();
    await Promise.all([service.refresh(), service.detail('bgm:1'), service.detail('bgm:2')]); expect(peak).toBe(2);
  });
});

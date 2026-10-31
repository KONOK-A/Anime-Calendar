import { createServer } from 'node:http';
import { listenTestServer } from './support/listen.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createApp } from '../server/app.js';
import { AnimeService } from '../server/service.js';
import { buildSchedule } from '../shared/schedule.js';
import { rawCatalog, rawCalendar } from './fixtures.js';
import type { Overrides } from '../shared/types.js';

let server: Server | undefined, directory: string | undefined;
afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; }
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function boot(available = true, overrides?: Overrides) {
  directory = await mkdtemp(join(tmpdir(), 'anime-view-'));
  const source = structuredClone(rawCatalog);
  source.items[1]!.broadcast = 'R/2026-10-30T10:00:00Z/P2D';
  source.items.push(
    { ...structuredClone(source.items[0]), title: '跨季作品', begin: '2026-07-01T00:00:00Z', broadcast: 'R/2026-10-28T12:00:00Z/P7D', sites: [{ site: 'bangumi', id: '3' }, { site: 'bilibili', id: '3', begin: '2026-07-01T00:00:00Z', broadcast: 'R/2026-10-28T12:00:00Z/P7D' }] },
    { ...structuredClone(source.items[0]), title: '元旦单次', begin: '2027-01-01T01:00:00Z', end: '2027-01-01T01:00:00Z', broadcast: '', sites: [{ site: 'bangumi', id: '4' }, { site: 'bilibili', id: '4', begin: '2027-01-01T01:00:00Z', broadcast: 'R/2027-01-01T01:00:00Z/P0D' }] },
  );
  const calendar = structuredClone(rawCalendar); calendar[0]!.items.push({ id: 3, type: 2 });
  const overridesPath = join(directory, 'overrides.json'); if (overrides) await writeFile(overridesPath, JSON.stringify(overrides));
  let upstreamCalls = 0;
  const service = new AnimeService({ directory, overridesPath, now: () => new Date('2026-10-29T04:00:00Z'), fetcher: async url => { upstreamCalls++; return new Response(JSON.stringify(url.includes('/calendar') ? calendar : source)); } });
  await service.initialize(); if (available) await service.refresh();
  const staticPath = join(directory, 'static');
  const app = createApp(service, staticPath);
  server = await listenTestServer(createServer(app));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test port');
  return { service, source, url: `http://127.0.0.1:${address.port}`, staticPath, calls: () => upstreamCalls };
}

describe('按页面读取目录', () => {
  it('周表包含跨季在播和当季待定，不下载无关季度，保留完整季度索引', async () => {
    const { url } = await boot();
    const response = await fetch(`${url}/api/catalog/weekly?week=2026-10-26&timezone=Asia/Shanghai`);
    expect(response.status).toBe(200);
    const view = await response.json();
    expect(view.catalog.items.map((item: { id: string }) => item.id)).toEqual(['bgm:1', 'bgm:2', 'bgm:3']);
    expect(view.seasons).toEqual([{ season: '2027-1', total: 1 }, { season: '2026-4', total: 2 }, { season: '2026-3', total: 1 }]);
    expect(view.status.hasCatalog).toBe(true); expect(view.revision).toEqual(expect.any(String));
    expect(view.scope.type).toBe('weekly');
    expect(buildSchedule(view.catalog, { start: '2026-10-25T16:00:00Z', end: '2026-11-01T16:00:00Z' }).map(event => [event.animeId, event.at]))
      .toEqual([['bgm:1', '2026-10-26T15:30:00.000Z'], ['bgm:3', '2026-10-28T12:00:00.000Z']]);
  });
  it('跨季度周窗包含下一季度的单次上线，不用当前季度代替排期窗口', async () => {
    const { url } = await boot();
    const response = await fetch(`${url}/api/catalog/weekly?week=2026-12-28&timezone=Asia/Tokyo`);
    expect(response.status).toBe(200);
    const view = await response.json();
    expect(view.catalog.items.some((item: { id: string }) => item.id === 'bgm:4')).toBe(true);
  });
  it('季度空结果与合法失联ID正常返回，尚无基础目录返回503', async () => {
    const { url } = await boot();
    const season = await fetch(`${url}/api/catalog/season?season=2025-1`);
    expect(season.status).toBe(200); expect((await season.json()).catalog.items).toEqual([]);
    const lookup = await fetch(`${url}/api/catalog/items?ids=bgm:3,bgm:3,bd:orphan`);
    expect(lookup.status).toBe(200);
    const view = await lookup.json(); expect(view.catalog.items.map((item: { id: string }) => item.id)).toEqual(['bgm:3']); expect(view.missingIds).toEqual(['bd:orphan']);
  });
  it('无缓存时范围接口提供来源状态供初始化重试，不伪装成空季度', async () => {
    const { url } = await boot(false);
    const response = await fetch(`${url}/api/catalog/season?season=2026-4`);
    expect(response.status).toBe(503); expect((await response.json()).status.hasCatalog).toBe(false);
    const items = await fetch(`${url}/api/catalog/items?ids=bgm:1`);
    expect(items.status).toBe(503); expect((await items.json()).missingIds).toEqual([]);
  });
  it('人工改档和休播记录优先，单次人工安排可使非当季作品进入周表', async () => {
    const { url } = await boot(true, { version: 1, active: [], events: [
      { animeId: 'bgm:1', originalAt: '2026-10-26T15:30:00Z', at: '2026-10-27T15:30:00Z', status: 'cancelled', sourceUrl: 'https://example.com/notice' },
      { animeId: 'bgm:4', at: '2026-10-29T03:00:00Z', status: 'scheduled', sourceUrl: 'https://example.com/special' },
    ] });
    const view = await (await fetch(`${url}/api/catalog/weekly?week=2026-10-26&timezone=Asia/Tokyo`)).json();
    expect(buildSchedule(view.catalog, { start: '2026-10-25T15:00:00Z', end: '2026-11-01T15:00:00Z' }).map(event => [event.animeId, event.at, event.status]))
      .toEqual([['bgm:1', '2026-10-27T15:30:00.000Z', 'cancelled'], ['bgm:3', '2026-10-28T12:00:00.000Z', 'scheduled'], ['bgm:4', '2026-10-29T03:00:00.000Z', 'scheduled']]);
  });
  it('范围读取只使用服务器快照，不新增上游请求', async () => {
    const { url, calls } = await boot(); const before = calls();
    await Promise.all(['/weekly?week=2026-10-26&timezone=Asia/Shanghai', '/season?season=2026-4', '/items?ids=bgm:1'].map(path => fetch(`${url}/api/catalog${path}`)));
    expect(calls()).toBe(before);
  });
  it('哈希资源允许长期缓存，HTML和无哈希资源仍重新验证', async () => {
    const { url, staticPath } = await boot(); await mkdir(join(staticPath, 'assets'), { recursive: true });
    await writeFile(join(staticPath, 'index.html'), '<div>page</div>');
    await writeFile(join(staticPath, 'assets', 'index-12345678.js'), 'console.log(1)');
    await writeFile(join(staticPath, 'plain.js'), 'console.log(2)');
    expect((await fetch(`${url}/assets/index-12345678.js`)).headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${url}/`)).headers.get('cache-control')).toBe('no-cache');
    expect((await fetch(`${url}/plain.js`)).headers.get('cache-control')).not.toContain('immutable');
  });
  it('拒绝非法范围和过量ID，正确区分周一与任意日期', async () => {
    const { url } = await boot();
    for (const path of ['/weekly?week=2026-10-27&timezone=Asia/Shanghai', '/weekly?week=2026-02-30&timezone=Asia/Tokyo', '/weekly?week=2026-10-26&timezone=UTC', '/season?season=2026-5', '/items?ids=invalid', `/items?ids=${Array.from({ length: 51 }, (_, index) => `bgm:${index}`).join(',')}`]) {
      expect((await fetch(`${url}/api/catalog${path}`)).status, path).toBe(400);
    }
  });
  it('内容未变时返回304，刷新后校验器改变，原完整接口仍然可用', async () => {
    const { url, service, source } = await boot();
    const path = `${url}/api/catalog/season?season=2026-4`;
    const first = await fetch(path); expect(first.status).toBe(200);
    const etag = first.headers.get('etag'); expect(etag).toBeTruthy(); await first.text();
    const second = await fetch(path, { headers: { 'if-none-match': etag! } });
    expect(second.status).toBe(304); expect(await second.text()).toBe('');
    expect(second.headers.get('cache-control')).toContain('private');
    expect((await (await fetch(`${url}/api/catalog`)).json()).items).toHaveLength(4);
    source.items[0]!.title = '原名改动'; await service.refresh();
    expect((await fetch(path, { headers: { 'if-none-match': etag! } })).status).toBe(200);
  });
});

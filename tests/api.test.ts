import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { AnimeService } from '../server/service.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { rawCatalog, rawCalendar } from './fixtures.js';

let server: Server | undefined, directory: string;
afterEach(async () => { if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); if (directory) await rm(directory, { recursive: true, force: true }); });
async function boot() {
  directory = await mkdtemp(join(tmpdir(), 'anime-calendar-api-'));
  const service = new AnimeService({ directory, fetcher: async url => new Response(JSON.stringify(url.includes('/calendar') ? rawCalendar : rawCatalog)) });
  await service.initialize(); const app = createApp(service, join(directory, 'dist'));
  server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing port');
  return { service, url: `http://127.0.0.1:${address.port}` };
}
describe('本地同源API', () => {
  it('首次无数据明确返回503，刷新后目录可用，不存在的条目返回404', async () => {
    const { service, url } = await boot(); expect((await fetch(`${url}/api/catalog`)).status).toBe(503);
    expect(await (await fetch(`${url}/api/status`)).json()).toMatchObject({ appId: 'anime-calendar', hasCatalog: false });
    const refresh = await fetch(`${url}/api/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); expect(refresh.status).toBe(202);
    await service.refresh(); expect((await (await fetch(`${url}/api/catalog`)).json()).items).toHaveLength(2);
    expect((await fetch(`${url}/api/anime/bgm:999`)).status).toBe(404);
    expect((await fetch(`${url}/api/anime/bgm:999/credits`)).status).toBe(404);
    expect((await fetch(`${url}/api/anime/bgm:999/character-names`)).status).toBe(404);
    expect((await fetch(`${url}/api/anime/bgm:1/character-names?offset=-1`)).status).toBe(400);
  });
  it('外站不能通过浏览器触发本地刷新', async () => {
    const { url } = await boot();
    expect((await fetch(`${url}/api/refresh`, { method: 'POST', headers: { origin: 'https://unrelated.example', 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
  });
});

import { createServer } from 'node:http';
import { listenTestServer } from './support/listen.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { AnimeService } from '../server/service.js';
import { createApp } from '../server/app.js';
import { rawCatalog, rawCalendar } from './fixtures.js';
const servers: Server[] = [], directories: string[] = [], services: AnimeService[] = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX6sAAAAASUVORK5CYII=', 'base64');
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } for (const service of services.splice(0)) await service.drain(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
describe('封面路由与资料兼容', () => {
  it('独立封面与详情复用一次元数据获取，三档来源与浏览器304正确', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'media-http-')); directories.push(directory);
    const calls: string[] = [];
    const service = new AnimeService({ directory, fetcher: async url => {
      calls.push(url);
      if (url.startsWith('https://lain.bgm.tv/')) return new Response(png, { headers: { 'content-type': 'image/png' } });
      if (url.includes('/subjects/')) return new Response(JSON.stringify({ id: 1, name: 'sample', images: { large: 'https://lain.bgm.tv/original.png', small: 'https://lain.bgm.tv/small.png', common: 'https://lain.bgm.tv/common.png', medium: 'https://lain.bgm.tv/medium.png' } }));
      return new Response(JSON.stringify(url.includes('/calendar') ? rawCalendar : rawCatalog));
    } }); services.push(service); await service.initialize(); await service.refresh();
    const server = await listenTestServer(createServer(createApp(service, directory))); servers.push(server);
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('port'); const base = `http://127.0.0.1:${address.port}`;
    const [poster, detail] = await Promise.all([fetch(`${base}/media/posters/bgm%3A1/card`), fetch(`${base}/api/anime/bgm%3A1`)]);
    expect(poster.status).toBe(200); expect(poster.headers.get('content-type')).toContain('image/png'); expect(poster.headers.get('cache-control')).toContain('max-age=86400');
    expect((await detail.json()).image).toBe('https://lain.bgm.tv/original.png');
    expect(calls.filter(url => url.includes('/subjects/'))).toHaveLength(1); expect(calls).toContain('https://lain.bgm.tv/common.png');
    const conditional = await fetch(`${base}/media/posters/bgm%3A1/card`, { headers: { 'if-none-match': poster.headers.get('etag')! } });
    expect(conditional.status).toBe(304); expect(await conditional.text()).toBe('');
    expect((await fetch(`${base}/media/posters/bgm%3A1/other`)).status).toBe(400);
    expect((await fetch(`${base}/media/posters/bgm%3A999/card`)).status).toBe(404);
  });
});

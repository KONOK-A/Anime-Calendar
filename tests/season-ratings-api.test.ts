import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { AnimeService } from '../server/service.js';
import { createApp } from '../server/app.js';
import { rawCatalog, rawCalendar } from './fixtures.js';
let server: Server | undefined, directory: string | undefined, service: AnimeService | undefined;
afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); } await service?.drain(); if (directory) await rm(directory, { recursive: true, force: true }); });
describe('按需评分接口', () => {
  it('普通目录不取整季评分；新接口复用缓存且不获取图片或CV', async () => {
    directory = await mkdtemp(join(tmpdir(), 'season-score-api-')); const requests: string[] = [];
    service = new AnimeService({ directory, fetcher: async url => { requests.push(url); return Response.json(url.includes('/subjects/') ? { id: Number(url.split('/').at(-1)), name: 'sample', summary: 'large summary', images: {}, rating: { score: 8, total: 10, rank: 1 } } : url.includes('/calendar') ? rawCalendar : rawCatalog); } });
    await service.initialize(); const app = createApp(service, directory); server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server!.once('listening', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('port'); const origin = `http://127.0.0.1:${address.port}`;
    expect((await fetch(`${origin}/api/catalog/ratings?season=2026-4`)).status).toBe(503);
    await service.refresh(); await fetch(`${origin}/api/catalog/season?season=2026-4`); expect(requests.filter(url => url.includes('/subjects/'))).toHaveLength(0);
    expect((await fetch(`${origin}/api/catalog/ratings?season=bad`)).status).toBe(400);
    const first = await fetch(`${origin}/api/catalog/ratings?season=2026-4`); expect(first.headers.get('cache-control')).toBe('no-store'); await first.json();
    await service.drain(); const data = await (await fetch(`${origin}/api/catalog/ratings?season=2026-4`)).json();
    expect(data.status).toBe('ready'); expect(data.total).toBe(2); expect(data.entries[0].rating.score).toBe(8); expect(data.entries[0]).not.toHaveProperty('summary');
    expect(requests.filter(url => url.includes('/subjects/'))).toHaveLength(2); expect(requests.some(url => /persons|characters|lain\.bgm/.test(url))).toBe(false);
    const empty = await (await fetch(`${origin}/api/catalog/ratings?season=2025-1`)).json(); expect(empty).toMatchObject({ status: 'ready', total: 0, entries: [] });
  });
});

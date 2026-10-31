import { createServer } from 'node:http';
import { listenTestServer } from './support/listen.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
import { AnimeService } from '../server/service.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { request } from 'node:http';
import { rawCatalog, rawCalendar } from './fixtures.js';

let server: Server | undefined, directory: string;
afterEach(async () => { vi.restoreAllMocks(); if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); if (directory) await rm(directory, { recursive: true, force: true }); });
async function boot(publicOrigin?: string, fetcher?: (url: string) => Promise<Response>) {
  directory = await mkdtemp(join(tmpdir(), 'anime-calendar-api-'));
  const service = new AnimeService({ directory, fetcher: fetcher ?? (async url => new Response(JSON.stringify(url.includes('/calendar') ? rawCalendar : rawCatalog))) });
  await service.initialize(); const app = createApp(service, join(directory, 'dist'), { publicOrigin });
  server = await listenTestServer(createServer(app));
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

function siteRequest(base: string, path: string, method = 'GET', headers: Record<string, string> = {}) {
  return new Promise<{ status: number; text: string; retryAfter?: string }>((resolve, reject) => {
    const req = request(new URL(path, base), { method, headers: { host: 'anime.example.test', ...headers } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve({ status: res.statusCode!, text: Buffer.concat(chunks).toString('utf8'), retryAfter: res.headers['retry-after'] }));
      res.on('error', reject);
    });
    req.on('error', reject); req.end();
  });
}

describe('HTTPS反向代理后的同源API', () => {
  const origin = 'https://anime.example.test';
  it('显式公开域名可读取状态、刷新和目录，内部HTTP不误判公开HTTPS Origin', async () => {
    const { service, url } = await boot(origin);
    expect((await siteRequest(url, '/api/status')).status).toBe(200);
    expect((await siteRequest(url, '/api/status', 'HEAD')).status).toBe(200);
    expect((await siteRequest(url, '/api/refresh', 'POST', { origin })).status).toBe(202);
    await service.refresh();
    expect(JSON.parse((await siteRequest(url, '/api/catalog')).text).items).toHaveLength(2);
  });
  it('拒绝错误Host、跨站/空Origin，伪造转发头不能绕过校验', async () => {
    const { url } = await boot(origin);
    expect((await siteRequest(url, '/api/status', 'GET', { host: 'unrelated.example', 'x-forwarded-host': 'anime.example.test' })).status).toBe(403);
    expect((await siteRequest(url, '/api/refresh', 'POST', { origin: 'https://unrelated.example', 'x-forwarded-proto': 'https' })).status).toBe(403);
    expect((await siteRequest(url, '/api/refresh', 'POST')).status).toBe(403);
  });
  it('公开手动刷新一分钟内冷却，到期后可以重试', async () => {
    const { service, url } = await boot(origin);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-30T08:00:00Z'));
    expect((await siteRequest(url, '/api/refresh', 'POST', { origin })).status).toBe(202);
    await service.refresh();
    const repeated = await siteRequest(url, '/api/refresh', 'POST', { origin });
    expect(repeated.status).toBe(429);
    expect(repeated.retryAfter).toBe('60');
    clock.mockReturnValue(Date.parse('2026-10-30T08:01:00Z'));
    expect((await siteRequest(url, '/api/refresh', 'POST', { origin })).status).toBe(202);
    await service.refresh();
  });
  it('正在进行的刷新复用同一任务，不因冷却拒绝，也不重复抓取', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fetcher = vi.fn(async (url: string) => { await gate; return new Response(JSON.stringify(url.includes('/calendar') ? rawCalendar : rawCatalog)); });
    const { service, url } = await boot(origin, fetcher);
    try {
      expect((await siteRequest(url, '/api/refresh', 'POST', { origin })).status).toBe(202);
      expect((await siteRequest(url, '/api/refresh', 'POST', { origin })).status).toBe(202);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { release(); await service.refresh(); }
  });
});

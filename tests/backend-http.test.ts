import { createServer } from 'node:http';
import { listenTestServer } from './support/listen.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { AnimeService } from '../server/service.js';
import { createApp } from '../server/app.js';
import { rawCatalog, rawCalendar } from './fixtures.js';
const dirs: string[] = [], servers: Server[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } for (const directory of dirs.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function boot() {
  const directory = await mkdtemp(join(tmpdir(), 'backend-http-')); dirs.push(directory);
  const events: Record<string, unknown>[] = [];
  const service = new AnimeService({ directory, fetcher: async url => new Response(JSON.stringify(url.includes('/calendar') ? rawCalendar : rawCatalog)) });
  await service.initialize();
  const app = createApp(service, join(directory, 'static'), { observe: event => events.push(event) });
  const server = await listenTestServer(createServer(app)); servers.push(server);
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('port');
  return { service, events, url: `http://127.0.0.1:${address.port}` };
}
describe('后端HTTP与热缓存', () => {
  it.each(['/api/anime/%E0%A4%A', '/api/anime/bgm%ZZ1/ratings', '/media/posters/%/card'])('畸形路径编码返回400：%s', async path => {
    const { url, events } = await boot();
    const response = await fetch(`${url}${path}`);
    expect(response.status).toBe(400);
    const body = await response.json(); expect(body).toEqual({ error: expect.any(String) });
    expect(JSON.stringify(body)).not.toMatch(/Failed to decode param|URIError/);
    expect(JSON.stringify(events)).not.toContain(path);
    expect(events.some(event => event.event === 'request_error' && event.status === 400)).toBe(true);
  });
  it('有效编码的作品ID可读取详情，未知ID仍返回404', async () => {
    const { service, url } = await boot(); await service.refresh();
    const response = await fetch(`${url}/api/anime/bgm%3A1?wait=1`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 'bgm:1' });
    expect((await fetch(`${url}/api/anime/bgm%3A999`)).status).toBe(404);
  });
  it.each([{ 'content-type': 'application/json; charset=iso-8859-1' }, { 'content-type': 'application/json', 'content-encoding': 'unsupported' }])('不支持的正文编码返回415：%j', async headers => {
    const { url } = await boot();
    const response = await fetch(`${url}/api/refresh`, { method: 'POST', headers, body: '{}' });
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });
  it.each([400, 413, 415])('内部异常自带status=%i仍返回脱敏500', async status => {
    const { service, url, events } = await boot();
    vi.spyOn(service, 'status').mockImplementation(() => { throw Object.assign(new Error('private-secret-value'), { status, statusCode: status }); });
    const response = await fetch(`${url}/api/status`);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('private-secret-value');
    expect(events.some(event => event.event === 'request_error' && event.status === 500)).toBe(true);
    expect(JSON.stringify(events)).not.toContain('private-secret-value');
  });
  it('解析错误400与正文超限413，真实500产生可关联的脱敏日志', async () => {
    const { service, url, events } = await boot();
    expect((await fetch(`${url}/api/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' })).status).toBe(400);
    expect((await fetch(`${url}/api/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: 'x'.repeat(8200) }) })).status).toBe(413);
    vi.spyOn(service, 'status').mockImplementation(() => { throw new Error('private-secret-value'); });
    const response = await fetch(`${url}/api/status`); expect(response.status).toBe(500);
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(JSON.stringify(events)).not.toContain('private-secret-value');
    expect(events.some(event => event.event === 'request_error' && event.requestId === response.headers.get('x-request-id'))).toBe(true);
  });
  it('就绪与存活分开，有旧目录但来源失败仍可提供服务', async () => {
    const { service, url } = await boot();
    expect((await fetch(`${url}/api/health/live`)).status).toBe(200);
    expect((await fetch(`${url}/api/health/ready`)).status).toBe(503);
    await service.refresh(); expect((await fetch(`${url}/api/health/ready`)).status).toBe(200);
  });
  it('命中304不再序列化完整目录，刷新状态变化不能复用旧ETag', async () => {
    const { service, url } = await boot(); await service.refresh();
    const path = `${url}/api/catalog/season?season=2026-4`;
    const first = await fetch(path); const etag = first.headers.get('etag')!; await first.text();
    const serialize = vi.spyOn(JSON, 'stringify');
    const response = await fetch(path, { headers: { 'if-none-match': etag } });
    expect(response.status).toBe(304);
    expect(serialize.mock.calls.some(call => call[0] === service.catalog())).toBe(false);
  });
});

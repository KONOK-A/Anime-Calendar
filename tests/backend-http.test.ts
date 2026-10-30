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
  const server = app.listen(0, '127.0.0.1'); servers.push(server); await new Promise<void>(resolve => server.on('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('port');
  return { service, events, url: `http://127.0.0.1:${address.port}` };
}
describe('后端HTTP与热缓存', () => {
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

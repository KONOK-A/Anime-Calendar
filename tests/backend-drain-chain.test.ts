import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnimeService } from '../server/service.js';
import { CacheStore } from '../server/cache.js';
import { rawCatalog, rawCalendar } from './fixtures.js';
let directory: string | undefined;
afterEach(async () => { vi.restoreAllMocks(); if (directory) await rm(directory, { recursive: true, force: true }); });
describe('退出的后台后继任务', () => {
  it('正在整理缓存时也排空后台维护，不把其遗漏到优雅退出之外', async () => {
    directory = await mkdtemp(join(tmpdir(), 'drain-maintenance-'));
    const service = new AnimeService({ directory }); await service.initialize();
    let release!: () => void;
    vi.spyOn(service.posters, 'maintain').mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const maintenance = service.maintain(); let ended = false; const drain = service.drain().then(() => { ended = true; });
    try { await new Promise(resolve => setTimeout(resolve, 20)); expect(ended).toBe(false); }
    finally { release(); await maintenance; await drain; }
  });
  it('角色列表延迟读盘之后创建的名字更新也在排空完成前持久保存', async () => {
    directory = await mkdtemp(join(tmpdir(), 'drain-chain-'));
    let time = new Date('2026-10-30T00:00:00Z'), stale = false, releaseName!: () => void, started!: () => void, written!: () => void;
    const nameStarted = new Promise<void>(resolve => { started = resolve; }), nameWritten = new Promise<void>(resolve => { written = resolve; });
    const service = new AnimeService({ directory, now: () => time, fetcher: async url => {
      if (url.endsWith('/characters/10')) { if (stale) { started(); await new Promise<void>(resolve => { releaseName = resolve; }); await new Promise(resolve => setTimeout(resolve, 30)); } return Response.json({ id: 10, name: stale ? 'new-name' : 'old-name', infobox: [] }); }
      if (url.endsWith('/characters')) return Response.json([{ id: 10, name: 'old-name', relation: '主角', actors: [] }]);
      if (url.endsWith('/persons')) return Response.json([]);
      if (url.includes('/subjects/')) return Response.json({ id: 1, name: 'sample', images: {} });
      return Response.json(url.includes('/calendar') ? rawCalendar : rawCatalog);
    } });
    await service.initialize(); await service.refresh(); await service.characterNames('bgm:1');
    time = new Date('2026-11-01T00:00:00Z'); stale = true;
    let releaseRead!: () => void; const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
    const originalRead = CacheStore.prototype.read, originalWrite = CacheStore.prototype.write;
    vi.spyOn(CacheStore.prototype, 'read').mockImplementation(async function(this: CacheStore, key, validate) { if (key === 'credits-characters-1') await readGate; return originalRead.call(this, key, validate); });
    vi.spyOn(CacheStore.prototype, 'write').mockImplementation(function(this: CacheStore, key, data, at, validators) { const task = originalWrite.call(this, key, data, at, validators); if (key === 'character-name-10') void task.then(written); return task; });
    const names = service.characterNames('bgm:1'), drain = service.drain(); releaseRead();
    await names; await nameStarted; releaseName();
    try { await drain; expect(JSON.parse(await readFile(join(directory, 'character-name-10.json'), 'utf8')).data.name).toBe('new-name'); }
    finally { releaseName(); await nameWritten; await service.drain(); }
  });
});

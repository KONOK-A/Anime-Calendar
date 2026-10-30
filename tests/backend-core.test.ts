import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnimeService } from '../server/service.js';
import { rawCatalog, rawCalendar } from './fixtures.js';
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function setup(fetcher?: (url: string, init?: RequestInit) => Promise<Response>) {
  const directory = await mkdtemp(join(tmpdir(), 'anime-backend-')); dirs.push(directory);
  let time = new Date('2026-10-30T00:00:00Z');
  const service = new AnimeService({ directory, now: () => time, fetcher: fetcher ?? (async url => new Response(JSON.stringify(url.includes('/calendar') ? rawCalendar : rawCatalog))) });
  await service.initialize();
  return { service, directory, setTime: (value: string) => { time = new Date(value); } };
}
describe('服务端快照与来源更新', () => {
  it('credits和角色名跨入口复用同一角色列表，过期详情返回旧值供后台更新', async () => {
    let calls = 0, release!: () => void, delayed = false;
    const { service, setTime } = await setup(async url => {
      if (url.endsWith('/characters')) { calls++; await new Promise<void>(resolve => { release = resolve; }); return new Response('[]'); }
      if (url.endsWith('/persons')) return new Response('[]');
      if (url.includes('/subjects/')) { if (delayed) await new Promise<void>(resolve => { release = resolve; }); return new Response(JSON.stringify({ id: 1, name: 'sample', summary: delayed ? 'new' : 'old', images: {} })); }
      return new Response(JSON.stringify(url.includes('/calendar') ? rawCalendar : rawCatalog));
    });
    await service.refresh();
    const credits = service.credits('bgm:1'), names = service.characterNames('bgm:1');
    while (!release) await new Promise(resolve => setTimeout(resolve, 0)); release(); await Promise.all([credits, names]); expect(calls).toBe(1);
    setTime('2026-11-01T00:00:00Z'); delayed = true;
    const old = await service.detail('bgm:1'); expect(old).toMatchObject({ summary: 'old', revalidating: true });
    const fresh = service.detail('bgm:1', true); release(); expect(await fresh).toMatchObject({ summary: 'new' }); await service.drain();
  });
  it('同一有效目录复用快照，详情和状态不重复生成所有作品', async () => {
    const { service } = await setup(); await service.refresh();
    const first = service.catalog(); expect(service.catalog()).toBe(first);
    expect(service.item('bgm:1')).toBe(first!.items[0]);
    expect(service.status().hasCatalog).toBe(true); expect(service.catalog()).toBe(first);
  });
  it('只更新自动过期来源，不因另一个源失败重复获取新鲜目录', async () => {
    let fail = false; const calls: string[] = [];
    const { service, setTime } = await setup(async url => {
      calls.push(url); if (fail && url.includes('/calendar')) return new Response('', { status: 500 });
      return new Response(JSON.stringify(url.includes('/calendar') ? rawCalendar : rawCatalog));
    });
    await service.refresh(); fail = true; setTime('2026-10-30T06:00:00Z'); await service.refresh('stale');
    setTime('2026-10-30T06:15:01Z'); await service.refresh('stale');
    expect(calls.filter(url => url.includes('data.json'))).toHaveLength(2);
    expect(calls.filter(url => url.includes('/calendar'))).toHaveLength(3);
  });
  it('来源校验器被保存及恢复，304保留原数据并更新核对时间', async () => {
    const headers: Record<string, string>[] = [];
    const { service, setTime } = await setup(async (url, init) => {
      headers.push(init?.headers as Record<string, string>);
      if ((init?.headers as Record<string, string>)?.['if-none-match']) return new Response(null, { status: 304 });
      return new Response(JSON.stringify(url.includes('/calendar') ? rawCalendar : rawCatalog), { headers: { etag: '"source-v1"' } });
    });
    await service.refresh(); setTime('2026-10-30T06:00:00Z'); await service.refresh('stale');
    expect(headers.slice(2).every(value => value['if-none-match'] === '"source-v1"')).toBe(true);
    expect(service.catalog()!.items).toHaveLength(2); expect(service.status().sources.catalog.fetchedAt).toBe('2026-10-30T06:00:00.000Z');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CacheStore } from '../server/cache.js';
import { UpstreamClient } from '../server/upstream.js';
import { ResourceCache } from '../server/resources.js';
const dirs: string[] = [];
afterEach(async () => { for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true }); });
async function setup(fetcher: (url: string) => Promise<Response>) {
  const dir = await mkdtemp(join(tmpdir(), 'resource-cache-')); dirs.push(dir); const store = new CacheStore(dir), upstream = new UpstreamClient(fetcher);
  let now = new Date('2026-10-30T00:00:00Z');
  return { store, cache: new ResourceCache(store, upstream, () => now), advance: () => { now = new Date('2026-11-01T00:00:00Z'); } };
}
const validate = (raw: unknown) => { if (typeof raw !== 'string') throw new Error('bad'); return raw; };
describe('资料后台更新', () => {
  it('过期值立即返回，wait加入同一资源任务，成功后返回新值', async () => {
    let release!: () => void, calls = 0;
    const { store, cache, advance } = await setup(async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); return new Response('"new"'); });
    await store.write('detail-aaaaaaaaaaaaaaaaaaaaaaaa', 'old', '2026-10-30T00:00:00Z'); advance();
    const first = await cache.get('detail-aaaaaaaaaaaaaaaaaaaaaaaa', 'https://example.com/item', validate);
    expect(first).toMatchObject({ data: 'old', revalidating: true });
    const wait = cache.get('detail-aaaaaaaaaaaaaaaaaaaaaaaa', 'https://example.com/item', validate, true);
    release(); expect(await wait).toMatchObject({ data: 'new', error: null }); expect(calls).toBe(1); await cache.drain();
  });
  it('失败保留旧资料并冷却，后续读取不会连续轰炸上游', async () => {
    let calls = 0; const { store, cache, advance } = await setup(async () => { calls++; return new Response('', { status: 500 }); });
    const key = 'detail-bbbbbbbbbbbbbbbbbbbbbbbb'; await store.write(key, 'old', '2026-10-30T00:00:00Z'); advance();
    expect(await cache.get(key, 'https://example.com/item', validate, true)).toMatchObject({ data: 'old', error: expect.any(String) });
    expect(await cache.get(key, 'https://example.com/item', validate)).toMatchObject({ data: 'old', revalidating: false }); expect(calls).toBe(1);
  });
});

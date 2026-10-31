import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PosterStore } from '../server/posters.js';
import { UpstreamClient } from '../server/upstream.js';

const hooks = vi.hoisted(() => ({
  descriptor: undefined as ((path: string) => Promise<void>) | undefined,
  listing: undefined as { started: boolean; reached: () => void; gate: Promise<void> } | undefined,
}));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readdir: async (...args: unknown[]) => {
    const listing = hooks.listing;
    hooks.listing = undefined;
    if (listing) listing.started = true;
    const files = await Reflect.apply(actual.readdir, actual, args);
    if (listing) { listing.reached(); await listing.gate; }
    return files;
  } };
});
vi.mock('../server/cache.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/cache.js')>();
  return { ...actual, atomicWrite: async (path: string, bytes: string | Uint8Array) => {
    await hooks.descriptor?.(path);
    return actual.atomicWrite(path, bytes);
  } };
});

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX6sAAAAASUVORK5CYII=', 'base64');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const directories: string[] = [], stores: PosterStore[] = [], releases: (() => void)[] = [];
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  releases.push(release);
  return { promise, release };
}
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'poster-maintenance-'));
  directories.push(directory);
  const fetcher = vi.fn(async () => new Response(png, { headers: { 'content-type': 'image/png' } }));
  const source = (id: string) => `https://lain.bgm.tv/${id}.png`;
  const store = new PosterStore(directory, new UpstreamClient(fetcher), async id => source(id));
  stores.push(store);
  return { directory, fetcher, source, store };
}
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  hooks.descriptor = undefined; hooks.listing = undefined;
  await Promise.all(stores.splice(0).map(store => store.drain()));
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('封面维护与提交的文件交错', () => {
  it('旧目录快照不能删除随后完成 descriptor 提交的 blob', async () => {
    const { directory, fetcher, source, store } = await setup();
    const descriptorPath = join(directory, `${hash(source('bgm:1'))}.json`);
    const descriptorReached = gate(), descriptorGate = gate(), sweepReached = gate(), sweepGate = gate();
    hooks.descriptor = async path => {
      if (path !== descriptorPath) return;
      hooks.descriptor = undefined;
      descriptorReached.release(); await descriptorGate.promise;
    };
    const downloading = store.get('bgm:1', 'card');
    await descriptorReached.promise;
    const listing = { started: false, reached: sweepReached.release, gate: sweepGate.promise };
    hooks.listing = listing;
    const sweeping = store.maintain();
    // A serialized sweep may wait for the descriptor; do not require the unsafe interleaving.
    if (listing.started) {
      await sweepReached.promise;
      descriptorGate.release();
      await downloading;
    } else descriptorGate.release();
    sweepGate.release();
    await Promise.all([downloading, sweeping]);
    expect(JSON.parse(await readFile(descriptorPath, 'utf8')).blob).toBe(hash(png));
    await expect(readFile(join(directory, `${hash(png)}.bin`))).resolves.toEqual(png);
    expect((await store.get('bgm:1', 'card')).cache).toBe('hit');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('drain 等待独立维护完成', async () => {
    const { store } = await setup();
    const sweepReached = gate(), sweepGate = gate();
    hooks.listing = { started: false, reached: sweepReached.release, gate: sweepGate.promise };
    const sweeping = store.maintain();
    await sweepReached.promise;
    let drained = false;
    const draining = store.drain().then(() => { drained = true; });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(drained).toBe(false);
    sweepGate.release();
    await Promise.all([sweeping, draining]);
    expect(drained).toBe(true);
  });

  it('同 blob 的多来源只占一份预算，过期引用淘汰不删除有效引用', async () => {
    const { directory, source, store } = await setup();
    await Promise.all([store.get('bgm:1', 'card'), store.get('bgm:2', 'card')]);
    await writeFile(join(directory, 'keep.txt'), 'unrelated');
    await store.maintain({ maxBytes: png.length });
    expect((await readdir(directory)).filter(name => name.endsWith('.json'))).toHaveLength(2);
    const oldPath = join(directory, `${hash(source('bgm:1'))}.json`), old = new Date(Date.now() - 31 * 86_400_000);
    await utimes(oldPath, old, old);
    await store.maintain({ maxBytes: png.length });
    expect((await readdir(directory)).filter(name => name.endsWith('.json'))).toHaveLength(1);
    expect((await store.get('bgm:2', 'card')).cache).toBe('hit');
    await store.maintain({ maxBytes: 0 });
    expect(await readdir(directory)).toEqual(['keep.txt']);
  });

  it('写盘失败仍返回图片，后续磁盘任务可以继续', async () => {
    const { fetcher, store } = await setup();
    hooks.descriptor = async path => { if (path.endsWith('.json')) throw new Error('controlled descriptor write failure'); };
    expect(await store.get('bgm:1', 'card')).toMatchObject({ bytes: png, cache: 'memory' });
    expect(store.warnings).toHaveLength(1);
    hooks.descriptor = undefined;
    expect((await store.get('bgm:2', 'card')).cache).toBe('miss');
    expect((await store.get('bgm:2', 'card')).cache).toBe('hit');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

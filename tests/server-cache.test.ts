import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CacheStore } from '../server/cache.js';
const dirs: string[] = [];
afterEach(async () => { for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true }); });
async function directory() { const path = await mkdtemp(join(tmpdir(), 'server-cache-')); dirs.push(path); return path; }
const validate = (value: unknown) => { if (typeof value !== 'string') throw new Error('bad data'); return value; };
describe('持久缓存恢复与容量', () => {
  it('正常派生缓存写入在本机模式也执行容量预算，无需维护定时器', async () => {
    const dir = await directory(), store = new CacheStore(dir, 250);
    for (const suffix of ['a', 'b', 'c']) await store.write(`detail-${suffix.repeat(24)}`, suffix.repeat(100), '2026-10-30T00:00:00Z');
    expect(await store.derivedBytes()).toBeLessThanOrEqual(250);
  });
  it('重复损坏告警有界，恢复后清除，损坏原件保留', async () => {
    const dir = await directory(), store = new CacheStore(dir);
    await writeFile(join(dir, 'detail-aaaaaaaaaaaaaaaaaaaaaaaa.json'), '{broken');
    for (let i = 0; i < 20; i++) await store.read('detail-aaaaaaaaaaaaaaaaaaaaaaaa', validate);
    expect(store.warnings).toHaveLength(1); expect(await readFile(join(dir, 'detail-aaaaaaaaaaaaaaaaaaaaaaaa.json'), 'utf8')).toBe('{broken');
    await store.write('detail-aaaaaaaaaaaaaaaaaaaaaaaa', 'new', '2026-10-30T00:00:00Z');
    expect((await store.read('detail-aaaaaaaaaaaaaaaaaaaaaaaa', validate))?.data).toBe('new'); expect(store.warnings).toHaveLength(0);
  });
  it('主基础缓存损坏时恢复上一次已校验快照，不删除损坏文件', async () => {
    const dir = await directory(), store = new CacheStore(dir);
    await store.write('catalog', 'first', '2026-10-29T00:00:00Z'); await store.read('catalog', validate);
    await store.write('catalog', 'second', '2026-10-30T00:00:00Z');
    await writeFile(join(dir, 'catalog.json'), '{broken');
    const restored = new CacheStore(dir); expect((await restored.read('catalog', validate))?.data).toBe('first');
    expect(await readFile(join(dir, 'catalog.json'), 'utf8')).toBe('{broken'); expect(restored.warnings.join(' ')).toContain('备份');
  });
  it('清理只涉及派生缓存，保留基础源、人工文件和其他目录', async () => {
    const dir = await directory(), store = new CacheStore(dir);
    await store.write('catalog', 'base', '2026-10-30T00:00:00Z');
    await writeFile(join(dir, 'personal.json'), 'private');
    for (const suffix of ['a', 'b', 'c']) await store.write(`detail-${suffix.repeat(24)}`, suffix.repeat(100), '2026-10-30T00:00:00Z');
    await store.maintain({ maxBytes: 250 });
    expect((await store.read('catalog', validate))?.data).toBe('base'); expect(await readFile(join(dir, 'personal.json'), 'utf8')).toBe('private');
    expect(await store.derivedBytes()).toBeLessThanOrEqual(250);
  });
});

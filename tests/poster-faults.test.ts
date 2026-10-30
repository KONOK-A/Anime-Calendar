import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PosterStore } from '../server/posters.js';
import { UpstreamClient, UpstreamError } from '../server/upstream.js';
const state = vi.hoisted(() => ({ readOnly: false }));
vi.mock('node:fs/promises', async () => {
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return { ...fs, utimes: (...args: Parameters<typeof fs.utimes>) => state.readOnly ? Promise.reject(Object.assign(new Error('read only'), { code: 'EROFS' })) : fs.utimes(...args) };
});
const directories: string[] = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX6sAAAAASUVORK5CYII=', 'base64');
afterEach(async () => { state.readOnly = false; vi.restoreAllMocks(); for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function directory() { const path = await mkdtemp(join(tmpdir(), 'poster-fault-')); directories.push(path); return path; }
describe('封面故障隔离', () => {
  it('访问时间写入失败且上游离线时，仍读取有效旧图而不请求网络', async () => {
    const path = await directory(), resolve = async () => 'https://lain.bgm.tv/cover.png';
    const first = new PosterStore(path, new UpstreamClient(async () => new Response(png, { headers: { 'content-type': 'image/png' } })), resolve);
    const original = await first.get('bgm:1', 'card');
    let calls = 0; state.readOnly = true;
    const restored = new PosterStore(path, new UpstreamClient(async () => { calls++; throw new Error('offline'); }), resolve);
    const data = await restored.get('bgm:1', 'card');
    expect(data.etag).toBe(original.etag); expect(data.bytes.equals(png)).toBe(true); expect(calls).toBe(0);
  });
  it('队列恢复后立即可重试图片，不把本机排队失败记成来源冷却', async () => {
    const path = await directory(), client = new UpstreamClient();
    const request = vi.spyOn(client, 'request').mockRejectedValueOnce(new UpstreamError('上游排队超时，请稍后重试', 504)).mockResolvedValue({ status: 200, headers: new Headers({ 'content-type': 'image/png' }), bytes: png });
    const store = new PosterStore(path, client, async () => 'https://lain.bgm.tv/cover.png');
    await expect(store.get('bgm:1', 'card')).rejects.toThrow('排队');
    expect((await store.get('bgm:1', 'card')).bytes.equals(png)).toBe(true); expect(request).toHaveBeenCalledTimes(2);
  });
});

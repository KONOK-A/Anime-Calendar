import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PosterStore } from '../server/posters.js';
import { UpstreamClient } from '../server/upstream.js';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX6sAAAAASUVORK5CYII=', 'base64');
const dirs: string[] = [];
afterEach(async () => { for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true }); });
async function setup(fetcher: (url: string) => Promise<Response>, resolve: (id: string, size: string) => Promise<string | null> = async () => 'https://lain.bgm.tv/pic/a.png') {
  const path = await mkdtemp(join(tmpdir(), 'poster-cache-')); dirs.push(path);
  return { path, store: new PosterStore(path, new UpstreamClient(fetcher), resolve) };
}
describe('受限同源封面缓存', () => {
  it('合并并发下载，磁盘命中不请求上游，重启后保留校验器', async () => {
    let calls = 0;
    const { path, store } = await setup(async () => { calls++; return new Response(png, { headers: { 'content-type': 'image/png' } }); });
    const [first, second] = await Promise.all([store.get('bgm:1', 'card'), store.get('bgm:1', 'card')]);
    expect(first.bytes.equals(png)).toBe(true); expect(second.etag).toBe(first.etag); expect(calls).toBe(1);
    expect((await store.get('bgm:1', 'card')).cache).toBe('hit');
    const restored = new PosterStore(path, new UpstreamClient(async () => { throw new Error('offline'); }), async () => 'https://lain.bgm.tv/pic/a.png');
    expect((await restored.get('bgm:1', 'card')).etag).toBe(first.etag);
  });
  it('拒绝任意主机、私网、凭据与不受信任的重定向', async () => {
    for (const source of ['http://lain.bgm.tv/a.jpg', 'https://127.0.0.1/a', 'https://lain.bgm.tv.evil.example/a', 'https://name:password@lain.bgm.tv/a']) {
      let calls = 0; const { store } = await setup(async () => { calls++; return new Response(png); }, async () => source);
      await expect(store.get('bgm:1', 'card')).rejects.toThrow(); expect(calls).toBe(0);
    }
    const { store } = await setup(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }));
    await expect(store.get('bgm:1', 'card')).rejects.toThrow();
  });
  it('不把HTML、SVG或错误图片类型写成有效封面', async () => {
    for (const type of ['image/png', 'image/svg+xml', 'text/html']) {
      const { path, store } = await setup(async () => new Response('<html>error</html>', { headers: { 'content-type': type } }));
      await expect(store.get('bgm:1', 'card')).rejects.toThrow();
      expect((await readdir(path)).filter(name => name.endsWith('.bin'))).toHaveLength(0);
    }
  });
  it('缺图与无效档位明确失败，来源变化使用不同缓存', async () => {
    const absent = await setup(async () => new Response(png), async () => null);
    await expect(absent.store.get('bgm:1', 'card')).rejects.toMatchObject({ statusCode: 404 });
    await expect(absent.store.get('bgm:1', 'other')).rejects.toMatchObject({ statusCode: 400 });
    let calls = 0, source = 'a';
    const { store } = await setup(async () => { calls++; return new Response(png, { headers: { 'content-type': 'image/png' } }); }, async () => `https://lain.bgm.tv/${source}.png`);
    await store.get('bgm:1', 'card'); source = 'b'; await store.get('bgm:1', 'card'); expect(calls).toBe(2);
  });
  it('磁盘容量受限且仅清理自身缓存文件', async () => {
    const { store, path } = await setup(async () => new Response(png, { headers: { 'content-type': 'image/png' } }), async id => `https://lain.bgm.tv/${id}.png`);
    await store.get('bgm:1', 'card'); await store.get('bgm:2', 'card');
    await store.maintain({ maxBytes: 1 }); expect((await readdir(path)).filter(name => name.endsWith('.bin'))).toHaveLength(0);
  });
});

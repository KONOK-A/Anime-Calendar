import { describe, expect, it } from 'vitest';
import { DataCache } from '../src/data-cache.js';

function storage() {
  const stores = new Map<string, Map<string, Response>>();
  return { stores, storage: { async open(name: string) {
    const entries = stores.get(name) ?? new Map<string, Response>(); stores.set(name, entries);
    return {
      match: async (key: Request) => entries.get(key.url)?.clone(),
      put: async (key: Request, response: Response) => { entries.set(key.url, response.clone()); },
      delete: async (key: Request) => entries.delete(key.url),
      keys: async () => [...entries.keys()].map(url => new Request(url)),
    };
  } } as unknown as CacheStorage };
}
const valid = (value: unknown): value is { title: string } => !!value && typeof (value as { title?: unknown }).title === 'string';

describe('页面数据加速缓存', () => {
  it('新页面实例可读取保存的数据和校验器，超过七天不恢复', async () => {
    const io = storage(); let now = 1000;
    const cache = new DataCache(() => {}, io.storage, () => now);
    await cache.write('views', 'weekly:one', { title: '星旅' }, 'W/"one"');
    const reopened = new DataCache(() => {}, io.storage, () => now);
    expect(await reopened.read('views', 'weekly:one', valid)).toMatchObject({ data: { title: '星旅' }, etag: 'W/"one"' });
    now += 7 * 86_400_000 + 1;
    expect(await reopened.read('views', 'weekly:one', valid)).toBeUndefined();
  });
  it('视图和详情分开淘汰旧记录，不删除其他应用的缓存', async () => {
    const io = storage(), cache = new DataCache(() => {}, io.storage);
    await io.storage.open('another-app');
    for (let index = 0; index < 33; index++) await cache.write('views', `season:${index}`, { title: String(index) }, null);
    await cache.write('details', 'bgm:1', { title: '详情' }, null);
    expect(await cache.read('views', 'season:0', valid)).toBeUndefined();
    expect(await cache.read('views', 'season:32', valid)).toMatchObject({ data: { title: '32' } });
    expect(await cache.read('details', 'bgm:1', valid)).toMatchObject({ data: { title: '详情' } });
    expect(io.stores.has('another-app')).toBe(true);
  });
  it('缓存不可用时保留内存数据，只通知一次且不改变收藏存储', async () => {
    const notices: string[] = [];
    const broken = { open: async () => { throw new Error('quota'); } } as unknown as CacheStorage;
    const cache = new DataCache(text => notices.push(text), broken);
    await cache.write('views', 'one', { title: '保留信息' }, null);
    await cache.write('details', 'two', { title: '角色' }, null);
    expect(await cache.read('views', 'one', valid)).toMatchObject({ data: { title: '保留信息' } });
    expect(notices).toEqual(['加速缓存未保存，当前仍可正常使用。']);
  });
  it('损坏或格式版本不匹配的缓存不会作为页面数据恢复', async () => {
    const io = storage(), cache = new DataCache(() => {}, io.storage);
    await cache.write('views', 'one', { title: '星旅' }, null);
    const entries = [...io.stores.values()][0]!;
    const key = [...entries.keys()][0]!;
    entries.set(key, new Response('{broken'));
    expect(await new DataCache(() => {}, io.storage).read('views', 'one', valid)).toBeUndefined();
    entries.set(key, Response.json({ schemaVersion: 999, savedAt: Date.now(), data: { title: '旧格式' } }));
    expect(await new DataCache(() => {}, io.storage).read('views', 'one', valid)).toBeUndefined();
  });
  it('迟到的旧详情响应不会覆盖已经保存的新详情', async () => {
    const io = storage(), cache = new DataCache(() => {}, io.storage);
    await cache.write('details', 'bgm:1', { title: '新评分', detailFetchedAt: '2026-10-30T12:00:00Z' }, null);
    await cache.write('details', 'bgm:1', { title: '旧评分', detailFetchedAt: '2026-10-30T11:00:00Z' }, null);
    expect((await cache.read('details', 'bgm:1', valid))?.data.title).toBe('新评分');
  });
  it('缓存正文绑定查询范围和作品ID，不能串用另一周或另一部作品', async () => {
    const io = storage(), cache = new DataCache(() => {}, io.storage);
    await cache.write('views', 'weekly:current', { title: '下一周', scope: { key: 'weekly:next' } }, null);
    expect(await cache.read('views', 'weekly:current', valid)).toBeUndefined();
    await cache.write('details', 'bgm:1', { title: '另一部作品', id: 'bgm:2' }, null);
    expect(await cache.read('details', 'bgm:1', valid)).toBeUndefined();
  });
});

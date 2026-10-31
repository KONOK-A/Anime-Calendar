import { describe, expect, it } from 'vitest';
import { isCatalogView, isCurrentCatalogView } from '../src/data-validation.js';
import { DataCache } from '../src/data-cache.js';
import { normalizeCatalog } from '../server/normalize.js';
import { rawCatalog } from './fixtures.js';

function view() {
  const base = normalizeCatalog(rawCatalog);
  return {
    schemaVersion: 1, scope: { type: 'weekly', week: '2026-10-26', timezone: 'Asia/Shanghai', season: '2026-4', key: 'weekly:2026-10-26:Asia/Shanghai:2026-4' }, revision: 'one', seasons: [{ season: '2026-4', total: 2 }],
    status: { appId: 'anime-calendar', version: '1.0.0', refreshing: false, hasCatalog: true, warnings: [], sources: { catalog: { fetchedAt: '2026-10-29T04:00:00Z', error: null }, calendar: { fetchedAt: '2026-10-29T04:00:00Z', error: null } } },
    catalog: { ...base, schemaVersion: 1, activeIds: ['bgm:1'], fetchedAt: { catalog: '2026-10-29T04:00:00Z', calendar: '2026-10-29T04:00:00Z' }, overrides: { version: 1, active: [], events: [] } },
  };
}
describe('持久页面缓存格式', () => {
  it('内存视图也必须满足当前常规排期政策，不能绕过持久缓存检查', async () => {
    const cache = new DataCache(() => {}), original = view();
    Object.assign(original.catalog, { schedulePolicy: 'streaming' });
    await cache.write('views', original.scope.key, original, null);
    expect(await cache.read('views', original.scope.key, isCurrentCatalogView)).toBeUndefined();
    Object.assign(original.catalog, { streamingAccessPolicy: 'exclude-member-advance-v1' });
    await cache.write('views', original.scope.key, original, null);
    expect((await cache.read('views', original.scope.key, isCurrentCatalogView))?.data.catalog.items[0]?.id).toBe('bgm:1');
  });
  it('旧网络口径 payload 仍可读取，未知的访问政策不能冒充当前格式', () => {
    const original = view();
    Object.assign(original.catalog, { schedulePolicy: 'streaming' });
    expect(isCatalogView(original)).toBe(true);
    Object.assign(original.catalog, { streamingAccessPolicy: 'unknown-policy' });
    expect(isCatalogView(original)).toBe(false);
  });
  it('有效数据可恢复，缺少范围字段的记录不能恢复为当前周', () => {
    const original = view(); expect(isCatalogView(original)).toBe(true);
    const broken = { ...original, scope: { type: 'weekly', key: original.scope.key } };
    expect(isCatalogView(broken)).toBe(false);
  });
  it('缺少网络平台地区的缓存不会进入详情模板导致白屏', () => {
    const original = view();
    Object.assign(original.catalog.items[0]!, { networkAiring: { platform: '网络平台', begin: '2026-10-29T04:00:00Z', sourceUrl: 'https://example.com', rule: original.catalog.items[0]!.rule } });
    expect(isCatalogView(original)).toBe(false);
  });
  it('损坏的补充网络周期不会进入排期展开', () => {
    const original = view();
    Object.assign(original.catalog.items[0]!, { networkAiring: { platform: '网络平台', regions: ['JP'], begin: '', sourceUrl: 'https://example.com', rule: original.catalog.items[0]!.rule, rules: {} } });
    expect(isCatalogView(original)).toBe(false);
  });
  it.each([undefined, 'regular', 'member-advance'])('网络排期的发布类型 %s 可读取', releaseKind => {
    const original = view();
    Object.assign(original.catalog.items[0]!, { networkAiring: { platform: '网络平台', regions: ['JP'], begin: '2026-10-29T04:00:00Z', sourceUrl: 'https://example.com', rule: original.catalog.items[0]!.rule, releaseKind } });
    expect(isCatalogView(original)).toBe(true);
  });
  it('未知的网络发布类型不能进入排期', () => {
    const original = view();
    Object.assign(original.catalog.items[0]!, { networkAiring: { platform: '网络平台', regions: ['JP'], begin: '2026-10-29T04:00:00Z', sourceUrl: 'https://example.com', rule: original.catalog.items[0]!.rule, releaseKind: 'vip' } });
    expect(isCatalogView(original)).toBe(false);
  });
  it.each([undefined, 'regular', 'member-advance'])('人工事件的发布类型 %s 可读取', releaseKind => {
    const original = view();
    Object.assign(original.catalog.overrides, { events: [{ animeId: 'bgm:1', at: '2026-10-29T04:00:00Z', status: 'scheduled', sourceUrl: 'https://example.com', releaseKind }] });
    expect(isCatalogView(original)).toBe(true);
  });
  it('未知的人工事件发布类型不能进入排期', () => {
    const original = view();
    Object.assign(original.catalog.overrides, { events: [{ animeId: 'bgm:1', at: '2026-10-29T04:00:00Z', status: 'scheduled', sourceUrl: 'https://example.com', releaseKind: 'vip' }] });
    expect(isCatalogView(original)).toBe(false);
  });
  it('ID查询必须显式给出缺失集合，不能把省略当作全部已关联', () => {
    const original = { ...view(), scope: { type: 'items', ids: ['bgm:1'], key: 'items:bgm:1' } };
    expect(isCatalogView(original)).toBe(false);
  });
});

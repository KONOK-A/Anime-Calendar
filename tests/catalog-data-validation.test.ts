import { describe, expect, it } from 'vitest';
import { isCatalogView } from '../src/data-validation.js';
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
  it('ID查询必须显式给出缺失集合，不能把省略当作全部已关联', () => {
    const original = { ...view(), scope: { type: 'items', ids: ['bgm:1'], key: 'items:bgm:1' } };
    expect(isCatalogView(original)).toBe(false);
  });
});

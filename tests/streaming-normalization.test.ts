import { describe, expect, it } from 'vitest';
import { normalizeCatalog } from '../server/normalize.js';
import { rawCatalog } from './fixtures.js';

describe('仅采用正式网络周期', () => {
  it('缺少网络规则时进入待定并保留电视参考', () => {
    const data = normalizeCatalog({ ...rawCatalog, items: [{ ...rawCatalog.items[0], sites: [{ site: 'bangumi', id: '1' }] }] });
    expect(data.items[0].rule.frequency).toBe('unknown');
    expect(data.items[0].rule.anchor).toBeNull();
    expect(data.items[0].broadcastRule.anchor).toBe('2026-10-19T15:30:00.000Z');
  });
  it('普通网络晚于电视也须采用，不能将放送时间当配信时间', () => {
    const data = normalizeCatalog({ ...rawCatalog, items: [{ ...rawCatalog.items[0], sites: [{ site: 'bangumi', id: '1' }, { site: 'bilibili', id: '10', begin: '2026-10-20T00:00:00Z', broadcast: 'R/2026-10-20T00:00:00Z/P7D' }] }] });
    expect(data.items[0].rule.anchor).toBe('2026-10-20T00:00:00.000Z');
    expect(data.items[0].networkAiring?.platform).toBe('哔哩哔哩');
  });
  it('没有周期的网络上架日期不能伪造成每周更新', () => {
    const data = normalizeCatalog({ ...rawCatalog, items: [{ ...rawCatalog.items[0], sites: [{ site: 'bangumi', id: '1' }, { site: 'bilibili', id: '10', begin: '2026-09-01T00:00:00Z' }] }] });
    expect(data.items[0].rule.frequency).toBe('unknown');
  });
  it('只取得新季条目时，也拒绝比该季早一年以上的共用页旧周期', () => {
    const data = normalizeCatalog({ ...rawCatalog, items: [{ ...rawCatalog.items[0], sites: [{ site: 'bangumi', id: '1' }, { site: 'bilibili', id: '10', begin: '2024-10-05T00:00:00Z', broadcast: 'R/2024-10-05T00:00:00Z/P7D' }] }] });
    expect(data.items[0].networkAiring).toBeUndefined();
    expect(data.items[0].rule.frequency).toBe('unknown');
    expect(data.warnings.join(' ')).toContain('旧季');
  });
  it('WEB条目明确的带时区上线时间可生成一次性网络事件，不能扩成周播', () => {
    const data = normalizeCatalog({ ...rawCatalog, items: [{ ...rawCatalog.items[1], broadcast: '' }] });
    expect(data.items[0].rule).toMatchObject({ anchor: '2026-10-30T10:00:00.000Z', frequency: 'once' });
    expect(data.items[0].networkAiring?.platform).toBe('官方网络发行');
  });
});

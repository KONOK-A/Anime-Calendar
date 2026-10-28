import { describe, expect, it } from 'vitest';
import { normalizeCatalog, normalizeCalendar } from '../server/normalize.js';
import { rawCatalog } from './fixtures.js';

describe('上游目录标准化', () => {
  it('有巴哈记录时展示台湾和港澳平台并保留具体链接、地区，未关联作品不添加', () => {
    const data = {
      ...structuredClone(rawCatalog),
      siteMeta: { ...rawCatalog.siteMeta,
        gamer: { title: '動畫瘋', type: 'onair', urlTemplate: 'https://acg.gamer.com.tw/acgDetail.php?s={{id}}', regions: ['TW'] },
        gamer_hk: { title: '動畫瘋 HK', type: 'onair', urlTemplate: 'https://acg.gamer.com.tw/acgDetail.php?s={{id}}', regions: ['HK', 'MO'] },
      },
    };
    data.items[0].sites.push({ site: 'gamer', id: '149355' }, { site: 'gamer_hk', id: '149355', url: 'https://acg.gamer.com.tw/acgDetail.php?s=149355&region=hk', regions: ['HK'] });
    const result = normalizeCatalog(data);
    expect(result.items[0].platforms.filter(platform => platform.name.startsWith('巴哈姆特'))).toEqual([
      { name: '巴哈姆特动画疯（台湾）', url: 'https://acg.gamer.com.tw/acgDetail.php?s=149355', regions: ['TW'] },
      { name: '巴哈姆特动画疯（港澳）', url: 'https://acg.gamer.com.tw/acgDetail.php?s=149355&region=hk', regions: ['HK'] },
    ]);
    expect(result.items[1].platforms.some(platform => platform.name.startsWith('巴哈姆特'))).toBe(false);
  });
  it('保留别名、固定北京时间季度，只将明确放送站点列为播放平台', () => {
    const result = normalizeCatalog(rawCatalog);
    expect(result.items[0]).toMatchObject({ id: 'bgm:1', title: '星旅', originalTitle: 'テストの旅', season: '2026-4' });
    expect(result.items[0].aliases).toContain('星之旅');
    expect(result.items[0].platforms).toEqual([{ name: '哔哩哔哩', url: 'https://www.bilibili.com/bangumi/play/ss10', regions: ['TW'] }]);
    expect(result.items[1].title).toBe('帰り道');
  });
  it('过滤非日语、电影，译名变化不改变收藏ID', () => {
    const data = structuredClone(rawCatalog);
    data.items.push({ ...data.items[0], type: 'movie' }, { ...data.items[0], lang: 'zh-Hans' });
    data.items[0].titleTranslate['zh-Hans'] = ['新的译名'];
    expect(normalizeCatalog(data).items.map(x => x.id)).toEqual(['bgm:1', 'bgm:2']);
  });
  it('不会把只有日期的记录伪造成午夜，季度边界按北京时间计算', () => {
    const data = structuredClone(rawCatalog);
    data.items[0].begin = '2026-09-30T16:30:00Z';
    data.items[1].begin = '2026-10-30'; data.items[1].broadcast = '';
    const result = normalizeCatalog(data);
    expect(result.items[0].season).toBe('2026-4');
    expect(result.items[1].rule.anchor).toBeNull();
  });
  it('拒绝损坏的根结构；有冲突的ID保留首条并报告', () => {
    expect(() => normalizeCatalog({ items: [] })).toThrow();
    const data = structuredClone(rawCatalog); data.items.push({ ...data.items[0], title: '不应合并的第二条' });
    const result = normalizeCatalog(data);
    expect(result.items).toHaveLength(2); expect(result.warnings.join(' ')).toContain('bgm:1');
  });
  it('当前放送名单只使用有效动画ID，损坏的响应不能清空名单', () => {
    expect(normalizeCalendar([{ items: [{ id: 2, type: 2 }, { id: 3, type: 1 }] }])).toEqual(['bgm:2']);
    expect(() => normalizeCalendar({ error: 'unavailable' })).toThrow();
  });
});

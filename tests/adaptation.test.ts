import { describe, expect, it } from 'vitest';
import { adaptationFromTags } from '../shared/adaptation';
describe('作品来源标签', () => {
  it('只认明确来源标签，并统一同类写法', () => {
    expect(adaptationFromTags(['漫画改', '漫改'])).toBe('漫改');
    expect(adaptationFromTags(['轻小说改', '小说改'])).toBe('小说改');
    expect(adaptationFromTags(['原創'])).toBe('原创');
    expect(adaptationFromTags(['游戏改编'])).toBe('游戏改');
  });
  it('未知或来源票数接近时不猜测类别，不以题材或音乐推断原创', () => {
    expect(adaptationFromTags(['原创音乐', '小说', '异世界'])).toBeNull();
    expect(adaptationFromTags([])).toBeNull();
    expect(adaptationFromTags(['漫画改', '原创'])).toBeNull();
    expect(adaptationFromTags([{ name: '漫画改', count: 30 }, { name: '原创', count: 28 }])).toBeNull();
  });
  it('相同类别别名不叠加票数，明确多数标签可忽略个别噪声', () => {
    expect(adaptationFromTags([{ name: '小说改', count: 50 }, { name: '轻小说改', count: 40 }, { name: '原创', count: 1 }])).toBe('小说改');
    expect(adaptationFromTags([{ name: '小说改', count: 20 }, { name: '轻小说改', count: 20 }, { name: '漫改', count: 15 }])).toBeNull();
  });
});

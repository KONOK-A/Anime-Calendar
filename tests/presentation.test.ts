import { describe, expect, it } from 'vitest';
import type { AiringEvent } from '../shared/types';
import { featuredEvents, initialFeatured, readThemePreference, resolveTheme } from '../src/presentation';

const event = (animeId: string, at: string, status: AiringEvent['status'] = 'scheduled'): AiringEvent => ({ animeId, at, status, basis: 'estimated', sourceUrl: 'https://example.com' });
const now = '2026-10-29T04:00:00Z';
const earlier = event('earlier', '2026-10-29T03:00:00Z');
const next = event('next', '2026-10-29T05:00:00Z');
const later = event('later', '2026-10-29T12:00:00Z');

describe('今日主视觉作品', () => {
  it('只使用当前时区的今日排期，排除休播并按时间排序', () => {
    expect(featuredEvents([later, event('tomorrow', '2026-10-29T17:00:00Z'), next, event('cancelled', now, 'cancelled'), earlier], [], now, 'Asia/Shanghai').map(x => x.animeId)).toEqual(['earlier', 'next', 'later']);
  });
  it('今日有收藏排期时只在这些收藏中切换，其他日的收藏不影响候选', () => {
    expect(featuredEvents([later, next, earlier], ['next', 'tomorrow'], now, 'Asia/Shanghai').map(x => x.animeId)).toEqual(['next']);
    expect(featuredEvents([later, next], ['tomorrow'], now, 'Asia/Shanghai').map(x => x.animeId)).toEqual(['next', 'later']);
  });
  it('同作品多条排期仅保留下一条，全部已过则保留最近一条', () => {
    expect(featuredEvents([event('a', '2026-10-29T02:00:00Z'), event('a', '2026-10-29T10:00:00Z'), event('a', '2026-10-29T06:00:00Z')], [], now, 'Asia/Shanghai').map(x => x.at)).toEqual(['2026-10-29T06:00:00Z']);
    expect(featuredEvents([event('a', '2026-10-29T02:00:00Z'), event('a', '2026-10-29T03:00:00Z')], [], now, 'Asia/Shanghai').map(x => x.at)).toEqual(['2026-10-29T03:00:00Z']);
  });
  it('跨日作品按北京和日本日期分别处理', () => {
    const midnight = event('midnight', '2026-10-29T15:30:00Z');
    expect(featuredEvents([midnight], [], '2026-10-29T16:00:00Z', 'Asia/Shanghai')).toEqual([]);
    expect(featuredEvents([midnight], [], '2026-10-29T16:00:00Z', 'Asia/Tokyo')).toEqual([midnight]);
  });
  it('初始选择下一条，全部已过选择最近一条，空候选不生成作品', () => {
    expect(initialFeatured([earlier, next, later], now)?.animeId).toBe('next');
    expect(initialFeatured([earlier, next, later], '2026-10-29T13:00:00Z')?.animeId).toBe('later');
    expect(initialFeatured([], now)).toBeUndefined();
  });
});

describe('主题偏好', () => {
  it('未知或未保存的偏好回到跟随系统，手动选择优先', () => {
    expect(readThemePreference(null)).toBe('system');
    expect(readThemePreference('bad')).toBe('system');
    expect(readThemePreference('dark')).toBe('dark');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

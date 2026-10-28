import { describe, expect, it } from 'vitest';
import { readFavorites, saveFavorites, parseBackup, exportBackup } from '../src/favorites.js';

function storage(initial: string | null = null) { let value = initial; return { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } }; }

describe('收藏与备份', () => {
  it('刷新读取保持收藏，保存去重', () => {
    const target = storage(); expect(saveFavorites(target, ['bgm:1', 'bgm:1', 'bd:old']).saved).toBe(true);
    expect(readFavorites(target).ids).toEqual(['bgm:1', 'bd:old']);
  });
  it('导入合并而非覆盖，未知但合法ID保留', () => {
    const backup = exportBackup(['bgm:2', 'bd:old'], '2026-10-29T00:00:00Z');
    expect(parseBackup(backup, ['bgm:1', 'bgm:2'])).toEqual(['bgm:1', 'bgm:2', 'bd:old']);
  });
  it('拒绝损坏或未知版本备份，不修改原数据', () => {
    expect(() => parseBackup('{bad', ['bgm:1'])).toThrow();
    expect(() => parseBackup('{"version":2,"favorites":[]}', ['bgm:1'])).toThrow();
  });
  it('存储禁止和损坏JSON可读地报错，页面仍有可用的空状态', () => {
    expect(readFavorites(storage('broken')).error).toBeTruthy();
    const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
    expect(readFavorites(blocked).ids).toEqual([]);
    expect(saveFavorites(blocked, ['bgm:1']).saved).toBe(false);
  });
});

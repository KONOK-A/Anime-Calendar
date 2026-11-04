import { describe, expect, it } from 'vitest';
import {
  defaultWatchRecord, emptyWatchSnapshot, exportWatchBackup, mergeWatchBackup,
  normalizeWatchDate, parseWatchBackup, updateWatchRecord, watchTitle,
  type WatchList, type WatchSnapshot,
} from '../src/watchlist/model';

const at = '2026-11-04T14:00:00.000Z';
const animeId = 'bgm:1';
const list = (id: string, name = '补番'): WatchList => ({ id, name, description: '', pinned: false, createdAt: at });

describe('追番记录与备份', () => {
  it('旧收藏默认未记录，第一次填写正数时进入在看', () => {
    const initial = defaultWatchRecord(animeId);
    expect(initial).toMatchObject({ status: 'wanted', watched: null, plannedDate: null, updatedAt: '' });
    const watching = updateWatchRecord(initial, { watched: 12 }, at);
    expect(watching).toMatchObject({ status: 'watching', watched: 12, updatedAt: at });
    expect(updateWatchRecord(watching, { watched: 15 }, at).status).toBe('watching');
    expect(updateWatchRecord(initial, { watched: 2, status: 'paused' }, at).status).toBe('paused');
    expect(updateWatchRecord(watching, { status: 'wanted' }, at)).toMatchObject({ status: 'wanted', watched: 12 });
  });

  it('个人日期保留日历日，拒绝不存在的日期和非法观看数据', () => {
    expect(normalizeWatchDate('2028-02-29')).toBe('2028-02-29');
    expect(normalizeWatchDate('')).toBeNull();
    expect(() => normalizeWatchDate('2026-02-29')).toThrow();
    expect(() => normalizeWatchDate('2026-11-04T16:00:00Z')).toThrow();
    expect(() => updateWatchRecord(defaultWatchRecord(animeId), { watched: -1 }, at)).toThrow();
    expect(() => updateWatchRecord(defaultWatchRecord(animeId), { personalScore: 3.4 }, at)).toThrow();
    expect(() => updateWatchRecord(defaultWatchRecord(animeId), { note: '字'.repeat(1001) }, at)).toThrow();
  });

  it('导入旧备份保留失联 ID，不伪造个人记录', () => {
    expect(parseWatchBackup(JSON.stringify({ version: 1, favorites: ['bd:gone', animeId, animeId] }))).toEqual({
      version: 1, favorites: ['bd:gone', animeId], snapshot: emptyWatchSnapshot(),
    });
  });

  it('完整备份能还原已取消收藏的记录与多清单归属', () => {
    const records = [updateWatchRecord(defaultWatchRecord(animeId), { watched: 4, personalScore: 8.5, plannedDate: '2026-11-05', note: '下周继续', archived: true }, at)];
    const snapshot: WatchSnapshot = {
      ...emptyWatchSnapshot(), records, lists: [list('a'), list('b', '新番')],
      memberships: [{ listId: 'a', animeId }, { listId: 'b', animeId }],
      titles: [watchTitle({ id: animeId, title: '星旅', originalTitle: '星の旅', aliases: ['别名'], season: '2026-4', type: 'tv' }, 12)],
    };
    expect(parseWatchBackup(exportWatchBackup(['bgm:2'], snapshot, at))).toEqual({ version: 2, favorites: ['bgm:2'], snapshot });
    expect(parseWatchBackup(exportWatchBackup(['bgm:2'], snapshot, at)).snapshot.titles[0]).not.toHaveProperty('platforms');
  });

  it('先验证完整 v2 备份，拒绝非法记录、未定义清单和未来版本', () => {
    const valid = JSON.parse(exportWatchBackup([animeId], emptyWatchSnapshot(), at));
    expect(() => parseWatchBackup(JSON.stringify({ ...valid, records: [{ ...defaultWatchRecord(animeId), updatedAt: at, watched: 1.5 }] }))).toThrow();
    expect(() => parseWatchBackup(JSON.stringify({ ...valid, memberships: [{ listId: 'missing', animeId }] }))).toThrow();
    expect(() => parseWatchBackup(JSON.stringify({ ...valid, version: 3 }))).toThrow();
  });

  it('稳定 ID 合并已有记录优先，成员关系取并集，重复导入不重复建立清单', () => {
    const record = updateWatchRecord(defaultWatchRecord(animeId), { watched: 3, note: '本地备注' }, at);
    const current = { ...emptyWatchSnapshot(), records: [record], lists: [list('a')] };
    const incoming = {
      ...emptyWatchSnapshot(),
      records: [{ ...record, watched: 10, note: '备份备注' }],
      lists: [list('a'), list('b', '補番'), list('c')],
      memberships: [{ listId: 'a', animeId }, { listId: 'c', animeId }],
    };
    const result = mergeWatchBackup(current, incoming);
    expect(result).toMatchObject({ addedRecords: 0, conflicts: 1, addedLists: 2 });
    expect(result.snapshot.records).toEqual([record]);
    expect(result.snapshot.lists.map(value => value.name)).toEqual(['补番', '補番', '补番（导入 1）']);
    expect(result.snapshot.memberships).toEqual(incoming.memberships);
    expect(mergeWatchBackup(result.snapshot, incoming).snapshot).toEqual(result.snapshot);
  });
});

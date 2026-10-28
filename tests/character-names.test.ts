import { afterEach, describe, expect, it } from 'vitest';
import { normalizeCharacterName } from '../server/credits.js';
import { AnimeService } from '../server/service.js';
import { rawCatalog, rawCalendar } from './fixtures.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
describe('角色中文名', () => {
  it('优先简体中文名，兼容infobox数组，保留原名供核对', () => {
    expect(normalizeCharacterName({ id: 1, name: 'ロメリア', infobox: [{ key: '中文名', value: '其他中文名' }, { key: '简体中文名', value: [{ v: '罗梅莉亚' }] }] }, 1)).toEqual({ id: 1, name: '罗梅莉亚', originalName: 'ロメリア' });
  });
  it('缺少中文名保留原名，错误ID或响应不能匹配到其他角色', () => {
    expect(normalizeCharacterName({ id: 2, name: 'アル', infobox: [] }, 2)).toEqual({ id: 2, name: 'アル', originalName: 'アル' });
    expect(() => normalizeCharacterName({ id: 3, name: '其他角色' }, 2)).toThrow();
    expect(() => normalizeCharacterName({ error: 'bad' }, 2)).toThrow();
  });
  it('中文资料按显示的8名角色加载、缓存24小时，不改变角色CV对应关系', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'anime-names-')); dirs.push(directory);
    const requests: number[] = []; let offline = false, time = new Date('2026-10-29T04:00:00Z');
    const service = new AnimeService({ directory, now: () => time, fetcher: async url => {
      const character = url.match(/\/v0\/characters\/(\d+)$/);
      if (character) { const id = Number(character[1]); requests.push(id); if (offline) throw new Error('offline'); return new Response(JSON.stringify({ id, name: `原名${id}`, infobox: [{ key: '简体中文名', value: `中文角色${id}` }] })); }
      const body = url.endsWith('/characters') ? Array.from({ length: 10 }, (_, index) => ({ id: index + 10, name: `原名${index + 10}`, relation: '主角', actors: [{ id: index + 100, name: `声优${index}` }] })) : url.endsWith('/persons') ? [] : url.includes('/subjects/') ? { id: 1, name: '作品', summary: '', images: {} } : url.includes('/calendar') ? rawCalendar : rawCatalog;
      return new Response(JSON.stringify(body));
    } });
    await service.initialize(); await service.refresh(); await service.credits('bgm:1');
    expect(requests).toEqual([]);
    const first = await service.characterNames('bgm:1'); expect(requests.toSorted((a, b) => a - b)).toEqual([10,11,12,13,14,15,16,17]);
    expect(first?.names[0]).toMatchObject({ id: 10, name: '中文角色10' });
    await service.characterNames('bgm:1'); expect(requests).toHaveLength(8);
    const more = await service.characterNames('bgm:1', 8); expect(more?.names).toHaveLength(2); expect(requests).toHaveLength(10);
    expect((await service.credits('bgm:1'))?.cast[0].actors[0]).toEqual({ id: 100, name: '声优0' });
    time = new Date('2026-10-31T04:00:00Z'); offline = true;
    const stale = await service.characterNames('bgm:1'); expect(stale?.names[0].name).toBe('中文角色10'); expect(stale?.error).toBeTruthy();
    expect(await service.characterNames('bgm:999')).toBeNull();
  });
});

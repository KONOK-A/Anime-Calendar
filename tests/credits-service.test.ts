import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnimeService } from '../server/service.js';
import { rawCatalog, rawCalendar } from './fixtures.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const subject = { id: 1, name: 'テストの旅', summary: '中文简介\n[简介原文]\n物語。', images: {}, infobox: [{ key: '导演', value: '旧译名' }, { key: '音乐', value: 'ha-j' }] };
const staff = [{ id: 1, name: '导演甲', relation: '导演', type: 1 }, { id: 2, name: 'Studio PIERROT', relation: '动画制作', type: 2 }];
const cast = [{ id: 10, name: '角色甲', relation: '主角', actors: [{ id: 20, name: '声优甲' }] }];
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'anime-credits-test-')); directories.push(directory);
  let time = new Date('2026-10-29T04:00:00Z'), mode = 'ok', active = 0, peak = 0;
  const requested: string[] = [];
  const fetcher = async (url: string) => {
    requested.push(url); active++; peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 5));
      if (mode === 'offline') throw new Error('offline');
      const body = url.endsWith('/persons') ? mode === 'bad-staff' ? { error: 'invalid' } : staff : url.endsWith('/characters') ? mode === 'empty-cast' ? [] : cast : url.includes('/subjects/') ? subject : url.includes('/calendar') ? rawCalendar : rawCatalog;
      return new Response(JSON.stringify(body));
    } finally { active--; }
  };
  const service = new AnimeService({ directory, now: () => time, fetcher }); await service.initialize(); await service.refresh(); requested.splice(0);
  return { service, directory, requested, fetcher, get time() { return time; }, set time(value: Date) { time = value; }, set mode(value: string) { mode = value; }, get peak() { return peak; } };
}

describe('详情补充资料缓存与独立失败', () => {
  it('普通卡片只获取基础详情，打开补充资料才请求制作和角色', async () => {
    const context = await setup();
    const detail = await context.service.detail('bgm:1');
    expect(context.requested).toEqual(['https://api.bgm.tv/v0/subjects/1']);
    expect(detail?.staff).toContainEqual({ role: '音乐', names: ['ha-j'] });
    const credits = await context.service.credits('bgm:1');
    expect(credits?.staff).toEqual([{ role: '导演', names: ['导演甲'] }, { role: '音乐', names: ['ha-j'] }, { role: '动画制作', names: ['Studio PIERROT'] }]);
    expect(credits?.cast).toEqual([{ id: 10, name: '角色甲', relation: '主角', actors: [{ id: 20, name: '声优甲' }] }]);
    expect(context.requested.filter(url => url.endsWith('/persons') || url.endsWith('/characters'))).toHaveLength(2);
    expect(context.peak).toBeLessThanOrEqual(2);
  });
  it('补充资料24小时复用磁盘缓存，重启后离线也能读取', async () => {
    const context = await setup();
    const first = context.service.credits('bgm:1'), second = context.service.credits('bgm:1'); expect(first).toBe(second); await first;
    const calls = context.requested.length; await context.service.credits('bgm:1'); expect(context.requested).toHaveLength(calls);
    context.mode = 'offline';
    const restored = new AnimeService({ directory: context.directory, now: () => context.time, fetcher: context.fetcher }); await restored.initialize();
    expect((await restored.credits('bgm:1'))?.cast[0].actors[0].name).toBe('声优甲');
    expect(context.requested).toHaveLength(calls);
  });
  it('过期后一源异常保留旧资料，另一个来源可以正常更新', async () => {
    const context = await setup(); await context.service.credits('bgm:1');
    context.time = new Date('2026-10-31T04:00:00Z'); context.mode = 'bad-staff';
    const credits = await context.service.credits('bgm:1');
    expect(credits?.staff).toContainEqual({ role: '导演', names: ['导演甲'] });
    expect(credits?.sources.staff.error).toContain('响应格式无效');
    expect(credits?.sources.staff.fetchedAt).toBe('2026-10-29T04:00:00.000Z');
    expect(credits?.sources.cast).toEqual({ fetchedAt: '2026-10-31T04:00:00.000Z', error: null });
  });
  it('首次离线可返回已有基础资料和可重试的独立错误', async () => {
    const context = await setup(); await context.service.detail('bgm:1'); context.mode = 'offline';
    const credits = await context.service.credits('bgm:1');
    expect(credits?.staff).toContainEqual({ role: '音乐', names: ['ha-j'] }); expect(credits?.cast).toEqual([]);
    expect(credits?.sources.staff.error).toBeTruthy(); expect(credits?.sources.cast.error).toBeTruthy();
    context.mode = 'ok'; expect((await context.service.credits('bgm:1'))?.cast[0].name).toBe('角色甲');
  });
  it('空列表表示尚未收录，无需伪造CV，未知ID不请求上游', async () => {
    const context = await setup(); context.mode = 'empty-cast';
    const credits = await context.service.credits('bgm:1'); expect(credits?.cast).toEqual([]); expect(credits?.sources.cast.error).toBeNull();
    const count = context.requested.length; expect(await context.service.credits('bgm:999')).toBeNull(); expect(context.requested).toHaveLength(count);
  });
});

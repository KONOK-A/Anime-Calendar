import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnimeService } from '../server/service';
import { rawCatalog, rawCalendar } from './fixtures';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function setup(rating: unknown) {
  const directory = await mkdtemp(join(tmpdir(), 'anime-rating-')); directories.push(directory);
  let at = new Date('2026-10-29T04:00:00Z'), offline = false, subjectRequests = 0;
  const fetcher = async (url: string) => {
    if (offline) throw new Error('offline');
    const subject = url.includes('/subjects/'); if (subject) subjectRequests++;
    return new Response(JSON.stringify(subject ? { id: 1, name: 'テストの旅', summary: '有效简介', images: {}, rating } : url.includes('/calendar') ? rawCalendar : rawCatalog));
  };
  const service = new AnimeService({ directory, now: () => at, fetcher });
  await service.initialize(); await service.refresh();
  return { service, directory, fetcher, requests: () => subjectRequests, expire: () => { at = new Date('2026-10-30T06:00:00Z'); offline = true; } };
}

describe('Bangumi评分', () => {
  it('读取官方评分、人数与排名，复用详情缓存且断网保留有效数据', async () => {
    const context = await setup({ score: 7.8, total: 1234, rank: 321 });
    expect(await context.service.detail('bgm:1')).toMatchObject({ rating: { score: 7.8, total: 1234, rank: 321 } });
    const restarted = new AnimeService({ directory: context.directory, now: () => new Date('2026-10-29T05:00:00Z'), fetcher: context.fetcher });
    await restarted.initialize();
    expect(await restarted.detail('bgm:1')).toMatchObject({ rating: { score: 7.8, total: 1234, rank: 321 } });
    expect(context.requests()).toBe(1);
    context.expire();
    expect(await context.service.detail('bgm:1')).toMatchObject({ rating: { score: 7.8, total: 1234, rank: 321 }, detailError: expect.any(String) });
  });
  it.each([undefined, { score: 0, total: 0 }, { score: 7.8, total: 0 }, { score: 11, total: 20 }, { score: -1, total: 20 }, { score: '7.8', total: 20 }, { score: 7.8, total: -1 }])('缺失、无投票或异常评分不伪装成有效分数：%j', async rating => {
    const { service } = await setup(rating);
    expect(await service.detail('bgm:1')).toMatchObject({ summary: '有效简介', rating: null });
  });
  it('无排名仍展示有效分数', async () => {
    const { service } = await setup({ score: 6.4, total: 25, rank: 0 });
    expect(await service.detail('bgm:1')).toMatchObject({ rating: { score: 6.4, total: 25, rank: null } });
  });
});

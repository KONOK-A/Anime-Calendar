import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnimeService } from '../server/service.js';
import { rawCatalog, rawCalendar } from './fixtures.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
it('作品来源从完整Bangumi标签识别，展示标签截断不能漏掉来源', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anime-adaptation-')); directories.push(directory);
  const tags = [...Array.from({ length: 12 }, (_, index) => ({ name: `题材${index}`, count: 100 })), { name: '小说改', count: 80 }, { name: '原创', count: 1 }];
  const service = new AnimeService({ directory, fetcher: async url => new Response(JSON.stringify(url.includes('/subjects/') ? { id: 1, name: '星旅', tags } : url.includes('/calendar') ? rawCalendar : rawCatalog)) });
  await service.initialize(); await service.refresh();
  const detail = await service.detail('bgm:1');
  expect(detail?.adaptation).toBe('小说改');
  expect(detail?.tags).toHaveLength(12);
  await service.drain(); service.close();
});

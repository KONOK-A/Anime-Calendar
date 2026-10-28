import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnimeService } from '../../dist/server/server/service.js';
import { createApp } from '../../dist/server/server/app.js';

const directory = await mkdtemp(join(tmpdir(), 'anime-calendar-e2e-'));
const item = (id, title, original, broadcast, begin, type = 'tv') => ({ title: original, titleTranslate: { 'zh-Hans': [title, `${title}别名`] }, type, lang: 'ja', officialSite: 'https://example.com', begin, broadcast, end: '', sites: [{ site: 'bangumi', id: String(id) }, { site: 'bilibili', id: String(id) }] });
const catalog = { siteMeta: { bangumi: { type: 'info' }, bilibili: { title: '哔哩哔哩', type: 'onair', urlTemplate: 'https://www.bilibili.com/bangumi/media/md{{id}}', regions: ['CN'] } }, items: [
  item(1, '星旅', '星の旅', 'R/2026-10-26T15:30:00Z/P7D', '2026-09-30T16:30:00Z'),
  item(2, '放课后的音符', '放課後のノート', 'R/2026-10-29T12:00:00Z/P7D', '2026-10-01T12:00:00Z'),
  item(3, '漫长的夏日', '長い夏', 'R/2026-10-30T12:00:00Z/P7D', '2026-07-03T12:00:00Z'),
  item(4, '尚未定时的故事', '未定', '', '2026-10-30', 'web'),
  { ...item(5, '网络先行作品', '先行配信', 'R/2026-10-19T14:30:00Z/P7D', '2026-10-19T14:30:00Z'), sites: [{ site: 'bangumi', id: '5' }, { site: 'bilibili', id: '5', begin: '2026-10-17T12:00:00Z', broadcast: 'R/2026-10-17T12:00:00Z/P7D' }] },
] };
catalog.siteMeta.gamer = { title: '動畫瘋', type: 'onair', urlTemplate: 'https://acg.gamer.com.tw/acgDetail.php?s={{id}}', regions: ['TW'] };
catalog.siteMeta.gamer_hk = { title: '動畫瘋 HK', type: 'onair', urlTemplate: 'https://acg.gamer.com.tw/acgDetail.php?s={{id}}', regions: ['HK', 'MO'] };
catalog.items[0].sites.push({ site: 'gamer', id: '12345' }, { site: 'gamer_hk', id: '12345' });
const calendar = [{ items: [{ id: 1, type: 2 }, { id: 2, type: 2 }, { id: 3, type: 2 }, { id: 5, type: 2 }] }];
const service = new AnimeService({ directory, now: () => new Date('2026-10-29T04:00:00Z'), fetcher: async url => {
  let value;
  const profile = url.match(/\/v0\/characters\/(\d+)$/);
  if (profile) {
    const id = Number(profile[1]), index = id - 100;
    value = { id, name: `原名${index}`, infobox: index === 7 ? [] : [{ key: '简体中文名', value: index === 0 ? '主角甲' : `配角${index}` }] };
  } else if (url.endsWith('/persons')) {
    const id = Number(url.split('/').at(-2));
    value = id === 1 ? [{ id: 10, name: '导演甲', relation: '导演', type: 1 }, { id: 11, name: '人设乙', relation: '人物原案', type: 1 }, { id: 12, name: '制作公司丙', relation: '动画制作', type: 2 }] : [];
  } else if (url.endsWith('/characters')) {
    const id = Number(url.split('/').at(-2));
    value = id === 1 ? Array.from({ length: 10 }, (_, index) => ({ id: index + 100, name: `原名${index}`, relation: index === 0 ? '主角' : '配角', actors: index === 7 ? [] : [{ id: index + 200, name: `声优${index}` }] })) : [];
  } else if (url.includes('/subjects/')) { const id = Number(url.split('/').at(-1)); value = { id, name: `作品${id}`, name_cn: '', summary: '这是测试中的作品简介，用来验证详情、收藏和平台链接。' + (id === 1 ? '\r\n\r\n[简介原文]\r\nこれは折りたたむ原文です。' : ''), images: { large: 'http://127.0.0.1:4321/missing-cover.jpg' }, eps: 12, tags: [{ name: '青春' }, { name: '日常' }], infobox: id === 1 ? [{ key: '音乐', value: '音乐家丁' }] : [] }; }
  else value = url.includes('/calendar') ? calendar : catalog;
  return new Response(JSON.stringify(value), { status: 200 });
} });
await service.initialize(); await service.refresh();
const server = createApp(service, join(process.cwd(), 'dist/client')).listen(4321, '127.0.0.1');
async function stop() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);

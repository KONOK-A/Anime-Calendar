import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnimeService } from '../server/service.js';
import { rawCalendar, rawCatalog } from './fixtures.js';
import { normalizeCatalog } from '../server/normalize.js';
import { applyRatingLinks, normalizeRatingLinks } from '../server/rating-links.js';
import { verifiedRatingLinks } from './support/verified-rating-links.js';

const directories: string[] = [], services: AnimeService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) { service.close(); await service.drain(); }
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
const external = { mal: { id: 61987, sourceUrl: 'https://myanimelist.net/anime/61987' }, aniList: { id: 195516, sourceUrl: 'https://anilist.co/anime/195516' } };
const filmarks = { filmarks: { seriesId: 3964, seasonId: 6773 }, sourceUrl: 'https://filmarks.com/animes/3964/6773' };
async function setup(links: unknown[], sites: { site: string; id: string }[] = []) {
  const directory = await mkdtemp(join(tmpdir(), 'anime-rating-links-')); directories.push(directory);
  await mkdir(join(directory, 'data')); await mkdir(join(directory, 'cache'));
  const overridesPath = join(directory, 'data/overrides.json');
  await writeFile(overridesPath, JSON.stringify({ version: 1, active: [], events: [], rules: [] }));
  await writeFile(join(directory, 'data/rating-links.json'), JSON.stringify({ version: 1, links }));
  const catalog = structuredClone(rawCatalog); catalog.items[0]!.sites.push(...sites);
  const calls: string[] = [];
  const service = new AnimeService({ directory: join(directory, 'cache'), overridesPath, now: () => new Date('2026-10-31T00:00:00Z'), fetcher: async (url, init) => {
    calls.push(url);
    if (url.includes('/subjects/')) return Response.json({ id: 1, name: 'テストの旅', rating: { score: 7.3, total: 629 } });
    if (url.startsWith('https://myanimelist.net/anime/')) return new Response('<link rel="canonical" href="https://myanimelist.net/anime/61987"><div itemprop="aggregateRating" itemscope itemtype="https://schema.org/AggregateRating"><span itemprop="ratingValue">8.64</span><span itemprop="ratingCount">16259</span></div>');
    if (url.startsWith('https://graphql.anilist.co/')) { expect(JSON.parse(init!.body as string).query).toContain('Media(id:195516,'); return Response.json({ data: { Media: { id: 195516, type: 'ANIME', averageScore: 85, stats: { scoreDistribution: [{ score: 80, amount: 4902 }] } } } }); }
    if (url.startsWith('https://filmarks.com/')) return new Response(`<link rel="canonical" href="${url}"><script type="application/ld+json">${JSON.stringify({ '@type': 'TVSeason', url, aggregateRating: { ratingValue: '4.2', bestRating: '5' } })}</script>`);
    return Response.json(url.includes('/calendar') ? rawCalendar : catalog);
  } });
  services.push(service); await service.initialize(); await service.refresh();
  return { service, calls };
}

describe('经核实的跨站评分关联', () => {
  it('基础目录缺ID时补入完整目录、单条详情和四站评分，首屏不额外查找关联', async () => {
    const { service, calls } = await setup([{ animeId: 'bgm:1', ...filmarks, ...external }]);
    expect(service.catalog()?.items[0]?.externalIds).toEqual({ mal: 61987, aniList: 195516 });
    expect(calls).toHaveLength(2);
    expect((await service.detail('bgm:1'))?.externalIds).toEqual({ mal: 61987, aniList: 195516 });
    const summary = await service.ratings('bgm:1', true);
    expect(summary).toMatchObject({ score: 8.2, count: 4 });
    expect(summary?.sources.map(source => source.status)).toEqual(['ready', 'ready', 'ready', 'ready']);
  });
  it('允许仅MAL/AniList的已核实记录，并兼容原有仅Filmarks记录', async () => {
    const { service } = await setup([{ animeId: 'bgm:1', ...external }, { animeId: 'bgm:2', ...filmarks }]);
    expect(service.item('bgm:1')?.externalIds).toEqual({ mal: 61987, aniList: 195516 });
    expect(service.status().warnings).not.toContain('部分外站评分关联无法读取。');
  });
  it('关联冲突时保留基础目录并停止整条补齐，避免混合不同作品评分', async () => {
    const { service } = await setup([{ animeId: 'bgm:1', ...filmarks, ...external }], [{ site: 'mal', id: '123' }]);
    expect(service.item('bgm:1')?.externalIds).toEqual({ mal: 123 });
    expect(service.status().warnings.some(warning => /评分关联.*冲突/.test(warning))).toBe(true);
  });
  it.each([
    { ...external.mal, id: 0 },
    { ...external.mal, sourceUrl: 'https://myanimelist.net/anime/61988' },
    { ...external.mal, sourceUrl: 'https://myanimelist.net.attacker.test/anime/61987' },
  ])('拒绝无效ID或来源与ID不符的补充数据', async mal => {
    const { service } = await setup([{ animeId: 'bgm:1', ...filmarks, mal }]);
    expect(service.item('bgm:1')?.externalIds).toBeUndefined();
    expect(service.status().warnings).toContain('部分外站评分关联无法读取。');
  });
  it('药屋第三季随项目交付明确的两站关联，不借用前季', async () => {
    const input = JSON.parse(await readFile(new URL('../data/rating-links.json', import.meta.url), 'utf8'));
    expect(input.links.find((entry: { animeId: string }) => entry.animeId === 'bgm:568244')).toMatchObject(external);
  });
  it.each(verifiedRatingLinks)('%s 补齐核实的当季条目，所有来源ID与审核样本一致', async (id, mal, aniList, externalIds) => {
    const input = JSON.parse(await readFile(new URL('../data/rating-links.json', import.meta.url), 'utf8'));
    const item = { ...normalizeCatalog(rawCatalog).items[0]!, id, bangumiId: Number(id.slice(4)), externalIds };
    const warnings: string[] = [], [linked] = applyRatingLinks([item], normalizeRatingLinks(input), warnings);
    expect(linked?.externalIds).toEqual({ ...(mal ? { mal } : {}), ...(aniList ? { aniList } : {}) });
    expect(warnings).toEqual([]);
  });
});

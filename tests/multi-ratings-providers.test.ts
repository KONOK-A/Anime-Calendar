import { describe, expect, it } from 'vitest';
import { parseAniListRating, parseFilmarksRating, parseMalPageRating, parseMalRating } from '../server/rating-providers.js';

const filmarks = (body: unknown, canonical = 'https://filmarks.com/animes/4998/6805') => `<html><head><link rel="canonical" href="${canonical}"><script type="application/ld+json">${JSON.stringify(body)}</script></head></html>`;
const malPage = (body: string, canonical = 'https://myanimelist.net/anime/59787/Romelia_Senki') => `<html><head><title>Anime - MyAnimeList.net</title><link rel="canonical" href="${canonical}"></head><body>${body}</body></html>`;
const malAggregate = (value: string, count: string) => `<div itemprop="aggregateRating" itemscope itemtype="http://schema.org/AggregateRating" class="spaceit_pad po-r js-statistics-info di-ib" data-id="info1"><span itemprop="ratingValue" class="score-label score-8">${value}</span><sup>1</sup> (scored by <span itemprop="ratingCount" style="display: none">${count}</span>users)</div>`;
describe('评分来源解析', () => {
  it('只接受精确MAL作品ID及评分人数，未评分返回null', () => {
    expect(parseMalRating({ data: { mal_id: 123, score: 8.21, scored_by: 111 } }, 123, 'jikan')).toEqual({ score: 8.21, votes: 111 });
    expect(parseMalRating({ id: 123, mean: 8.21, num_scoring_users: 111 }, 123, 'official')).toEqual({ score: 8.21, votes: 111 });
    expect(parseMalRating({ data: { mal_id: 123, score: null, scored_by: null } }, 123, 'jikan')).toEqual({ score: null, votes: null });
    expect(() => parseMalRating({ data: { mal_id: 124, score: 8 } }, 123, 'jikan')).toThrow();
    expect(() => parseMalRating({ data: { mal_id: 123, score: '8.0', scored_by: 2 } }, 123, 'jikan')).toThrow();
    expect(parseMalRating({ data: { mal_id: 123, score: 8, scored_by: '999' } }, 123, 'jikan').votes).toBeNull();
  });
  it.each([
    [59787, 'Romelia_Senki', '7.26', '3717', { score: 7.26, votes: 3717 }],
    [52991, 'Sousou_no_Frieren', '9.24', '949363', { score: 9.24, votes: 949363 }],
    [1, 'Cowboy_Bebop', '8.75', '1080122', { score: 8.75, votes: 1080122 }],
  ] as const)('MAL公开页从作品%d的聚合微数据提取分数及评分人数', (id, slug, value, count, expected) => {
    expect(parseMalPageRating(malPage(malAggregate(value, count), `https://myanimelist.net/anime/${id}/${slug}`), id)).toEqual(expected);
  });
  it('MAL公开页只读聚合评分，不读用户评分或普通人数', () => {
    const review = '<div itemscope itemtype="https://schema.org/Review"><span itemprop="ratingValue">1</span><span itemprop="ratingCount">999999</span></div>';
    expect(parseMalPageRating(malPage(`${review}${malAggregate('7.26', '3717')}<div>Members: 999999</div>`), 59787)).toEqual({ score: 7.26, votes: 3717 });
    expect(() => parseMalPageRating(malPage(review), 59787)).toThrow(/聚合评分/);
    expect(parseMalPageRating(malPage(malAggregate('N/A', '0')), 59787)).toEqual({ score: null, votes: 0 });
  });
  it.each([
    'https://myanimelist.net/anime/52991/Sousou_no_Frieren', 'https://myanimelist.net/anime/597870',
    'https://myanimelist.net/manga/59787', 'https://myanimelist.net.evil.invalid/anime/59787',
    'http://myanimelist.net/anime/59787', 'https://myanimelist.net/anime/59787?other=52991',
  ])('MAL公开页拒绝错误canonical身份：%s', canonical => {
    expect(() => parseMalPageRating(malPage(malAggregate('7.26', '3717'), canonical), 59787)).toThrow();
  });
  it('MAL公开页拒绝缺失或重复canonical及挑战/登录页面', () => {
    const html = malPage(malAggregate('7.26', '3717'));
    expect(() => parseMalPageRating(html.replace(/<link[^>]+>/, ''), 59787)).toThrow();
    expect(() => parseMalPageRating(html.replace('</head>', '<link rel="canonical" href="https://myanimelist.net/anime/59787"></head>'), 59787)).toThrow();
    for (const title of ['Just a moment...', 'Login - MyAnimeList.net', 'Verify you are human']) expect(() => parseMalPageRating(html.replace('Anime - MyAnimeList.net', title), 59787)).toThrow();
  });
  it.each([
    ['Infinity', '2'], ['NaN', '2'], ['10.01', '2'], ['-1', '2'], ['7.26x', '2'],
    ['<img onerror="globalThis.malPageExecuted=true">', '2'], ['7.26', '-1'], ['7.26', '1.5'],
    ['7.26', 'Infinity'], ['7.26', '9007199254740992'], ['N/A', '2'],
  ])('MAL公开页拒绝非法评分/人数：%s/%s', (value, count) => {
    expect(() => parseMalPageRating(malPage(malAggregate(value, count)), 59787)).toThrow();
    expect((globalThis as Record<string, unknown>).malPageExecuted).toBeUndefined();
  });
  it('MAL公开页拒绝不完整、重复或嵌套其他评分对象的聚合块', () => {
    const aggregate = malAggregate('7.26', '3717');
    expect(() => parseMalPageRating(malPage(aggregate.replace('</div>', '')), 59787)).toThrow();
    expect(() => parseMalPageRating(malPage(aggregate + aggregate), 59787)).toThrow();
    expect(() => parseMalPageRating(malPage(aggregate.replace('</div>', '<span itemprop="ratingValue">9.9</span></div>')), 59787)).toThrow();
    expect(() => parseMalPageRating(malPage(aggregate.replace('<span itemprop="ratingValue"', '<div itemscope itemtype="https://schema.org/Rating"><span itemprop="ratingValue"').replace('</div>', '</div></div>')), 59787)).toThrow();
  });
  it('MAL公开页忽略脚本和注释里的假评分，不执行HTML', () => {
    const fake = `<script>globalThis.malPageExecuted=true; const html=${JSON.stringify(malAggregate('9.99', '999'))}</script><!--${malAggregate('9.99', '999')}-->`;
    expect(parseMalPageRating(malPage(fake + malAggregate('7.26', '3717')), 59787)).toEqual({ score: 7.26, votes: 3717 });
    expect((globalThis as Record<string, unknown>).malPageExecuted).toBeUndefined();
  });
  it('AniList人数只累加有效评分分布，不能使用收藏或追踪人数', () => {
    expect(parseAniListRating({ data: { Media: { id: 200, type: 'ANIME', averageScore: 81, popularity: 999, stats: { scoreDistribution: [{ score: 10, amount: 2 }, { score: 80, amount: 5 }] } } } }, 200)).toEqual({ score: 81, votes: 7 });
    expect(parseAniListRating({ data: { Media: { id: 200, type: 'ANIME', averageScore: 81 } } }, 200).votes).toBeNull();
    expect(() => parseAniListRating({ data: { Media: { id: 201, type: 'ANIME', averageScore: 81 } } }, 200)).toThrow();
    expect(() => parseAniListRating({ data: { Media: { id: 200, type: 'MANGA', averageScore: 81 } } }, 200)).toThrow();
    expect(() => parseAniListRating({ errors: [{ message: 'no' }], data: null }, 200)).toThrow();
  });
  it('Filmarks仅提取对应作品JSON-LD聚合分，评论数不充当评分人数', () => {
    expect(parseFilmarksRating(filmarks({ '@type': 'TVSeries', url: 'https://filmarks.com/animes/4998/6805', aggregateRating: { '@type': 'AggregateRating', ratingValue: 3.6, bestRating: 5, reviewCount: 270 } }), { seriesId: 4998, seasonId: 6805 })).toEqual({ score: 3.6, votes: null });
  });
  it('Filmarks未评分页面仅有正确作品面包屑时保留空分', () => {
    expect(parseFilmarksRating(filmarks({ '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', item: { '@id': 'https://filmarks.com/animes/4998/6805', name: '未评分作品' } }] }), { seriesId: 4998, seasonId: 6805 })).toEqual({ score: null, votes: null });
  });
  it('Filmarks拒绝错误身份、脚本内容、异常满分且不执行HTML', () => {
    const link = { seriesId: 4998, seasonId: 6805 };
    expect(() => parseFilmarksRating(filmarks({ '@type': 'TVSeries', url: 'https://filmarks.com/animes/1/2', aggregateRating: { ratingValue: 4, bestRating: 5 } }), link)).toThrow();
    expect(() => parseFilmarksRating(filmarks({ '@type': 'TVSeries', aggregateRating: { ratingValue: '<img onerror=alert(1)>', bestRating: 5 } }), link)).toThrow();
    expect(() => parseFilmarksRating(filmarks({ '@type': 'TVSeries', aggregateRating: { ratingValue: 4, bestRating: 10 } }), link)).toThrow();
    expect(() => parseFilmarksRating('<script>globalThis.attacked=true</script>', link)).toThrow();
    expect((globalThis as Record<string, unknown>).attacked).toBeUndefined();
  });
});

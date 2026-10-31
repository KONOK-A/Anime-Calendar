import { test, expect, type Route } from '@playwright/test';
import { useCatalogFixture } from '../support/catalog-view-fixture';
import type { RatingSummary } from '../../shared/scores';

const sample: RatingSummary = { score: 8.3, count: 4, fetchedAt: '2026-10-29T04:00:00Z', sources: [
  { provider: 'bangumi', score: 8, maxScore: 10, votes: 1234, url: 'https://bgm.tv/subject/1', fetchedAt: null, status: 'ready' },
  { provider: 'mal', score: 8.2, maxScore: 10, votes: 2345, url: 'https://myanimelist.net/anime/1', fetchedAt: null, status: 'ready' },
  { provider: 'filmarks', score: 4.2, maxScore: 5, votes: null, url: 'https://filmarks.com/animes/1/1', fetchedAt: null, status: 'ready' },
  { provider: 'anilist', score: 86, maxScore: 100, votes: 3456, url: 'https://anilist.co/anime/1', fetchedAt: null, status: 'ready' },
] };

test('来源返回不可用时保留同一作品和来源的已有评分，恢复后可以重试', async ({ page }) => {
  let failed = false, changed = false;
  await page.route(/\/api\/anime\/[^/]+\/ratings(?:\?.*)?$/, route => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3]!);
    return route.fulfill({ json: { id, ...sample, ...(failed ? { score: null, count: 0, sources: sample.sources.map(source => ({ ...source, url: changed && source.provider === 'filmarks' ? 'https://filmarks.com/animes/2/2' : source.url, score: null, votes: null, status: 'unavailable', error: '来源暂不可用' })) } : {}) } });
  });
  await page.goto('/#/anime/bgm:1');
  const panel = page.locator('.rating-panel'), refresh = panel.locator('.rating-refresh');
  await expect(page.locator('.detail-rating-row .rating-badge-score')).toHaveText('8.3');
  failed = true;
  const updated = page.waitForResponse(response => /\/api\/anime\/[^/]+\/ratings$/.test(new URL(response.url()).pathname));
  await refresh.click(); await updated; await expect(refresh).toBeEnabled();
  await expect(page.locator('.detail-rating-row .rating-badge-score')).toHaveText('8.3');
  await expect(panel.locator('.rating-load-error')).toContainText('保留现有评分');
  changed = true; await refresh.click();
  await expect(page.locator('.detail-rating-row .rating-badge')).toHaveAttribute('aria-label', '综合评分 8.3 / 10');
  await expect(panel.locator('[data-provider="filmarks"] .rating-source-score')).toHaveText('暂不可用');
  failed = false; await refresh.click();
  await expect(panel.locator('.rating-load-error')).toHaveCount(0);
});
const animeId = (route: Route) => decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3]!);

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') });
  await page.route(/\/api\/anime\/[^/]+\/ratings(?:\?.*)?$/, route => route.fulfill({ json: { ...sample, id: animeId(route) } }));
});

test('综合评分在作品卡、主视觉与详情一致，四站保留各自满分和人数', async ({ page }) => {
  await page.goto('/#/weekly');
  const hero = page.getByRole('region', { name: '今日作品', exact: true });
  await expect(hero.locator('.hero-work:not([inert]) .rating-badge')).toHaveAttribute('aria-label', '综合评分 8.3 / 10');
  await expect(page.locator('.anime-card[data-anime-id="bgm:2"]:visible').first().locator('.rating-badge')).toContainText('8.3');
  await hero.getByRole('link', { name: '打开今日作品详情', exact: true }).click();
  const ratings = page.getByRole('region', { name: '作品评分', exact: true });
  await expect(ratings.locator('.rating-source')).toHaveCount(4);
  await expect(ratings.locator('[data-provider="filmarks"]')).toContainText('4.2 / 5');
  await expect(ratings.locator('[data-provider="filmarks"]')).toContainText('评分人数暂缺');
  await expect(ratings.locator('[data-provider="anilist"]')).toContainText('86 / 100');
  await expect(ratings.locator('[data-provider="mal"]')).toContainText('2,345 人评分');
  await expect(page.locator('.detail-rating-row .rating-badge')).toContainText('8.3');
});

test('主视觉快速切换时标题和评分仍对应同一作品，长标题和手机保留首屏排期', async ({ page }) => {
  const catalog = await (await page.request.get('/api/catalog')).json();
  const first = catalog.items.find((item: { id: string }) => item.id === 'bgm:1');
  first.rule = { ...first.rule, anchor: '2026-10-29T05:00:00Z', frequency: 'weekly', raw: 'R/2026-10-29T05:00:00Z/P7D' };
  if (first.networkAiring) { first.networkAiring.rule = { ...first.rule }; first.networkAiring.rules = [{ ...first.rule }]; }
  first.title = '这是一部用于检查长标题排版并保留今日完整排期的动画作品';
  await useCatalogFixture(page, catalog);
  await page.route(/\/api\/anime\/bgm(?:%3A|:)1\/ratings(?:\?.*)?$/, route => route.fulfill({ json: { ...sample, id: animeId(route), score: 8, count: 1, sources: [sample.sources[0]] } }));
  await page.goto('/#/weekly');
  const hero = page.getByRole('region', { name: '今日作品', exact: true });
  await expect(hero.locator('.hero-work:not([inert])')).toContainText(first.title);
  await expect(hero.locator('.hero-work:not([inert]) .rating-badge')).toContainText('8.0');
  await hero.getByRole('button', { name: '下一部今日作品' }).click();
  await expect(hero.locator('.hero-work:not([inert])')).toContainText('放课后的音符');
  await expect(hero.locator('.hero-work:not([inert]) .rating-badge')).toContainText('8.3');
  await hero.getByRole('button', { name: '下一部今日作品' }).click();
  await expect(hero.locator('.hero-work:not([inert])')).toContainText(first.title);
  await expect(hero.locator('.hero-work:not([inert]) .rating-badge')).toContainText('8.0');
  await expect(page.locator('.weekly-grid .anime-card:visible').first()).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('评分失败可以重试，显式关闭的 AniList 可查看说明', async ({ page }) => {
  let failed = true;
  await page.route(/\/api\/anime\/[^/]+\/ratings(?:\?.*)?$/, route => failed ? route.fulfill({ status: 503, json: { id: animeId(route), error: '评分来源暂不可用' } }) : route.fulfill({ json: { ...sample, id: animeId(route), score: 8.2, count: 3, sources: [...sample.sources.slice(0, 3), { ...sample.sources[3], score: null, votes: null, status: 'disabled' }] } }));
  await page.goto('/#/anime/bgm:1');
  const ratings = page.getByRole('region', { name: '作品评分', exact: true });
  await expect(ratings.getByRole('button', { name: '重试评分', exact: true })).toBeVisible();
  failed = false;
  await ratings.getByRole('button', { name: '重试评分', exact: true }).click();
  await expect(ratings.locator('[data-provider="anilist"]')).toContainText('未启用');
  await ratings.getByText('评分说明', { exact: true }).click();
  await expect(ratings.locator('.rating-explanation')).toContainText('AniList');
});

test('卡片呈现改编标签与休播说明，旧缓存冲突标签不推测改编类型，无分保持简洁', async ({ page }) => {
  const catalog = await (await page.request.get('/api/catalog')).json();
  catalog.overrides.events.push({ animeId: 'bgm:2', at: '2026-10-29T12:00:00Z', status: 'cancelled', sourceUrl: 'https://example.com', note: '本次休播，顺延一周' });
  await useCatalogFixture(page, catalog);
  await page.route(/\/api\/anime\/bgm(?:%3A|:)[12]$/, async route => {
    const detail = await (await route.fetch()).json();
    delete detail.adaptation;
    detail.rating = null;
    detail.tags = detail.id === 'bgm:2' ? ['漫画改'] : ['漫画改', '小说改'];
    await route.fulfill({ json: detail });
  });
  await page.route(/\/api\/anime\/[^/]+\/ratings(?:\?.*)?$/, route => route.fulfill({ json: { id: animeId(route), score: null, count: 0, sources: [], fetchedAt: null } }));
  await page.goto('/#/weekly');
  const card = page.locator('.weekly-grid [data-anime-id="bgm:2"]');
  await expect(card.locator('.card-adaptation')).toHaveText('漫改');
  await expect(card.locator('.event-footnote')).toHaveText('本次休播，顺延一周');
  await expect(card.locator('.rating-badge')).toHaveCount(0);
  await page.goto('/#/season/2026/4');
  await expect(page.locator('.catalog-page [data-anime-id="bgm:1"] .card-adaptation')).toHaveCount(0);
  await expect(page.locator('.catalog-page [data-anime-id="bgm:2"] .card-adaptation')).toHaveText('漫改');
});

test('缺少可信网络时刻仍能查看原放送参考', async ({ page }) => {
  const catalog = await (await page.request.get('/api/catalog')).json();
  const first = catalog.items.find((item: { id: string }) => item.id === 'bgm:1');
  first.rule = { anchor: null, frequency: 'unknown', raw: '', end: null };
  first.broadcastRule = { anchor: '2026-10-26T13:00:00Z', frequency: 'weekly', raw: 'R/2026-10-26T13:00:00Z/P7D', end: null };
  delete first.networkAiring;
  await useCatalogFixture(page, catalog);
  await page.goto('/#/anime/bgm:1');
  const facts = page.locator('.detail-facts');
  await expect(facts.locator('div').filter({ has: page.getByText('默认播出时间', { exact: true }) })).toContainText('时间待定');
  await expect(facts.locator('div').filter({ has: page.getByText('原放送参考', { exact: true }) })).toContainText('每星期一 21:00');
});

test('详情合并同作多条常规配信时段并去重，特殊首发不覆盖常规周一和周五', async ({ page }) => {
  const catalog = await (await page.request.get('/api/catalog')).json();
  const first = catalog.items.find((item: { id: string }) => item.id === 'bgm:1');
  const monday = { anchor: '2026-10-05T07:00:00Z', frequency: 'weekly', raw: 'R/2026-10-05T07:00:00Z/P7D', end: null };
  const friday = { ...monday, anchor: '2026-10-09T07:00:00Z', raw: 'R/2026-10-09T07:00:00Z/P7D' };
  const premiere = { ...monday, anchor: '2026-10-01T07:00:00Z', frequency: 'once', raw: '2026-10-01T07:00:00Z' };
  first.rule = premiere;
  first.networkAiring = { platform: 'YouTube', regions: ['JP'], begin: premiere.anchor, rule: premiere, rules: [premiere, monday, friday, { ...monday }], sourceUrl: 'https://example.com' };
  await useCatalogFixture(page, catalog);
  await page.goto('/#/anime/bgm:1');
  const schedule = page.locator('.detail-facts div').filter({ has: page.getByText('默认播出时间', { exact: true }) });
  await expect(schedule.locator('dd')).toHaveText('每星期一 15:00、每星期五 15:00');
  await expect(page.locator('.detail-airing-summary')).toContainText('每星期一 15:00、每星期五 15:00');
});

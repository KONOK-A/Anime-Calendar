import { expect, test, type Page } from '@playwright/test';
import { summarizeRatings, type ProviderRating } from '../../shared/scores';
import { useCatalogFixture } from '../support/catalog-view-fixture';
import type { CatalogSnapshot } from '../../shared/types';

const stamp = '2026-10-29T04:00:00Z', id = 'bgm:2';
const detailPath = /\/api\/anime\/bgm(?:%3A|:)2(?:\?.*)?$/;
const ratingPath = /\/api\/anime\/bgm(?:%3A|:)2\/ratings(?:\?.*)?$/;
const sources: ProviderRating[] = [
  { provider: 'bangumi', score: 8, maxScore: 10, votes: 1234, url: 'https://bgm.tv/subject/2', fetchedAt: stamp, status: 'ready' },
  { provider: 'mal', score: 8.2, maxScore: 10, votes: 2345, url: 'https://myanimelist.net/anime/2', fetchedAt: stamp, status: 'ready' },
  { provider: 'filmarks', score: 4.2, maxScore: 5, votes: null, url: 'https://filmarks.com/animes/2/2', fetchedAt: stamp, status: 'ready' },
  { provider: 'anilist', score: 86, maxScore: 100, votes: 3456, url: 'https://anilist.co/anime/2', fetchedAt: stamp, status: 'ready' },
];
const complete = () => ({ id, ...summarizeRatings(sources) });
const partial = (status: 'unavailable' | 'unlinked') => ({ id, ...summarizeRatings(sources.map((source, index) => index === 0 ? source : { ...source, score: null, votes: null, fetchedAt: null, status, ...(status === 'unlinked' ? { url: null } : { error: '评分更新任务较多，请稍后重试。' }) })) });

async function prepare(page: Page, linked = true) {
  await page.clock.install({ time: new Date(stamp) });
  const catalog: CatalogSnapshot = await (await page.request.get('/api/catalog')).json();
  const item = catalog.items.find(item => item.id === id)!;
  item.externalIds = linked ? { mal: 2, aniList: 2 } : undefined;
  catalog.items = [item]; catalog.activeIds = [id];
  await useCatalogFixture(page, catalog);
  return {
    card: page.locator(`.weekly-grid .anime-card[data-anime-id="${id}"]:visible`).first(),
    hero: page.getByRole('region', { name: '今日作品', exact: true }).locator('.hero-work:not([inert])'),
  };
}

test('首页可见卡片和主视觉取评分不等待慢详情元数据', async ({ page }) => {
  const { card, hero } = await prepare(page);
  let release!: () => void, detailsStarted = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  const delivered = page.waitForResponse(response => detailPath.test(new URL(response.url()).pathname));
  await page.route(detailPath, async route => {
    detailsStarted = true;
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await page.route(ratingPath, route => route.fulfill({ json: complete() }));
  try {
    await page.goto('/#/weekly');
    await expect(card).toBeInViewport();
    await expect.poll(() => detailsStarted).toBe(true);
    await expect(card.locator('.rating-badge')).toHaveAttribute('aria-label', '综合评分 8.3 / 10', { timeout: 2000 });
    await expect(hero.locator('.rating-badge')).toHaveAttribute('aria-label', '综合评分 8.3 / 10');
    await expect(page).toHaveURL(/#\/weekly$/);
  } finally { release(); await delivered; }
});

test('首页队列暂满时按提示退避并补齐评分，成功后停止确认', async ({ page }) => {
  const { card, hero } = await prepare(page);
  let requests = 0, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(ratingPath, async route => {
    if (++requests === 1) { await held; await route.fulfill({ json: { ...partial('unavailable'), revalidating: false, retryAfterMs: 1000 } }); }
    else await route.fulfill({ json: complete() });
  });
  try {
    await page.goto('/#/weekly');
    await expect(card).toBeInViewport();
    await expect.poll(() => requests).toBe(1);
    // Let both initial visible consumers join the same request before releasing it.
    await page.clock.runFor(300); release();
    await expect(card.locator('.rating-badge')).toHaveAttribute('aria-label', '综合评分 8.0 / 10');
    await page.clock.runFor(1200);
    await expect(card.locator('.rating-badge')).toHaveAttribute('aria-label', '综合评分 8.3 / 10', { timeout: 2000 });
    await expect(hero.locator('.rating-badge')).toHaveAttribute('aria-label', '综合评分 8.3 / 10');
    expect(requests).toBe(2);
    await page.clock.runFor(5000); expect(requests).toBe(2);
    await expect(page).toHaveURL(/#\/weekly$/);
  } finally { release(); }
});

test('首页真正未关联的来源保留未关联结果，不反复取分', async ({ page }) => {
  const { card } = await prepare(page, false); let requests = 0;
  await page.route(ratingPath, route => { requests++; return route.fulfill({ json: partial('unlinked') }); });
  await page.goto('/#/weekly');
  await expect(card.locator('.rating-badge')).toHaveAttribute('aria-label', '综合评分 8.0 / 10');
  await page.clock.runFor(5000);
  expect(requests).toBe(1);
  await expect(page).toHaveURL(/#\/weekly$/);
});

test('进入已有缓存详情取得新评分后，返回首页保留同一最新结果', async ({ page }) => {
  const { card } = await prepare(page); let requests = 0;
  const metadata = page.waitForResponse(response => detailPath.test(new URL(response.url()).pathname));
  await page.route(ratingPath, route => route.fulfill({ json: ++requests === 1 ? { ...partial('unavailable'), retryAfterMs: 60_000 } : complete() }));
  await page.goto('/#/weekly'); await metadata;
  await expect(card.locator('.rating-badge')).toHaveAttribute('aria-label', '综合评分 8.0 / 10');
  await page.clock.runFor(300);
  await page.getByRole('region', { name: '今日作品', exact: true }).getByRole('link', { name: '打开今日作品详情', exact: true }).click();
  await expect(page.locator('.detail-rating-row .rating-badge')).toHaveAttribute('aria-label', '综合评分 8.3 / 10');
  await page.getByRole('link', { name: '返回番表', exact: true }).click();
  await expect(card.locator('.rating-badge')).toHaveAttribute('aria-label', '综合评分 8.3 / 10');
  expect(requests).toBe(2);
});

import { expect, test } from '@playwright/test';
import { summarizeRatings } from '../../shared/scores';
import { useCatalogFixture } from '../support/catalog-view-fixture';
import type { AppStatus, CatalogSnapshot, SeasonRatings } from '../../shared/types';

const stamp = '2026-10-29T04:00:00Z', links = { mal: 61987, aniList: 195516 };
function score(id: string, linked: boolean) {
  const complete = linked && id === 'bgm:1';
  return summarizeRatings([
    { provider: 'bangumi', score: id === 'bgm:1' ? 8 : 6, maxScore: 10, votes: 1234, url: `https://bgm.tv/subject/${id.slice(4)}`, fetchedAt: stamp, status: 'ready' },
    { provider: 'mal', score: complete ? 8.2 : null, maxScore: 10, votes: complete ? 2345 : null, url: complete ? `https://myanimelist.net/anime/${links.mal}` : null, fetchedAt: complete ? stamp : null, status: complete ? 'ready' : 'unlinked' },
    { provider: 'filmarks', score: complete ? 4.2 : null, maxScore: 5, votes: null, url: complete ? 'https://filmarks.com/animes/1/1' : null, fetchedAt: complete ? stamp : null, status: complete ? 'ready' : 'unlinked' },
    { provider: 'anilist', score: complete ? 86 : null, maxScore: 100, votes: complete ? 3456 : null, url: complete ? `https://anilist.co/anime/${links.aniList}` : null, fetchedAt: complete ? stamp : null, status: complete ? 'ready' : 'unlinked' },
  ]);
}
async function prepare(page: import('@playwright/test').Page) {
  await page.clock.install({ time: new Date(stamp) });
  const catalog: CatalogSnapshot = await (await page.request.get('/api/catalog')).json();
  const item = catalog.items.find(item => item.id === 'bgm:1')!; delete item.externalIds;
  await useCatalogFixture(page, catalog);
  let linked = false, ratingsCalls = 0, quarterCalls = 0;
  await page.route('**/api/refresh', async route => {
    linked = true; item.externalIds = links;
    const status: AppStatus = { appId: 'anime-calendar', version: '1.0.0', refreshing: false, hasCatalog: true, sources: { catalog: { fetchedAt: stamp, error: null }, calendar: { fetchedAt: stamp, error: null } }, warnings: [] };
    await route.fulfill({ json: status });
  });
  await page.route(/\/api\/anime\/[^/]+\/ratings(?:\?.*)?$/, route => {
    ratingsCalls++; const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3]!);
    return route.fulfill({ json: { id, ...score(id, linked) } });
  });
  await page.route('**/api/catalog/ratings?**', route => {
    quarterCalls++; const season = new URL(route.request().url()).searchParams.get('season')!;
    const items = catalog.items.filter(item => item.season === season), ids = items.map(item => item.id).sort();
    const value: SeasonRatings = { schemaVersion: 1, scope: { type: 'ratings', key: `ratings:${season}`, season }, ids, total: ids.length, processed: ids.length, status: 'ready', updatedAt: stamp, entries: ids.map(id => ({ id, rating: null, fetchedAt: stamp, error: null, summary: score(id, linked) })) };
    return route.fulfill({ json: value });
  });
  return { get ratingsCalls() { return ratingsCalls; }, get quarterCalls() { return quarterCalls; } };
}

test('补齐同一作品关联后，卡片与详情不被旧未关联评分锁住', async ({ page }) => {
  const calls = await prepare(page); await page.goto('/#/season/2026/4');
  const card = page.locator('.catalog-page [data-anime-id="bgm:1"]');
  await expect(card.locator('.card-rating')).toHaveAttribute('aria-label', '综合评分 8.0 / 10');
  const before = calls.ratingsCalls;
  await page.getByRole('button', { name: '刷新数据', exact: true }).click();
  await expect(card.locator('.card-rating')).toHaveAttribute('aria-label', '综合评分 8.3 / 10');
  expect(calls.ratingsCalls).toBeGreaterThan(before);
  await card.getByRole('link', { name: '查看星旅详情', exact: true }).click();
  const panel = page.getByRole('region', { name: '作品评分', exact: true });
  await expect(panel.locator('[data-provider="mal"] .rating-source-score')).toHaveText('8.2 / 10');
  await expect(panel.locator('[data-provider="anilist"] .rating-source-score')).toHaveText('86 / 100');
  await expect(page.locator('.detail-rating-row .rating-badge-score')).toHaveText('8.3');
});

test('季度作品集合相同但关联改变时，评分排序重新取得完整摘要', async ({ page }) => {
  const calls = await prepare(page); await page.goto('/#/season/2026/4');
  await page.getByRole('combobox', { name: '作品排序', exact: true }).selectOption('rating');
  const card = page.locator('.catalog-page [data-anime-id="bgm:1"]');
  await expect(card.locator('.card-rating')).toHaveAttribute('aria-label', '综合评分 8.0 / 10');
  expect(calls.quarterCalls).toBe(1);
  await page.getByRole('button', { name: '刷新数据', exact: true }).click();
  await expect(card.locator('.card-rating')).toHaveAttribute('aria-label', '综合评分 8.3 / 10');
  expect(calls.quarterCalls).toBeGreaterThan(1);
  await expect(page.getByRole('combobox', { name: '作品排序', exact: true })).toHaveValue('rating');
});

import { expect, test } from '@playwright/test';
import type { Anime, AiringRule, CatalogSnapshot } from '../../shared/types';
import { catalogViewFixture } from '../support/catalog-view-fixture';

const total = 3000;
const baseId = 80_000;
const oldId = `bgm:${baseId}`;
const fixedDate = '2026-10-29T04:00:00.000Z';
const unknown: AiringRule = { anchor: null, frequency: 'unknown', raw: '', end: null };
const library = new Map<string, Anime>();
for (let index = 0; index < total; index++) {
  const bangumiId = baseId + index;
  const id = `bgm:${bangumiId}`;
  library.set(id, {
    id, bangumiId, title: index === 0 ? '远星旧卷' : `追番库作品 ${index + 1}`,
    originalTitle: index === 0 ? '旧星の記録' : `原題 ${index + 1}`,
    aliases: index === 0 ? ['远星密钥'] : [`目录别名 ${index + 1}`],
    type: 'tv', begin: '2025-01-01', season: index < 40 ? '2025-1' : '2026-4', officialSite: null,
    platforms: [], rule: unknown, broadcastRule: unknown, sourceUrl: `https://bgm.tv/subject/${bangumiId}`,
  });
}

function snapshot(items: Anime[]): CatalogSnapshot {
  return {
    schemaVersion: 1, items, warnings: [], activeIds: [],
    fetchedAt: { catalog: fixedDate, calendar: fixedDate }, overrides: { version: 1, active: [], events: [], rules: [] },
  };
}

test('3000 部追番分批建索引，全库别名搜索与分页不重复拉取，重新载入仍可读个人记录', async ({ page }) => {
  await page.clock.install({ time: new Date(fixedDate) });
  await page.addInitScript(ids => {
    if (!localStorage.getItem('anime-calendar:favorites:v1')) localStorage.setItem('anime-calendar:favorites:v1', JSON.stringify(ids));
  }, [...library.keys()]);

  const batches: string[][] = [], detailIds = new Set<string>(), posterIds = new Set<string>();
  let inFlight = 0, peak = 0, fullCatalog = 0, unavailable = false;
  page.on('request', request => {
    const { pathname } = new URL(request.url());
    if (pathname === '/api/catalog') fullCatalog++;
    const detail = pathname.match(/^\/api\/anime\/([^/]+)$/)?.[1];
    if (detail) detailIds.add(decodeURIComponent(detail));
    const poster = pathname.match(/^\/media\/posters\/([^/]+)\//)?.[1];
    if (poster) posterIds.add(decodeURIComponent(poster));
  });
  await page.route(/\/api\/catalog\/weekly\?/, route => route.fulfill({ json: catalogViewFixture(route.request().url(), snapshot([])) }));
  await page.route(/\/api\/catalog\/items\?/, async route => {
    const url = route.request().url();
    const ids = (new URL(url).searchParams.get('ids') ?? '').split(',').filter(Boolean);
    batches.push(ids);
    inFlight++;
    peak = Math.max(peak, inFlight);
    try {
      // Keep the two request slots overlapping under both Playwright viewports.
      await new Promise(resolve => setTimeout(resolve, 15));
      if (unavailable) await route.fulfill({ status: 503, json: { error: '目录暂时不可用' } });
      else await route.fulfill({ json: catalogViewFixture(url, snapshot(ids.flatMap(id => library.has(id) ? [library.get(id)!] : []))) });
    } finally { inFlight--; }
  });

  await page.goto('/#/favorites');
  await expect(page.getByRole('heading', { name: '近期排期', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '全部作品', exact: true }).click();
  const rows = page.locator('.watch-library .watch-entry');
  const search = page.getByRole('searchbox', { name: '搜索追番作品' });
  const summary = page.getByText('3000 部作品', { exact: true });
  const top = page.getByRole('navigation', { name: '顶部追番分页', exact: true });
  const bottom = page.getByRole('navigation', { name: '追番分页', exact: true });
  const topNext = top.getByRole('button', { name: '下一页', exact: true });
  const pageNumber = top.getByRole('status', { name: '页码', exact: true });
  const selectPage = page.getByRole('button', { name: '选择本页', exact: true });
  const cancelPageSelection = page.getByRole('button', { name: '取消本页选择', exact: true });
  const batch = page.locator('.watch-library .watch-batch');
  const checkedRows = rows.getByRole('checkbox', { checked: true });
  await expect(rows).toHaveCount(12);
  await expect(summary).toBeVisible();
  await expect(pageNumber).toHaveText('1 / 250');
  await expect.poll(() => new Set(batches.flat()).size, { timeout: 15_000 }).toBe(total);
  await expect(page.getByText('正在补齐作品资料，搜索结果会陆续更新。')).toHaveCount(0);

  const initialBatches = batches.length;
  expect(batches.flat()).toHaveLength(total);
  expect(batches.every(batch => batch.length > 0 && batch.length <= 50)).toBe(true);
  expect(peak).toBe(2);
  expect(fullCatalog).toBe(0);
  await selectPage.click();
  await expect(batch.getByRole('status')).toHaveText('已选 12 部');
  await expect(checkedRows).toHaveCount(12);
  await expect(topNext).toBeInViewport();
  await topNext.focus();
  await page.keyboard.press('Enter');
  await expect(pageNumber).toHaveText('2 / 250');
  await expect(topNext).toBeFocused();
  await expect(rows).toHaveCount(12);
  await expect(rows.first()).toHaveAttribute('data-anime-id', `bgm:${baseId + total - 13}`);
  await expect(batch).toHaveCount(0);
  await expect(checkedRows).toHaveCount(0);
  await selectPage.click();
  await expect(batch.getByRole('status')).toHaveText('已选 12 部');
  await expect(checkedRows).toHaveCount(12);
  await cancelPageSelection.click();
  await expect(batch).toHaveCount(0);
  await expect(checkedRows).toHaveCount(0);
  await rows.first().getByRole('checkbox').check();
  await expect(batch.getByRole('status')).toHaveText('已选 1 部');
  await bottom.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(pageNumber).toHaveText('1 / 250');
  await expect(top.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
  await expect(rows.first()).toHaveAttribute('data-anime-id', `bgm:${baseId + total - 1}`);
  await expect(batch).toHaveCount(0);
  await expect(checkedRows).toHaveCount(0);

  // The only alias match is the oldest saved item, far outside the first pages.
  await search.fill('远星密钥');
  await expect(rows).toHaveCount(1);
  const match = rows.first();
  await expect(match).toHaveAttribute('data-anime-id', oldId);
  await expect(match.getByRole('heading', { name: '远星旧卷', exact: true })).toBeVisible();
  const quarter = page.getByRole('combobox', { name: '筛选追番季度', exact: true });
  const quarters = page.getByRole('listbox', { name: '筛选追番季度', exact: true });
  await quarter.click();
  await quarters.getByRole('option', { name: '2026 年秋季', exact: true }).click();
  await expect(rows).toHaveCount(0);
  await quarter.click();
  await quarters.getByRole('option', { name: '2025 年冬季', exact: true }).click();
  await match.getByRole('button', { name: '为远星旧卷记录一集', exact: true }).click();
  await expect(match).toHaveAttribute('data-status', 'watching');
  await expect(match.getByText('已看 1 集', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '在看', exact: true }).click();
  await expect(rows).toHaveCount(1);
  expect(batches).toHaveLength(initialBatches);
  expect(detailIds.size).toBeLessThan(80);
  expect(posterIds.size).toBeLessThan(80);

  // A failed public lookup cannot erase the stored title or the newly saved progress.
  unavailable = true;
  await page.reload();
  await expect(search).toHaveValue('远星密钥');
  await expect(rows).toHaveCount(1);
  await expect(match.getByRole('heading', { name: '远星旧卷', exact: true })).toBeVisible();
  await expect(match.getByText('已看 1 集', { exact: true })).toBeVisible();
  await expect(match.getByText('资料暂不可用', { exact: false })).toBeVisible();
  expect(batches.slice(initialBatches).flat()).toEqual([oldId]);
});

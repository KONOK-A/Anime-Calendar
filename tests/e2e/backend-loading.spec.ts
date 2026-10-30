import { expect, test } from '@playwright/test';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX6sAAAAASUVORK5CYII=', 'base64');
test.beforeEach(async ({ page }) => { await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') }); });
test('后端优化：海报直接读取同源尺寸接口，不等待慢详情', async ({ page }) => {
  const media: string[] = [];
  await page.route('**/api/anime/**', async route => { await new Promise(resolve => setTimeout(resolve, 2000)); await route.continue().catch(() => {}); });
  await page.route('**/media/posters/**', async route => { media.push(new URL(route.request().url()).pathname); await route.fulfill({ contentType: 'image/png', body: png }); });
  await page.goto('/#/weekly');
  await expect(page.locator('.hero-poster img.poster')).toHaveAttribute('src', /\/media\/posters\//);
  await expect.poll(() => media.length).toBeGreaterThan(0);
  await expect.poll(() => page.locator('.hero-poster img.poster').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
});
test('后端优化：过期资料先显示，并且只确认一次后台更新', async ({ page }) => {
  let confirmations = 0;
  await page.route('**/api/anime/**', async route => {
    const url = new URL(route.request().url()); if (decodeURIComponent(url.pathname) !== '/api/anime/bgm:1') { await route.continue(); return; }
    const response = await route.fetch(), value = await response.json();
    if (url.searchParams.get('wait') === '1') { confirmations++; await new Promise(resolve => setTimeout(resolve, 900)); await route.fulfill({ json: { ...value, summary: '后台更新后的简介', detailFetchedAt: '2026-10-29T04:00:00Z', revalidating: false } }); }
    else await route.fulfill({ json: { ...value, summary: '已缓存的旧简介', detailFetchedAt: '2026-10-27T04:00:00Z', revalidating: true } });
  });
  await page.goto('/#/anime/bgm:1');
  await expect(page.getByText('已缓存的旧简介', { exact: true })).toBeVisible();
  await expect(page.getByText('后台更新后的简介', { exact: true })).toBeVisible(); expect(confirmations).toBe(1);
});
test('后端优化：离开详情取消自身更新等待，不给新页面残留错误', async ({ page }) => {
  let waiting = false;
  await page.route('**/api/anime/**', async route => {
    const url = new URL(route.request().url()); if (decodeURIComponent(url.pathname) !== '/api/anime/bgm:1') { await route.continue(); return; }
    const response = await route.fetch(), value = await response.json();
    if (url.searchParams.has('wait')) { waiting = true; await new Promise(resolve => setTimeout(resolve, 1000)); await route.abort().catch(() => {}); }
    else await route.fulfill({ json: { ...value, revalidating: true, detailFetchedAt: '2026-10-27T04:00:00Z' } });
  });
  await page.goto('/#/anime/bgm:1'); await expect.poll(() => waiting).toBe(true);
  await page.getByRole('link', { name: '季度目录', exact: true }).click();
  await expect(page.locator('.catalog-page')).toBeVisible(); await page.waitForTimeout(1100);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

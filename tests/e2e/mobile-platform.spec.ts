import { expect, test } from '@playwright/test';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test('触控记录一集后，反馈结束会恢复按钮的普通样式', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') });
  await page.addInitScript(() => localStorage.setItem('anime-calendar:favorites:v1', '["bgm:1"]'));
  await page.goto('/#/favorites');
  await page.getByRole('button', { name: '全部作品', exact: true }).tap();
  const card = page.locator('.watch-entry[data-anime-id="bgm:1"]');
  const record = card.getByRole('button', { name: '为星旅记录一集' });
  await record.tap();
  await expect(card.getByText('已看 1 集', { exact: true })).toBeVisible();
  await expect(record).toHaveText('+1 集');
  await expect(record).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('触控横屏时，顶栏、底栏和结果区避开左右安全区', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('anime-calendar:favorites:v1', '["bgm:1"]'));
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/#/season/2026/4');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-area-left', '44px');
    document.documentElement.style.setProperty('--safe-area-right', '44px');
  });
  const brand = page.getByRole('link', { name: '番时记首页' });
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  await expect(nav.locator('.nav-count')).toHaveText('1');
  const refresh = page.getByRole('button', { name: '刷新数据', exact: true });
  const search = page.getByRole('searchbox', { name: '搜索作品' });
  for (const [width, height] of [[844, 390], [901, 430], [932, 430]] as const) {
    await page.setViewportSize({ width, height });
    for (const target of [brand, nav, refresh, search]) {
      await expect(target).toBeVisible();
      const box = (await target.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 44);
    }
  }
  await search.tap();
  await expect(search).toBeFocused();
  await search.fill('星旅别名');
  await expect(page.getByRole('link', { name: '查看星旅详情', exact: true })).toBeVisible();
});

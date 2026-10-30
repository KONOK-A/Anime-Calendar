import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') });
  await page.goto('/#/season/2026/4');
});

test('目录筛选面板可以直接点选年份、季度和作品类型', async ({ page }) => {
  const year = page.getByRole('combobox', { name: '年份', exact: true });
  await year.click();
  const option = page.getByRole('option', { name: '2025 年', exact: true });
  await expect(option).toBeVisible();
  await option.click();
  await expect(page).toHaveURL(/#\/season\/2025\/4$/);
  await year.click();
  await page.getByRole('option', { name: '2026 年', exact: true }).click();
  await page.getByRole('combobox', { name: '季度', exact: true }).click();
  await page.getByRole('option', { name: '冬季 · 1—3月', exact: true }).click();
  await expect(page).toHaveURL(/#\/season\/2026\/1$/);
  await page.getByRole('combobox', { name: '季度', exact: true }).click();
  await page.getByRole('option', { name: '秋季 · 10—12月', exact: true }).click();
  await page.getByRole('combobox', { name: '作品类型', exact: true }).click();
  await page.getByRole('option', { name: 'Web 动画', exact: true }).click();
  await expect(page.getByRole('link', { name: '查看尚未定时的故事详情' })).toBeVisible();
  await expect(page.getByRole('link', { name: '查看星旅详情' })).toHaveCount(0);
});

test('目录下拉菜单支持键盘取消、切换和主题变化', async ({ page }) => {
  const type = page.getByRole('combobox', { name: '作品类型', exact: true });
  await type.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('option', { name: '全部类型', exact: true })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(type).toHaveValue('');
  await page.keyboard.press('Space');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(type).toHaveValue('web');
  await page.getByRole('combobox', { name: '页面主题' }).selectOption('dark');
  await type.click();
  await expect(page.getByRole('option', { name: 'Web 动画', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(type).toBeFocused();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', page.viewportSize()!.width);
});

test('季度卡片可切换4、5、6列并记忆，不改变分页或追番页布局', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/season/2025/4');
  const grid = page.locator('.catalog-page .poster-grid');
  const columns = () => grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  await expect(grid.locator('.anime-card')).toHaveCount(24);
  await expect.poll(columns).toBe(4);
  const originalWidth = (await grid.locator('.anime-card').first().boundingBox())!.width;
  await page.getByRole('button', { name: '每行显示5部', exact: true }).click();
  await expect.poll(columns).toBe(5);
  const six = page.getByRole('button', { name: '每行显示6部', exact: true });
  await six.focus(); await page.keyboard.press('Enter');
  await expect.poll(columns).toBe(6);
  await expect(six).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await grid.locator('.anime-card').first().boundingBox())!.width).toBeLessThan(originalWidth);
  await expect(grid.locator('.anime-card')).toHaveCount(24);
  await page.getByRole('button', { name: '下一页' }).click();
  await page.reload();
  await expect(grid.locator('.anime-card')).toHaveCount(1);
  await expect.poll(columns).toBe(6);
  await page.getByRole('button', { name: '每行显示4部', exact: true }).click();
  await expect.poll(columns).toBe(4);
  await expect(grid.locator('.anime-card')).toHaveCount(1);
  await page.getByRole('button', { name: '每行显示6部', exact: true }).click();
  await page.evaluate(() => localStorage.setItem('anime-calendar:favorites:v1', JSON.stringify(['bgm:1'])));
  await page.goto('/#/favorites'); await page.reload();
  await expect(page.locator('.collection-grid .anime-card')).toHaveCount(1);
  expect(await page.locator('.collection-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1);
  const collectionWidth = (await page.locator('.collection-grid').boundingBox())!.width;
  expect((await page.locator('.collection-grid .anime-card').boundingBox())!.width).toBeGreaterThan(collectionWidth * .85);
});

test('小屏保持两列，恢复桌面后沿用选择且无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '每行显示6部', exact: true }).click();
  for (const width of [1280, 1200, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
    if (width < 1280) await expect(page.getByRole('group', { name: '每行作品数量' })).toBeHidden();
  }
  expect(await page.locator('.catalog-page .poster-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole('button', { name: '每行显示6部', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.catalog-page .poster-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(6);
});

test('异常列数偏好使用默认值，保存失败仍可切换并提示', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => localStorage.setItem('anime-calendar:catalog-columns', '99'));
  await page.reload();
  await expect(page.getByRole('button', { name: '每行显示4部', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'anime-calendar:catalog-columns') throw new DOMException('blocked', 'QuotaExceededError'); original.call(this, key, value); };
  });
  await page.getByRole('button', { name: '每行显示5部', exact: true }).click();
  await expect(page.getByRole('button', { name: '每行显示5部', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.catalog-page .poster-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(5);
  await expect(page.getByRole('status')).toContainText('未保存');
});

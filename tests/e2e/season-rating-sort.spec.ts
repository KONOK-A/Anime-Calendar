import { expect, test } from '@playwright/test';
test.beforeEach(async ({ page }) => { await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') }); });
test('季度评分：默认首播不额外取整季评分，切换后最高分从第二页进入第一页', async ({ page }) => {
  const requests: string[] = []; page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.goto('/#/season/2025/4');
  await expect(page.locator('.catalog-page .anime-card')).toHaveCount(24);
  await expect(page.locator('.catalog-page .anime-card').first()).toHaveAttribute('data-anime-id', 'bgm:1000');
  expect(requests.filter(path => path === '/api/catalog/ratings')).toHaveLength(0);
  await page.getByRole('combobox', { name: '作品排序', exact: true }).selectOption('rating');
  const first = page.locator('.catalog-page .anime-card').first();
  await expect(first).toHaveAttribute('data-anime-id', 'bgm:1024'); await expect(first.locator('.card-rating .rating-badge-score')).toHaveText('9.9');
  await expect(page.locator('.catalog-results .section-heading')).toContainText('评分从高到低');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.catalog-page .anime-card')).toHaveCount(1);
  await expect(page.locator('.catalog-page .anime-card').first()).toHaveAttribute('data-anime-id', 'bgm:1002');
  await page.getByRole('combobox', { name: '作品排序', exact: true }).selectOption('premiere');
  await expect(page.locator('.catalog-page .anime-card')).toHaveCount(24); await expect(page.locator('.catalog-page .anime-card').first()).toHaveAttribute('data-anime-id', 'bgm:1000');
});
test('季度评分：评分排序与搜索/类型筛选配合，详情返回和重载恢复排序与页码', async ({ page }) => {
  await page.goto('/#/season/2025/4'); await page.getByRole('combobox', { name: '作品排序' }).selectOption('rating');
  await expect(page.locator('.catalog-page .anime-card').first()).toHaveAttribute('data-anime-id', 'bgm:1024');
  await page.getByRole('searchbox', { name: '搜索作品' }).fill('历史分页样本25别名'); await expect(page.locator('.catalog-page .anime-card')).toHaveCount(1);
  await page.getByRole('combobox', { name: '作品类型' }).selectOption('web'); await expect(page.getByText('没有匹配的作品', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '作品类型' }).selectOption('tv'); await page.getByRole('searchbox', { name: '搜索作品' }).fill('');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByRole('link', { name: '查看历史分页样本3详情', exact: true }).click();
  await page.getByRole('link', { name: '返回季度目录' }).click();
  await expect(page.getByRole('combobox', { name: '作品排序' })).toHaveValue('rating');
  await expect(page.locator('.catalog-page .anime-card')).toHaveCount(1); await expect(page.locator('.catalog-page .anime-card')).toHaveAttribute('data-anime-id', 'bgm:1002');
  await page.reload(); await expect(page.getByRole('combobox', { name: '作品排序' })).toHaveValue('rating');
  await expect(page.locator('.catalog-page .anime-card')).toHaveCount(1); await expect(page.locator('.catalog-page .anime-card')).toHaveAttribute('data-anime-id', 'bgm:1002');
});
test('季度评分：服务失败可回首播浏览，快速切换季度不会显示旧排名', async ({ page }) => {
  await page.route('**/api/catalog/ratings?season=2025-4', route => route.fulfill({ status: 503, json: { error: '测试：评分暂不可用' } }));
  await page.goto('/#/season/2025/4'); await page.getByRole('combobox', { name: '作品排序' }).selectOption('rating');
  await expect(page.getByText('测试：评分暂不可用', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '按首播顺序浏览' }).click(); await expect(page.locator('.catalog-page .anime-card')).toHaveCount(24);
  await page.getByRole('combobox', { name: '作品排序' }).selectOption('rating');
  await page.evaluate(() => { location.hash = '#/season/2026/4'; });
  await expect(page.getByRole('combobox', { name: '作品排序' })).toHaveValue('premiere');
  await expect(page.locator('.catalog-page .anime-card').first()).toHaveAttribute('data-anime-id', 'bgm:1');
});
test('季度评分：浅深主题及手机下拉与卡片不横向溢出，旧偏好默认首播', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('anime-calendar:browse:v1', JSON.stringify({ version: 1, seasons: { '2025-4': { query: '', type: '', page: 1, sort: 'invalid' } } })));
  await page.goto('/#/season/2025/4'); await expect(page.getByRole('combobox', { name: '作品排序' })).toHaveValue('premiere');
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: '页面主题' }).selectOption(theme);
    await page.getByRole('combobox', { name: '作品排序' }).selectOption('rating');
    await expect(page.locator('.catalog-page .anime-card').first()).toHaveAttribute('data-anime-id', 'bgm:1024');
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', page.viewportSize()!.width);
    await page.getByRole('combobox', { name: '作品排序' }).focus(); await page.keyboard.press('Space');
    await expect(page.getByRole('option', { name: '评分从高到低', exact: true })).toBeVisible(); await page.keyboard.press('Escape');
  }
});

import { expect, test } from '@playwright/test';
import type { SeasonRatings } from '../../shared/types';
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
  await page.getByRole('navigation', { name: '作品分页', exact: true }).getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.catalog-page .anime-card')).toHaveCount(1);
  await expect(page.locator('.catalog-page .anime-card').first()).toHaveAttribute('data-anime-id', 'bgm:1002');
  await page.getByRole('combobox', { name: '作品排序', exact: true }).selectOption('premiere');
  await expect(page.locator('.catalog-page .anime-card')).toHaveCount(24); await expect(page.locator('.catalog-page .anime-card').first()).toHaveAttribute('data-anime-id', 'bgm:1000');
});

test('季度评分：等待和部分结果都保留首播列表，评分完整后再重排', async ({ page }) => {
  const season = '2025-4', fetchedAt = '2026-10-29T04:00:00Z';
  const ids = Array.from({ length: 25 }, (_, index) => `bgm:${1000 + index}`);
  const complete: SeasonRatings = {
    schemaVersion: 1, scope: { type: 'ratings', key: `ratings:${season}`, season },
    ids, total: ids.length, processed: ids.length, status: 'ready', updatedAt: fetchedAt,
    entries: ids.map(id => ({ id, rating: { score: id === 'bgm:1024' ? 9.9 : 6, total: 100, rank: null }, fetchedAt, error: null })),
  };
  const partial: SeasonRatings = {
    ...complete, entries: complete.entries.slice(-1), processed: 1, status: 'loading', updatedAt: null,
  };
  const progress = Promise.withResolvers<void>(), ready = Promise.withResolvers<void>();
  let calls = 0;
  await page.route(`**/api/catalog/ratings?season=${season}`, async route => {
    const first = ++calls === 1;
    await (first ? progress.promise : ready.promise);
    await route.fulfill({ json: first ? partial : complete });
  });
  const cards = page.locator('.catalog-page .anime-card');
  const results = page.locator('.catalog-results');
  try {
    await page.goto('/#/season/2025/4');
    await expect(cards).toHaveCount(24);
    await page.getByRole('combobox', { name: '作品排序' }).selectOption('rating');
    await expect.poll(() => calls).toBe(1);
    await expect(results).toContainText('正在读取本季度评分');
    await expect(results).toContainText('当前按首播顺序');
    await expect(cards).toHaveCount(24);
    await expect(cards.first()).toHaveAttribute('data-anime-id', 'bgm:1000');
    await expect(cards.first()).toBeVisible();

    progress.resolve();
    await expect.poll(() => calls).toBe(2);
    await expect(cards).toHaveCount(24);
    await expect(cards.first()).toHaveAttribute('data-anime-id', 'bgm:1000');
    const search = page.getByRole('searchbox', { name: '搜索作品' });
    await search.fill('历史分页样本25别名');
    await expect(cards).toHaveCount(1);
    await expect(page.getByRole('link', { name: '查看历史分页样本25详情', exact: true })).toBeVisible();
    await search.fill('');
    await expect(cards.first()).toHaveAttribute('data-anime-id', 'bgm:1000');
  } finally {
    progress.resolve();
    ready.resolve();
  }
  await expect(cards).toHaveCount(24);
  await expect(cards.first()).toHaveAttribute('data-anime-id', 'bgm:1024');
  await expect(results).not.toContainText('当前按首播顺序');
});

test('季度评分：评分排序与搜索/类型筛选配合，详情返回和重载恢复排序与页码', async ({ page }) => {
  await page.goto('/#/season/2025/4'); await page.getByRole('combobox', { name: '作品排序' }).selectOption('rating');
  await expect(page.locator('.catalog-page .anime-card').first()).toHaveAttribute('data-anime-id', 'bgm:1024');
  await page.getByRole('searchbox', { name: '搜索作品' }).fill('历史分页样本25别名'); await expect(page.locator('.catalog-page .anime-card')).toHaveCount(1);
  await page.getByRole('combobox', { name: '作品类型' }).selectOption('web'); await expect(page.getByText('没有匹配的作品', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '作品类型' }).selectOption('tv'); await page.getByRole('searchbox', { name: '搜索作品' }).fill('');
  await page.getByRole('navigation', { name: '作品分页', exact: true }).getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByRole('link', { name: '查看历史分页样本3详情', exact: true }).click();
  await page.getByRole('link', { name: '返回季度目录' }).click();
  await expect(page.getByRole('combobox', { name: '作品排序' })).toHaveValue('rating');
  await expect(page.locator('.catalog-page .anime-card')).toHaveCount(1); await expect(page.locator('.catalog-page .anime-card')).toHaveAttribute('data-anime-id', 'bgm:1002');
  await page.reload(); await expect(page.getByRole('combobox', { name: '作品排序' })).toHaveValue('rating');
  await expect(page.locator('.catalog-page .anime-card')).toHaveCount(1); await expect(page.locator('.catalog-page .anime-card')).toHaveAttribute('data-anime-id', 'bgm:1002');
});
test('季度评分：服务失败保留首播列表，快速切换季度不会显示旧排名', async ({ page }) => {
  await page.route('**/api/catalog/ratings?season=2025-4', route => route.fulfill({ status: 503, json: { error: '测试：评分暂不可用' } }));
  await page.goto('/#/season/2025/4'); await page.getByRole('combobox', { name: '作品排序' }).selectOption('rating');
  await expect(page.getByText('测试：评分暂不可用', { exact: true })).toBeVisible();
  const cards = page.locator('.catalog-page .anime-card');
  await expect(cards).toHaveCount(24);
  await expect(cards.first()).toHaveAttribute('data-anime-id', 'bgm:1000');
  await expect(cards.first()).toBeVisible();
  await expect(page.locator('.catalog-results')).toContainText('当前按首播顺序');
  await expect(page.getByRole('button', { name: '稍后重试', exact: true })).toBeVisible();
  const sort = page.getByRole('combobox', { name: '作品排序' });
  await sort.selectOption('premiere');
  await expect(cards).toHaveCount(24);
  await sort.selectOption('rating');
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

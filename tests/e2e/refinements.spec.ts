import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') });
  await page.goto('/');
});

test('横竖番表可以切换并在刷新后保留，日期和排期不丢失', async ({ page }, info) => {
  const layoutButtons = page.getByRole('group', { name: '番表布局' }).getByRole('button');
  for (const button of await layoutButtons.all()) await expect(button).toHaveAccessibleName(new RegExp((await button.innerText()).trim()));
  await page.getByRole('button', { name: '横排番表', exact: true }).click();
  await expect(page.locator('.weekly-grid')).toHaveAttribute('data-layout', 'rows');
  await expect(page.locator('.day-column')).toHaveCount(7);
  await page.reload();
  await expect(page.getByRole('button', { name: '横排番表', exact: true })).toHaveAttribute('aria-pressed', 'true');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: '星期一', exact: false }).click();
  await expect(page.getByRole('link', { name: '查看星旅详情' }).first()).toBeVisible();
  await page.getByRole('combobox', { name: '显示时区' }).selectOption('Asia/Tokyo');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: '星期二', exact: false }).click();
  await expect(page.getByRole('link', { name: '查看星旅详情' }).first()).toBeVisible();
  await expect(page.getByText('00:30', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '竖列番表', exact: true }).click();
  await expect(page.locator('.weekly-grid')).toHaveAttribute('data-layout', 'columns');
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', info.project.name === 'mobile' ? 390 : 1440);
});

test('番表布局保存失败仍切换并明确提示未保存', async ({ page }) => {
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'anime-calendar:weekly-layout') throw new DOMException('blocked', 'QuotaExceededError'); original.call(this, key, value); };
  });
  await page.getByRole('button', { name: '横排番表', exact: true }).click();
  await expect(page.locator('.weekly-grid')).toHaveAttribute('data-layout', 'rows');
  await expect(page.getByRole('status')).toContainText('未保存');
});

test('详情显示Bangumi评分与人数，无评分不显示零分', async ({ page }) => {
  await page.goto('/#/anime/bgm:1');
  const rating = page.locator('.detail-heading .detail-rating');
  await expect(rating).toContainText('7.8');
  await expect(rating).toContainText('1,234');
  await expect(rating).toContainText('321');
  await expect(rating).toHaveAttribute('href', 'https://bgm.tv/subject/1');
  await page.goto('/#/anime/bgm:2');
  await expect(rating).toContainText('暂无评分');
  await expect(rating).not.toContainText('0.0');
});

test('排期说明默认收起且可以主动查看', async ({ page }) => {
  const help = page.locator('.schedule-help');
  await expect(help).toHaveJSProperty('open', false);
  await expect(help.locator('p')).toBeHidden();
  await help.locator('summary').click();
  await expect(help.locator('p')).toContainText('周期推算');
  await expect(help.locator('p')).toContainText('平台已更新');
});

test('排期说明点击内部保持展开，点击空白或其他操作自动关闭', async ({ page }) => {
  const help = page.locator('.schedule-help');
  await help.locator('summary').click();
  await help.locator('p').click({ position: { x: 14, y: 14 } });
  await expect(help).toHaveJSProperty('open', true);
  await page.locator('.week-meta').click({ position: { x: 100, y: 10 } });
  await expect(help).toHaveJSProperty('open', false);
  await expect(help.locator('p')).toBeHidden();
  await help.locator('summary').click();
  await page.getByRole('button', { name: '横排番表', exact: true }).click();
  await expect(help).toHaveJSProperty('open', false);
  await expect(page.locator('.weekly-grid')).toHaveAttribute('data-layout', 'rows');
});

test('排期说明支持Esc关闭，返回番表后仍可正常开合', async ({ page }) => {
  const help = page.locator('.schedule-help'), summary = help.locator('summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(help).toHaveJSProperty('open', true);
  await page.keyboard.press('Escape');
  await expect(help).toHaveJSProperty('open', false);
  await expect(summary).toBeFocused();
  await page.keyboard.press('Space');
  await expect(help).toHaveJSProperty('open', true);
  await page.getByRole('link', { name: '季度目录', exact: true }).click();
  await page.getByRole('link', { name: '本周番表', exact: true }).click();
  await expect(help).toHaveJSProperty('open', false);
  await summary.click();
  await expect(help).toHaveJSProperty('open', true);
  await summary.click();
  await expect(help).toHaveJSProperty('open', false);
});

test('季度、追番和番表卡片显示有效评分，无投票作品不显示零分', async ({ page }, info) => {
  await page.goto('/#/season/2026/4');
  const rated = page.locator('.anime-card[data-anime-id="bgm:1"]');
  await expect(rated.getByLabel('Bangumi评分 7.8', { exact: true })).toBeVisible();
  const unrated = page.locator('.anime-card[data-anime-id="bgm:2"]');
  await expect(unrated.locator('.poster-ready')).toBeVisible();
  await expect(unrated.locator('.card-rating')).toHaveCount(0);
  await rated.getByRole('button', { name: '追番星旅', exact: true }).click();
  await page.getByRole('link', { name: /我的追番/ }).click();
  await expect(page.locator('.collection-grid').getByLabel('Bangumi评分 7.8', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '本周番表', exact: true }).click();
  if (info.project.name === 'mobile') await page.getByRole('button', { name: '星期一', exact: false }).click();
  await expect(page.locator('.weekly-grid').getByLabel('Bangumi评分 7.8', { exact: true }).first()).toBeVisible();
});

test('旧服务没有评分字段时明确告知重启，不伪装成无评分', async ({ page }) => {
  await page.route(/\/api\/anime\/bgm(?:%3A|:)1$/, async route => {
    const response = await route.fetch(), detail = await response.json();
    delete detail.rating;
    await route.fulfill({ response, json: detail });
  });
  await page.goto('/#/anime/bgm:1');
  await page.reload();
  await expect(page.locator('.detail-rating')).toContainText('重启本地服务');
  await expect(page.locator('.detail-rating')).not.toContainText('暂无评分');
});

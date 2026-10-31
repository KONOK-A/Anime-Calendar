import { test, expect, type Locator, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') });
});

async function weeklyCard(page: Page, layout: 'columns' | 'rows') {
  await page.goto('/#/weekly');
  await page.getByRole('button', { name: layout === 'columns' ? '竖列番表' : '横排番表', exact: true }).click();
  if (page.viewportSize()!.width < 1200) await page.getByRole('button', { name: '星期一 10月26日', exact: true }).click();
  const card = page.locator('.weekly-grid [data-anime-id="bgm:1"]');
  await expect(card.locator('.event-time .rating-badge')).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  return card;
}

async function blankPoint(card: Locator) {
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height - 6 };
}

for (const target of ['时间', '评分', '底部留白'] as const) {
  test(`番表整卡：${target}在横排和竖列均可打开详情`, async ({ page }) => {
    for (const layout of ['columns', 'rows'] as const) {
      const card = await weeklyCard(page, layout);
      let point;
      if (target === '底部留白') point = await blankPoint(card);
      else {
        const box = (await card.locator(target === '时间' ? '.event-time time' : '.event-time .rating-badge').boundingBox())!;
        point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
      await page.mouse.click(point.x, point.y);
      await expect(page).toHaveURL(/#\/anime\/bgm:1$/, { timeout: 1500 });
      await expect(page.getByRole('heading', { name: '星旅', exact: true, level: 1 })).toBeVisible();
    }
  });
}

test('海报及追番卡的边缘留白可进入详情，保持完整标题提示', async ({ page }) => {
  await page.goto('/#/season/2026/4');
  const poster = page.locator('.catalog-page [data-anime-id="bgm:1"]');
  await expect(poster).toBeVisible(); await poster.scrollIntoViewIfNeeded();
  await expect(poster.locator('.anime-link')).toHaveAttribute('title', '星旅 / 星の旅');
  let point = await blankPoint(poster); await page.mouse.click(point.x, point.y);
  await expect(page).toHaveURL(/#\/anime\/bgm:1$/);
  await page.evaluate(() => localStorage.setItem('anime-calendar:favorites:v1', '["bgm:1"]'));
  await page.goto('/#/favorites'); await page.reload();
  const favorite = page.locator('.collection-grid [data-anime-id="bgm:1"]');
  await expect(favorite).toBeVisible(); await favorite.scrollIntoViewIfNeeded();
  point = await blankPoint(favorite); await page.mouse.click(point.x, point.y);
  await expect(page).toHaveURL(/#\/anime\/bgm:1$/);
});

test('整卡点击层不遮挡收藏按钮及手机扩大触区', async ({ page }) => {
  const card = await weeklyCard(page, 'columns'), save = card.locator('.save-card');
  await save.click();
  await expect(save).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/#\/weekly$/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('anime-calendar:favorites:v1')!))).toContain('bgm:1');
  if (page.viewportSize()!.width < 768) {
    const box = await save.boundingBox();
    await page.mouse.click(box!.x - 4, box!.y + box!.height / 2);
  } else await save.click();
  await expect(save).toHaveAttribute('aria-pressed', 'false');
  await expect(page).toHaveURL(/#\/weekly$/);
});

test('整卡保留中键新标签和原生键盘链接，收藏仍是独立焦点', async ({ page, context }) => {
  const card = await weeklyCard(page, 'columns'), box = (await card.boundingBox())!;
  const opened = context.waitForEvent('page');
  await page.mouse.click(box.x + box.width / 2, box.y + 6, { button: 'middle' });
  const popup = await opened;
  await popup.waitForURL(/#\/anime\/bgm:1$/); await popup.close();
  await expect(page).toHaveURL(/#\/weekly$/);
  const link = card.getByRole('link', { name: '查看星旅详情', exact: true });
  await link.focus(); await expect(link).toBeFocused();
  await page.keyboard.press('Tab'); await expect(card.locator('.save-card')).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(link).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page).toHaveURL(/#\/anime\/bgm:1$/);
});

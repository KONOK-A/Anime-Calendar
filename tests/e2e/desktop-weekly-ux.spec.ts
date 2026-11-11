import { expect, test } from '@playwright/test';
import type { CatalogSnapshot } from '../../shared/types';
import { useCatalogFixture } from '../support/catalog-view-fixture';

test('窄桌面可切换番表密度，空收藏筛选可用键盘退出', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('anime-calendar:favorites:v1', '["bgm:4"]'));
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/#/weekly');

  const grid = page.locator('.weekly-grid');
  const date = page.getByRole('button', { name: '星期四 10月29日' });
  const entries = grid.locator('.mobile-selected .day-entries');
  const columns = () => entries.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  await expect(date).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '竖列番表' }).click();
  await expect.poll(columns).toBe(2);
  await page.getByRole('button', { name: '横排番表' }).click();
  await expect.poll(columns).toBeGreaterThan(2);
  await expect(date).toHaveAttribute('aria-pressed', 'true');

  await page.setViewportSize({ width: 1440, height: 900 });
  const filter = page.getByRole('checkbox', { name: '仅看收藏' });
  await filter.check();
  await expect(page.getByText('本周暂无收藏排期', { exact: true })).toBeVisible();
  await expect(grid).toBeHidden();
  await expect(page.locator('.pending-links')).toContainText('尚未定时的故事');

  const clear = page.getByRole('button', { name: '查看全部排期' });
  await clear.focus();
  await page.keyboard.press('Enter');
  await expect(filter).not.toBeChecked();
  await expect(filter).toBeFocused();
  await expect(grid.locator('.day-column')).toHaveCount(7);
});

test('短桌面首屏能完整看到首条排期，长标题保留时间和操作', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1024, height: 768 });
  const catalog: CatalogSnapshot = await (await page.request.get('/api/catalog')).json();
  const first = catalog.items.find(item => item.id === 'bgm:1')!;
  first.rule = { ...first.rule, anchor: '2026-10-29T05:00:00Z', frequency: 'weekly', raw: 'R/2026-10-29T05:00:00Z/P7D' };
  if (first.networkAiring) {
    first.networkAiring.rule = { ...first.rule };
    first.networkAiring.rules = [{ ...first.rule }];
  }
  first.title = '乱世千金倪亚‧利斯顿转生为娇弱千金的弑神武人华丽无双录～被流放后的传奇与异世界宫廷～';
  first.originalTitle = '凶乱令嬢ニア・リストン 病弱令嬢に転生した神殺しの武人の華麗なる無双録';
  await useCatalogFixture(page, catalog);
  await page.goto('/#/weekly');

  const hero = page.getByRole('region', { name: '今日作品', exact: true });
  const title = hero.getByRole('link', { name: first.title, exact: true });
  const airing = hero.locator('.frame-airing time');
  const open = hero.getByRole('link', { name: '打开今日作品详情', exact: true });
  const next = hero.getByRole('button', { name: '下一部今日作品' });
  const firstCard = page.locator('.weekly-grid .anime-card:visible').first();
  await expect(title).toHaveAttribute('title', first.title);
  await expect(airing).toHaveText('13:00');

  for (const width of [1024, 1200]) {
    await page.setViewportSize({ width, height: 768 });
    await expect(firstCard).toBeInViewport({ ratio: 1 });
    await expect(open).toBeInViewport({ ratio: 1 });
    await expect(next).toBeInViewport({ ratio: 1 });
    const [titleBox, timeBox, openBox, heroBox] = await Promise.all([title.boundingBox(), airing.boundingBox(), open.boundingBox(), hero.boundingBox()]);
    expect(titleBox!.y + titleBox!.height).toBeLessThan(timeBox!.y);
    expect(openBox!.y + openBox!.height).toBeLessThan(heroBox!.y + heroBox!.height);
  }

  await next.press('Enter');
  await expect(hero.getByRole('heading', { name: '放课后的音符' })).toBeVisible();
  await expect(open).toHaveAttribute('href', '#/anime/bgm:2');
});

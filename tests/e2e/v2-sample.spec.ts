import { useCatalogFixture } from '../support/catalog-view-fixture';
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') });
  await page.goto('/');
});

test('V2：主题选择跟随系统、手动覆盖并在刷新后保持', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.getByRole('combobox', { name: '页面主题' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('combobox', { name: '页面主题' }).selectOption('light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('combobox', { name: '页面主题' })).toHaveValue('light');
  await page.getByRole('combobox', { name: '页面主题' }).selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('V2：偏好存储失败仍切换主题并报告未保存', async ({ page }) => {
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'anime-calendar:theme') throw new DOMException('blocked', 'QuotaExceededError'); original.call(this, key, value); };
  });
  await page.getByRole('combobox', { name: '页面主题' }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('status')).toContainText('未保存');
});

test('V2：详情返回来源并在刷新后恢复目录筛选', async ({ page }) => {
  await page.getByRole('link', { name: '季度目录', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索作品' }).fill('星旅别名');
  await page.getByRole('link', { name: '查看星旅详情' }).click();
  await page.getByRole('link', { name: '返回季度目录', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: '搜索作品' })).toHaveValue('星旅别名');
  await page.reload();
  await expect(page.getByRole('searchbox', { name: '搜索作品' })).toHaveValue('星旅别名');
  await page.goto('/#/anime/bgm:1');
  await expect(page.getByRole('link', { name: '返回季度目录', exact: true })).toBeVisible();
});

test('V2：今日主视觉展示参考排期且减少动效时静止', async ({ page }) => {
  const hero = page.getByRole('region', { name: '今日作品' });
  await expect(hero.getByRole('heading', { name: '放课后的音符', exact: true })).toBeVisible();
  await expect(hero).toContainText('20:00');
  await expect(hero).not.toContainText('预计');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(hero.locator('.scene-backdrop')).toHaveAttribute('data-motion', 'paused');
  await hero.getByRole('link', { name: '打开今日作品详情' }).click();
  await expect(page).toHaveURL(/#\/anime\/bgm:2$/);
  await expect(page.getByRole('heading', { name: '放课后的音符', exact: true, level: 1 })).toBeVisible();
});

test('V2：详情直达使用番表返回入口', async ({ page, context }) => {
  const direct = await context.newPage();
  await direct.goto('/#/anime/bgm:1');
  await expect(direct.getByRole('link', { name: '返回番表', exact: true })).toBeVisible();
  await direct.close();
});

test('V2：追番卡显示下一次参考排期并区分未知排期', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('anime-calendar:favorites:v1', JSON.stringify(['bgm:1', 'bgm:2', 'bgm:4'])));
  await page.goto('/#/favorites'); await page.reload();
  const cards = page.locator('.collection-grid .anime-card');
  await expect(cards.first()).toContainText('放课后的音符');
  await expect(cards.first()).toContainText('今天 20:00');
  await expect(cards.first()).not.toContainText('预计');
  await expect(cards.nth(1)).toContainText('11月2日');
  await expect(cards.nth(1)).toContainText('23:30');
  await expect(cards.nth(2)).toContainText('14天内暂无排期');
  await page.getByRole('combobox', { name: '显示时区' }).selectOption('Asia/Tokyo');
  await expect(cards.nth(1)).toContainText('11月3日');
  await expect(cards.nth(1)).toContainText('00:30');
});

test('V2：季度翻页定位列表并在返回后保留页码', async ({ page }) => {
  await page.goto('/#/season/2025/4');
  await expect(page.locator('.poster-grid .anime-card')).toHaveCount(24);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.poster-grid .anime-card')).toHaveCount(1);
  await expect.poll(() => page.locator('#season-results').evaluate(el => Math.round(el.getBoundingClientRect().top))).toBeLessThan(140);
  await expect(page.locator('#season-results')).toBeFocused();
  await page.getByRole('link', { name: '查看历史分页样本25详情' }).click();
  await page.getByRole('link', { name: '返回季度目录', exact: true }).click();
  await expect(page.locator('.pagination')).toContainText('2 / 2');
  await page.reload();
  await expect(page.locator('.pagination')).toContainText('2 / 2');
});

test('V2：详情返回和浏览器后退恢复滚动位置', async ({ page }) => {
  await page.goto('/#/season/2025/4');
  const target = page.locator('.catalog-page .poster-grid .anime-link').nth(12);
  await target.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  expect(before).toBeGreaterThan(250);
  await target.click();
  await expect(page.getByRole('heading', { name: '历史分页样本13', exact: true, level: 1 })).toBeVisible();
  await page.getByRole('link', { name: '返回季度目录', exact: true }).click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before - 8);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(before + 8);
  await target.click();
  await expect(page).toHaveURL(/#\/anime\/bgm:1012$/);
  await page.goBack();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before - 8);
});

test('V2：浏览偏好损坏或不可写时仍可操作并报告未保存', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('anime-calendar:browse:v1', '{broken'));
  await page.reload();
  await expect(page.getByRole('heading', { name: '本周番表', exact: false })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('无法恢复');
  await page.evaluate(() => {
    sessionStorage.removeItem('anime-calendar:browse:v1');
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'anime-calendar:browse:v1') throw new DOMException('blocked', 'QuotaExceededError'); original.call(this, key, value); };
  });
  await page.getByRole('checkbox', { name: '仅看收藏' }).check();
  await expect(page.getByRole('checkbox', { name: '仅看收藏' })).toBeChecked();
  await expect(page.getByRole('status')).toContainText('未保存');
});

test('V2：详情首屏可直接定位播放平台', async ({ page }) => {
  await page.goto('/#/anime/bgm:1');
  await page.getByRole('button', { name: '查看播放平台', exact: true }).click();
  const heading = page.getByRole('heading', { name: '播放平台', exact: false });
  await expect(heading).toBeFocused();
  // Compact pages can reach the document end before the target reaches the top.
  await expect.poll(() => heading.evaluate(el => el.getBoundingClientRect().top < 140 || scrollY >= document.documentElement.scrollHeight - innerHeight - 2)).toBe(true);
  const visible = await heading.evaluate(el => {
    const bounds = el.getBoundingClientRect(), header = document.querySelector('.site-header')!.getBoundingClientRect();
    const nav = document.querySelector('.main-nav')!, navBounds = nav.getBoundingClientRect();
    return bounds.top >= header.bottom && bounds.bottom <= (getComputedStyle(nav).position === 'fixed' ? navBounds.top : innerHeight);
  });
  expect(visible).toBe(true);
  await expect(page.locator('.platforms-section')).toBeInViewport({ ratio: 1 });
  await expect(page).toHaveURL(/#\/anime\/bgm:1$/);
});

test('V2：窄屏与七日视图切换、键盘入口和图片故障仍可使用', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('anime-calendar:favorites:v1', JSON.stringify(['bgm:1', 'bgm:2'])));
  await page.reload();
  for (const width of [320, 390, 768, 900, 1024, 1199, 1200, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator('.day-column:visible')).toHaveCount(width >= 1200 ? 7 : 1);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
  }
  await page.route('**/art/*.webp', route => route.abort('failed'));
  await page.reload();
  await expect(page.getByRole('region', { name: '今日作品' })).toContainText('放课后的音符');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '跳转到内容', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#content')).toBeFocused();
  await expect(page.getByRole('heading', { name: '本周番表', exact: false })).toBeVisible();
  await expect(page).not.toHaveURL(/#content$/);
});

test('V2：初始主题在应用脚本运行前生效', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('anime-calendar:theme', 'dark'));
  await page.route('**/assets/*.js', route => route.abort('failed'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(17, 24, 43)');
});

test('V2：切换到页数相同的季度也会夹紧已保存的大页码', async ({ page }) => {
  const snapshot = await (await page.request.get('/api/catalog')).json();
  const historical = snapshot.items.filter((item: { season: string }) => item.season === '2025-4');
  snapshot.items.push(...historical.map((item: object, index: number) => ({ ...item, id: `bgm:${2000 + index}`, season: '2024-4', begin: '2024-10-01T12:00:00Z' })));
  await useCatalogFixture(page, snapshot);
  await page.addInitScript(() => sessionStorage.setItem('anime-calendar:browse:v1', JSON.stringify({ version: 1, seasons: { '2024-4': { query: '', type: '', page: 3 } } })));
  await page.goto('/#/season/2025/4'); await page.reload();
  await page.getByRole('combobox', { name: '年份' }).selectOption('2024');
  await expect(page.locator('.pagination')).toContainText('2 / 2');
  await expect(page.locator('.poster-grid .anime-card')).toHaveCount(1);
});

test('V2：今日作品手动切换保持稳定且遵循收藏候选', async ({ page }) => {
  const snapshot = await (await page.request.get('/api/catalog')).json();
  snapshot.items.find((item: { id: string }) => item.id === 'bgm:1').rule.anchor = '2026-10-29T05:00:00Z';
  snapshot.items.find((item: { id: string }) => item.id === 'bgm:3').rule.anchor = '2026-10-29T06:00:00Z';
  await useCatalogFixture(page, snapshot);
  await page.addInitScript(() => localStorage.setItem('anime-calendar:favorites:v1', JSON.stringify(['bgm:1', 'bgm:2'])));
  await page.reload();
  const hero = page.getByRole('region', { name: '今日作品' });
  await expect(hero.getByRole('heading', { name: '星旅', exact: true })).toBeVisible();
  await hero.getByRole('button', { name: '下一部今日作品' }).click();
  await expect(hero.getByRole('heading', { name: '放课后的音符', exact: true })).toBeVisible();
  await page.clock.fastForward(60_000);
  await expect(hero.getByRole('heading', { name: '放课后的音符', exact: true })).toBeVisible();
  for (let index = 0; index < 4; index++) {
    await hero.getByRole('button', { name: '下一部今日作品' }).click();
    await expect(hero.getByRole('heading', { name: index % 2 ? '放课后的音符' : '星旅', exact: true })).toBeVisible();
  }
  await hero.getByRole('button', { name: '取消今日追番' }).click();
  await expect(hero.getByRole('heading', { name: '星旅', exact: true })).toBeVisible();
  await expect(hero.getByRole('button', { name: '下一部今日作品' })).toHaveCount(0);
  for (const [id, at] of [['bgm:1', '2026-10-29T05:00:00Z'], ['bgm:2', '2026-10-29T12:00:00Z'], ['bgm:3', '2026-10-29T06:00:00Z']]) snapshot.overrides.events.push({ animeId: id, at, status: 'cancelled', sourceUrl: 'https://example.com' });
  await page.reload();
  await expect(hero).toContainText('今日暂无参考排期');
});

test('V2：主视觉离开视口或减少动效时暂停环境动画', async ({ page }) => {
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 500 });
  const scene = page.getByRole('region', { name: '今日作品' }).locator('.scene-backdrop');
  await expect(scene).toHaveAttribute('data-motion', 'running');
  await page.locator('.app-footer').scrollIntoViewIfNeeded();
  await expect(scene).toHaveAttribute('data-motion', 'paused');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(scene).toHaveAttribute('data-motion', 'running');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(scene).toHaveAttribute('data-motion', 'paused');
});

test('V2：追番目录仍在读取时先显示加载状态', async ({ page }) => {
  await expect(page.getByRole('heading', { name: '本周番表', exact: false })).toBeVisible();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/catalog/**', async route => { await pending; await route.continue().catch(() => {}); });
  await page.evaluate(() => localStorage.setItem('anime-calendar:favorites:v1', JSON.stringify(['bgm:1'])));
  await page.goto('/#/favorites'); await page.reload();
  try {
    await expect(page.locator('.collection-loading')).toBeVisible();
    await expect(page.getByRole('heading', { name: '暂时无法关联的收藏' })).toHaveCount(0);
  } finally { release(); }
  await expect(page.getByRole('link', { name: '查看星旅详情' })).toBeVisible();
});

test('V2：主视觉使用矢量排版且不再加载人物风景图', async ({ page }) => {
  let artworkRequests = 0;
  await page.route('**/art/coast-*', route => { artworkRequests++; return route.abort('failed'); });
  await page.reload();
  const scene = page.getByRole('region', { name: '今日作品' }).locator('.scene-backdrop');
  await expect(scene.locator('picture, img')).toHaveCount(0);
  await expect(scene.locator('svg:visible')).toHaveCount(1);
  await expect(scene.locator('svg:visible')).toBeVisible();
  await expect(page.getByRole('region', { name: '今日作品' })).toContainText('20:00');
  await page.getByRole('combobox', { name: '页面主题' }).selectOption('dark');
  await expect(scene.locator('svg:visible')).toHaveCount(1);
  await expect(scene.locator('svg:visible')).toBeVisible();
  await page.goto('/#/anime/bgm:1');
  await expect(page.locator('.detail-hero .scene-backdrop .broadcast-geometry')).toBeVisible();
  await expect(page.locator('.detail-hero .scene-backdrop img')).toHaveCount(0);
  expect(artworkRequests).toBe(0);
});

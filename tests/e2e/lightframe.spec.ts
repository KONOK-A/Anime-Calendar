import { useCatalogFixture } from '../support/catalog-view-fixture';
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') });
  await page.goto('/#/weekly');
  await expect(page.getByRole('heading', { name: '本周番表', exact: false })).toBeVisible();
});

test('光帧：静止首页突出海报，手机首屏可见排期且操作不被遮挡', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const hero = page.getByRole('region', { name: '今日作品', exact: true });
  const poster = hero.locator('.hero-poster');
  await expect(poster).toBeVisible();
  expect((await poster.boundingBox())!.width).toBeGreaterThan(info.project.name === 'desktop' ? 175 : 80);
  await expect(hero.getByRole('link', { name: '打开今日作品详情', exact: true })).toBeInViewport();
  const visibleCard = page.locator('.weekly-grid .anime-card:visible').first();
  expect((await visibleCard.boundingBox())!.y).toBeLessThan(page.viewportSize()!.height - (info.project.name === 'mobile' ? 90 : 120));
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('光帧：主视觉切换时海报与文字共同运动，快速操作仍对应当前作品', async ({ page }) => {
  const catalog = await (await page.request.get('/api/catalog')).json();
  catalog.items.find((item: { id: string }) => item.id === 'bgm:1').rule.anchor = '2026-10-29T05:00:00Z';
  await useCatalogFixture(page, catalog);
  await page.reload();
  const hero = page.getByRole('region', { name: '今日作品', exact: true });
  await expect(hero.getByRole('heading', { name: '星旅', exact: true })).toBeVisible();
  await hero.getByRole('button', { name: '下一部今日作品' }).click();
  await expect(hero.getByRole('heading', { name: '放课后的音符', exact: true })).toBeVisible();
  const animatedPoster = await hero.evaluate(element => element.getAnimations({ subtree: true }).some(animation => {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    return target instanceof Element && (target.matches('.hero-poster') || !!target.closest('.hero-poster'));
  }));
  expect(animatedPoster).toBe(true);
  await expect(hero.locator('.hero-poster:not([inert])')).toHaveAttribute('href', '#/anime/bgm:2');
  await hero.getByRole('button', { name: '下一部今日作品' }).click();
  await expect(hero.getByRole('heading', { name: '星旅', exact: true })).toBeVisible();
  await expect(hero.locator('.hero-poster:not([inert])')).toHaveAttribute('href', '#/anime/bgm:1');
});

test('光帧：真实今日海报样板可收藏，保存失败保留未收藏状态', async ({ page }) => {
  const sample = page.getByRole('region', { name: '今日片单', exact: true });
  await expect(sample).toBeVisible();
  await expect(sample.getByRole('link', { name: '查看放课后的音符海报详情' })).toBeVisible();
  const save = sample.getByRole('button', { name: '追番放课后的音符', exact: true });
  await save.click();
  await expect(sample.getByRole('button', { name: '取消追番放课后的音符', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await sample.getByRole('button', { name: '取消追番放课后的音符', exact: true }).click();
  await expect(save).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'anime-calendar:favorites:v1') throw new DOMException('blocked', 'QuotaExceededError'); original.call(this, key, value); };
  });
  await save.click();
  await expect(save).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('alert')).toContainText('未保存');
});

test('光帧：背景离屏和减少动态效果时暂停，恢复后可继续', async ({ page }) => {
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 500 });
  const ambient = page.locator('.ambient-backdrop');
  await expect(ambient).toHaveAttribute('data-motion', 'running');
  await page.getByRole('region', { name: '今日片单', exact: true }).scrollIntoViewIfNeeded();
  await expect(ambient).toHaveAttribute('data-motion', 'paused');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(ambient).toHaveAttribute('data-motion', 'running');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(ambient).toHaveAttribute('data-motion', 'paused');
  expect(await ambient.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
});

test('光帧：导航指示器随页面与视口移动，键盘入口保持可用', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  const indicator = nav.locator('.nav-indicator');
  await expect(indicator).toBeVisible();
  await nav.getByRole('link', { name: '季度目录', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '季度目录', exact: false })).toBeVisible();
  await expect(nav.getByRole('link', { name: '季度目录', exact: true })).toHaveAttribute('aria-current', 'page');
  for (const width of [900, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(indicator).toBeVisible();
    if (width <= 900) expect((await nav.boundingBox())!.y).toBeGreaterThan(600);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
});

test('光帧：深浅主题保持整页可见，装饰透明度不影响文档', async ({ page }) => {
  for (const theme of ['dark', 'light', 'dark']) {
    await page.getByRole('combobox', { name: '页面主题', exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).opacity)).toBe('1');
  }
});

test('光帧：离场封面延迟失败不会清除当前作品背景', async ({ page }) => {
  const catalog = await (await page.request.get('/api/catalog')).json();
  catalog.items.find((item: { id: string }) => item.id === 'bgm:1').rule.anchor = '2026-10-29T05:00:00Z';
  await useCatalogFixture(page, catalog);
  await page.route(/\/api\/anime\/bgm(?:%3A|:)\d+$/, async route => {
    const response = await route.fetch();
    const detail = await response.json();
    detail.image = `/test-cover-${decodeURIComponent(new URL(route.request().url()).pathname).split(':').at(-1)}.svg`;
    await route.fulfill({ json: detail });
  });
  await page.route('**/test-cover-*.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="140"><rect width="100" height="140" fill="#547bd0"/></svg>' }));
  await page.reload();
  const hero = page.getByRole('region', { name: '今日作品', exact: true });
  await expect(hero.locator('.frame-wash img')).toHaveAttribute('src', '/test-cover-1.svg');
  await page.evaluate(() => { (window as unknown as { outgoingCover: Element | null }).outgoingCover = document.querySelector('.frame-wash img'); });
  await hero.getByRole('button', { name: '下一部今日作品' }).click();
  await expect(hero.getByRole('heading', { name: '放课后的音符', exact: true })).toBeVisible();
  await expect(hero.locator('.frame-wash:not([inert]) img')).toHaveAttribute('src', '/test-cover-2.svg');
  await page.evaluate(() => { (window as unknown as { outgoingCover: Element }).outgoingCover.dispatchEvent(new Event('error')); });
  await expect(hero.locator('.frame-wash:not([inert]) img')).toHaveAttribute('src', '/test-cover-2.svg');
});

test('光帧：目录初始化时背景装饰保持稳定，避免首屏布局跳动', async ({ page }) => {
  const catalog = await (await page.request.get('/api/catalog')).json();
  await page.addInitScript(() => {
    const metrics = window as unknown as { initialShifts: number[] };
    metrics.initialShifts = [];
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput) metrics.initialShifts.push(shift.value);
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await useCatalogFixture(page, catalog, () => pending);
  await page.reload({ waitUntil: 'domcontentloaded' });
  try {
    await expect(page.getByRole('heading', { name: '正在准备你的番表', exact: true })).toBeVisible();
    await page.waitForTimeout(100);
  } finally { release(); }
  await expect(page.locator('.weekly-grid')).toBeVisible();
  await page.waitForTimeout(400);
  const shift = await page.evaluate(() => (window as unknown as { initialShifts: number[] }).initialShifts.reduce((sum, value) => sum + value, 0));
  expect(shift).toBeLessThan(.05);
});

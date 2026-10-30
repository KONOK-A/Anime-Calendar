import { test, expect, type Page } from '@playwright/test';

type GeometryWindow = Window & { finalCardGeometryReads: number };

test.beforeEach(async ({ page }) => {
  // Advance business time without replacing RAF/performance or freezing Vue event timestamps.
  await page.addInitScript(value => {
    const NativeDate = Date, offset = NativeDate.parse(value) - NativeDate.now();
    class BusinessDate extends NativeDate {
      constructor(...args: unknown[]) {
        super(...(args.length ? args : [NativeDate.now() + offset]) as ConstructorParameters<typeof NativeDate>);
      }
      static now() { return NativeDate.now() + offset; }
    }
    window.Date = BusinessDate as DateConstructor;
    localStorage.setItem('anime-calendar:theme', 'dark');
    localStorage.setItem('anime-calendar:catalog-columns', '4');
    localStorage.setItem('anime-calendar:favorites:v1', '[]');
  }, '2026-10-29T04:00:00Z');
});

async function openCatalog(page: Page) {
  await page.goto('/#/season/2025/4');
  await expect(page.locator('.poster-grid .anime-card')).toHaveCount(24);
  await page.evaluate(() => document.fonts.ready);
}

async function countCardRectangles(page: Page) {
  await page.evaluate(() => {
    const metrics = window as GeometryWindow;
    metrics.finalCardGeometryReads = 0;
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList.contains('anime-card')) metrics.finalCardGeometryReads++;
      return original.call(this);
    };
  });
}

async function expectNoCardMeasurements(page: Page) {
  await page.evaluate(() => { (window as GeometryWindow).finalCardGeometryReads = 0; });
  await page.getByRole('button', { name: '每行显示6部', exact: true }).click();
  await expect(page.locator('.poster-grid')).toHaveAttribute('data-density', '6');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect.soft(await page.evaluate(() => (window as GeometryWindow).finalCardGeometryReads), 'density change must skip card geometry').toBe(0);

  await page.evaluate(() => { (window as GeometryWindow).finalCardGeometryReads = 0; });
  await page.getByRole('searchbox', { name: '搜索作品', exact: true }).fill('历史分页样本25');
  await expect(page.locator('.poster-grid .anime-card')).toHaveCount(1);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect.soft(await page.evaluate(() => (window as GeometryWindow).finalCardGeometryReads), 'filter change must skip card geometry').toBe(0);
}

test('最终边界：缩小视口模拟后搜索焦点保留且不被浮动导航遮挡', async ({ page }) => {
  // A layout viewport resize is a reproducible approximation, not a real mobile keyboard.
  await page.setViewportSize({ width: 390, height: 844 });
  await openCatalog(page);
  const input = page.getByRole('searchbox', { name: '搜索作品', exact: true });
  await input.focus();
  await expect(input).toBeFocused();
  await page.setViewportSize({ width: 390, height: 360 });
  await expect(input).toBeFocused();
  await expect(input).toBeInViewport();
  await expect.poll(() => input.evaluate(element => {
    const box = element.getBoundingClientRect();
    const header = document.querySelector('.site-header')!.getBoundingClientRect();
    const navigation = document.querySelector('.main-nav')!.getBoundingClientRect();
    return box.top >= header.bottom && box.bottom <= navigation.top && box.left >= 0 && box.right <= innerWidth;
  })).toBe(true);
  await expect(input).toBeFocused();
});

test('最终边界：减少动态效果时密度与筛选不读取卡片矩形', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openCatalog(page);
  await countCardRectangles(page);
  await expectNoCardMeasurements(page);
});

test('最终边界：模拟hidden路径下密度与筛选不读取卡片矩形', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openCatalog(page);
  await page.evaluate(() => {
    // Explicit simulation: these getters and the untrusted event do not prove OS backgrounding.
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  try {
    expect(await page.evaluate(() => document.hidden)).toBe(true);
    await countCardRectangles(page);
    await expectNoCardMeasurements(page);
  } finally {
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden');
      Reflect.deleteProperty(document, 'visibilityState');
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
});

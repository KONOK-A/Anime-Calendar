import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') });
  await page.goto('/#/weekly');
  await expect(page.locator('.weekly-grid')).toBeVisible();
});

test('阶段二：全周使用统一条目，切换有位移动画且排期不跨日期', async ({ page }) => {
  const grid = page.locator('.weekly-grid');
  const entries = () => grid.evaluate(element => [...element.querySelectorAll('.anime-card')].map(card => ({ id: card.getAttribute('data-anime-id'), day: card.closest('.day-column')!.getAttribute('data-day'), at: card.querySelector('time')!.getAttribute('datetime') })));
  const before = await entries();
  expect(await grid.locator('.anime-card').evaluateAll(cards => cards.every(card => card.classList.contains('lightframe-schedule')))).toBe(true);
  await page.getByRole('button', { name: '横排番表', exact: true }).click();
  await expect(grid).toHaveAttribute('data-layout', 'rows');
  expect(await grid.evaluate(element => element.getAnimations({ subtree: true }).some(animation => {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    return target instanceof Element && target.matches('.anime-card');
  }))).toBe(true);
  expect(await entries()).toEqual(before);
  await page.getByRole('button', { name: '竖列番表', exact: true }).click();
  expect(await entries()).toEqual(before);
});

test('阶段二：目录复用带内框的海报卡，三档密度均保留原名评分与收藏', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/season');
  const grid = page.locator('.catalog-page .poster-grid');
  for (const columns of [4, 5, 6]) {
    await page.getByRole('button', { name: `每行显示${columns}部`, exact: true }).click();
    await expect.poll(() => grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(columns);
    const card = grid.locator('[data-anime-id="bgm:1"]');
    await expect(card.getByLabel('Bangumi评分 7.8', { exact: true })).toBeVisible();
    await expect(card.locator('.original-title')).toBeVisible();
    await expect(card.getByRole('button', { name: '追番星旅', exact: true })).toBeVisible();
    const inset = await card.evaluate(element => element.querySelector('.poster-frame')!.getBoundingClientRect().left - element.getBoundingClientRect().left);
    expect(inset).toBeGreaterThanOrEqual(5);
    await expect(card.locator('.card-tags')).toContainText('2026.10.01');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('group', { name: '每行作品数量' })).toBeHidden();
  expect(await grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2);
});

test('阶段二：少量追番是横向收藏卡，显示真实下次参考排期', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('anime-calendar:favorites:v1', JSON.stringify(['bgm:2'])));
  await page.goto('/#/favorites'); await page.reload();
  const grid = page.locator('.collection-grid'), card = grid.locator('.anime-card');
  await expect(card).toHaveCount(1);
  const size = await card.boundingBox(), container = await grid.boundingBox();
  expect(size!.width).toBeGreaterThan(container!.width * .85);
  const image = await card.locator('.poster-frame').boundingBox(), title = await card.getByRole('heading').boundingBox();
  expect(title!.x).toBeGreaterThan(image!.x + image!.width);
  await expect(card.locator('.next-airing')).toContainText('今天 20:00');
  await expect(card.locator('.next-airing')).not.toContainText('预计');
});

test('阶段二：多部追番使用宽屏双列和手机单列，保留无排期状态', async ({ page }, info) => {
  await page.evaluate(() => localStorage.setItem('anime-calendar:favorites:v1', JSON.stringify(['bgm:1', 'bgm:2', 'bgm:3', 'bgm:4'])));
  await page.goto('/#/favorites'); await page.reload();
  const grid = page.locator('.collection-grid');
  await expect(grid.locator('.anime-card')).toHaveCount(4);
  const columns = await grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(info.project.name === 'mobile' ? 1 : 2);
  await expect(grid.locator('[data-anime-id="bgm:4"]')).toContainText('14天内暂无排期');
  await expect(grid.locator('.anime-card').first()).toContainText('放课后的音符');
});

test('阶段二：刷新错误提示不推挤当前主视觉，仍可关闭和重试', async ({ page }) => {
  const hero = page.getByRole('region', { name: '今日作品', exact: true });
  const before = (await hero.boundingBox())!.y;
  await page.route('**/api/refresh', route => route.fulfill({ status: 503, json: { error: '测试刷新错误' } }));
  await page.getByRole('button', { name: '刷新数据', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('测试刷新错误');
  expect((await hero.boundingBox())!.y).toBeCloseTo(before, 1);
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刷新数据', exact: true })).toBeEnabled();
});

test('阶段二：键盘移除收藏后焦点随布局变化留在可见作品上', async ({ page }, info) => {
  await page.evaluate(() => localStorage.setItem('anime-calendar:favorites:v1', JSON.stringify(['bgm:1', 'bgm:2', 'bgm:3', 'bgm:4'])));
  await page.goto('/#/favorites'); await page.reload();
  const grid = page.locator('.collection-grid');
  await expect(grid.locator('.anime-card')).toHaveCount(4);
  await grid.locator('[data-anime-id="bgm:4"] .save-card').focus();
  await page.keyboard.press('Enter');
  await expect(grid.locator('.anime-card')).toHaveCount(3);
  const replacement = grid.locator('[data-anime-id="bgm:1"] .anime-link');
  await expect(replacement).toBeFocused();
  await page.waitForTimeout(300);
  const bounds = await replacement.boundingBox();
  const limit = info.project.name === 'mobile' ? (await page.getByRole('navigation', { name: '主导航', exact: true }).boundingBox())!.y : page.viewportSize()!.height;
  expect(bounds!.y).toBeGreaterThan(60);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(limit - 4);
});

test('阶段二：连续提示关闭后回到最近操作的控件', async ({ page }) => {
  await page.route('**/api/refresh', route => route.fulfill({ status: 503, json: { error: '刷新错误样本' } }));
  await page.getByRole('button', { name: '刷新数据', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('刷新错误样本');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'anime-calendar:favorites:v1') throw new DOMException('blocked', 'QuotaExceededError'); original.call(this, key, value); };
  });
  const save = page.getByRole('button', { name: '追番今日作品', exact: true });
  await save.click();
  await expect(page.getByRole('alert')).toContainText('未保存');
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await expect(save).toBeFocused();
});

test('阶段二：冷打开详情时并行按需读取资料，避免简介推挤首屏', async ({ page }) => {
  const catalog = await (await page.request.get('/api/catalog')).json();
  const detail = await (await page.request.get('/api/anime/bgm:1')).json();
  detail.summary = Array.from({ length: 12 }, () => '这是一段用于检验详情首次读取布局稳定性的作品简介。').join('\n');
  await page.addInitScript(() => {
    const metrics = window as unknown as { detailShifts: number[] };
    metrics.detailShifts = [];
    new PerformanceObserver(list => { for (const entry of list.getEntries()) { const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean }; if (!shift.hadRecentInput) metrics.detailShifts.push(shift.value); } }).observe({ type: 'layout-shift', buffered: true });
  });
  let catalogReady = false, detailsBeforeCatalog = false, requests = 0;
  await page.route('**/api/catalog', async route => { await new Promise(resolve => setTimeout(resolve, 150)); catalogReady = true; await route.fulfill({ json: catalog }); });
  await page.route(/\/api\/anime\/bgm(?:%3A|:)1$/, async route => {
    if (route.request().headers().referer?.includes('cold=1')) { detailsBeforeCatalog ||= !catalogReady; requests++; }
    await new Promise(resolve => setTimeout(resolve, 50)); await route.fulfill({ json: detail });
  });
  await page.goto('/?cold=1#/anime/bgm:1', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.synopsis').first()).toContainText('布局稳定性');
  await page.waitForTimeout(500);
  const shift = await page.evaluate(() => (window as unknown as { detailShifts: number[] }).detailShifts.reduce((sum, value) => sum + value, 0));
  expect(detailsBeforeCatalog).toBe(true);
  expect(requests).toBe(1);
  expect(shift).toBeLessThan(.05);
});

test('阶段二：详情文字实际绘制在光色遮罩前方', async ({ page }) => {
  await page.getByRole('combobox', { name: '页面主题', exact: true }).selectOption('light');
  await page.goto('/#/anime/bgm:1');
  const heading = page.getByRole('heading', { level: 1, name: '星旅', exact: true });
  await expect(heading).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const png = await heading.screenshot({ animations: 'disabled' });
  const darkPixels = await page.evaluate(async data => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + data;
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; });
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 100 && pixels[index + 1] < 120 && pixels[index + 2] < 160 && pixels[index + 3] > 200) count++;
    return count;
  }, png.toString('base64'));
  expect(darkPixels).toBeGreaterThan(40);
});

import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') }); });

test('访问优化：正常首页不读取全量目录，基础番表先于慢详情显示', async ({ page }) => {
  const full: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/catalog') full.push(request.url()); });
  await page.route('**/api/catalog', route => route.abort());
  await page.route('**/api/anime/*', async route => { await new Promise(resolve => setTimeout(resolve, 2500)); await route.continue().catch(() => {}); });
  await page.goto('/#/weekly');
  await expect(page.locator('.day-column:visible .anime-card').first()).toBeVisible({ timeout: 1500 });
  expect(full).toEqual([]);
});

test('访问优化：重载先显示持久缓存，API变慢不再阻塞已有番表', async ({ page }) => {
  await page.goto('/#/weekly');
  await expect(page.locator('.day-column:visible .anime-card').first()).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const cache = await caches.open('anime-calendar:views:v1'); return (await cache.keys()).length;
  })).toBeGreaterThan(0);
  await page.route('**/api/catalog/**', async route => { await new Promise(resolve => setTimeout(resolve, 3000)); await route.continue().catch(() => {}); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.day-column:visible .anime-card').first()).toBeVisible({ timeout: 1000 });
});

test('访问优化：快速换季度仅应用最新范围，未加载完成不夹掉已保存页码', async ({ page }) => {
  await page.goto('/#/season/2025/4');
  await expect(page.locator('.catalog-page .anime-card')).toHaveCount(24);
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.locator('.catalog-page .anime-card')).toHaveCount(1);
  await page.goto('/#/season/2026/4');
  await expect(page.locator('.catalog-page .anime-card').first()).toBeVisible();
  await page.route('**/api/catalog/season?season=2025-4', async route => { await new Promise(resolve => setTimeout(resolve, 1000)); await route.continue().catch(() => {}); });
  await page.goto('/#/season/2025/4');
  await expect(page.locator('.catalog-page .anime-card')).toHaveCount(1);
  await expect(page.locator('.catalog-page .anime-card')).toContainText('历史分页样本25');
});

test('访问优化：详情直达基础信息不等待简介和CV，未查询收藏不误判失联', async ({ page }) => {
  await page.route('**/api/anime/**', async route => { await new Promise(resolve => setTimeout(resolve, 2500)); await route.continue().catch(() => {}); });
  await page.goto('/#/anime/bgm:1');
  await expect(page.getByRole('heading', { name: '星旅', exact: true })).toBeVisible({ timeout: 1500 });
  await expect(page.getByRole('button', { name: '加入追番', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '加入追番', exact: true }).click();
  await page.getByRole('link', { name: '我的追番', exact: true }).click();
  await expect(page.locator('.collection-grid .anime-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '暂时无法关联的收藏' })).toHaveCount(0);
});

test('访问优化：缓存格式损坏后重新联网读取，不出现白屏', async ({ page }) => {
  await page.goto('/#/weekly');
  await expect(page.locator('.day-column:visible .anime-card').first()).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await (await caches.open('anime-calendar:views:v1')).keys()).length)).toBeGreaterThan(0);
  await page.evaluate(async () => {
    const cache = await caches.open('anime-calendar:views:v1'), keys = await cache.keys();
    await cache.put(keys[0]!, Response.json({ schemaVersion: 999, data: { broken: true } }));
  });
  await page.route('**/api/catalog/**', async route => { await new Promise(resolve => setTimeout(resolve, 600)); await route.continue().catch(() => {}); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.day-column:visible .anime-card').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '本周番表', exact: false })).toBeVisible();
});

test('访问优化：304复用缓存正文，后台API断开仍保留已显示排期', async ({ page }) => {
  await page.goto('/#/weekly');
  await expect(page.locator('.day-column:visible .anime-card').first()).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await (await caches.open('anime-calendar:views:v1')).keys()).length)).toBeGreaterThan(0);
  let validator = '';
  await page.route('**/api/catalog/**', async route => {
    validator = (await route.request().allHeaders())['if-none-match'] ?? '';
    await route.fulfill({ status: 304, headers: { etag: validator } });
  });
  await page.reload();
  await expect(page.locator('.day-column:visible .anime-card').first()).toBeVisible();
  await expect.poll(() => validator).not.toBe('');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.unroute('**/api/catalog/**');
  await page.route('**/api/catalog/**', route => route.abort('failed'));
  await page.reload();
  await expect(page.locator('.day-column:visible .anime-card').first()).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('缓存');
});

test('访问优化：存储加速缓存失败不阻碍读取与保存追番', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'caches', { configurable: true, value: { open: async () => { throw new DOMException('blocked', 'SecurityError'); } } }); });
  await page.goto('/#/weekly');
  const save = page.locator('.day-column:visible .anime-card .save-card').first();
  await expect(save).toBeVisible(); await save.click();
  await expect(save).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('anime-calendar:favorites:v1') ?? '[]').length)).toBe(1);
  await page.reload();
  await expect(page.locator('.day-column:visible .anime-card .save-card[aria-pressed="true"]')).toHaveCount(1);
});

test('访问优化：迟到的历史季度响应不会覆盖当前季度', async ({ page }) => {
  await page.goto('/#/season/2026/4');
  await expect(page.locator('.catalog-page .anime-card')).toHaveCount(4);
  await page.route('**/api/catalog/season?season=2025-4', async route => { await new Promise(resolve => setTimeout(resolve, 700)); await route.continue().catch(() => {}); });
  await page.goto('/#/season/2025/4');
  await page.goto('/#/season/2026/4');
  await page.waitForTimeout(900);
  await expect(page.locator('.catalog-page .anime-card')).toHaveCount(4);
  await expect(page.getByRole('heading', { name: '2026 年秋季', exact: true })).toBeVisible();
});

test('访问优化：大收藏分批并发不超过两路，查询完成前不显示失联', async ({ page }) => {
  await page.addInitScript(() => {
    const ids = ['bgm:1', ...Array.from({ length: 25 }, (_, index) => `bgm:${1000 + index}`), ...Array.from({ length: 30 }, (_, index) => `bd:missing-${index}`)];
    localStorage.setItem('anime-calendar:favorites:v1', JSON.stringify(ids));
  });
  let release!: () => void, active = 0, peak = 0, calls = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/catalog/items?*', async route => {
    active++; calls++; peak = Math.max(peak, active);
    try { await pending; await route.continue().catch(() => {}); } finally { active--; }
  });
  await page.goto('/#/favorites');
  await expect.poll(() => calls).toBe(2);
  await expect(page.getByRole('heading', { name: '暂时无法关联的收藏' })).toHaveCount(0);
  release();
  await expect(page.locator('.collection-grid .anime-card')).toHaveCount(26);
  await expect(page.locator('.orphan-list code')).toHaveCount(30);
  expect(peak).toBe(2);
});

test('访问优化：请求失败的收藏显示读取失败，保留ID而不判定失联', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('anime-calendar:favorites:v1', JSON.stringify(['bgm:1', 'bd:orphan'])));
  await page.route('**/api/catalog/items?*', route => route.abort('failed'));
  await page.goto('/#/favorites');
  await expect(page.getByRole('heading', { name: '暂时无法读取的收藏' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '暂时无法关联的收藏' })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('anime-calendar:favorites:v1')!))).toEqual(['bgm:1', 'bd:orphan']);
});

test('访问优化：基础接口一直不返回时结束等待并允许重新获取', async ({ page }) => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/catalog/**', async route => { await hold; await route.continue().catch(() => {}); });
  const started = page.waitForRequest('**/api/catalog/**');
  await page.goto('/#/weekly');
  await started;
  await page.clock.fastForward(16_000);
  try { await expect(page.getByRole('alert')).toContainText('超时'); }
  finally { release(); }
  await page.unroute('**/api/catalog/**');
  await page.getByRole('button', { name: '重试获取', exact: true }).click();
  await expect(page.locator('.day-column:visible .anime-card').first()).toBeVisible();
});

test('访问优化：时区跨日后使用新日期选中状态与相应周缓存', async ({ page }) => {
  await page.clock.setSystemTime(new Date('2026-10-29T15:30:00Z'));
  await page.goto('/#/weekly');
  await expect(page.locator('.day-column.mobile-selected')).toHaveAttribute('data-day', '2026-10-29');
  await page.getByRole('combobox', { name: '显示时区' }).selectOption('Asia/Tokyo');
  await expect(page.locator('.day-column.mobile-selected')).toHaveAttribute('data-day', '2026-10-30');
});

test('访问优化：连续两轮后台刷新均能启动并完成状态轮询', async ({ page }) => {
  let refreshing = true, polls = 0;
  await page.route('**/api/catalog/weekly?*', async route => {
    const response = await route.fetch({ headers: { ...route.request().headers(), 'if-none-match': '' } }), view = await response.json();
    view.status.refreshing = refreshing;
    await route.fulfill({ json: view });
  });
  await page.route('**/api/status', async route => {
    polls++; refreshing = false;
    const response = await route.fetch(), status = await response.json();
    await route.fulfill({ json: { ...status, refreshing: false } });
  });
  await page.goto('/#/weekly');
  const refresh = page.getByRole('button', { name: '刷新数据', exact: true });
  await expect(refresh).toBeDisabled(); await page.clock.fastForward(2000);
  await expect.poll(() => polls).toBe(1); await expect(refresh).toBeEnabled();
  refreshing = true;
  await page.getByRole('link', { name: '季度目录', exact: true }).click();
  await expect(page.locator('.catalog-page .anime-card').first()).toBeVisible();
  await page.getByRole('link', { name: '本周番表', exact: true }).click();
  await expect(refresh).toBeDisabled(); await page.clock.fastForward(2000);
  await expect.poll(() => polls).toBe(2); await expect(refresh).toBeEnabled();
});

test('访问优化：默认季度入口在北京时间换季后读取新季度', async ({ page }) => {
  await page.clock.setSystemTime(new Date('2026-09-30T15:59:30Z'));
  await page.goto('/#/season');
  await expect(page.locator('.catalog-page .anime-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '2026 年夏季', exact: true })).toBeVisible();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole('heading', { name: '2026 年秋季', exact: true })).toBeVisible();
  await expect(page.locator('.catalog-page .anime-card')).toHaveCount(4);
});

test('访问优化：周表别名入口切时区后请求相应范围', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/catalog/weekly?')) requests.push(request.url()); });
  await page.goto('/#/');
  await expect(page.locator('.day-column:visible .anime-card').first()).toBeVisible();
  await page.getByRole('combobox', { name: '显示时区' }).selectOption('Asia/Tokyo');
  await expect.poll(() => requests.some(url => new URL(url).searchParams.get('timezone') === 'Asia/Tokyo')).toBe(true);
});

test('访问优化：同周同区但季度不同的响应被拒绝，已有缓存保留', async ({ page }) => {
  await page.goto('/#/weekly');
  await expect(page.locator('.day-column:visible .anime-card').first()).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await (await caches.open('anime-calendar:views:v1')).keys()).length)).toBeGreaterThan(0);
  await page.route('**/api/catalog/weekly?*', async route => {
    const response = await route.fetch({ headers: { ...route.request().headers(), 'if-none-match': '' } }), view = await response.json();
    view.scope.season = '2025-4'; view.scope.key = `weekly:${view.scope.week}:${view.scope.timezone}:2025-4`; view.catalog.items = [];
    await route.fulfill({ json: view });
  });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('范围不匹配');
  await expect(page.locator('.day-column:visible .anime-card').first()).toBeVisible();
});

test('访问优化：首次目录的迟到状态不会提前结束手动刷新', async ({ page }) => {
  const original = await (await page.request.get('/api/status')).json();
  const originalView = await (await page.request.get('/api/catalog/weekly?week=2026-10-26&timezone=Asia%2FShanghai&season=2026-4')).json();
  let release!: () => void, releaseStatus!: () => void, captured!: () => void, finished = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { captured = resolve; });
  const statusGate = new Promise<void>(resolve => { releaseStatus = resolve; });
  await page.route('**/api/catalog/weekly?*', async route => {
    captured(); await gate;
    await route.fulfill({ json: { ...originalView, status: { ...originalView.status, refreshing: false } } }).catch(() => {});
  });
  await page.route('**/api/refresh', route => route.fulfill({ status: 202, json: { ...original, refreshing: true } }));
  await page.route('**/api/status', async route => { await statusGate; await route.fulfill({ json: { ...original, refreshing: !finished } }); });
  await page.goto('/#/weekly'); await ready;
  const refresh = page.getByRole('button', { name: '刷新数据', exact: true });
  await refresh.click(); await expect(refresh).toBeDisabled();
  release(); await expect(page.locator('.day-column:visible .anime-card').first()).toBeVisible();
  try { expect(await refresh.isDisabled()).toBe(true); } finally { finished = true; releaseStatus(); }
  await page.clock.fastForward(2000);
  await expect(refresh).toBeEnabled();
});

import { test, expect } from '@playwright/test';

test('旧电视口径缓存不作为新网络周表展示，联网后恢复真实网络排期', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') });
  await page.goto('/#/weekly');
  await expect(page.locator('.weekly-grid .anime-card:visible').first()).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await (await caches.open('anime-calendar:views:v1')).keys()).length)).toBeGreaterThan(0);
  await page.evaluate(async () => {
    const cache = await caches.open('anime-calendar:views:v1');
    for (const key of await cache.keys()) {
      const response = await cache.match(key); if (!response) continue;
      const value = await response.json();
      if (value.data?.scope?.type !== 'weekly') continue;
      delete value.data.catalog.schedulePolicy;
      for (const item of value.data.catalog.items) item.title = '旧电视口径不能展示';
      await cache.put(key, new Response(JSON.stringify(value)));
    }
  });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/catalog/weekly?**', async route => { await held; await route.continue().catch(() => {}); });
  try {
    await page.reload();
    await expect(page.getByText('正在准备你的番表', { exact: false })).toBeVisible();
    await expect(page.getByText('旧电视口径不能展示', { exact: false })).toHaveCount(0);
  } finally { release(); }
  await expect(page.locator('.weekly-grid .anime-card:visible').first()).toBeVisible();
  await expect(page.getByRole('link', { name: '查看放课后的音符详情', exact: true })).toBeVisible();
});

test('旧 streaming 会员缓存断网时不恢复，重试后展示常规网络排期', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') });
  await page.goto('/#/weekly');
  await expect(page.locator('.weekly-grid .anime-card:visible').first()).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await (await caches.open('anime-calendar:views:v1')).keys()).length)).toBeGreaterThan(0);
  await page.evaluate(async () => {
    const cache = await caches.open('anime-calendar:views:v1');
    for (const key of await cache.keys()) {
      const response = await cache.match(key); if (!response) continue;
      const value = await response.json();
      if (value.data?.scope?.type !== 'weekly') continue;
      value.data.catalog.schedulePolicy = 'streaming';
      delete value.data.catalog.streamingAccessPolicy;
      for (const item of value.data.catalog.items) item.title = '旧会员抢先排期不能展示';
      await cache.put(key, new Response(JSON.stringify(value)));
    }
  });
  let offline = true;
  await page.route('**/api/catalog/weekly?**', route => offline ? route.abort('internetdisconnected') : route.continue());
  await page.reload();
  await expect(page.getByRole('heading', { name: '尚无可用数据', exact: true })).toBeVisible();
  await expect(page.getByText('旧会员抢先排期不能展示', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重试获取', exact: true })).toBeEnabled();
  offline = false;
  await page.getByRole('button', { name: '重试获取', exact: true }).click();
  await expect(page.getByRole('link', { name: '查看放课后的音符详情', exact: true })).toBeVisible();
  await expect(page.getByText('旧会员抢先排期不能展示', { exact: false })).toHaveCount(0);
});

import { expect, test } from '@playwright/test';
import { assetHtml } from '../../server/static-assets';

for (const fail of [false, true]) test(`静态分发：${fail ? 'CDN失败自动回到同源资源' : '独立域名加载资源且应用保持同源'}`, async ({ page, baseURL }) => {
  await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') });
  const requested: string[] = [];
  page.on('request', request => requested.push(request.url()));
  await page.route('https://static.example.test/**', async route => {
    if (fail) { await route.abort('failed'); return; }
    const response = await route.fetch({ url: new URL(new URL(route.request().url()).pathname, baseURL).href });
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
  });
  await page.route(url => url.origin === new URL(baseURL!).origin && url.pathname === '/', async route => {
    const response = await route.fetch(); await route.fulfill({ response, body: assetHtml(await response.text(), 'https://static.example.test') });
  });
  await page.goto('/#/weekly');
  await expect(page.getByRole('heading', { name: '本周番表', exact: false })).toBeVisible();
  await expect(page.locator('.day-column:visible .anime-card').first()).toBeVisible();
  expect(requested.some(url => url.startsWith('https://static.example.test/assets/') && url.endsWith('.js'))).toBe(true);
  expect(requested.filter(url => url.startsWith('https://static.example.test/')).every(url => /\/(assets|fonts)\//.test(url))).toBe(true);
  expect(requested.some(url => url.startsWith(baseURL!) && url.includes('/api/catalog/weekly'))).toBe(true);
  if (fail) expect(requested.some(url => url.startsWith(`${baseURL}/assets/`) && url.endsWith('.js'))).toBe(true);
});

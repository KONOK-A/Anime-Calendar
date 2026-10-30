import { useCatalogFixture } from '../support/catalog-view-fixture';
import { test, expect } from '@playwright/test';

test('短简介和较多平台信息不会把制作阵容推到大片留白下方', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') });
  const snapshot = await (await page.request.get('/api/catalog')).json();
  const anime = snapshot.items.find((item: { id: string }) => item.id === 'bgm:1');
  anime.platforms = Array.from({ length: 8 }, (_, index) => ({
    name: `测试平台${index + 1}`, url: `https://example.com/watch/${index + 1}`,
    regions: index === 6 ? Array.from({ length: 40 }, (_, region) => `R${String(region + 1).padStart(2, '0')}`) : ['JP'],
  }));
  await useCatalogFixture(page, snapshot);
  await page.goto('/#/anime/bgm:1');
  await expect(page.getByText('导演甲', { exact: true })).toBeVisible();
  await expect(page.getByText('主角甲', { exact: true })).toBeVisible();
  await expect(page.locator('.platform-list a')).toHaveCount(8);
  await expect(page.locator('.synopsis-original')).toHaveJSProperty('open', false);

  const positions = await page.evaluate(() => {
    const bounds = (selector: string) => { const box = document.querySelector(selector)!.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, height: box.height, left: box.left }; };
    return { story: bounds('.story-section'), credits: bounds('.credits-section'), airing: bounds('.airing-section'), platforms: bounds('.platforms-section'), lastPlatform: bounds('.platform-list a:last-child') };
  });
  if (testInfo.project.name === 'desktop') {
    expect(positions.credits.top - positions.story.bottom).toBeLessThan(60);
    expect(positions.credits.left).toBe(positions.story.left);
    expect(positions.lastPlatform.height).toBeLessThan(100);
  } else {
    expect(positions.airing.top).toBeGreaterThan(positions.story.bottom);
    expect(positions.platforms.top).toBeGreaterThan(positions.airing.bottom);
    expect(positions.credits.top).toBeGreaterThan(positions.platforms.bottom);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  }
});

import { useCatalogFixture } from '../support/catalog-view-fixture';
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') });
  await page.goto('/#/weekly');
  await expect(page.locator('.weekly-grid')).toBeVisible();
});

test('主视觉精修：标题保留安全间距，日期完整露出海报', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const hero = page.getByRole('region', { name: '今日作品', exact: true });
  const boxes = await hero.evaluate(element => {
    const box = (selector: string) => element.querySelector(selector)!.getBoundingClientRect().toJSON();
    return { title: box('.frame-title-stage'), date: box('.frame-date-number'), caption: box('.broadcast-short-date'), poster: box('.hero-poster') };
  });
  if (info.project.name === 'mobile') {
    expect(boxes.poster.left - boxes.title.right).toBeGreaterThanOrEqual(20);
    expect(boxes.caption.top - boxes.poster.bottom).toBeGreaterThanOrEqual(3);
    const first = await page.locator('.weekly-grid .anime-card:visible').first().boundingBox();
    const nav = await page.getByRole('navigation', { name: '主导航', exact: true }).boundingBox();
    expect(first!.y + first!.height).toBeLessThanOrEqual(nav!.y - 4);
  } else {
    expect(boxes.poster.left - boxes.date.right).toBeGreaterThanOrEqual(8);
  }
  await expect(hero.locator('.frame-eyebrow')).toContainText('2026');
});

test('主视觉精修：长短标题切换不重叠，时间和入口跟随新作品', async ({ page }) => {
  const catalog = await (await page.request.get('/api/catalog')).json();
  const first = catalog.items.find((item: { id: string }) => item.id === 'bgm:1');
  first.rule.anchor = '2026-10-29T05:00:00Z';
  first.title = '用于检查长短作品标题切换的长标题'.repeat(5);
  await useCatalogFixture(page, catalog);
  await page.reload();
  const hero = page.getByRole('region', { name: '今日作品', exact: true });
  await expect(hero.getByRole('heading', { name: first.title, exact: true })).toBeVisible();
  const observed = await hero.evaluate(async element => {
    const counts: number[] = [];
    element.querySelector<HTMLButtonElement>('[aria-label="下一部今日作品"]')!.click();
    await Promise.resolve();
    const outgoingVisible = [...element.querySelectorAll('.hero-work[inert]')].some(work => work.getClientRects().length > 0);
    await new Promise<void>(resolve => { function frame() {
      counts.push([...element.querySelectorAll('.hero-work h2')].filter(title => {
        const work = title.parentElement!;
        return work.getClientRects().length > 0 && getComputedStyle(work).opacity !== '0';
      }).length);
      if (counts.length < 30) requestAnimationFrame(frame); else resolve();
    }
    requestAnimationFrame(frame); });
    return { counts, outgoingVisible };
  });
  expect(observed.outgoingVisible).toBe(false);
  expect(Math.max(...observed.counts)).toBeLessThanOrEqual(1);
  await expect(hero.getByRole('heading', { name: '放课后的音符', exact: true })).toBeVisible();
  await expect(hero.locator('.frame-airing time')).toHaveText('20:00');
  await expect(hero.getByRole('link', { name: '打开今日作品详情', exact: true })).toHaveAttribute('href', '#/anime/bgm:2');
  await expect(hero.locator('.hero-poster:not([inert])')).toHaveAttribute('href', '#/anime/bgm:2');
  await expect(hero.getByRole('button', { name: '追番今日作品', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('主视觉精修：省略的长标题可以直接打开完整作品标题', async ({ page }) => {
  const catalog = await (await page.request.get('/api/catalog')).json();
  const first = catalog.items.find((item: { id: string }) => item.id === 'bgm:1');
  first.rule.anchor = '2026-10-29T05:00:00Z';
  first.title = '这是需要在作品详情完整查看的很长的动画标题'.repeat(5);
  await useCatalogFixture(page, catalog);
  await page.reload();
  const link = page.getByRole('region', { name: '今日作品', exact: true }).getByRole('link', { name: first.title, exact: true });
  await expect(link).toHaveAttribute('title', first.title);
  await link.click();
  await expect(page.getByRole('heading', { level: 1, name: first.title, exact: true })).toBeVisible();
});

test('主视觉精修：页尾最后一张卡与键盘操作露出浮动导航', async ({ page }, info) => {
  const last = page.getByRole('region', { name: '今日片单', exact: true }).locator('.anime-card').last();
  await last.scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  const bounds = await last.boundingBox();
  const bottom = info.project.name === 'mobile' ? (await page.getByRole('navigation', { name: '主导航', exact: true }).boundingBox())!.y : page.viewportSize()!.height;
  expect(bounds!.y + bounds!.height).toBeLessThan(bottom - 4);
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await last.locator('.anime-link').focus();
  await expect(last.locator('.anime-link')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(last.locator('.save-card')).toBeFocused();
  const exposed = await last.locator('.save-card').evaluate(button => {
    const box = button.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return button === hit || button.contains(hit);
  });
  expect(exposed).toBe(true);
});

test('主视觉精修：34px安全区下首条排期和末张卡片仍可完整操作', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.documentElement.style.setProperty('--safe-area-bottom', '34px'));
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  await expect(nav).toHaveCSS('bottom', '44px');
  const first = await page.locator('.weekly-grid .anime-card:visible').first().boundingBox();
  expect(first!.y + first!.height).toBeLessThan((await nav.boundingBox())!.y - 4);
  const last = page.getByRole('region', { name: '今日片单', exact: true }).locator('.anime-card').last();
  await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  const card = await last.boundingBox();
  expect(card!.y + card!.height).toBeLessThan((await nav.boundingBox())!.y - 4);
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await last.locator('.anime-link').focus();
  const focused = await last.boundingBox();
  expect(focused!.y + focused!.height).toBeLessThan((await nav.boundingBox())!.y - 4);
  await page.keyboard.press('Tab');
  await expect(last.locator('.save-card')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(last.locator('.save-card')).toHaveAttribute('aria-pressed', 'true');
});

test('主视觉精修：窄屏标题与顶栏在320至430px均无横向溢出', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 360, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      gap: document.querySelector('.hero-poster')!.getBoundingClientRect().left - document.querySelector('.frame-title-stage')!.getBoundingClientRect().right,
    }));
    expect(layout.overflow).toBe(false);
    expect(layout.gap).toBeGreaterThanOrEqual(20);
  }
});

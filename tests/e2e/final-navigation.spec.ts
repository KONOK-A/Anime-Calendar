import { test, expect, type CDPSession, type Locator, type Page } from '@playwright/test';
import type { Anime, AnimeDetail, AppStatus, CatalogSnapshot } from '../../shared/types';

const now = '2026-10-30T04:00:00Z';
const items: Anime[] = Array.from({ length: 8 }, (_, index) => {
  const at = `2026-10-${index < 6 ? '30' : '31'}T09:${String(index).padStart(2, '0')}:00Z`;
  const rule = { anchor: at, frequency: 'once' as const, raw: at, end: null };
  return {
    id: `bgm:${91000 + index}`, bangumiId: 91000 + index,
    title: `横滑样本${index + 1} 与 Navigation`, originalTitle: `ナビゲーション${index + 1}`,
    aliases: [`横滑样本${index + 1}`], type: 'tv', begin: at, season: '2026-4',
    officialSite: null, platforms: [], rule, broadcastRule: rule,
    sourceUrl: `https://example.com/anime/${91000 + index}`,
  };
});
const catalog: CatalogSnapshot = {
  schemaVersion: 1, items, activeIds: items.map(item => item.id), warnings: [],
  fetchedAt: { catalog: now, calendar: now }, overrides: { version: 1, active: [], events: [] },
};
const status: AppStatus = {
  appId: 'anime-calendar', version: '1.0.0', refreshing: false, hasCatalog: true, warnings: [],
  sources: { catalog: { fetchedAt: now, error: null }, calendar: { fetchedAt: now, error: null } },
};

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test.beforeEach(async ({ page }) => {
  // Keep time advancing: Vue capture/bubble handlers reject older event timestamps.
  // RAF, performance.now and gesture inertia remain native.
  await page.addInitScript(value => {
    const NativeDate = Date, offset = NativeDate.parse(value) - NativeDate.now();
    class BusinessDate extends NativeDate {
      constructor(...args: unknown[]) {
        super(...(args.length ? args : [NativeDate.now() + offset]) as ConstructorParameters<typeof NativeDate>);
      }
      static now() { return NativeDate.now() + offset; }
    }
    window.Date = BusinessDate as DateConstructor;
  }, now);
  await page.addInitScript(() => {
    localStorage.setItem('anime-calendar:weekly-layout', 'rows');
    localStorage.setItem('anime-calendar:favorites:v1', '[]');
  });
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') return route.abort();
    if (pathname === '/api/status') return route.fulfill({ json: status });
    if (pathname === '/api/catalog') return route.fulfill({ json: catalog });
    const match = pathname.match(/^\/api\/anime\/([^/]+)(\/credits)?$/);
    const item = match && items.find(value => value.id === decodeURIComponent(match[1]!));
    if (!item) return route.fulfill({ status: 404, json: { error: '未收录验收样本' } });
    if (match![2]) return route.fulfill({ json: {
      staff: [], cast: [],
      sources: { staff: { fetchedAt: now, error: null }, cast: { fetchedAt: now, error: null } },
    } });
    const detail: AnimeDetail = {
      ...item, summary: '用于验证详情往返的固定样本。', image: null, episodes: 1,
      tags: [], staff: [], rating: null, detailFetchedAt: now, detailError: null,
    };
    return route.fulfill({ json: detail });
  });
});

const selectedStrip = (page: Page) => page.locator('.day-column.mobile-selected .day-entries');

async function settleStrip(strip: Locator) {
  await strip.evaluate(element => new Promise<void>(resolve => {
    const started = performance.now();
    let previous = element.scrollLeft, stable = 0;
    function sample(time: number) {
      const current = element.scrollLeft;
      stable = Math.abs(current - previous) < .5 ? stable + 1 : 0;
      previous = current;
      if (time - started >= 250 && stable >= 8) resolve();
      else requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }));
}

async function panLeft(page: Page, strip: Locator, session: CDPSession) {
  const box = await strip.boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + 80;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 330, y, id: 1 }] });
  for (let step = 1; step <= 18; step++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 330 - step * 15, y, id: 1 }] });
    await page.waitForTimeout(16);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settleStrip(strip);
}

async function openFriday(page: Page, theme: 'light' | 'dark') {
  await page.goto('/#/weekly');
  await page.getByRole('combobox', { name: '页面主题' }).selectOption(theme);
  await page.getByRole('button', { name: '星期五 10月30日', exact: true }).tap();
  const strip = selectedStrip(page);
  await expect(strip.locator('.anime-card')).toHaveCount(6);
  await strip.evaluate(element => window.scrollTo({ top: element.getBoundingClientRect().top + scrollY - 300, behavior: 'instant' }));
  await settleStrip(strip);
  return strip;
}

async function position(strip: Locator) {
  return strip.evaluate(element => ({
    left: element.scrollLeft, top: scrollY,
    day: element.closest<HTMLElement>('.day-column')!.dataset.day,
  }));
}

async function expectRestored(strip: Locator, before: Awaited<ReturnType<typeof position>>) {
  await settleStrip(strip);
  await expect.poll(async () => Math.abs((await position(strip)).left - before.left)).toBeLessThan(3);
  await expect.poll(async () => Math.abs((await position(strip)).top - before.top)).toBeLessThan(8);
  expect((await position(strip)).day).toBe(before.day);
}

for (const theme of ['light', 'dark'] as const) {
  test(`最终验收：${theme} 手机CDP可信触摸横滑模拟条目可达且不误点`, async ({ page, context }) => {
    const strip = await openFriday(page, theme), session = await context.newCDPSession(page);
    const sourceIds = await strip.locator('.anime-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-anime-id')));
    const reached = new Set<string | null>();
    let accidentalClicks = 0, trustedMoves = 0;
    await page.exposeFunction('recordNavigationTouch', (type: string, trusted: boolean) => {
      if (type === 'click') accidentalClicks++;
      if (type === 'touchmove' && trusted) trustedMoves++;
    });
    await page.evaluate(() => {
      for (const type of ['click', 'touchmove']) document.addEventListener(type, event => {
        void (window as unknown as { recordNavigationTouch: (type: string, trusted: boolean) => Promise<void> }).recordNavigationTouch(type, event.isTrusted);
      }, { capture: true, passive: true });
    });
    const before = await position(strip);
    for (let count = 0; count <= sourceIds.length; count++) {
      const visible = await strip.locator('.anime-card').evaluateAll(cards => cards.filter(card => {
        const box = card.getBoundingClientRect();
        return box.left >= 15 && box.right <= 375;
      }).map(card => card.getAttribute('data-anime-id')));
      visible.forEach(id => reached.add(id));
      const atEnd = await strip.evaluate(element => element.scrollLeft >= element.scrollWidth - element.clientWidth - 3);
      if (atEnd) break;
      await panLeft(page, strip, session);
    }
    expect([...reached]).toEqual(sourceIds);
    expect(trustedMoves).toBeGreaterThan(0);
    expect(accidentalClicks).toBe(0);
    await expect(page).toHaveURL(/#\/weekly$/);
    expect(Math.abs((await position(strip)).top - before.top)).toBeLessThan(2);
  });

  test(`最终验收：${theme} 手机详情返回及浏览器后退恢复横排位置`, async ({ page, context }) => {
    const strip = await openFriday(page, theme), session = await context.newCDPSession(page);
    await panLeft(page, strip, session); await panLeft(page, strip, session);
    const before = await position(strip);
    expect(before.left).toBeGreaterThan(300);
    for (const back of ['link', 'history'] as const) {
      const href = await strip.locator('.anime-link').evaluateAll(links => links.find(link => {
        const box = link.getBoundingClientRect();
        return box.left >= 16 && box.right <= 374;
      })?.getAttribute('href'));
      expect(href).toBeTruthy();
      await strip.locator(`a[href="${href}"]`).tap();
      await expect(page.getByRole('link', { name: '返回番表', exact: true })).toBeVisible();
      if (back === 'link') await page.getByRole('link', { name: '返回番表', exact: true }).tap();
      else await page.goBack();
      await expect(page.locator('.weekly-grid')).toHaveAttribute('data-layout', 'rows');
      await expectRestored(strip, before);
    }
    await page.reload();
    await expect(page.locator('.weekly-grid')).toHaveAttribute('data-layout', 'rows');
    await expectRestored(strip, before);
  });

  test(`最终验收：${theme} 手机切换日期与竖横视图恢复横排位置`, async ({ page, context }) => {
    const strip = await openFriday(page, theme), session = await context.newCDPSession(page);
    await panLeft(page, strip, session); await panLeft(page, strip, session);
    const before = await position(strip);
    expect(before.left).toBeGreaterThan(300);
    await page.getByRole('button', { name: '星期六 10月31日', exact: true }).tap();
    await expect(page.locator('.day-column.mobile-selected')).toHaveAttribute('data-day', '2026-10-31');
    await settleStrip(strip);
    await page.getByRole('button', { name: '星期五 10月30日', exact: true }).tap();
    await expect(page.locator('.day-column.mobile-selected')).toHaveAttribute('data-day', '2026-10-30');
    await expectRestored(strip, before);
    await page.getByRole('button', { name: '竖列番表', exact: true }).click();
    await expect(page.locator('.weekly-grid')).toHaveAttribute('data-layout', 'columns');
    await expect(page.getByRole('button', { name: '竖列番表', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => strip.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0);
    await settleStrip(strip);
    await page.getByRole('button', { name: '横排番表', exact: true }).click();
    await expect(page.locator('.weekly-grid')).toHaveAttribute('data-layout', 'rows');
    await expectRestored(strip, before);
  });
}

test('边界回归：旧v1浏览状态支持横滑，窄宽窄切换保留手机位置', async ({ page, context }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('anime-calendar:browse:v1', JSON.stringify({
      version: 1, weekly: { selectedDay: '2026-10-30', onlyFavorites: false },
      seasons: {}, scroll: {}, detailFrom: '#/weekly', lastSeason: '#/season',
    }));
  });
  const strip = await openFriday(page, 'light'), session = await context.newCDPSession(page);
  await panLeft(page, strip, session); await panLeft(page, strip, session);
  const before = await position(strip);
  expect(before.left).toBeGreaterThan(300);
  await page.setViewportSize({ width: 1200, height: 844 });
  await expect.poll(() => strip.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0);
  // Allow the native resize scroll event and the throttled save to run at max=0.
  await page.waitForTimeout(200);
  await page.setViewportSize({ width: 390, height: 844 });
  await settleStrip(strip);
  await expect.poll(async () => Math.abs((await position(strip)).left - before.left)).toBeLessThan(3);
  expect((await position(strip)).day).toBe(before.day);
});

test('边界回归：时区与收藏记录独立，快速切换日期布局只恢复末状态并夹紧', async ({ page, context }) => {
  await page.addInitScript(() => {
    localStorage.setItem('anime-calendar:timezone', 'Asia/Shanghai');
    sessionStorage.setItem('anime-calendar:browse:v1', JSON.stringify({
      version: 1,
      weekly: {
        selectedDay: '2026-10-30', onlyFavorites: false,
        horizontalScroll: {
          'Asia/Shanghai|2026-10-30|rows|all': 586,
          'Asia/Tokyo|2026-10-30|rows|all': 294,
          'Asia/Tokyo|2026-10-30|rows|favorites': 586,
          'Asia/Tokyo|2026-10-31|rows|all': 50_000,
        },
      },
      seasons: {}, scroll: {}, detailFrom: '#/weekly', lastSeason: '#/season',
    }));
  });
  const strip = await openFriday(page, 'light'), session = await context.newCDPSession(page);
  await expect.poll(async () => Math.abs((await position(strip)).left - 586)).toBeLessThan(3);
  for (let index = 0; index < 4; index++) await strip.locator('.save-card').nth(index).tap();
  await panLeft(page, strip, session);
  const shanghai = await position(strip);
  expect(shanghai.left).toBeGreaterThan(300);
  const timezone = page.getByRole('combobox', { name: '显示时区' });
  await timezone.selectOption('Asia/Tokyo');
  await settleStrip(strip);
  await expect.poll(async () => Math.abs((await position(strip)).left - 294)).toBeLessThan(3);
  const favorites = page.getByRole('checkbox', { name: '仅看收藏' });
  await favorites.check();
  await expect(strip.locator('.anime-card')).toHaveCount(4);
  await settleStrip(strip);
  await expect.poll(async () => Math.abs((await position(strip)).left - 586)).toBeLessThan(3);
  await favorites.uncheck();
  await settleStrip(strip);
  await expect.poll(async () => Math.abs((await position(strip)).left - 294)).toBeLessThan(3);
  await timezone.selectOption('Asia/Shanghai');
  await settleStrip(strip);
  await expect.poll(async () => Math.abs((await position(strip)).left - shanghai.left)).toBeLessThan(3);
  await timezone.selectOption('Asia/Tokyo');
  await settleStrip(strip);
  await page.evaluate(() => {
    const click = (label: string) => {
      const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      if (!button) throw new Error(`缺少控件：${label}`);
      button.click();
    };
    // One task keeps all changes ahead of the pending restoration frame.
    click('星期六 10月31日'); click('星期五 10月30日'); click('星期六 10月31日');
    click('竖列番表'); click('横排番表');
  });
  await expect(page.locator('.weekly-grid')).toHaveAttribute('data-layout', 'rows');
  await expect(page.locator('.day-column.mobile-selected')).toHaveAttribute('data-day', '2026-10-31');
  await settleStrip(strip);
  const end = await strip.evaluate(element => ({ left: element.scrollLeft, maximum: element.scrollWidth - element.clientWidth }));
  expect(end.maximum).toBeGreaterThan(0);
  expect(Math.abs(end.left - end.maximum)).toBeLessThan(3);
  await page.getByRole('button', { name: '星期五 10月30日', exact: true }).tap();
  await settleStrip(strip);
  await expect.poll(async () => Math.abs((await position(strip)).left - 294)).toBeLessThan(3);
});

test('边界回归：正常动效中新可信touchStart向起点横滑优先于待恢复位置', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const strip = await openFriday(page, 'light'), session = await context.newCDPSession(page);
  await panLeft(page, strip, session); await panLeft(page, strip, session);
  const before = await position(strip);
  expect(Math.abs(before.left - 586)).toBeLessThan(3);
  await page.getByRole('button', { name: '竖列番表', exact: true }).click();
  await expect(page.locator('.weekly-grid')).toHaveAttribute('data-layout', 'columns');
  await expect.poll(() => strip.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0);
  await settleStrip(strip);

  type TouchEvidence = { trusted: boolean; blank: boolean; animations: number; left: number };
  let touchEvidence: TouchEvidence | undefined;
  await page.exposeFunction('recordPriorityTouch', (value: TouchEvidence) => { touchEvidence = value; });
  await strip.evaluate(element => {
    element.addEventListener('touchstart', event => {
      void (window as unknown as { recordPriorityTouch: (value: TouchEvidence) => Promise<void> }).recordPriorityTouch({
        trusted: event.isTrusted, blank: event.target === element, left: element.scrollLeft,
        animations: element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length,
      });
    }, { once: true, passive: true });
  });
  await page.getByRole('button', { name: '横排番表', exact: true }).click();
  const point = await strip.evaluate(element => new Promise<{ x: number; y: number }>((resolve, reject) => {
    function sample() {
      const running = element.getAnimations({ subtree: true }).some(animation => animation.playState === 'running');
      if (!running) { reject(new Error('未在正常列表动效期间找到触摸空白区')); return; }
      const box = element.getBoundingClientRect(), y = box.bottom - 2;
      for (const x of [box.left + 1, box.left + 8, Math.min(240, (box.left + box.right) / 2)]) {
        if (x <= 240 && document.elementFromPoint(x, y) === element) { resolve({ x, y }); return; }
      }
      requestAnimationFrame(sample);
    }
    sample();
  }));
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
  for (let step = 1; step <= 8; step++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + step * 15, y: point.y, id: 1 }] });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(320);
  const held = await position(strip);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(touchEvidence?.trusted).toBe(true);
  expect(touchEvidence?.blank).toBe(true);
  expect(touchEvidence?.animations).toBeGreaterThan(0);
  expect(Math.abs(held.left - before.left)).toBeGreaterThan(100);
  await settleStrip(strip);
  const after = await position(strip);
  expect(after.left).toBeLessThan(100);
  await expect(page).toHaveURL(/#\/weekly$/);
  expect(after.day).toBe(before.day);
  const columns = page.getByRole('button', { name: '竖列番表', exact: true });
  await columns.focus(); await expect(columns).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '横排番表', exact: true })).toBeFocused();
});

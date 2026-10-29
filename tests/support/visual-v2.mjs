import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const live = process.argv.includes('--live');
const baseURL = live ? 'http://127.0.0.1:4317' : 'http://127.0.0.1:4321';
const directory = resolve(`.local/v2-visual-sample/${live ? 'live' : 'fixed'}`);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  const catalog = await (await fetch(`${baseURL}/api/catalog`)).json();
  const detailId = live && catalog.items.some(x => x.id === 'bgm:511936') ? 'bgm:511936' : 'bgm:1';
  const saved = live ? [...new Set([detailId, ...catalog.activeIds])].filter(id => catalog.items.some(item => item.id === id)).slice(0, 6) : ['bgm:1', 'bgm:2', 'bgm:4'];
  for (const [device, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
      await context.addInitScript(({ theme, saved }) => { localStorage.setItem('anime-calendar:theme', theme); localStorage.setItem('anime-calendar:favorites:v1', JSON.stringify(saved)); }, { theme, saved });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') });
      for (const [name, route, heading] of [['weekly', '#/weekly', '本周番表'], ['detail', `#/anime/${detailId}`, null], ['season', '#/season', '季度目录'], ['favorites', '#/favorites', '我的追番']]) {
        await page.goto(`${baseURL}/${route}`, { waitUntil: 'domcontentloaded' });
        await page.locator('main h1').filter({ hasText: heading ?? '' }).first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        let incompleteImages = false;
        if (name === 'favorites' && saved.length) await page.locator('.collection-grid .anime-card').first().waitFor();
        try { await page.waitForFunction(() => [...document.images].filter(image => image.getBoundingClientRect().height > 0 && image.getBoundingClientRect().top < innerHeight).every(image => image.complete), undefined, { timeout: 6000 }); }
        catch { incompleteImages = true; }
        if (name === 'detail') await page.getByRole('heading', { name: '制作阵容', exact: true }).waitFor();
        await page.screenshot({ path: resolve(directory, `${device}-${theme}-${name}.png`), fullPage: true, animations: 'disabled' });
        await page.screenshot({ path: resolve(directory, `${device}-${theme}-${name}-viewport.png`), animations: 'disabled' });
        results.push({ device, theme, page: name, incompleteImages, ...await page.evaluate(() => {
          const first = [...document.querySelectorAll('.weekly-grid .anime-card')].find(el => el.getClientRects().length)?.getBoundingClientRect();
          const nav = document.querySelector('.main-nav')?.getBoundingClientRect();
          return { overflow: document.documentElement.scrollWidth > innerWidth, firstAiringTop: first?.top ?? null, viewportHeight: innerHeight, navTop: nav?.top, navBottom: nav?.bottom, dom: document.querySelectorAll('*').length, scene: document.querySelector('.scene-backdrop svg') ? 'broadcast-vector' : null };
        }), errors: [...errors] });
      }
      await context.close();
    }
  }
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ directory, captures: results.length, issues: results.filter(x => x.overflow || x.errors.length || x.incompleteImages), weekly: results.filter(x => x.page === 'weekly') }));
} finally { await browser.close(); }

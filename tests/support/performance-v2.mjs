import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Run against the isolated fixed-data server, with real RAF/performance clocks.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const [device, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-10-29T04:00:00Z'));
    await page.addInitScript(() => {
      window.__v2Metrics = { longTasks: [], shifts: [], lcp: [], shiftDetails: [] };
      for (const [type, field] of [['longtask', 'longTasks'], ['layout-shift', 'shifts'], ['largest-contentful-paint', 'lcp']]) {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (type === 'layout-shift' && entry.hadRecentInput) continue;
            if (type === 'layout-shift') window.__v2Metrics.shiftDetails.push({ value: entry.value, sources: entry.sources.map(source => ({ node: source.node?.className || source.node?.nodeName, previous: source.previousRect.toJSON(), current: source.currentRect.toJSON() })) });
            window.__v2Metrics[field].push(type === 'longtask' ? entry.duration : type === 'layout-shift' ? entry.value : entry.startTime);
          }
        }).observe({ type, buffered: true });
      }
    });
    await page.goto('http://127.0.0.1:4321');
    await page.locator('.weekly-grid').waitFor();
    await page.evaluate(() => document.fonts.ready);
    const frames = await page.evaluate(() => new Promise(resolve => {
      const values = []; let previous;
      const frame = at => { if (previous !== undefined) values.push(at - previous); previous = at; if (values.length < 60) requestAnimationFrame(frame); else resolve(values); };
      requestAnimationFrame(frame);
    }));
    const initial = await page.evaluate(() => ({ ...window.__v2Metrics, dom: document.querySelectorAll('*').length }));
    const sorted = frames.slice().sort((a, b) => a - b);
    const themePaint = await page.evaluate(() => new Promise(resolve => {
      const select = document.querySelector('[aria-label="页面主题"]'), started = performance.now();
      select.value = 'dark'; select.dispatchEvent(new Event('change', { bubbles: true }));
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({ milliseconds: performance.now() - started, theme: document.documentElement.dataset.theme })));
    }));
    results.push({ device, viewport: { width, height }, cls: initial.shifts.reduce((sum, x) => sum + x, 0), shiftDetails: initial.shiftDetails, longTasks: initial.longTasks, maxLongTaskMs: Math.max(0, ...initial.longTasks), dom: initial.dom, lastLcpMs: initial.lcp.at(-1), frameP95Ms: sorted[Math.floor(sorted.length * .95)], themePaint });
    await context.close();
  }
  await mkdir('.local/dev-logs', { recursive: true });
  await writeFile('.local/dev-logs/v2-performance.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); }

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const directory = resolve('docs/screenshots'); await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4317', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '本周番表.' }).waitFor();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: resolve(directory, 'desktop-weekly.png'), fullPage: true });
  await page.getByRole('link', { name: '季度目录', exact: true }).click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: resolve(directory, 'desktop-season.png'), fullPage: true });
  const first = page.locator('.poster-grid .anime-link').first();
  await first.click(); await page.getByRole('heading', { name: '故事简介', exact: true }).waitFor();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: resolve(directory, 'desktop-detail.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: '本周番表', exact: true }).click();
  await page.screenshot({ path: resolve(directory, 'mobile-weekly.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.body.scrollWidth > innerWidth);
  console.log(JSON.stringify({ errors, mobileOverflow: overflow, directory }));
} finally { await browser.close(); }

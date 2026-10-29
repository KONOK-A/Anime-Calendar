import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') });
  await page.goto('/');
});

test('顶栏菜单可点选时区和主题，并应用到排期与页面', async ({ page }, info) => {
  const timezone = page.getByRole('combobox', { name: '显示时区' });
  await timezone.click();
  const japan = page.getByRole('option', { name: '日本 UTC+9', exact: true });
  await expect(japan).toBeVisible();
  await japan.click();
  await expect(timezone).toHaveValue('Asia/Tokyo');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /星期二/ }).click();
  await expect(page.locator('.weekly-grid').getByText('00:30', { exact: true }).first()).toBeVisible();
  await page.getByRole('combobox', { name: '页面主题' }).click();
  await page.getByRole('option', { name: '深色', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(timezone).toHaveValue('Asia/Tokyo');
  await expect(page.getByRole('combobox', { name: '页面主题' })).toHaveValue('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('顶栏菜单支持键盘选择、Esc取消和点击空白关闭', async ({ page }) => {
  const timezone = page.getByRole('combobox', { name: '显示时区' });
  const theme = page.getByRole('combobox', { name: '页面主题' });
  await timezone.focus(); await page.keyboard.press('Space');
  await expect(page.getByRole('option', { name: '北京 UTC+8', exact: true })).toBeVisible();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape');
  await expect(timezone).toHaveValue('Asia/Shanghai');
  await expect(timezone).toBeFocused();
  await theme.focus(); await page.keyboard.press('Space');
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await expect(theme).toHaveValue('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await theme.click();
  await expect(page.getByRole('option', { name: '跟随系统', exact: true })).toBeVisible();
  await page.getByRole('heading', { name: '本周番表', level: 1 }).click();
  await expect(page.getByRole('option', { name: '跟随系统', exact: true })).toBeHidden();
  await expect(theme).toHaveValue('dark');
  await page.getByRole('link', { name: '季度目录', exact: true }).click();
  await expect(page).toHaveURL(/#\/season/);
});

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('视觉统一：目录海报的评分与追番入口顶部对齐且左右对称', async ({ page }, info) => {
  await page.goto('/#/season/2026/4');
  const grid = page.locator('.catalog-page .poster-grid');
  const card = grid.locator('[data-anime-id="bgm:1"]');
  await expect(card.getByLabel('综合评分 7.8 / 10', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: '追番星旅', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const densities = info.project.name === 'desktop' ? [4, 5, 6] : [null];
  for (const columns of densities) {
    if (columns !== null) {
      await page.getByRole('button', { name: `每行显示${columns}部`, exact: true }).click();
      await expect.poll(() => grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(columns);
    } else {
      await expect(page.getByRole('group', { name: '每行作品数量' })).toBeHidden();
    }
    await page.mouse.move(0, 0);
    const alignment = await card.evaluate(element => {
      const poster = element.querySelector('.poster-frame')!.getBoundingClientRect();
      const rating = element.querySelector('.card-rating')!.getBoundingClientRect();
      const save = element.querySelector('.save-card')!.getBoundingClientRect();
      return { top: Math.abs(rating.top - save.top), sides: Math.abs((rating.left - poster.left) - (poster.right - save.right)) };
    });
    expect(alignment.top, `密度 ${columns ?? '手机'} 的评分与追番按钮顶部偏差`).toBeLessThanOrEqual(1);
    expect(alignment.sides, `密度 ${columns ?? '手机'} 的海报左右控件内距偏差`).toBeLessThanOrEqual(1);
  }
});

test('视觉统一：手机默认主题控件完整容纳跟随系统文字及箭头', async ({ page }) => {
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/#/favorites');
    const theme = page.getByRole('combobox', { name: '页面主题', exact: true });
    await expect(theme).toHaveValue('system');
    await expect(theme).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const fit = await theme.evaluate(element => {
      const select = element as HTMLSelectElement;
      const style = getComputedStyle(select), icon = getComputedStyle(select, '::picker-icon');
      const number = (value: string) => Number.parseFloat(value) || 0;
      const label = select.selectedOptions[0]!.textContent!.trim();
      const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
      context.font = style.font;
      const textWidth = context.measureText(label).width + Math.max(0, label.length - 1) * number(style.letterSpacing);
      const iconWidth = number(icon.width) + (icon.boxSizing === 'border-box' ? 0 : number(icon.paddingLeft) + number(icon.paddingRight) + number(icon.borderLeftWidth) + number(icon.borderRightWidth));
      const requiredWidth = textWidth + number(style.paddingLeft) + number(style.paddingRight) + number(style.columnGap) + iconWidth + number(icon.marginLeft) + number(icon.marginRight);
      const bounds = select.getBoundingClientRect();
      return {
        scrollWidth: select.scrollWidth, clientWidth: select.clientWidth, requiredWidth,
        arrowVisible: icon.display !== 'none' && icon.visibility !== 'hidden' && number(icon.width) > 0 && number(icon.height) > 0,
        left: bounds.left, right: bounds.right,
        pageScrollWidth: document.documentElement.scrollWidth, pageClientWidth: document.documentElement.clientWidth,
      };
    });
    expect(fit.pageScrollWidth, `${width}px 页面没有横向溢出`).toBeLessThanOrEqual(fit.pageClientWidth);
    expect(fit.scrollWidth, `${width}px 主题控件没有内部溢出`).toBeLessThanOrEqual(fit.clientWidth);
    expect(fit.requiredWidth, `${width}px 主题文字和箭头完整放入控件`).toBeLessThanOrEqual(fit.clientWidth + 1);
    expect(fit.arrowVisible, `${width}px 主题控件保留展开箭头`).toBe(true);
    expect(fit.left).toBeGreaterThanOrEqual(0);
    expect(fit.right).toBeLessThanOrEqual(width);
  }
});

test('视觉统一：桌面展开数据来源后页脚品牌保持顶部位置', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/favorites');
  const footer = page.locator('.app-footer'), sources = footer.locator('.data-source');
  await expect(footer.locator('.footer-brand')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await footer.scrollIntoViewIfNeeded();
  const brandOffset = () => footer.evaluate(element => element.querySelector('.footer-brand')!.getBoundingClientRect().top - element.querySelector('.footer-overview')!.getBoundingClientRect().top);
  const before = await brandOffset();
  await sources.getByText('数据与来源', { exact: true }).click();
  await expect(sources).toHaveAttribute('open', '');
  await expect(sources.locator('.data-source-body')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(Math.abs(await brandOffset() - before), '展开来源时品牌相对页脚行顶部的偏移保持稳定').toBeLessThanOrEqual(1);
});

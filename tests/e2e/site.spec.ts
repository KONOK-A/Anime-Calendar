import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T04:00:00Z') });
  await page.goto('/');
});

test('番表到详情、收藏、刷新保留与仅看收藏', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '星期一', exact: false }).click();
  await page.getByRole('link', { name: '查看星旅详情' }).first().click();
  await expect(page.getByRole('heading', { name: '星旅', exact: true })).toBeVisible();
  await expect(page.getByText('这是测试中的作品简介', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '加入追番', exact: true }).click();
  await page.reload(); await expect(page.getByRole('button', { name: '已在追番', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '本周番表', exact: true }).click();
  await page.getByRole('checkbox', { name: '仅看收藏' }).check();
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '星期一', exact: false }).click();
  await expect(page.getByRole('link', { name: '查看星旅详情' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: '查看放课后的音符详情' })).toHaveCount(0);
});

test('季度别名搜索、类型过滤、待定作品与详情直达', async ({ page }) => {
  await page.getByRole('link', { name: '季度目录', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索作品' }).fill('星旅别名');
  await expect(page.getByRole('link', { name: '查看星旅详情' })).toBeVisible();
  await expect(page.locator('.anime-card').first()).toContainText('2026.10.01');
  await page.getByRole('searchbox', { name: '搜索作品' }).fill('');
  await page.getByRole('combobox', { name: '作品类型' }).selectOption('web');
  await expect(page.getByRole('link', { name: '查看尚未定时的故事详情' })).toBeVisible();
  await expect(page.getByRole('link', { name: '查看星旅详情' })).toHaveCount(0);
  await page.goto('/#/anime/bgm:2'); await expect(page.getByRole('heading', { name: '放课后的音符', exact: true })).toBeVisible();
  await page.goto('/#/anime/bgm:999'); await expect(page.getByText('当前目录未收录该作品。', { exact: false })).toBeVisible();
});

test('时区切换使深夜作品跨日移动，封面失败有占位且没有横向溢出', async ({ page }, testInfo) => {
  const missingImage = page.waitForResponse(response => response.url().endsWith('/missing-cover.jpg'));
  await page.reload(); await missingImage;
  await page.getByRole('combobox', { name: '显示时区' }).selectOption('Asia/Tokyo');
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '星期二', exact: false }).click();
  await expect(page.getByRole('link', { name: '查看星旅详情' }).first()).toBeVisible();
  await expect(page.getByText('00:30', { exact: true }).first()).toBeVisible();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', testInfo.project.name === 'mobile' ? 390 : 1440);
  await expect(page.locator('.weekly-grid img.poster:visible').first()).toHaveAttribute('src', '/poster-placeholder.svg');
});

test('备份导入合并去重，无效备份不损坏收藏，允许移除失联ID', async ({ page }) => {
  await page.getByRole('link', { name: '我的追番', exact: true }).click();
  const backup = { version: 1, exportedAt: '2026-10-29T00:00:00Z', favorites: ['bgm:1', 'bgm:1', 'bd:orphan'] };
  await page.getByLabel('导入追番备份').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.getByRole('link', { name: '查看星旅详情' })).toHaveCount(1);
  await expect(page.getByText('bd:orphan')).toBeVisible();
  await page.getByLabel('导入追番备份').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.getByRole('alert')).toContainText('现有收藏未改动');
  await expect(page.getByRole('link', { name: '查看星旅详情' })).toHaveCount(1);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出备份' }).click(); expect((await download).suggestedFilename()).toMatch(/anime-calendar/);
  await page.getByRole('button', { name: '移除bd:orphan' }).click(); await expect(page.getByText('bd:orphan')).toHaveCount(0);
});

test('多个标签页的收藏添加、移除和导入不会互相覆盖', async ({ page, context }) => {
  const second = await context.newPage(); await second.clock.install({ time: new Date('2026-10-29T04:00:00Z') });
  await page.goto('/#/anime/bgm:1'); await second.goto('/#/anime/bgm:2');
  await page.getByRole('button', { name: '加入追番', exact: true }).click();
  await second.getByRole('button', { name: '加入追番', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('anime-calendar:favorites:v1') ?? '[]'))).toEqual(['bgm:1', 'bgm:2']);
  await page.getByRole('link', { name: '我的追番', exact: true }).click();
  await expect(page.getByRole('link', { name: '查看放课后的音符详情' })).toBeVisible();
  await page.getByRole('button', { name: '取消追番放课后的音符', exact: true }).click();
  await expect(second.getByRole('button', { name: '加入追番', exact: true })).toBeVisible();
  await second.getByRole('link', { name: '我的追番', exact: true }).click();
  await second.getByLabel('导入追番备份').setInputFiles({ name: 'extra.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, favorites: ['bgm:3'] })) });
  await expect(page.getByRole('link', { name: '查看漫长的夏日详情' })).toBeVisible(); await expect(page.getByRole('link', { name: '查看星旅详情' })).toBeVisible();
  await second.close();
});

test('刷新状态请求断线后仍可重试，不会永久禁用刷新', async ({ page }) => {
  const status = await (await page.request.get('/api/status')).json();
  await page.route('**/api/refresh', route => route.fulfill({ json: { ...status, refreshing: true } }));
  await page.route('**/api/status', route => route.abort('failed'));
  await page.getByRole('button', { name: '刷新数据', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('无法连接本地服务');
  await expect(page.getByRole('button', { name: '刷新数据', exact: true })).toBeEnabled();
  await page.unroute('**/api/status'); await page.unroute('**/api/refresh');
  await page.getByRole('button', { name: '刷新数据', exact: true }).click();
  await expect(page.getByRole('button', { name: '刷新数据', exact: true })).toBeEnabled();
});

test('详情首次连接失败会说明错误并允许就地重试', async ({ page }) => {
  await page.route('**/api/anime/**', route => route.abort('failed'));
  await page.goto('/#/anime/bgm:1');
  await expect(page.getByText('详情请求失败', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '重试详情', exact: true })).toBeVisible();
  await page.unroute('**/api/anime/**'); await page.getByRole('button', { name: '重试详情', exact: true }).click();
  await expect(page.getByText('这是测试中的作品简介', { exact: false })).toBeVisible();
});

test('目录不可用时仍能查看收藏ID和导出备份', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('anime-calendar:favorites:v1', JSON.stringify(['bgm:1', 'bd:orphan'])));
  const status = await (await page.request.get('/api/status')).json();
  await page.route('**/api/status', route => route.fulfill({ json: { ...status, hasCatalog: false, refreshing: false } }));
  await page.goto('/#/favorites'); await page.reload();
  await expect(page.getByText('bd:orphan', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出备份', exact: true }).click(); expect((await download).suggestedFilename()).toMatch(/anime-calendar/);
  await page.getByRole('button', { name: '移除bd:orphan' }).click(); await expect(page.getByText('bd:orphan', { exact: true })).toHaveCount(0);
});

test('跨周后所选日期自动进入新周，不会隐藏整张窄屏番表', async ({ page }) => {
  await page.clock.fastForward(4 * 86_400_000);
  await expect(page.locator('.day-column.mobile-selected')).toHaveCount(1);
  await expect(page.locator('.day-column.mobile-selected')).toHaveAttribute('data-day', '2026-11-02');
});

test('网络先行使用周六网络时段，详情同时显示所选平台与原放送参考', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '星期六', exact: false }).click();
  const saturday = page.locator('.day-column[data-day="2026-10-31"]');
  await expect(saturday.getByRole('link', { name: '查看网络先行作品详情' })).toBeVisible();
  await expect(saturday.getByText('20:00', { exact: true })).toBeVisible();
  await expect(saturday.locator('.event-footnote')).toContainText('网络先行');
  await expect(page.locator('.day-column[data-day="2026-10-26"]').getByRole('link', { name: '查看网络先行作品详情' })).toHaveCount(0);
  await saturday.getByRole('link', { name: '查看网络先行作品详情' }).click();
  await expect(page.getByText('采用平台', { exact: true })).toBeVisible();
  await expect(page.locator('.detail-facts')).toContainText('哔哩哔哩');
  await expect(page.locator('.detail-facts')).toContainText('星期六 20:00');
  await expect(page.locator('.detail-facts')).toContainText('星期一 22:30');
  await expect(page.locator('.detail-facts')).not.toContainText('预计');
  await expect(page.locator('.detail-airing-summary')).not.toContainText('预计');
});

test('详情展示制作阵容与角色CV，原文默认折叠、切换作品后重新收起', async ({ page }) => {
  await page.goto('/#/anime/bgm:1');
  await expect(page.getByRole('heading', { name: '制作阵容', exact: true })).toBeVisible();
  await expect(page.locator('.staff-list')).toContainText('导演甲');
  await expect(page.locator('.staff-list')).toContainText('制作公司丙');
  await expect(page.locator('.staff-list')).toContainText('音乐家丁');
  await expect(page.locator('.cast-list').first()).toContainText('主角甲');
  await expect(page.locator('.cast-list').first()).toContainText('声优0');
  await expect(page.getByText('这是测试中的作品简介', { exact: false })).toBeVisible();
  const original = page.getByText('これは折りたたむ原文です。', { exact: true });
  await expect(original).toBeHidden();
  await page.locator('summary').filter({ hasText: '简介原文' }).click(); await expect(original).toBeVisible();
  await page.locator('summary').filter({ hasText: '其余 2 名角色' }).click();
  await expect(page.getByText('声优9', { exact: true })).toBeVisible();
  await page.goto('/#/anime/bgm:2'); await page.goto('/#/anime/bgm:1'); await expect(original).toBeHidden();
  expect(await page.evaluate(() => document.body.scrollWidth > innerWidth)).toBe(false);
});

test('角色资料连接失败显示重试，未收录时给出空状态', async ({ page }) => {
  await page.route('**/api/anime/*/credits', route => route.abort('failed'));
  await page.goto('/#/anime/bgm:1');
  await expect(page.getByText('补充资料请求失败', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: '星旅', exact: true })).toBeVisible();
  await page.unroute('**/api/anime/*/credits');
  await page.getByRole('button', { name: '重试制作与配音资料', exact: true }).click();
  await expect(page.locator('.cast-list').first()).toContainText('声优0');
  await page.goto('/#/anime/bgm:2');
  await expect(page.getByText('暂未收录主要角色的配音信息。', { exact: true })).toBeVisible();
  await expect(page.getByText('暂未收录制作资料。', { exact: true })).toBeVisible();
});

test('基础详情失败后重试会补齐infobox主创，不被先返回的补充资料遮住', async ({ page }) => {
  await page.route('**/api/anime/**', route => {
    if (route.request().url().endsWith('/credits')) return route.fulfill({ json: { staff: [{ role: '导演', names: ['导演甲'] }, { role: '音乐', names: ['过期音乐名'] }], cast: [], sources: { staff: { fetchedAt: '2026-10-29T04:00:00Z', error: null }, cast: { fetchedAt: '2026-10-29T04:00:00Z', error: null } } } });
    return route.abort('failed');
  });
  await page.goto('/#/anime/bgm:1'); await page.reload();
  await expect(page.getByRole('button', { name: '重试详情', exact: true })).toBeVisible();
  await expect(page.locator('.staff-list')).toContainText('导演甲');
  await page.unroute('**/api/anime/**'); await page.getByRole('button', { name: '重试详情', exact: true }).click();
  await expect(page.getByText('这是测试中的作品简介', { exact: false })).toBeVisible();
  await expect(page.locator('.staff-list')).toContainText('音乐家丁');
  await expect(page.locator('.staff-list')).not.toContainText('过期音乐名');
  await expect(page.locator('.staff-list')).toContainText('导演甲');
});

test('角色优先中文名，CV对应不变；只有展开更多才加载后续角色中文名', async ({ page }) => {
  const offsets: string[] = [];
  page.on('request', request => { if (request.url().includes('/character-names')) offsets.push(new URL(request.url()).searchParams.get('offset') ?? '0'); });
  await page.goto('/#/anime/bgm:1');
  await expect(page.locator('.cast-list').first()).toContainText('主角甲');
  await expect(page.locator('.cast-list').first()).toContainText('声优0');
  await expect(page.locator('.cast-list a').filter({ hasText: '主角甲' })).toHaveAttribute('title', '原名0');
  expect(offsets).toEqual(['0']);
  await page.locator('summary').filter({ hasText: '其余 2 名角色' }).click();
  await expect(page.getByText('配角9', { exact: true })).toBeVisible();
  expect(offsets).toEqual(['0', '8']);
  await expect(page.locator('.cast-list').first()).toContainText('原名7');
});

test('播放平台按作品关联显示巴哈台湾和港澳入口，无记录时不显示', async ({ page }) => {
  await page.goto('/#/anime/bgm:1');
  const taiwan = page.getByRole('link', { name: '巴哈姆特动画疯（台湾）', exact: false });
  const hongkong = page.getByRole('link', { name: '巴哈姆特动画疯（港澳）', exact: false });
  await expect(taiwan).toBeVisible(); await expect(taiwan).toHaveAttribute('href', 'https://acg.gamer.com.tw/acgDetail.php?s=12345'); await expect(taiwan).toContainText('TW');
  await expect(hongkong).toBeVisible(); await expect(hongkong).toContainText('HK / MO');
  await page.goto('/#/anime/bgm:2');
  await expect(page.getByRole('link', { name: '巴哈姆特动画疯', exact: false })).toHaveCount(0);
});

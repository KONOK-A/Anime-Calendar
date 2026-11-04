import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type { Anime, AiringRule, CatalogSnapshot } from '../../shared/types';
import { useCatalogFixture } from '../support/catalog-view-fixture';

const now = new Date('2026-10-29T04:00:00Z');
const nav = (page: Page) => page.getByRole('navigation', { name: '我的追番分区' });
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true });
async function openBackup(page: Page, value: unknown) {
  await page.getByLabel('导入追番备份').setInputFiles({ name: 'watchlist.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  return dialog(page, '预览备份');
}

test('旧收藏可以编辑进度和计划，刷新与另一标签页可读取同一份记录', async ({ page, context }) => {
  await page.clock.install({ time: now });
  await page.goto('/#/weekly');
  await page.evaluate(() => localStorage.setItem('anime-calendar:favorites:v1', '["bgm:1"]'));
  await page.goto('/#/anime/bgm:1');
  await page.reload();
  const open = page.getByRole('button', { name: '编辑追番记录', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog', { name: '编辑追番记录', exact: true });
  await dialog.getByLabel('已看集数', { exact: true }).fill('3');
  await dialog.getByLabel('计划观看日期', { exact: true }).fill('2026-10-30');
  await dialog.getByLabel('备注', { exact: true }).fill('周末补看');
  await dialog.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(open).toBeFocused();

  const other = await context.newPage();
  await other.clock.install({ time: now });
  await other.goto('/#/favorites');
  await expect(other.getByRole('heading', { name: '近期排期', exact: true })).toBeVisible();
  await nav(other).getByRole('button', { name: '全部作品', exact: true }).click();
  const star = other.locator('.watch-library .watch-entry[data-anime-id="bgm:1"]');
  await expect(star.getByText('已看 3 集', { exact: true })).toBeVisible();
  await page.reload();
  await open.click();
  await expect(dialog.getByLabel('已看集数', { exact: true })).toHaveValue('3');
  await expect(dialog.getByLabel('计划观看日期', { exact: true })).toHaveValue('2026-10-30');
  await page.keyboard.press('Escape');
  await expect(open).toBeFocused();
  const increment = star.getByRole('button', { name: '为星旅记录一集' });
  await increment.click();
  await expect(increment).toHaveAttribute('data-recorded', 'true');
  await expect(star.getByRole('status')).toHaveText('星旅，已看 4 集');
  await expect(star.getByText('已看 4 集', { exact: true })).toBeVisible();
  await open.click();
  await expect(dialog.getByLabel('已看集数', { exact: true })).toHaveValue('4');
  await page.keyboard.press('Escape');
  await other.getByRole('combobox', { name: '显示时区' }).selectOption('Asia/Tokyo');
  await star.getByRole('button', { name: '编辑星旅追番记录' }).click();
  await expect(other.getByRole('dialog', { name: '编辑追番记录', exact: true }).getByLabel('计划观看日期', { exact: true })).toHaveValue('2026-10-30');
});

test('自定义清单、批量状态、归档及取消收藏保留个人进度', async ({ page }) => {
  await page.clock.install({ time: now });
  await page.addInitScript(() => {
    if (!localStorage.getItem('anime-calendar:favorites:v1')) localStorage.setItem('anime-calendar:favorites:v1', '["bgm:1","bgm:2"]');
  });
  await page.goto('/#/favorites');
  await nav(page).getByRole('button', { name: '待整理' }).click();
  await page.getByRole('checkbox', { name: '选择星旅', exact: true }).check();
  await page.getByRole('checkbox', { name: '选择放课后的音符', exact: true }).check();
  await page.getByRole('button', { name: '加入清单', exact: true }).click();
  const list = dialog(page, '新建清单');
  await list.getByLabel('清单名称').fill('周末补番');
  await list.getByLabel('简介').fill('两部周末想看的作品');
  await list.getByLabel('置顶清单').check();
  await list.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '收藏已整理完毕' })).toBeVisible();
  await nav(page).getByRole('button', { name: '我的清单' }).click();
  await page.locator('.watch-list-gallery').getByRole('button', { name: /周末补番/ }).first().click();
  await expect(page.locator('.collection-grid .watch-entry')).toHaveCount(2);
  await page.getByRole('button', { name: '选择本页' }).click();
  await page.getByRole('button', { name: '修改状态', exact: true }).click();
  const batch = dialog(page, '修改观看状态');
  await batch.getByRole('radio', { name: '在看', exact: true }).check();
  await batch.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.watch-entry[data-status="watching"]')).toHaveCount(2);
  const star = page.locator('.watch-entry[data-anime-id="bgm:1"]');
  await star.getByRole('button', { name: '为星旅记录一集' }).click();
  await expect(star.getByText('已看 1 集', { exact: true })).toBeVisible();
  await star.getByRole('button', { name: '取消追番星旅', exact: true }).click();
  await expect(star).toHaveCount(0);
  await nav(page).getByRole('button', { name: '归档' }).click();
  await expect(page.getByRole('heading', { name: '已取消收藏的记录' })).toBeVisible();
  await expect(star.getByText('已看 1 集', { exact: true })).toBeVisible();
  await star.getByRole('button', { name: '重新收藏' }).click();
  await expect(star).toHaveCount(0);
  await nav(page).getByRole('button', { name: '全部作品' }).click();
  await expect(star.getByText('已看 1 集', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: '选择星旅', exact: true }).check();
  await page.locator('.watch-batch').getByRole('button', { name: '归档', exact: true }).click();
  await dialog(page, '归档作品').getByRole('button', { name: '确认归档' }).click();
  await expect(star).toHaveCount(0);
  await nav(page).getByRole('button', { name: '归档' }).click();
  await expect(star.getByText('已看 1 集', { exact: true })).toBeVisible();
  await star.getByRole('button', { name: '恢复归档' }).click();
  await expect(star).toHaveCount(0);
  await nav(page).getByRole('button', { name: '我的清单' }).click();
  await page.locator('.watch-list-gallery').getByRole('button', { name: /周末补番/ }).first().click();
  await page.getByRole('button', { name: '删除清单', exact: true }).click();
  await dialog(page, '删除清单').getByRole('button', { name: '删除清单', exact: true }).click();
  await expect(page.getByRole('heading', { name: '还没有自定义清单' })).toBeVisible();
  await nav(page).getByRole('button', { name: '全部作品' }).click();
  await expect(star.getByText('已看 1 集', { exact: true })).toBeVisible();
});

test('完整备份先预览，收藏写入失败可安全重试，离线可编辑与导出', async ({ page }) => {
  await page.clock.install({ time: now });
  await page.goto('/#/favorites');
  const backup = {
    version: 2, exportedAt: now.toISOString(), favorites: ['bgm:1', 'bd:orphan'],
    records: [{ id: 'bgm:1', status: 'watching', watched: 2, plannedDate: '2026-10-30', personalScore: 8, note: '补看记录', archived: false, updatedAt: now.toISOString() }],
    lists: [{ id: 'weekend', name: '周末计划', description: '', pinned: false, createdAt: now.toISOString() }],
    memberships: [{ listId: 'weekend', animeId: 'bgm:1' }],
    titles: [{ id: 'bgm:1', title: '星旅', originalTitle: '星の旅', aliases: ['星旅别名'], season: '2026-4', type: 'tv', episodes: 12 }],
  };
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'anime-calendar:favorites:v1' && !localStorage.getItem('watchlist-test-retry')) throw new DOMException('quota', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  const preview = await openBackup(page, backup);
  await expect(preview.getByText('新增收藏')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('anime-calendar:favorites:v1'))).toBeNull();
  await preview.getByRole('button', { name: '合并导入' }).click();
  await expect(preview.getByRole('alert')).toContainText('个人记录和清单已保存，收藏列表未保存');
  await page.evaluate(() => localStorage.setItem('watchlist-test-retry', 'true'));
  await preview.getByRole('button', { name: '合并导入' }).click();
  await expect(preview).not.toBeVisible();

  const duplicate = await openBackup(page, { ...backup, records: [{ ...backup.records[0], watched: 10 }] });
  await expect(duplicate.getByText('保留本机记录')).toBeVisible();
  await duplicate.getByRole('button', { name: '合并导入' }).click();
  await expect(duplicate).not.toBeVisible();
  await page.route('**/api/**', route => route.abort('internetdisconnected'));
  await page.reload();
  await nav(page).getByRole('button', { name: '全部作品' }).click();
  const star = page.locator('.collection-grid .watch-entry[data-anime-id="bgm:1"]');
  await expect(star.getByText('已看 2 集')).toBeVisible();
  await star.getByRole('button', { name: '为星旅记录一集' }).click();
  await expect(star.getByText('已看 3 集', { exact: true })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  const file = await (await downloaded).path();
  const exported = JSON.parse(await readFile(file!, 'utf8'));
  expect(exported).toMatchObject({ version: 2, favorites: ['bgm:1', 'bd:orphan'], records: [{ id: 'bgm:1', watched: 3, note: '补看记录' }], lists: backup.lists, memberships: backup.memberships });
});

test('记录写入失败时保留编辑草稿，重试后详情返回恢复追番筛选', async ({ page }) => {
  await page.clock.install({ time: now });
  await page.addInitScript(() => localStorage.setItem('anime-calendar:favorites:v1', '["bgm:1","bgm:2"]'));
  await page.goto('/#/favorites');
  await nav(page).getByRole('button', { name: '全部作品' }).click();
  const search = page.getByRole('searchbox', { name: '搜索追番作品' });
  await search.fill('星の旅');
  const sort = page.getByRole('combobox', { name: '追番排序', exact: true });
  await sort.click();
  await page.getByRole('listbox', { name: '追番排序', exact: true }).getByRole('option', { name: '作品标题', exact: true }).click();
  await page.getByRole('link', { name: '查看星旅详情' }).click();
  await page.getByRole('button', { name: '编辑追番记录' }).click();
  const editor = dialog(page, '编辑追番记录');
  await editor.getByLabel('备注', { exact: true }).fill('草稿不会丢失');
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      if (this.name === 'anime-calendar:watchlist' && mode === 'readwrite' && !sessionStorage.getItem('watchlist-test-write')) throw new DOMException('quota', 'QuotaExceededError');
      return original.call(this, stores, mode, options);
    };
  });
  await editor.getByRole('button', { name: '保存记录' }).click();
  await expect(editor.getByRole('alert')).toContainText('编辑内容已保留');
  await expect(editor.getByLabel('备注', { exact: true })).toHaveValue('草稿不会丢失');
  await page.evaluate(() => sessionStorage.setItem('watchlist-test-write', 'true'));
  await editor.getByRole('button', { name: '保存记录' }).click();
  await expect(editor).not.toBeVisible();
  await page.getByRole('link', { name: '返回我的追番' }).click();
  await expect(search).toHaveValue('星の旅');
  await expect(sort).toHaveText('作品标题');
  await expect(page.locator('.watch-library .watch-entry')).toHaveCount(1);
  await expect(page.getByText('草稿不会丢失', { exact: true })).toBeVisible();
});

test('追番排序菜单支持键盘选择、取消和点击外部关闭', async ({ page }) => {
  await page.clock.install({ time: now });
  await page.addInitScript(() => localStorage.setItem('anime-calendar:favorites:v1', '["bgm:1","bgm:2"]'));
  await page.goto('/#/favorites');
  await nav(page).getByRole('button', { name: '全部作品' }).click();

  const sort = page.getByRole('combobox', { name: '追番排序', exact: true });
  const options = page.getByRole('listbox', { name: '追番排序', exact: true });
  const latest = options.getByRole('option', { name: '最近记录', exact: true });
  const title = options.getByRole('option', { name: '作品标题', exact: true });
  const selected = page.getByRole('checkbox', { name: '选择星旅', exact: true });
  await selected.check();
  await sort.focus();
  await page.keyboard.press('Space');
  await expect(options).toBeVisible();
  await expect(sort).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('End');
  const titleId = await title.getAttribute('id');
  expect(titleId).toBeTruthy();
  await expect(sort).toHaveAttribute('aria-activedescendant', titleId!);
  await expect(latest).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(options).not.toBeVisible();
  await expect(sort).toBeFocused();
  await expect(sort).toHaveText('最近记录');

  await page.keyboard.press('ArrowDown');
  await expect(options).toBeVisible();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(options).not.toBeVisible();
  await expect(sort).toBeFocused();
  await expect(sort).toHaveText('作品标题');
  await expect(selected).toBeChecked();

  await sort.click();
  await expect(title).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('searchbox', { name: '搜索追番作品' }).click();
  await expect(options).not.toBeVisible();
  await expect(sort).toHaveText('作品标题');
  await page.getByRole('button', { name: '取消选择', exact: true }).click();
  await expect(page.getByRole('button', { name: '选择本页', exact: true })).toBeFocused();
  const search = page.getByRole('searchbox', { name: '搜索追番作品' });
  await search.fill('星旅');
  await expect(page.locator('.watch-library .watch-entry')).toHaveCount(1);
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await expect(page.locator('.watch-library .watch-entry')).toHaveCount(2);
});

test('追番列表分别按记录时间、收藏顺序和计划日期排序', async ({ page }) => {
  const favorites = ['bgm:1', 'bgm:2', 'bgm:3', 'bgm:4'];
  await page.clock.install({ time: now });
  await page.addInitScript(ids => localStorage.setItem('anime-calendar:favorites:v1', JSON.stringify(ids)), favorites);
  await page.goto('/#/favorites');
  await nav(page).getByRole('button', { name: '全部作品' }).click();

  const sort = page.getByRole('combobox', { name: '追番排序', exact: true });
  const options = page.getByRole('listbox', { name: '追番排序', exact: true });
  const choose = async (label: string) => {
    await sort.click();
    await options.getByRole('option', { name: label, exact: true }).click();
  };
  const order = () => page.locator('.watch-library .watch-entry').evaluateAll(rows => rows.map(row => row.getAttribute('data-anime-id')));
  const byAdded = [...favorites].reverse();
  await expect.poll(order).toEqual(byAdded);
  await expect(page.getByText('暂无追番记录，按最近加入排列')).toBeVisible();
  await choose('计划日期');
  await expect.poll(order).toEqual(byAdded);
  await expect(page.getByText('暂无计划日期，按最近加入排列')).toBeVisible();
  await choose('最近记录');
  await expect.poll(order).toEqual(byAdded);

  const defaults = { status: 'watching', watched: 1, personalScore: null, note: '', archived: false };
  const preview = await openBackup(page, {
    version: 2, exportedAt: now.toISOString(), favorites, lists: [], memberships: [], titles: [],
    records: [
      { ...defaults, id: 'bgm:1', updatedAt: '2026-10-26T12:00:00.000Z', plannedDate: '2026-11-04' },
      { ...defaults, id: 'bgm:2', updatedAt: '2026-10-28T12:00:00Z', plannedDate: '2026-10-30' },
      { ...defaults, id: 'bgm:3', updatedAt: '2026-10-28T12:00:00.500Z', plannedDate: null },
    ],
  });
  await preview.getByRole('button', { name: '合并导入' }).click();
  await expect(preview).not.toBeVisible();
  await expect.poll(order, { timeout: 1500 }).toEqual(['bgm:3', 'bgm:2', 'bgm:1', 'bgm:4']);
  await expect(page.getByText('最近编辑的记录优先')).toBeVisible();
  await choose('最近加入');
  await expect.poll(order).toEqual(byAdded);
  await choose('计划日期');
  await expect.poll(order).toEqual(['bgm:2', 'bgm:1', 'bgm:4', 'bgm:3']);
  await expect(page.getByText('计划日期从早到晚，未安排的排在后面')).toBeVisible();
});

test('加入清单以单选方式保存目标，作品只出现在所选清单', async ({ page }) => {
  await page.clock.install({ time: now });
  await page.goto('/#/favorites');
  const preview = await openBackup(page, {
    version: 2, exportedAt: now.toISOString(), favorites: ['bgm:1'], records: [], memberships: [], titles: [],
    lists: [
      { id: 'morning', name: '晨间清单', description: '', pinned: false, createdAt: now.toISOString() },
      { id: 'evening', name: '晚间清单', description: '', pinned: false, createdAt: now.toISOString() },
    ],
  });
  await preview.getByRole('button', { name: '合并导入' }).click();
  await expect(preview).not.toBeVisible();

  await nav(page).getByRole('button', { name: '待整理' }).click();
  await page.getByRole('checkbox', { name: '选择星旅', exact: true }).check();
  await page.getByRole('button', { name: '加入清单', exact: true }).click();
  const assign = dialog(page, '加入清单');
  const evening = assign.getByRole('radio', { name: '晚间清单' });
  const morning = assign.getByRole('radio', { name: '晨间清单' });
  await morning.check();
  await evening.check();
  await expect(morning).not.toBeChecked();
  await assign.getByRole('button', { name: '加入清单', exact: true }).click();
  await expect(assign).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '收藏已整理完毕' })).toBeVisible();

  await nav(page).getByRole('button', { name: '我的清单' }).click();
  const gallery = page.locator('.watch-list-gallery');
  await gallery.getByRole('button', { name: /^晚间清单/ }).click();
  await expect(page.locator('.watch-library .watch-entry[data-anime-id="bgm:1"]')).toBeVisible();
  await page.getByRole('button', { name: '我的清单', exact: true }).last().click();
  await gallery.getByRole('button', { name: /^晨间清单/ }).click();
  await expect(page.getByRole('heading', { name: '清单里还没有作品' })).toBeVisible();
});

test('近期排期保留未来七天的有效更新，追番列表区分完结和暂缺排期', async ({ page }) => {
  const anime = (id: number, title: string, anchor: string | null, frequency: AiringRule['frequency'] = 'weekly', end: string | null = null): Anime => {
    const rule: AiringRule = { anchor, frequency, end, raw: '' };
    return { id: `bgm:${id}`, bangumiId: id, title, originalTitle: title, aliases: [], type: 'tv', begin: '2026-10-01', season: '2026-4', officialSite: null, platforms: [], rule, broadcastRule: rule, sourceUrl: `https://bgm.tv/subject/${id}` };
  };
  const items = [
    anime(101, '收藏的日更作品', '2026-10-29T06:00:00Z', 'daily'),
    anime(102, '收藏的深夜作品', '2026-11-02T15:30:00Z'),
    anime(103, '未收藏作品', '2026-10-29T07:00:00Z'),
    anime(104, '已完结作品', '2026-10-22T09:00:00Z', 'weekly', '2026-10-22T09:00:00Z'),
    anime(105, '本次休播作品', '2026-10-29T10:00:00Z'),
    anime(106, '第八天更新的作品', '2026-11-04T16:00:00Z'),
    anime(107, '暂未排期作品', null, 'unknown'),
    anime(108, '不在播的旧作品', '2026-10-22T11:00:00Z'),
    anime(109, '今天已经播完的单次作品', '2026-10-29T01:00:00Z', 'once'),
    {
      ...anime(110, '已全季上线的网络作品', '2023-10-12T00:00:00Z'), type: 'web', begin: '2023-10-11T16:00:00Z', season: '2023-4',
      broadcastRule: { anchor: '2023-10-11T16:00:00Z', end: '2023-10-11T16:00:00Z', frequency: 'once', raw: '' },
    },
    anime(111, '完结集延期的作品', '2026-10-22T09:00:00Z', 'weekly', '2026-10-22T09:00:00Z'),
    anime(112, '结束日期仍在未来的作品', '2026-10-22T09:00:00Z', 'weekly', '2026-11-20T09:00:00Z'),
  ];
  const snapshot: CatalogSnapshot = {
    schemaVersion: 1, items, warnings: [], activeIds: ['bgm:101', 'bgm:102', 'bgm:103', 'bgm:105', 'bgm:106', 'bgm:107', 'bgm:109'],
    fetchedAt: { catalog: now.toISOString(), calendar: now.toISOString() },
    overrides: { version: 1, active: [], events: [
      { animeId: 'bgm:105', at: '2026-10-29T10:00:00Z', status: 'cancelled', sourceUrl: 'https://example.com/hiatus' },
      { animeId: 'bgm:111', at: '2026-11-20T09:00:00Z', originalAt: '2026-10-22T09:00:00Z', status: 'scheduled', sourceUrl: 'https://example.com/rescheduled-finale' },
    ] },
  };
  const favorites = items.filter(item => item.id !== 'bgm:103').map(item => item.id);
  await page.clock.install({ time: now });
  await page.addInitScript(ids => localStorage.setItem('anime-calendar:favorites:v1', JSON.stringify(ids)), favorites);
  await useCatalogFixture(page, snapshot);
  await page.goto('/#/favorites');
  const plan = page.getByRole('region', { name: '近期排期', exact: true });
  const rows = plan.locator('.watch-reference-grid .watch-entry');
  const headings = rows.getByRole('heading');
  await expect(headings).toHaveText(['收藏的日更作品', '收藏的深夜作品']);
  await expect(plan.getByRole('button', { name: '安排观看', exact: true })).toHaveCount(0);
  await expect(plan.getByRole('heading', { name: '我的计划', exact: true })).toHaveCount(0);
  await expect(plan.getByRole('heading', { name: '正在看', exact: true })).toHaveCount(0);
  await expect(rows.nth(1).locator('time')).toHaveText('23:30');
  await expect(plan.locator('.watch-plan-day').last().locator('h3 time')).toHaveAttribute('datetime', '2026-11-02');

  const record = { watched: null, personalScore: null, note: '', archived: false, updatedAt: now.toISOString() };
  const preview = await openBackup(page, {
    version: 2, exportedAt: now.toISOString(), favorites,
    records: [
      { ...record, id: 'bgm:101', status: 'completed', plannedDate: null },
      { ...record, id: 'bgm:104', status: 'watching', plannedDate: '2026-10-30' },
    ],
    lists: [], memberships: [], titles: [],
  });
  await preview.getByRole('button', { name: '合并导入' }).click();
  await expect(preview).not.toBeVisible();
  await expect(headings).toHaveText(['收藏的日更作品', '收藏的深夜作品']);

  await page.getByRole('combobox', { name: '显示时区' }).selectOption('Asia/Tokyo');
  await expect(rows.nth(1).locator('time')).toHaveText('00:30');
  await expect(plan.locator('.watch-plan-day').last().locator('h3 time')).toHaveAttribute('datetime', '2026-11-03');

  await nav(page).getByRole('button', { name: '全部作品', exact: true }).click();
  const card = (id: number) => page.locator(`.watch-library .watch-entry[data-anime-id="bgm:${id}"]`);
  await expect(card(104).getByText('已完结', { exact: true })).toBeVisible();
  await expect(card(104).getByText('在看', { exact: true })).toBeVisible();
  await expect(card(110).getByText('已完结', { exact: true })).toBeVisible();
  for (const id of [107, 108, 109, 111, 112]) {
    await expect(card(id).getByText('14天内暂无排期', { exact: true })).toBeVisible();
  }
});

test('短屏编辑可加减集数和清空日期，滚动备注时保存仍在视口内', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 420 });
  await page.clock.install({ time: now });
  await page.addInitScript(() => localStorage.setItem('anime-calendar:favorites:v1', '["bgm:1"]'));
  await page.goto('/#/anime/bgm:1');
  const open = page.getByRole('button', { name: '编辑追番记录' });
  await open.click();
  const editor = dialog(page, '编辑追番记录');
  const paused = editor.getByRole('radio', { name: '搁置', exact: true });
  await expect(editor.getByRole('radio', { name: '想看', exact: true })).toBeChecked();
  await paused.check();
  const watched = editor.getByLabel('已看集数', { exact: true });
  await editor.getByRole('button', { name: '已看集数加一' }).click();
  await expect(watched).toHaveValue('1');
  await editor.getByRole('button', { name: '已看集数减一' }).click();
  await expect(watched).toHaveValue('0');
  const date = editor.getByLabel('计划观看日期', { exact: true });
  await date.fill('2026-10-31');
  await editor.getByRole('button', { name: '清空计划日期' }).click();
  await expect(date).toHaveValue('');
  await expect(date).toBeFocused();
  await editor.getByLabel('备注', { exact: true }).fill('短屏记录');
  const save = editor.getByRole('button', { name: '保存记录' });
  await expect(save).toBeInViewport({ ratio: 1 });
  expect(await editor.evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(320);
  await save.click();
  await expect(editor).not.toBeVisible();
  await expect(open).toBeFocused();
  await open.click();
  await expect(paused).toBeChecked();
});

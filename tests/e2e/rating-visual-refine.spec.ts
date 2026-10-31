import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Anime, AnimeDetail, CatalogSnapshot } from '../../shared/types';
import type { RatingSummary } from '../../shared/scores';
import { useCatalogFixture } from '../support/catalog-view-fixture';

const stamp = '2026-10-29T04:00:00Z';
const ratedId = 'bgm:2', unratedId = 'bgm:4';
const longTitle = '这是用于检查番表评分与作品类型及改编标签不互相挤压的长标题动画作品'.repeat(2);
const ratings: RatingSummary = {
  score: 8.3, count: 4, fetchedAt: stamp,
  sources: [
    { provider: 'bangumi', score: 8, maxScore: 10, votes: 1234, url: 'https://bgm.tv/subject/2', fetchedAt: stamp, status: 'ready' },
    { provider: 'mal', score: 8.2, maxScore: 10, votes: 2345, url: 'https://myanimelist.net/anime/2', fetchedAt: stamp, status: 'ready' },
    { provider: 'filmarks', score: 4.2, maxScore: 5, votes: null, url: 'https://filmarks.com/animes/2/2', fetchedAt: stamp, status: 'ready' },
    { provider: 'anilist', score: 86, maxScore: 100, votes: 3456, url: 'https://anilist.co/anime/2', fetchedAt: stamp, status: 'ready' },
  ],
};

async function prepare(page: Page) {
  await page.clock.install({ time: new Date(stamp) });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const item = (id: string, title: string, type: Anime['type'], season: string, anchor: string): Anime => {
    const rule: Anime['rule'] = { anchor, frequency: 'weekly', raw: `R/${anchor}/P7D`, end: null };
    return {
      id, bangumiId: Number(id.split(':')[1]), title, originalTitle: title, aliases: [], type,
      begin: season === '2026-3' ? '2026-07-02T12:00:00Z' : '2026-10-01T12:30:00Z', season,
      officialSite: 'https://example.com', platforms: [], rule, broadcastRule: rule,
      sourceUrl: `https://bgm.tv/subject/${id.split(':')[1]}`,
      networkAiring: { platform: '测试平台', regions: ['JP'], begin: anchor, rule, sourceUrl: 'https://example.com' },
    };
  };
  const items = [
    item(ratedId, longTitle, 'web', '2026-3', '2026-10-29T12:00:00Z'),
    item(unratedId, '暂无评分的动画作品', 'tv', '2026-4', '2026-10-29T12:30:00Z'),
  ];
  const catalog: CatalogSnapshot = {
    schemaVersion: 1, schedulePolicy: 'streaming', items, activeIds: items.map(anime => anime.id),
    fetchedAt: { catalog: stamp, calendar: stamp }, warnings: [], overrides: { version: 1, active: [], events: [] },
  };
  await useCatalogFixture(page, catalog);
  await page.route('**/api/status', route => route.fulfill({ json: {
    appId: 'anime-calendar', version: '1.0.0', refreshing: false, hasCatalog: true,
    sources: { catalog: { fetchedAt: stamp, error: null }, calendar: { fetchedAt: stamp, error: null } }, warnings: [],
  } }));
  await page.route(/\/api\/anime\/[^/]+(?:\/(?:ratings|credits))?(?:\?.*)?$/, route => {
    const [, , , encodedId, endpoint] = new URL(route.request().url()).pathname.split('/');
    const id = decodeURIComponent(encodedId!), anime = items.find(item => item.id === id);
    if (!anime) return route.fulfill({ status: 404, json: { error: '固定样本没有该作品' } });
    if (endpoint === 'ratings') return route.fulfill({ json: {
      id, ...(id === ratedId ? ratings : { score: null, count: 0, fetchedAt: stamp, sources: [] }),
    } });
    if (endpoint === 'credits') return route.fulfill({ json: {
      staff: [], cast: [], sources: { staff: { fetchedAt: stamp, error: null }, cast: { fetchedAt: stamp, error: null } },
    } });
    const detail: AnimeDetail = {
      ...anime, summary: '固定离线样本的作品简介。', image: null, episodes: 12,
      tags: id === ratedId ? ['小说改'] : [], adaptation: id === ratedId ? '小说改' : null,
      staff: [], rating: null, detailFetchedAt: stamp, detailError: null,
    };
    return route.fulfill({ json: detail });
  });
}

async function expectCleanBadge(badge: Locator, card = false) {
  await expect(badge).toBeVisible();
  await expect(badge.locator('.rating-badge-score')).toHaveText('8.3');
  await expect(badge).toHaveAttribute('aria-label', '综合评分 8.3 / 10');
  await expect(badge).toHaveAttribute('title', '综合评分 8.3 / 10');
  await expect(badge.locator('.rating-source-count')).toHaveCount(0);
  await expect(badge).not.toContainText(/\d\s*\/\s*4/);
  if (card) {
    await expect(badge).toHaveText('8.3');
    await expect(badge.locator('svg')).toHaveCount(1);
  }
}

test('评分精修：主视觉、番表与海报只保留真实分数，详情仍有四站评分', async ({ page }) => {
  await prepare(page);
  await page.goto('/#/weekly');
  await expectCleanBadge(page.locator('.hero-work:not([inert]) .rating-badge'));
  await expectCleanBadge(page.locator(`.weekly-grid [data-anime-id="${ratedId}"] .card-rating`), true);
  const poster = page.locator(`.today-posters [data-anime-id="${ratedId}"]`);
  await poster.scrollIntoViewIfNeeded();
  await expectCleanBadge(poster.locator('.card-rating'), true);
  await poster.locator('.anime-link').click();
  await expectCleanBadge(page.locator('.detail-rating-row .rating-badge'));
  const panel = page.getByRole('region', { name: '作品评分', exact: true });
  await expect(panel.locator('.rating-source')).toHaveCount(4);
  await expect(panel.locator('[data-provider="bangumi"] .rating-source-score')).toHaveText('8.0 / 10');
  await expect(panel.locator('[data-provider="mal"] .rating-source-score')).toHaveText('8.2 / 10');
  await expect(panel.locator('[data-provider="filmarks"] .rating-source-score')).toHaveText('4.2 / 5');
  await expect(panel.locator('[data-provider="anilist"] .rating-source-score')).toHaveText('86 / 100');
  await expect(panel.locator('[data-provider="mal"]')).toContainText('2,345 人评分');
  await expect(panel.locator('[data-provider="filmarks"]')).toContainText('评分人数暂缺');
});

test('评分精修：无评分的卡片不出现假零分，详情保留无分状态', async ({ page }) => {
  await prepare(page);
  await page.goto('/#/weekly');
  const cards = page.locator(`.anime-card[data-anime-id="${unratedId}"]`);
  await expect(cards).toHaveCount(2);
  await expect(cards.first().locator('h3')).toHaveText('暂无评分的动画作品');
  await expect(cards.locator('.rating-badge')).toHaveCount(0);
  await page.goto(`/#/anime/${unratedId}`);
  const badge = page.locator('.detail-rating-row .rating-badge');
  await expect(badge).toHaveAttribute('aria-label', '暂无综合评分');
  await expect(badge).toHaveAttribute('title', '暂无综合评分');
  await expect(badge.locator('.rating-badge-score')).toHaveText('—');
  await expect(badge).not.toContainText('0.0');
  await expect(badge.locator('.rating-source-count')).toHaveCount(0);
});

for (const [layout, name] of [['columns', '竖列'], ['rows', '横排']] as const) {
  test(`评分精修：${name}番表的长标题、类型、改编、续播与时间评分各自完整`, async ({ page }, info) => {
    await prepare(page);
    for (const width of info.project.name === 'mobile' ? [390] : [1200, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/#/weekly');
      await page.getByRole('button', { name: `${name}番表`, exact: true }).click();
      await expect(page.locator('.weekly-grid')).toHaveAttribute('data-layout', layout);
      const card = page.locator(`.weekly-grid [data-anime-id="${ratedId}"]`);
      await card.scrollIntoViewIfNeeded();
      await expect(card.locator('h3')).toHaveAttribute('title', longTitle);
      await expect(card.locator('.card-tags > span').first()).toHaveText('WEB');
      await expect(card.locator('.card-adaptation')).toHaveText('小说改');
      await expect(card.locator('.continuing')).toHaveText('续播');
      await expectCleanBadge(card.locator('.event-time .compact-rating'), true);
      await expect(card.locator('.card-tags .rating-badge')).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      const geometry = await card.evaluate(element => {
        const bounds = (selector: string) => element.querySelector(selector)!.getBoundingClientRect().toJSON();
        const tags = element.querySelector<HTMLElement>('.card-tags')!;
        return {
          card: element.getBoundingClientRect().toJSON(),
          boxes: ['h3', '.card-tags', '.card-tags > span:first-child', '.card-adaptation', '.continuing', '.event-time time', '.compact-rating', '.save-card'].map(selector => ({ selector, ...bounds(selector) })),
          tags: [...tags.children].map(tag => tag.getBoundingClientRect().toJSON()),
          tagsOverflow: tags.scrollWidth > tags.clientWidth + 1,
          typeLineHeight: getComputedStyle(tags.firstElementChild!).lineHeight,
          adaptationLineHeight: getComputedStyle(element.querySelector('.card-adaptation')!).lineHeight,
          time: bounds('.event-time time'), score: bounds('.compact-rating'), save: bounds('.save-card'),
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      const label = `${width}px ${name}`;
      expect(geometry.pageOverflow, `${label} 页面不横向溢出`).toBe(false);
      expect(geometry.tagsOverflow, `${label} 元信息不溢出`).toBe(false);
      expect(geometry.typeLineHeight, `${label} 类型与改编标签使用一致行高`).toBe(geometry.adaptationLineHeight);
      for (const box of geometry.boxes) {
        expect(box.width, `${label} ${box.selector} 有可读宽度`).toBeGreaterThan(0);
        expect(box.left, `${label} ${box.selector} 不越出卡片左边`).toBeGreaterThanOrEqual(geometry.card.left - 1);
        expect(box.right, `${label} ${box.selector} 不越出卡片右边`).toBeLessThanOrEqual(geometry.card.right + 1);
        expect(box.top, `${label} ${box.selector} 不越出卡片顶部`).toBeGreaterThanOrEqual(geometry.card.top - 1);
        expect(box.bottom, `${label} ${box.selector} 不越出卡片底部`).toBeLessThanOrEqual(geometry.card.bottom + 1);
      }
      for (let index = 0; index < geometry.tags.length; index++) for (const other of geometry.tags.slice(index + 1)) {
        const tag = geometry.tags[index]!;
        const overlap = Math.min(tag.right, other.right) - Math.max(tag.left, other.left) > 1 && Math.min(tag.bottom, other.bottom) - Math.max(tag.top, other.top) > 1;
        expect(overlap, `${label} 类型、改编和续播标签互不重叠`).toBe(false);
      }
      expect(geometry.score.left, `${label} 评分位于时间右侧`).toBeGreaterThanOrEqual(geometry.time.right);
      expect(geometry.score.right, `${label} 评分为收藏按钮留出位置`).toBeLessThanOrEqual(geometry.save.left);
      expect(Math.min(geometry.time.bottom, geometry.score.bottom) - Math.max(geometry.time.top, geometry.score.top), `${label} 时间与评分在同一栏`).toBeGreaterThan(0);
      for (const tag of geometry.tags) {
        const overlap = Math.min(tag.right, geometry.score.right) - Math.max(tag.left, geometry.score.left) > 1 && Math.min(tag.bottom, geometry.score.bottom) - Math.max(tag.top, geometry.score.top) > 1;
        expect(overlap, `${label} 标签与评分互不重叠`).toBe(false);
      }
    }
  });
}

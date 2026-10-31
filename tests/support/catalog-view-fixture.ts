import type { Page } from '@playwright/test';
import type { AppStatus, CatalogScope, CatalogSnapshot, CatalogView } from '../../shared/types';
import { STREAMING_ACCESS_POLICY } from '../../shared/airing-policy';

/** Wire fixture for existing visual/error scenarios; these tests assert literal UI outcomes. */
export function catalogViewFixture(url: string, catalog: CatalogSnapshot, status?: AppStatus): CatalogView {
  const parsed = new URL(url), type = parsed.pathname.split('/').at(-1);
  let scope: CatalogScope;
  if (type === 'weekly') {
    const week = parsed.searchParams.get('week')!, timezone = parsed.searchParams.get('timezone') === 'Asia/Tokyo' ? 'Asia/Tokyo' : 'Asia/Shanghai';
    const season = parsed.searchParams.get('season') ?? '2026-4';
    scope = { type, week, timezone, season, key: `weekly:${week}:${timezone}:${season}` };
  } else if (type === 'season') { const season = parsed.searchParams.get('season')!; scope = { type, season, key: `season:${season}` }; }
  else { const ids = [...new Set((parsed.searchParams.get('ids') ?? '').split(',').filter(Boolean))].sort(); scope = { type: 'items', ids, key: `items:${ids.join(',')}` }; }
  const counts = new Map<string, number>(); for (const item of catalog.items) counts.set(item.season, (counts.get(item.season) ?? 0) + 1);
  const view: CatalogView = {
    schemaVersion: 1, scope, revision: 'fixed-test-catalog', catalog: { schedulePolicy: 'streaming', streamingAccessPolicy: STREAMING_ACCESS_POLICY, ...catalog },
    seasons: [...counts].map(([season, total]) => ({ season, total })),
    status: status ?? { appId: 'anime-calendar', version: '1.0.0', refreshing: false, hasCatalog: true, sources: { catalog: { fetchedAt: catalog.fetchedAt.catalog, error: null }, calendar: { fetchedAt: catalog.fetchedAt.calendar, error: null } }, warnings: catalog.warnings },
  };
  if (scope.type === 'items') view.missingIds = scope.ids.filter(id => !catalog.items.some(item => item.id === id));
  return view;
}
export async function clearAccelerationCache(page: Page) {
  await page.addInitScript(() => {
    if (!globalThis.caches) return;
    const storage = caches, open = storage.open.bind(storage);
    const cleared = storage.keys().then(names => Promise.all(names.filter(name => /^anime-calendar:(views|details|ratings):/.test(name)).map(name => storage.delete(name))));
    storage.open = async name => { await cleared; return open(name); };
  });
  await page.evaluate(async () => {
    if (!location.href.startsWith('http') || !globalThis.caches) return;
    for (const name of await caches.keys()) if (/^anime-calendar:(views|details|ratings):/.test(name)) await caches.delete(name);
  });
}
export async function useCatalogFixture(page: Page, catalog: CatalogSnapshot, before?: () => void | Promise<void>) {
  await clearAccelerationCache(page);
  await page.route('**/api/catalog/**', async route => {
    await before?.();
    await route.fulfill({ json: catalogViewFixture(route.request().url(), catalog) }).catch(() => {});
  });
}

import { describe, expect, it, vi } from 'vitest';
import type { Anime, CatalogView, Overrides } from '../shared/types';
import type { CatalogRequest } from '../src/catalog-requests';
import { createWatchCatalog, watchDisplayDays, watchReferenceEvents, watchWeekRequests } from '../src/watchlist/catalog';

function anime(id: string, anchor: string | null = null): Anime {
  const rule = { anchor, frequency: anchor ? 'once' as const : 'unknown' as const, raw: anchor ?? '', end: null };
  return {
    id, bangumiId: Number(id.split(':')[1]), title: `作品 ${id}`, originalTitle: `原題 ${id}`,
    aliases: [`别名 ${id}`], type: 'tv', begin: '2026-10-01', season: '2026-4', officialSite: null,
    platforms: [], sourceUrl: 'https://example.com', rule, broadcastRule: rule,
  };
}

function view(request: CatalogRequest, items: Anime[], missingIds: string[] = [], events: Overrides['events'] = []): CatalogView {
  return {
    schemaVersion: 1, scope: request.scope, revision: 'fixture', seasons: [], missingIds,
    status: { appId: 'anime-calendar', version: '1.0.0', refreshing: false, hasCatalog: true, warnings: [], sources: { catalog: { fetchedAt: null, error: null }, calendar: { fetchedAt: null, error: null } } },
    catalog: { schemaVersion: 1, items, warnings: [], activeIds: [], fetchedAt: { catalog: null, calendar: null }, overrides: { version: 1, active: [], rules: [], events } },
  };
}

function ids(request: CatalogRequest) {
  if (request.scope.type !== 'items') throw new Error('Expected an items scope');
  return request.scope.ids;
}

describe('追番目录分批补齐', () => {
  it('3000 部先查当前页，每批最多 50、同时最多两批，翻页不重复整库', async () => {
    const requested: string[][] = [];
    let inflight = 0, peak = 0;
    const titles = Array.from({ length: 3000 }, (_, index) => `bgm:${index + 1}`);
    const catalog = createWatchCatalog({ load: async request => {
      const chunk = ids(request);
      requested.push(chunk);
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise(resolve => setTimeout(resolve, 0));
      inflight--;
      return view(request, chunk.map(id => anime(id)));
    }, onTitles: () => {} });
    catalog.prioritize(titles.slice(-24));
    catalog.activate(titles);
    await vi.waitFor(() => expect(catalog.indexing.value).toBe(false), { interval: 10 });
    expect(requested[0]).toEqual(titles.slice(-24).sort());
    expect(requested.every(chunk => chunk.length <= 50)).toBe(true);
    expect(peak).toBe(2);
    expect(requested.flat()).toHaveLength(3000);
    expect(catalog.titles.get('bgm:3000')?.aliases).toEqual(['别名 bgm:3000']);
    catalog.activate([...titles]);
    catalog.prioritize(titles.slice(72, 96));
    await Promise.resolve();
    expect(requested.flat()).toHaveLength(3000);
    catalog.dispose();
  });

  it('快照优先显示，区分明确失联和读取失败，显式重试保留快照', async () => {
    let attempts = 0, offline = true;
    const catalog = createWatchCatalog({ load: async request => {
      attempts++;
      if (offline) throw new Error('offline');
      return view(request, ids(request).includes('bgm:1') ? [anime('bgm:1')] : [], ids(request).includes('bgm:2') ? ['bgm:2'] : []);
    }, onTitles: () => {} });
    catalog.seed([{ id: 'bgm:1', title: '旧标题', originalTitle: '旧原题', aliases: [], season: '2026-4', type: 'tv', episodes: 12 }]);
    catalog.activate(['bgm:1', 'bgm:2'], ['bgm:1', 'bgm:2']);
    expect(catalog.titles.get('bgm:1')?.title).toBe('旧标题');
    await vi.waitFor(() => expect(catalog.failed.size).toBe(2));
    expect(catalog.missing.size).toBe(0);
    catalog.prioritize(['bgm:2']);
    await Promise.resolve();
    expect(attempts).toBe(1);
    offline = false;
    catalog.refresh();
    await vi.waitFor(() => expect(catalog.indexing.value).toBe(false));
    expect([...catalog.missing]).toEqual(['bgm:2']);
    expect(catalog.failed.size).toBe(0);
    expect(catalog.titles.get('bgm:1')).toMatchObject({ title: '作品 bgm:1', episodes: 12 });
    catalog.seed([{ id: 'bgm:1', title: '旧标题', originalTitle: '旧原题', aliases: [], season: '2026-4', type: 'tv', episodes: 13 }]);
    expect(catalog.titles.get('bgm:1')).toMatchObject({ title: '作品 bgm:1', episodes: 13 });
    offline = true;
    catalog.refresh(['bgm:2']);
    await vi.waitFor(() => expect(catalog.indexing.value).toBe(false));
    expect(catalog.missing.has('bgm:2')).toBe(false);
    expect(catalog.failed.has('bgm:2')).toBe(true);
    catalog.dispose();
  });

  it('单条无效目录资料不会中断同批其他作品', async () => {
    const catalog = createWatchCatalog({ load: async request => view(request, [
      { ...anime('bgm:1'), season: 'incorrect' }, anime('bgm:2'),
    ]), onTitles: () => {} });
    catalog.activate(['bgm:1', 'bgm:2']);
    await vi.waitFor(() => expect(catalog.indexing.value).toBe(false));
    expect([...catalog.failed]).toEqual(['bgm:1']);
    expect(catalog.titles.get('bgm:2')?.title).toBe('作品 bgm:2');
    catalog.dispose();
  });

  it('离开时取消在途批次，迟到响应不能修改当前收藏目录', async () => {
    const callbacks: Array<{ signal: AbortSignal; finish: () => void }> = [];
    const catalog = createWatchCatalog({ load: (request, signal) => new Promise(resolve => {
      callbacks.push({ signal, finish: () => resolve(view(request, ids(request).map(id => anime(id)))) });
    }), onTitles: () => {} });
    catalog.activate(['bgm:1']);
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
    catalog.deactivate();
    expect(callbacks[0]!.signal.aborted).toBe(true);
    catalog.activate(['bgm:2']);
    await vi.waitFor(() => expect(callbacks).toHaveLength(2));
    callbacks[0]!.finish();
    callbacks[1]!.finish();
    await vi.waitFor(() => expect(catalog.indexing.value).toBe(false));
    expect([...catalog.titles.keys()]).toEqual(['bgm:2']);
    catalog.dispose();
  });
});

describe('追番七天参考放送', () => {
  it('以选择的时区算七个显示日并只请求覆盖这些日期的周表', () => {
    const now = '2026-11-01T15:30:00.000Z';
    expect(watchDisplayDays(now, 'Asia/Shanghai')).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
    expect(watchWeekRequests(now, 'Asia/Shanghai').map(request => request.scope.key)).toEqual([
      'weekly:2026-10-26:Asia/Shanghai:2026-4', 'weekly:2026-11-02:Asia/Shanghai:2026-4',
    ]);
    expect(watchWeekRequests(now, 'Asia/Tokyo').map(request => request.scope.key)).toEqual(['weekly:2026-11-02:Asia/Tokyo:2026-4']);
    expect(watchWeekRequests(now, 'Asia/Shanghai', 14).map(request => request.scope.key)).toEqual([
      'weekly:2026-10-26:Asia/Shanghai:2026-4', 'weekly:2026-11-02:Asia/Shanghai:2026-4', 'weekly:2026-11-09:Asia/Shanghai:2026-4',
    ]);
    expect(watchWeekRequests('2026-09-28T01:00:00.000Z', 'Asia/Shanghai').map(request => request.scope.key)).toEqual([
      'weekly:2026-09-28:Asia/Shanghai:2026-3',
    ]);
  });

  it('排除过去、窗外和休播，保留每部下一次有效配信', () => {
    const now = '2026-11-01T15:30:00.000Z', zone = 'Asia/Shanghai';
    const requests = watchWeekRequests(now, zone);
    const overrides: Overrides['events'] = [
      { animeId: 'bgm:1', at: '2026-11-01T15:40:00Z', status: 'cancelled', sourceUrl: 'https://example.com/notice' },
      { animeId: 'bgm:1', at: '2026-11-02T11:00:00Z', status: 'scheduled', sourceUrl: 'https://example.com/change' },
    ];
    const first = view(requests[0]!, [anime('bgm:1', '2026-11-01T15:40:00.000Z'), anime('bgm:2', '2026-11-01T15:29:00.000Z')], [], overrides);
    const second = view(requests[1]!, [anime('bgm:1', '2026-11-02T14:00:00.000Z'), anime('bgm:3', '2026-11-07T16:00:00.000Z'), anime('bgm:4', '2026-11-07T15:59:00.000Z')], [], overrides);
    const events = watchReferenceEvents([second, first], now, zone);
    expect([...events].map(([id, event]) => [id, event.at])).toEqual([
      ['bgm:1', '2026-11-02T11:00:00.000Z'], ['bgm:4', '2026-11-07T15:59:00.000Z'],
    ]);
    const third = view(watchWeekRequests(now, zone, 14)[2]!, [anime('bgm:5', '2026-11-09T14:00:00.000Z')]);
    expect([...watchReferenceEvents([first, second, third], now, zone, 14).keys()]).toEqual(['bgm:1', 'bgm:4', 'bgm:3', 'bgm:5']);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRenderer } from 'vue';
import { createAppState, type AppState } from '../src/state';
import { normalizeCatalog } from '../server/normalize';
import { summarizeRatings } from '../shared/scores';
import { rawCatalog } from './fixtures';
import type { CatalogView } from '../shared/types';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
const links = { mal: 61987, aniList: 195516 };
const summary = (linked: boolean) => ({ id: 'bgm:1', ...summarizeRatings([
  { provider: 'bangumi', score: 7.3, maxScore: 10, votes: 635, url: 'https://bgm.tv/subject/1', fetchedAt: new Date().toISOString(), status: 'ready' },
  { provider: 'mal', score: linked ? 8.64 : null, maxScore: 10, votes: linked ? 16259 : null, url: linked ? `https://myanimelist.net/anime/${links.mal}` : null, fetchedAt: linked ? new Date().toISOString() : null, status: linked ? 'ready' : 'unlinked' },
  { provider: 'anilist', score: linked ? 85 : null, maxScore: 100, votes: linked ? 4902 : null, url: linked ? `https://anilist.co/anime/${links.aniList}` : null, fetchedAt: linked ? new Date().toISOString() : null, status: linked ? 'ready' : 'unlinked' },
]) });
function view(linked: boolean): CatalogView {
  const base = normalizeCatalog(rawCatalog), at = new Date().toISOString();
  if (linked) base.items[0]!.externalIds = links;
  return { schemaVersion: 1, scope: { type: 'season', season: '2026-4', key: 'season:2026-4' }, revision: linked ? 'linked' : 'old', seasons: [{ season: '2026-4', total: 2 }], status: { appId: 'anime-calendar', version: '1.0.0', refreshing: false, hasCatalog: true, warnings: [], sources: { catalog: { fetchedAt: at, error: null }, calendar: { fetchedAt: at, error: null } } }, catalog: { ...base, schemaVersion: 1, schedulePolicy: 'streaming', streamingAccessPolicy: 'exclude-member-advance-v1', activeIds: ['bgm:1'], fetchedAt: { catalog: at, calendar: at }, overrides: { version: 1, active: [], events: [] } } };
}
function storage() {
  const stores = new Map<string, Map<string, Response>>();
  return { stores, open: async (name: string) => {
    const entries = stores.get(name) ?? new Map<string, Response>(); stores.set(name, entries);
    return { match: async (key: Request) => entries.get(key.url)?.clone(), put: async (key: Request, value: Response) => { entries.set(key.url, value.clone()); }, delete: async (key: Request) => entries.delete(key.url), keys: async () => [...entries.keys()].map(url => new Request(url)) };
  } };
}
function setup() {
  const io = storage(), values = new Map<string, string>();
  const browserStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  vi.stubGlobal('window', { localStorage: browserStorage, sessionStorage: browserStorage, location: { hash: '#/season/2026/4' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('document', { documentElement: { dataset: {} }, querySelector: () => null });
  vi.stubGlobal('location', { origin: 'http://127.0.0.1' }); vi.stubGlobal('caches', io);
  const renderer = createRenderer<Record<string, unknown>, Record<string, unknown>>({ patchProp() {}, insert() {}, remove() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null });
  let state!: AppState;
  const app = renderer.createApp({ setup() { state = createAppState(); return () => null; } });
  app.mount({}); cleanups.push(() => app.unmount());
  return { state, io };
}

describe('常规网络排期的页面缓存隔离', () => {
  it('已标记常规排期的持久缓存，在断网时仍能恢复', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { state, io } = setup(), current = view(false);
    const cached = await io.open('anime-calendar:views:v1');
    await cached.put(new Request('http://127.0.0.1/__anime_calendar_cache__/v1/views/season%3A2026-4'), Response.json({ schemaVersion: 1, savedAt: Date.now(), etag: '"regular"', data: current }));
    await state.loadPage('#/season/2026/4');
    expect(state.catalog.value?.items[0]?.id).toBe('bgm:1');
    await vi.waitFor(() => expect(state.viewError.value).toContain('重试'));
  });
  it('已有 streaming 标记但缺少常规排期政策的持久缓存，在断网时不能恢复', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { state, io } = setup(), legacy = view(false);
    delete legacy.catalog!.streamingAccessPolicy;
    legacy.catalog!.items[0]!.title = '旧会员抢先排期不能展示';
    const cached = await io.open('anime-calendar:views:v1');
    const key = new Request('http://127.0.0.1/__anime_calendar_cache__/v1/views/season%3A2026-4');
    await cached.put(key, Response.json({ schemaVersion: 1, savedAt: Date.now(), etag: '"legacy-member"', data: legacy }));
    await state.loadPage('#/season/2026/4');
    expect(state.catalog.value).toBeNull();
    expect(state.loading.value).toBe(false);
    expect(state.viewError.value).toContain('重试');
    expect(await cached.match(key)).toBeUndefined();
  });
  it('缺少常规排期政策的新响应不能重新展示旧会员排期', async () => {
    const legacy = view(false); delete legacy.catalog!.streamingAccessPolicy;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(legacy)));
    const { state } = setup(); await state.loadPage('#/season/2026/4');
    expect(state.catalog.value).toBeNull();
    expect(state.viewError.value).toContain('格式无效');
  });
});

describe('评分关联变化后的页面缓存', () => {
  it('同标签页原未关联评分不会在目录补齐ID后被24小时内存缓存锁住', async () => {
    let linked = false, calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/catalog/season') ? Response.json(view(linked)) : (calls++, Response.json(summary(linked)))));
    const { state } = setup(); await state.loadPage('#/season/2026/4'); await state.loadRatings('bgm:1');
    expect(state.ratingSummaries.get('bgm:1')?.count).toBe(1); expect(calls).toBe(1);
    linked = true; await state.loadPage('#/season/2026/4', true);
    await vi.waitFor(() => expect(state.ratingSummaries.get('bgm:1')?.count).toBe(3)); expect(calls).toBe(2);
  });
  it('目录补齐ID后在途旧响应不能覆盖新评分，旧收尾也不能清除新加载状态', async () => {
    let linked = false, calls = 0, old!: (response: Response) => void, latest!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/catalog/season') ? Response.json(view(linked)) : new Promise<Response>(resolve => { if (++calls === 1) old = resolve; else latest = resolve; })));
    const { state } = setup(); await state.loadPage('#/season/2026/4'); const first = state.loadRatings('bgm:1');
    await vi.waitFor(() => expect(old).toBeTypeOf('function'));
    linked = true; await state.loadPage('#/season/2026/4', true); await vi.waitFor(() => expect(latest).toBeTypeOf('function'));
    old(Response.json(summary(false))); await first;
    expect(state.ratingSummaries.has('bgm:1')).toBe(false); expect(state.ratingsLoading.has('bgm:1')).toBe(true);
    const reused = state.loadRatings('bgm:1'); expect(calls).toBe(2);
    latest(Response.json(summary(true))); await reused;
    expect(state.ratingSummaries.get('bgm:1')?.count).toBe(3); expect(state.ratingsLoading.has('bgm:1')).toBe(false); expect(state.ratingErrors.has('bgm:1')).toBe(false);
  });
  it('旧持久评分的未关联来源与当前目录冲突时不作为当前评分恢复', async () => {
    let reply!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/catalog/season') ? Response.json(view(true)) : new Promise<Response>(resolve => { reply = resolve; })));
    const { state, io } = setup();
    const cached = await io.open('anime-calendar:ratings:v1');
    await cached.put(new Request('http://127.0.0.1/__anime_calendar_cache__/v1/ratings/bgm%3A1'), Response.json({ schemaVersion: 1, savedAt: Date.now(), etag: null, data: summary(false) }));
    await state.loadPage('#/season/2026/4'); const task = state.loadRatings('bgm:1'); await vi.waitFor(() => expect(reply).toBeTypeOf('function'));
    expect(state.ratingSummaries.has('bgm:1')).toBe(false);
    reply(Response.json(summary(true))); await task; expect(state.ratingSummaries.get('bgm:1')?.count).toBe(3);
  });
});

describe('首页按需评分自动确认', () => {
  const waiting = (retryAfterMs?: number) => ({ id: 'bgm:1', ...summarizeRatings(summary(true).sources.map(source => source.provider === 'bangumi' ? source : { ...source, score: null, votes: null, fetchedAt: null, status: 'unavailable' as const })), ...(retryAfterMs ? { retryAfterMs } : { revalidating: true }) });
  it('可见卡片触发详情时，评分不必等待元数据返回', async () => {
    let release!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/catalog/season') ? Response.json(view(true)) : String(input).includes('/ratings') ? Response.json(summary(true)) : new Promise<Response>(resolve => { release = resolve; })));
    const { state } = setup(); await state.loadPage('#/season/2026/4'); const task = state.loadDetail('bgm:1');
    try { await vi.waitFor(() => expect(state.ratingSummaries.get('bgm:1')?.count).toBe(3)); expect(state.detailLoading.has('bgm:1')).toBe(true); }
    finally { if (release) release(Response.json({ ...view(true).catalog!.items[0]!, summary: '', image: null, episodes: null, tags: [], staff: [], rating: null, detailFetchedAt: new Date().toISOString(), detailError: null })); await task; }
  });
  it('排队满但没有实际更新任务时，按提示退避并在同页补齐评分', async () => {
    vi.useFakeTimers(); let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/catalog/season') ? Response.json(view(true)) : Response.json(++calls === 1 ? waiting(1000) : summary(true))));
    const { state } = setup(); await state.loadPage('#/season/2026/4'); const task = state.loadRatings('bgm:1');
    await vi.advanceTimersByTimeAsync(1); expect(state.ratingsLoading.has('bgm:1')).toBe(true); expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(998); expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(2); await task; expect(state.ratingSummaries.get('bgm:1')?.count).toBe(3); expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000); expect(calls).toBe(2);
  });
  it('排队超过旧四轮确认后仍在本次有界窗口内继续补齐', async () => {
    vi.useFakeTimers(); let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/catalog/season')) return Response.json(view(true));
      const round = ++calls; if (round > 1) await new Promise(resolve => setTimeout(resolve, 14_000));
      return Response.json(round <= 5 ? waiting() : summary(true));
    }));
    const { state } = setup(); await state.loadPage('#/season/2026/4'); const task = state.loadRatings('bgm:1');
    await vi.advanceTimersByTimeAsync(70_010); await task;
    expect(state.ratingSummaries.get('bgm:1')?.count).toBe(3); expect(calls).toBe(6);
  });
  it('超出本次确认预算的冷却不会提前重试或无限等待', async () => {
    vi.useFakeTimers(); let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/catalog/season') ? Response.json(view(true)) : (calls++, Response.json(waiting(300_000)))));
    const { state } = setup(); await state.loadPage('#/season/2026/4'); const task = state.loadRatings('bgm:1');
    await vi.advanceTimersByTimeAsync(180_010); await task; expect(calls).toBe(1); expect(state.ratingsLoading.has('bgm:1')).toBe(false);
  });
  it('来源一直处理中也在三分钟内结束，快速响应不会忙轮询', async () => {
    vi.useFakeTimers(); let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/catalog/season') ? Response.json(view(true)) : (calls++, Response.json(waiting()))));
    const { state } = setup(); await state.loadPage('#/season/2026/4'); const task = state.loadRatings('bgm:1');
    await vi.advanceTimersByTimeAsync(180_010); await task;
    expect(state.ratingsLoading.has('bgm:1')).toBe(false); expect(calls).toBeGreaterThan(4); expect(calls).toBeLessThanOrEqual(182);
    const stopped = calls; await vi.advanceTimersByTimeAsync(60_000); expect(calls).toBe(stopped);
  });
  it('离开当前页面会结束退避等待，不再为旧页面继续确认', async () => {
    vi.useFakeTimers(); let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/catalog/season')) return Response.json(view(true));
      if (String(input).includes('/catalog/items')) { const data = view(true); return Response.json({ ...data, scope: { type: 'items', ids: [], key: 'items:' }, catalog: { ...data.catalog, items: [] }, missingIds: [] }); }
      calls++; return Response.json(waiting(60_000));
    }));
    const { state } = setup(); await state.loadPage('#/season/2026/4'); const task = state.loadRatings('bgm:1');
    await vi.advanceTimersByTimeAsync(1); await state.loadPage('#/favorites'); await vi.advanceTimersByTimeAsync(180_000); await task;
    expect(calls).toBe(1); expect(state.ratingsLoading.has('bgm:1')).toBe(false);
  });
  it('切到已有缓存详情时不会复用路由切换刚取消的首页确认任务', async () => {
    vi.useFakeTimers(); let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/catalog/season')) return Response.json(view(true));
      if (String(input).includes('/catalog/items')) return Response.json({ ...view(true), scope: { type: 'items', ids: ['bgm:1'], key: 'items:bgm:1' }, missingIds: [] });
      if (String(input).includes('/ratings')) return Response.json(++calls === 1 ? waiting(60_000) : summary(true));
      return Response.json({ ...view(true).catalog!.items[0]!, summary: '', image: null, episodes: null, tags: [], staff: [], rating: null, detailFetchedAt: new Date().toISOString(), detailError: null });
    }));
    const { state } = setup(); await state.loadPage('#/season/2026/4'); await state.loadDetail('bgm:1');
    await vi.advanceTimersByTimeAsync(1); expect(state.ratingsLoading.has('bgm:1')).toBe(true);
    await state.loadPage('#/anime/bgm:1'); await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2); expect(state.ratingSummaries.get('bgm:1')?.count).toBe(3); expect(state.ratingsLoading.has('bgm:1')).toBe(false);
  });
});

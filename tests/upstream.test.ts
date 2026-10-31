import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpstreamClient } from '../server/upstream.js';

afterEach(() => vi.useRealTimers());
const result = () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
describe('共享上游调度', () => {
  it('GraphQL按POST正文去重，重试保留方法与正文，不把不同作品合并', async () => {
    const calls: { method: string | undefined; body: BodyInit | null | undefined }[] = [];
    const releases: (() => void)[] = [];
    const client = new UpstreamClient(async (_url, init) => {
      calls.push({ method: init?.method, body: init?.body });
      await new Promise<void>(resolve => { releases.push(resolve); });
      return result();
    });
    const first = client.request('https://graphql.example/', { method: 'POST', body: '{"id":1}' });
    const same = client.request('https://graphql.example/', { method: 'POST', body: '{"id":1}' });
    const other = client.request('https://graphql.example/', { method: 'POST', body: '{"id":2}' });
    expect(same).toBe(first); expect(other).not.toBe(first);
    releases.splice(0).forEach(resolve => resolve()); await Promise.all([first, same, other]);
    expect(calls).toEqual([{ method: 'POST', body: '{"id":1}' }, { method: 'POST', body: '{"id":2}' }]);
    await client.idle(); client.close();
  });
  it('合并同URL任务，所有类别合计四路且图片与后台各至多一路', async () => {
    let active = 0, images = 0, background = 0, peak = 0, imagePeak = 0, backgroundPeak = 0;
    const releases: (() => void)[] = [], calls: string[] = [];
    const client = new UpstreamClient(async (url, init) => {
      calls.push(url); active++; peak = Math.max(peak, active);
      const image = url.includes('image'), bg = url.includes('background');
      if (image) imagePeak = Math.max(imagePeak, ++images);
      if (bg) backgroundPeak = Math.max(backgroundPeak, ++background);
      await new Promise<void>(resolve => { releases.push(resolve); init?.signal?.addEventListener('abort', () => resolve(), { once: true }); });
      active--; if (image) images--; if (bg) background--;
      return result();
    });
    const first = client.request('https://example.com/image-a', { kind: 'image' });
    const same = client.request('https://example.com/image-a', { kind: 'image' });
    expect(first).toBe(same);
    const tasks = [first, same, client.request('https://example.com/image-b', { kind: 'image' }), client.request('https://example.com/background-a', { background: true }), client.request('https://example.com/background-b', { background: true }), client.request('https://example.com/metadata-a'), client.request('https://example.com/metadata-b')];
    for (let i = 0; i < 12; i++) { releases.splice(0).forEach(release => release()); await new Promise(resolve => setTimeout(resolve, 0)); }
    await Promise.all(tasks); expect(calls).toHaveLength(6); expect(peak).toBe(4); expect(imagePeak).toBe(1); expect(backgroundPeak).toBe(1);
    await client.idle(); expect(client.stats().queued).toBe(0);
  });
  it('排队时间计入总预算，超时任务不会在之后发出或泄漏名额', async () => {
    vi.useFakeTimers(); const release: (() => void)[] = [];
    const fetcher = vi.fn(async () => { await new Promise<void>(resolve => release.push(resolve)); return result(); });
    const client = new UpstreamClient(fetcher);
    const busy = Array.from({ length: 4 }, (_, id) => client.request(`https://example.com/busy-${id}`));
    const queued = client.request('https://example.com/queued', { timeoutMs: 50 });
    const rejected = expect(queued).rejects.toThrow(/超时/);
    await vi.advanceTimersByTimeAsync(51); await rejected; expect(fetcher).toHaveBeenCalledTimes(4);
    release.splice(0).forEach(fn => fn()); await Promise.all(busy); await client.idle(); expect(client.stats().active).toBe(0);
  });
  it('尊重Retry-After秒值和HTTP日期，不为长冷却占名额', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-30T00:00:00Z'));
    for (const retry of ['60', 'Fri, 30 Oct 2026 00:01:00 GMT']) {
      const fetcher = vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': retry } }));
      const client = new UpstreamClient(fetcher);
      await expect(client.request('https://example.com/limited', { timeoutMs: 5000 })).rejects.toMatchObject({ retryAt: Date.parse('2026-10-30T00:01:00Z') });
      await expect(client.request('https://example.com/other')).rejects.toThrow(/冷却|限流/);
      expect(fetcher).toHaveBeenCalledTimes(1); expect(client.stats().active).toBe(0);
    }
  });
  it('限制正文大小，关闭后拒绝新任务', async () => {
    const client = new UpstreamClient(async () => new Response('x'.repeat(101)));
    await expect(client.request('https://example.com/large', { maxBytes: 100 })).rejects.toThrow(/大小|过大/);
    client.close(); await expect(client.request('https://example.com/new')).rejects.toThrow(/关闭/);
  });
  it('128个排队资源以外快速失败，重复资源不额外占队列', async () => {
    const releases: (() => void)[] = [];
    const client = new UpstreamClient(async () => { await new Promise<void>(resolve => releases.push(resolve)); return result(); });
    const requests = Array.from({ length: 132 }, (_, id) => client.request(`https://example.com/${id}`));
    const tasks = requests.map(request => request.catch(error => error));
    expect(client.stats()).toEqual({ active: 4, queued: 128, images: 0, background: 0 });
    expect(client.request('https://example.com/131')).toBe(requests[131]);
    expect(client.stats().queued).toBe(128);
    await expect(client.request('https://example.com/overflow')).rejects.toMatchObject({ statusCode: 503 });
    client.close(); releases.forEach(release => release()); await Promise.all(tasks);
    await client.idle(); expect(client.stats()).toEqual({ active: 0, queued: 0, images: 0, background: 0 });
  });
  it('前台合并仅提升同一POST正文，不提升同URL的其他后台作品', async () => {
    const calls: string[] = [], releases: (() => void)[] = [];
    const client = new UpstreamClient(async (url, init) => {
      calls.push(init?.body ? String(init.body) : url);
      await new Promise<void>(resolve => releases.push(resolve)); return result();
    });
    const busy = Array.from({ length: 4 }, (_, id) => client.request(`https://example.com/busy-${id}`));
    const other = client.request('https://graphql.example/', { method: 'POST', body: '{"id":2}', background: true });
    const target = client.request('https://graphql.example/', { method: 'POST', body: '{"id":1}', background: true });
    expect(client.request('https://graphql.example/', { method: 'POST', body: '{"id":1}' })).toBe(target);
    releases.shift()!(); await new Promise(resolve => setTimeout(resolve, 0));
    try { expect(calls.slice(4)).toEqual(['{"id":1}']); expect(client.stats().background).toBe(0); }
    finally { client.close(); releases.splice(0).forEach(release => release()); await Promise.allSettled([...busy, target, other]); }
  });
  it('前台元数据与封面优先，连续八次前台启动后后台仍能推进', async () => {
    const calls: string[] = [], releases = new Map<string, () => void>();
    const client = new UpstreamClient(async url => {
      const name = url.split('/').at(-1)!; calls.push(name);
      await new Promise<void>(resolve => releases.set(name, resolve)); return result();
    });
    const busy = Array.from({ length: 4 }, (_, id) => client.request(`https://example.com/busy-${id}`));
    const background = ['background-a', 'background-b'].map(name => client.request(`https://example.com/${name}`, { background: true }));
    const image = client.request('https://example.com/image', { kind: 'image' });
    const metadata = Array.from({ length: 5 }, (_, id) => client.request(`https://example.com/meta-${id}`));
    try {
      for (const name of ['busy-0', 'busy-1', 'busy-2', 'busy-3', 'image', 'meta-0']) {
        releases.get(name)!(); await new Promise(resolve => setTimeout(resolve, 0));
      }
      expect(calls.slice(4)).toEqual(['image', 'meta-0', 'meta-1', 'meta-2', 'background-a', 'meta-3']);
      expect(client.stats().background).toBe(1); expect(client.stats().queued).toBe(2);
    } finally { client.close(); releases.forEach(release => release()); await Promise.allSettled([...busy, ...background, image, ...metadata]); }
  });
  it('POST重试保留正文并在退避期间释放共享名额', async () => {
    vi.useFakeTimers(); const calls: RequestInit[] = [];
    const client = new UpstreamClient(async (_url, init) => { calls.push(init!); return calls.length === 1 ? new Response('', { status: 502 }) : result(); });
    const request = client.request('https://graphql.example/', { method: 'POST', body: '{"id":1}' });
    await vi.advanceTimersByTimeAsync(0); expect(client.stats().active).toBe(0); expect(client.stats().queued).toBe(1);
    await vi.advanceTimersByTimeAsync(250); await request;
    expect(calls.map(({ method, body }) => ({ method, body }))).toEqual([{ method: 'POST', body: '{"id":1}' }, { method: 'POST', body: '{"id":1}' }]);
    await client.idle(); client.close();
  });
});

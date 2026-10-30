import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpstreamClient } from '../server/upstream.js';

afterEach(() => vi.useRealTimers());
const result = () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
describe('共享上游调度', () => {
  it('合并同URL任务，所有类别合计两路且图片与后台各至多一路', async () => {
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
    const tasks = [first, same, client.request('https://example.com/image-b', { kind: 'image' }), client.request('https://example.com/background-a', { background: true }), client.request('https://example.com/background-b', { background: true }), client.request('https://example.com/metadata')];
    for (let i = 0; i < 12; i++) { releases.splice(0).forEach(release => release()); await new Promise(resolve => setTimeout(resolve, 0)); }
    await Promise.all(tasks); expect(calls).toHaveLength(5); expect(peak).toBe(2); expect(imagePeak).toBe(1); expect(backgroundPeak).toBe(1);
    await client.idle(); expect(client.stats().queued).toBe(0);
  });
  it('排队时间计入总预算，超时任务不会在之后发出或泄漏名额', async () => {
    vi.useFakeTimers(); const release: (() => void)[] = [];
    const fetcher = vi.fn(async () => { await new Promise<void>(resolve => release.push(resolve)); return result(); });
    const client = new UpstreamClient(fetcher);
    const busy = [client.request('https://example.com/one'), client.request('https://example.com/two')];
    const queued = client.request('https://example.com/three', { timeoutMs: 50 });
    const rejected = expect(queued).rejects.toThrow(/超时/);
    await vi.advanceTimersByTimeAsync(51); await rejected; expect(fetcher).toHaveBeenCalledTimes(2);
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
    const tasks = Array.from({ length: 130 }, (_, id) => client.request(`https://example.com/${id}`).catch(error => error));
    await expect(client.request('https://example.com/overflow')).rejects.toMatchObject({ statusCode: 503 });
    client.close(); releases.forEach(release => release()); await Promise.all(tasks);
  });
});

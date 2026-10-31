import { listenTestServer } from './support/listen.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { shutdown } from '../server/shutdown.js';
import { observeRuntime } from '../server/observability.js';
afterEach(() => vi.useRealTimers());
describe('退出与运行观测', () => {
  it('允许活动响应和缓存写入完成，再停止资源服务', async () => {
    let send!: () => void, written!: () => void;
    const server = createServer((_req, res) => { send = () => res.end('done'); });
    await listenTestServer(server);
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('port');
    const response = fetch(`http://127.0.0.1:${address.port}`);
    while (!send) await new Promise(resolve => setTimeout(resolve, 1));
    const close = vi.fn(), stop = vi.fn();
    const operation = shutdown(server, { drain: () => new Promise<void>(resolve => { written = resolve; }), close }, stop, 1000);
    send(); expect(await (await response).text()).toBe('done'); expect(close).not.toHaveBeenCalled();
    written(); expect(await operation).toBe(true); expect(stop).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
  });
  it('达到截止时间后终止仍然等待的资源并强关连接', async () => {
    const server = createServer(); await listenTestServer(server);
    const close = vi.fn(), force = vi.spyOn(server, 'closeAllConnections');
    expect(await shutdown(server, { drain: () => new Promise(() => {}), close }, () => {}, 20)).toBe(false);
    expect(force).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
  });
  it('汇总缓存命中和队列信息，停止后清理定时器', async () => {
    vi.useFakeTimers(); const lines: string[] = [];
    const monitor = observeRuntime(() => ({ active: 1 }), line => lines.push(line));
    monitor.observe({ event: 'http', status: 200, durationMs: 10, cache: 'hit' });
    monitor.observe({ event: 'upstream_start', queueMs: 123 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(lines.map(line => JSON.parse(line)).at(-1)).toMatchObject({ event: 'runtime', requests: 1, cacheHits: 1, upstream: 1, maxQueueMs: 123, active: 1 });
    monitor.stop(); expect(vi.getTimerCount()).toBe(0);
  });
});

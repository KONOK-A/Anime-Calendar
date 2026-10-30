import { monitorEventLoopDelay } from 'node:perf_hooks';

export function observeRuntime(stats: () => Record<string, unknown>, output: (line: string) => void = console.log) {
  const delay = monitorEventLoopDelay({ resolution: 20 }); delay.enable();
  let requests = 0, failures = 0, cacheHits = 0, upstream = 0, maxQueueMs = 0;
  const observe = (event: Record<string, unknown>) => {
    if (event.event === 'http') { requests++; if (Number(event.status) >= 500) failures++; if (event.cache === 'hit') cacheHits++; if (Number(event.durationMs) >= 2000 || Number(event.status) >= 500) output(JSON.stringify(event)); }
    else if (event.event === 'upstream_start') { upstream++; maxQueueMs = Math.max(maxQueueMs, Number(event.queueMs) || 0); }
    else if (event.event !== 'upstream_end' || event.ok === false) output(JSON.stringify(event));
  };
  const timer = setInterval(() => {
    output(JSON.stringify({ event: 'runtime', requests, failures, cacheHits, upstream, maxQueueMs, rssBytes: process.memoryUsage().rss, heapBytes: process.memoryUsage().heapUsed, eventLoopP95Ms: Math.round(delay.percentile(95) / 1e6 * 100) / 100, ...stats() }));
    requests = failures = cacheHits = upstream = maxQueueMs = 0; delay.reset();
  }, 30_000); timer.unref();
  return { observe, stop: () => { clearInterval(timer); delay.disable(); } };
}

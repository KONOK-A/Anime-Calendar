/** One scheduler for JSON and image traffic; a task owns its deadline, not its HTTP callers. */
export interface RequestOptions { kind?: 'json' | 'image'; background?: boolean; timeoutMs?: number; maxBytes?: number; headers?: Record<string, string>; redirect?: RequestInit['redirect'] }
export interface UpstreamResponse { status: number; headers: Headers; bytes: Buffer }
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export class UpstreamError extends Error {
  constructor(message: string, readonly statusCode = 502, readonly retryAt?: number) { super(message); }
}
interface Task {
  key: string; url: string; options: RequestOptions; started: number; deadline: number; available: number; attempt: number;
  controller: AbortController; timer: ReturnType<typeof setTimeout>; active: boolean; settled: boolean;
  resolve: (value: UpstreamResponse) => void; reject: (error: Error) => void; promise: Promise<UpstreamResponse>;
}
export class UpstreamClient {
  private readonly tasks = new Map<string, Task>();
  private readonly queue: Task[] = [];
  private readonly cooldowns = new Map<string, number>();
  private readonly idleWaiters: (() => void)[] = [];
  private active = 0; private images = 0; private background = 0; private foregroundRuns = 0;
  private closed = false; private wake?: ReturnType<typeof setTimeout>;
  constructor(private readonly fetcher: Fetcher = fetch, private readonly observe: (event: Record<string, unknown>) => void = () => {}) {}

  request(url: string, options: RequestOptions = {}): Promise<UpstreamResponse> {
    if (this.closed) return Promise.reject(new UpstreamError('上游服务正在关闭', 503));
    const key = `${url}|${JSON.stringify(options.headers ?? {})}`;
    const pending = this.tasks.get(key);
    if (pending) { if (!options.background) this.promote(url); return pending.promise; }
    const now = Date.now(), retryAt = this.cooldowns.get(new URL(url).origin) ?? 0;
    if (retryAt > now) return Promise.reject(new UpstreamError('上游限流冷却中，请稍后重试', 503, retryAt));
    if (this.queue.length >= 128) return Promise.reject(new UpstreamError('请求队列繁忙，请稍后重试', 503));
    let resolve!: Task['resolve'], reject!: Task['reject'];
    const promise = new Promise<UpstreamResponse>((yes, no) => { resolve = yes; reject = no; });
    const controller = new AbortController(), timeout = options.timeoutMs ?? (options.kind === 'image' ? 8000 : 12_000);
    const task: Task = { key, url, options: { ...options }, started: now, deadline: now + timeout, available: now, attempt: 0, controller, active: false, settled: false, resolve, reject, promise, timer: setTimeout(() => {
      controller.abort(new UpstreamError('上游读取超时，请稍后重试', 504));
      if (!task.active) this.finish(task, new UpstreamError('上游排队超时，请稍后重试', 504));
    }, timeout) };
    this.tasks.set(key, task); this.queue.push(task); this.pump(); return promise;
  }
  promote(url: string) {
    for (const task of this.queue) if (task.url === url) task.options.background = false;
    this.pump();
  }
  stats() { return { active: this.active, queued: this.queue.length, images: this.images, background: this.background }; }
  idle(): Promise<void> { return this.tasks.size ? new Promise(resolve => this.idleWaiters.push(resolve)) : Promise.resolve(); }
  close() {
    this.closed = true; clearTimeout(this.wake);
    for (const task of [...this.tasks.values()]) {
      task.controller.abort(new UpstreamError('上游服务已关闭', 503));
      if (!task.active) this.finish(task, new UpstreamError('上游服务已关闭', 503));
    }
  }
  private pump() {
    clearTimeout(this.wake); this.wake = undefined;
    while (!this.closed && this.active < 2) {
      const now = Date.now();
      const eligible = this.queue.filter(task => task.available <= now && (!task.options.background || this.background < 1) && (task.options.kind !== 'image' || this.images < 1));
      const task = (this.foregroundRuns >= 8 ? eligible.find(task => task.options.background) : undefined) ?? eligible.find(task => !task.options.background) ?? eligible[0];
      if (!task) break;
      this.queue.splice(this.queue.indexOf(task), 1);
      task.active = true; this.active++;
      const background = !!task.options.background, image = task.options.kind === 'image';
      if (background) { this.background++; this.foregroundRuns = 0; } else this.foregroundRuns++;
      if (image) this.images++;
      void this.run(task).finally(() => { this.active--; if (background) this.background--; if (image) this.images--; task.active = false; this.pump(); });
    }
    const next = Math.min(...this.queue.map(task => task.available).filter(at => at > Date.now()));
    if (Number.isFinite(next) && !this.closed) this.wake = setTimeout(() => this.pump(), Math.max(1, next - Date.now()));
  }
  private async run(task: Task) {
    let retryDelay: number | undefined;
    try {
      task.controller.signal.throwIfAborted();
      const retryAt = this.cooldowns.get(new URL(task.url).origin) ?? 0;
      if (retryAt > Date.now()) throw new UpstreamError('上游限流冷却中，请稍后重试', 503, retryAt);
      this.observe({ event: 'upstream_start', source: new URL(task.url).hostname, queueMs: Date.now() - task.started, kind: task.options.kind ?? 'json' });
      const operation = (async () => {
        const response = await this.fetcher(task.url, { headers: { accept: task.options.kind === 'image' ? 'image/*' : 'application/json', 'user-agent': 'anime-calendar/1.0.0', ...task.options.headers }, signal: task.controller.signal, redirect: task.options.redirect });
        if (task.controller.signal.aborted) { void response.body?.cancel(); task.controller.signal.throwIfAborted(); }
        if (!response.ok && response.status !== 304 && !(task.options.redirect === 'manual' && response.status >= 300 && response.status < 400)) {
          void response.body?.cancel();
          const raw = response.headers.get('retry-after');
          let delay = 250;
          if (raw && [429, 503].includes(response.status)) {
            const seconds = Number(raw), until = Number.isFinite(seconds) && seconds >= 0 ? Date.now() + seconds * 1000 : Date.parse(raw);
            if (Number.isFinite(until)) delay = Math.max(0, until - Date.now());
          }
          if (response.status === 429 || response.status === 503 && raw) this.cooldowns.set(new URL(task.url).origin, Date.now() + Math.max(1000, delay));
          const error = new UpstreamError(`上游返回 HTTP ${response.status}`, response.status === 429 ? 503 : 502, this.cooldowns.get(new URL(task.url).origin));
          if ([429, 502, 503, 504].includes(response.status)) Object.assign(error, { retryDelay: delay });
          throw error;
        }
        const maxBytes = task.options.maxBytes ?? 2 * 1024 * 1024;
        if (Number(response.headers.get('content-length')) > maxBytes) { void response.body?.cancel(); throw new UpstreamError('上游响应过大'); }
        const chunks: Uint8Array[] = []; let size = 0;
        const reader = response.body?.getReader();
        const abort = () => { void reader?.cancel().catch(() => {}); };
        task.controller.signal.addEventListener('abort', abort, { once: true });
        try {
          if (reader) while (true) {
            task.controller.signal.throwIfAborted(); const item = await reader.read(); if (item.done) break;
            size += item.value.byteLength;
            if (size > maxBytes) { void reader.cancel(); throw new UpstreamError('上游响应过大'); }
            chunks.push(item.value);
          }
          task.controller.signal.throwIfAborted();
        } finally { task.controller.signal.removeEventListener('abort', abort); reader?.releaseLock(); }
        return { status: response.status, headers: response.headers, bytes: Buffer.concat(chunks) };
      })();
      let abort!: () => void;
      const cancelled = new Promise<never>((_, reject) => { abort = () => reject(task.controller.signal.reason); task.controller.signal.addEventListener('abort', abort, { once: true }); });
      try { this.finish(task, null, await Promise.race([operation, cancelled])); }
      finally { task.controller.signal.removeEventListener('abort', abort); }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('上游请求失败');
      const delay = 'retryDelay' in failure ? Number(failure.retryDelay) : !(failure instanceof UpstreamError) && !task.controller.signal.aborted ? 250 : undefined;
      if (task.attempt < 1 && delay !== undefined && Date.now() + delay < task.deadline && !this.closed) retryDelay = delay;
      else this.finish(task, failure);
    }
    if (retryDelay !== undefined) { task.attempt++; task.available = Date.now() + retryDelay; this.queue.push(task); }
  }
  private finish(task: Task, error: Error | null, result?: UpstreamResponse) {
    if (task.settled) return;
    task.settled = true; clearTimeout(task.timer); this.tasks.delete(task.key);
    const queued = this.queue.indexOf(task); if (queued >= 0) this.queue.splice(queued, 1);
    this.observe({ event: 'upstream_end', source: new URL(task.url).hostname, durationMs: Date.now() - task.started, ok: !error });
    if (error) task.reject(error); else task.resolve(result!);
    if (!this.tasks.size) this.idleWaiters.splice(0).forEach(resolve => resolve());
  }
}

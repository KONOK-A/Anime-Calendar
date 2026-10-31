import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, unlink, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from './cache.js';
import { UpstreamClient, UpstreamError } from './upstream.js';

export type PosterSize = 'thumb' | 'card' | 'hero';
export interface PosterData { bytes: Buffer; contentType: string; etag: string; cache: 'hit' | 'miss' | 'stale' | 'memory' }
interface Descriptor { version: 1; blob: string; contentType: string; checkedAt: number; originEtag?: string; lastModified?: string }
const MAX_BYTES = 4 * 1024 * 1024, DAY = 86_400_000;
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export class PosterError extends Error { constructor(message: string, readonly statusCode: number) { super(message); } }
export function allowedImageSource(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== 'lain.bgm.tv' || url.username || url.password || url.port && url.port !== '443') throw new PosterError('封面来源不受支持。', 502);
  url.hash = ''; return url;
}
function imageType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif';
  if (bytes.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(bytes.toString('ascii', 8, 32))) return 'image/avif';
  return null;
}
async function within<T>(promise: Promise<T>, until: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PosterError('封面读取超时，可稍后重试。', 504)), Math.max(0, until - Date.now())); });
  try { return await Promise.race([promise, deadline]); } finally { clearTimeout(timer); }
}
export class PosterStore {
  private readonly requests = new Map<string, Promise<PosterData>>();
  private readonly downloads = new Map<string, Promise<PosterData>>();
  private readonly cooldowns = new Map<string, { until: number; error: Error }>();
  private readonly touches = new Map<string, number>();
  private diskTask: Promise<void> = Promise.resolve();
  private readonly problems = new Set<string>();
  revision = 0;
  constructor(private readonly directory: string, private readonly upstream: UpstreamClient, private readonly resolve: (id: string, size: PosterSize) => Promise<string | null>) {}
  get warnings() { return [...this.problems]; }
  private problem(value: boolean) { const message = '部分封面缓存未保存，当前图片仍可显示。'; if (value && !this.problems.has(message)) { this.problems.add(message); this.revision++; } else if (!value && this.problems.delete(message)) this.revision++; }
  private mutate(action: () => Promise<void>): Promise<void> {
    const task = this.diskTask.then(action);
    this.diskTask = task.catch(() => {});
    return task;
  }
  get(id: string, size: string): Promise<PosterData> {
    if (!['thumb', 'card', 'hero'].includes(size)) return Promise.reject(new PosterError('封面尺寸无效。', 400));
    if (!/^(bgm:\d+|bd:[\w-]+)$/.test(id) || id.length >= 120) return Promise.reject(new PosterError('作品ID无效。', 400));
    const key = `${id}:${size}`, pending = this.requests.get(key); if (pending) return pending;
    const task = this.load(id, size as PosterSize, Date.now() + 8000).finally(() => this.requests.delete(key)); this.requests.set(key, task); return task;
  }
  private async load(id: string, size: PosterSize, until: number): Promise<PosterData> {
    const source = await within(this.resolve(id, size), until);
    if (!source) throw new PosterError('暂未收录封面。', 404);
    const url = allowedImageSource(source).href, key = hash(url), cached = await within(this.read(key), until);
    if (cached) {
      if (Date.now() - cached.descriptor.checkedAt < 7 * DAY) return { ...cached.data, cache: 'hit' };
      void this.download(key, url, until, cached, true).catch(() => {});
      return { ...cached.data, cache: 'stale' };
    }
    return within(this.download(key, url, until, null, false), until);
  }
  private async read(key: string): Promise<{ descriptor: Descriptor; data: PosterData } | null> {
    try {
      const path = join(this.directory, `${key}.json`);
      if ((await stat(path)).size > 16_384) return null;
      const descriptor = JSON.parse(await readFile(path, 'utf8')) as Descriptor;
      if (descriptor.version !== 1 || !/^[a-f0-9]{64}$/.test(descriptor.blob) || !Number.isFinite(descriptor.checkedAt) || descriptor.checkedAt > Date.now() + 60_000) return null;
      const blob = join(this.directory, `${descriptor.blob}.bin`);
      if ((await stat(blob)).size > MAX_BYTES) return null;
      const bytes = await readFile(blob), contentType = imageType(bytes);
      if (!contentType || contentType !== descriptor.contentType || hash(bytes) !== descriptor.blob) return null;
      if (Date.now() - (this.touches.get(key) ?? 0) > 3_600_000) {
        this.touches.set(key, Date.now()); if (this.touches.size > 512) this.touches.delete(this.touches.keys().next().value!);
        await utimes(path, new Date(), new Date()).catch(() => this.problem(true));
      }
      return { descriptor, data: { bytes, contentType, etag: `"${descriptor.blob}"`, cache: 'hit' } };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.problem(true); return null; }
  }
  private download(key: string, source: string, until: number, cached: { descriptor: Descriptor; data: PosterData } | null, background: boolean): Promise<PosterData> {
    const existing = this.downloads.get(key); if (existing) { if (!background) this.upstream.promote(source); return existing; }
    const failure = this.cooldowns.get(key); if (failure && failure.until > Date.now()) return Promise.reject(failure.error);
    const task = this.pull(key, source, until, cached, background).catch(error => {
      const failure = error instanceof Error ? error : new PosterError('封面暂不可用。', 502);
      if (!/队列|排队/.test(failure.message)) this.cooldowns.set(key, { until: Math.max(Date.now() + 60_000, error instanceof UpstreamError ? error.retryAt ?? 0 : 0), error: failure });
      if (this.cooldowns.size > 512) this.cooldowns.delete(this.cooldowns.keys().next().value!);
      throw failure;
    }).finally(() => this.downloads.delete(key));
    this.downloads.set(key, task); return task;
  }
  private async pull(key: string, source: string, until: number, cached: { descriptor: Descriptor; data: PosterData } | null, background: boolean): Promise<PosterData> {
    let url = source;
    const headers: Record<string, string> = {};
    if (cached?.descriptor.originEtag) headers['if-none-match'] = cached.descriptor.originEtag;
    if (cached?.descriptor.lastModified) headers['if-modified-since'] = cached.descriptor.lastModified;
    for (let redirects = 0; redirects <= 2; redirects++) {
      url = allowedImageSource(url).href;
      const response = await this.upstream.request(url, { kind: 'image', background, timeoutMs: Math.max(1, until - Date.now()), maxBytes: MAX_BYTES, redirect: 'manual', headers });
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location'); if (!location || redirects === 2) throw new PosterError('封面重定向无效。', 502);
        url = allowedImageSource(new URL(location, url).href).href; continue;
      }
      let bytes: Buffer, contentType: string;
      if (response.status === 304 && cached) { bytes = cached.data.bytes; contentType = cached.data.contentType; }
      else {
        bytes = response.bytes; const detected = imageType(bytes), supplied = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        if (!detected || detected !== supplied || response.status !== 200) throw new PosterError('封面响应不是有效图片。', 502);
        contentType = detected;
      }
      const blob = hash(bytes), descriptor: Descriptor = { version: 1, blob, contentType, checkedAt: Date.now(), originEtag: response.headers.get('etag') ?? cached?.descriptor.originEtag, lastModified: response.headers.get('last-modified') ?? cached?.descriptor.lastModified };
      let cache: PosterData['cache'] = 'miss';
      try {
        await this.mutate(async () => {
          await mkdir(this.directory, { recursive: true });
          await atomicWrite(join(this.directory, `${blob}.bin`), bytes);
          await atomicWrite(join(this.directory, `${key}.json`), JSON.stringify(descriptor)); this.problem(false);
        });
      } catch { cache = 'memory'; this.problem(true); }
      this.cooldowns.delete(key);
      await this.maintain().catch(() => this.problem(true));
      return { bytes, contentType, etag: `"${blob}"`, cache };
    }
    throw new PosterError('封面重定向无效。', 502);
  }
  maintain(options: { maxBytes?: number; now?: number } = {}) {
    // A sweep must not observe a blob before its descriptor has been committed.
    return this.mutate(() => this.sweep(options));
  }
  private async sweep({ maxBytes = 512 * 1024 * 1024, now = Date.now() } = {}) {
    let files; try { files = await readdir(this.directory, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    const entries: { path: string; blob: string; at: number; size: number; key: string }[] = [], blobs = new Map<string, number>();
    for (const file of files) if (file.isFile() && /^[a-f0-9]{64}\.bin$/.test(file.name)) blobs.set(file.name.slice(0, -4), (await stat(join(this.directory, file.name))).size);
    for (const file of files) if (file.isFile() && /^[a-f0-9]{64}\.json$/.test(file.name)) {
      const key = file.name.slice(0, -5);
      const path = join(this.directory, file.name);
      try { const descriptor = JSON.parse(await readFile(path, 'utf8')) as Descriptor; if (/^[a-f0-9]{64}$/.test(descriptor.blob)) entries.push({ path, blob: descriptor.blob, at: (await stat(path)).mtimeMs, size: blobs.get(descriptor.blob) ?? 0, key }); } catch { /* Damaged metadata is replaced only after a valid download. */ }
    }
    const retained = new Set<string>();
    let remaining = maxBytes;
    for (const entry of entries.sort((a, b) => b.at - a.at)) {
      if (now - entry.at <= 30 * DAY && (retained.has(entry.blob) || entry.size <= remaining)) {
        if (!retained.has(entry.blob)) { retained.add(entry.blob); remaining -= entry.size; }
      } else { await unlink(entry.path).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); this.touches.delete(entry.key); }
    }
    for (const blob of blobs.keys()) if (!retained.has(blob)) await unlink(join(this.directory, `${blob}.bin`)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }
  async drain() {
    do { await Promise.allSettled([...this.requests.values(), ...this.downloads.values()]); } while (this.requests.size || this.downloads.size);
    await this.diskTask;
  }
}

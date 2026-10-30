import { mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isRecord } from './normalize.js';

export interface Validators { etag?: string; lastModified?: string }
interface Envelope { version: 1; fetchedAt: string; data: unknown; validators?: Validators }
export interface CacheValue<T> { data: T; fetchedAt: string; raw: unknown; validators?: Validators }
const derived = /^(detail-[a-f0-9]{24}|credits-(persons|characters)-\d+|character-name-\d+)$/;
const sourceKey = (key: string) => key === 'catalog' || key === 'calendar';
export async function atomicWrite(path: string, bytes: string | Uint8Array) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx');
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
  } finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); }
}
export class CacheStore {
  private readonly problems = new Map<string, string>();
  private readonly hot = new Map<string, Envelope>();
  private readonly hotSizes = new Map<string, number>();
  private hotBytes = 0;
  private readonly validSources = new Map<string, Envelope>();
  private readonly writes = new Map<string, Promise<void>>();
  private derivedWritten = 0;
  private swept = false;
  private sweeping: Promise<void> | undefined;
  revision = 0;
  constructor(private readonly directory: string, private readonly maxDerivedBytes = 256 * 1024 * 1024) {}
  get warnings(): string[] { return [...this.problems.values()]; }
  private issue(key: string, message?: string) {
    if (message === this.problems.get(key)) return;
    if (message) this.problems.set(key, message); else this.problems.delete(key);
    if (this.problems.size > 128) this.problems.delete(this.problems.keys().next().value!);
    this.revision++;
  }
  private remember(key: string, value: Envelope) {
    if (sourceKey(key)) return;
    if (this.hot.get(key) === value) { this.hot.delete(key); this.hot.set(key, value); return; }
    this.hotBytes -= this.hotSizes.get(key) ?? 0;
    const bytes = Buffer.byteLength(JSON.stringify(value)); this.hotBytes += bytes; this.hotSizes.set(key, bytes);
    this.hot.delete(key); this.hot.set(key, value);
    while (this.hot.size > 256 || this.hotBytes > 32 * 1024 * 1024) {
      const oldest = this.hot.keys().next().value!; this.hot.delete(oldest); this.hotBytes -= this.hotSizes.get(oldest) ?? 0; this.hotSizes.delete(oldest);
    }
  }
  private path(key: string) {
    if (!sourceKey(key) && !derived.test(key)) throw new Error('缓存键无效');
    return join(this.directory, `${key}.json`);
  }
  private envelope(input: unknown): Envelope {
    if (!isRecord(input) || input.version !== 1 || typeof input.fetchedAt !== 'string' || !Number.isFinite(Date.parse(input.fetchedAt))) throw new Error('缓存格式无效');
    const validators = isRecord(input.validators) ? { ...(typeof input.validators.etag === 'string' ? { etag: input.validators.etag } : {}), ...(typeof input.validators.lastModified === 'string' ? { lastModified: input.validators.lastModified } : {}) } : undefined;
    return { version: 1, data: input.data, fetchedAt: input.fetchedAt, ...(validators ? { validators } : {}) };
  }
  async read<T>(key: string, validate: (value: unknown) => T): Promise<CacheValue<T> | null> {
    const path = this.path(key), hot = this.hot.get(key);
    try {
      const envelope = hot ?? this.envelope(JSON.parse(await readFile(path, 'utf8')));
      const data = validate(envelope.data);
      this.issue(`read:${key}`); if (sourceKey(key)) this.validSources.set(key, envelope); else this.remember(key, envelope);
      return { data, fetchedAt: envelope.fetchedAt, raw: envelope.data, validators: envelope.validators };
    } catch (error) {
      const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
      if (!missing) this.issue(`read:${key}`, `缓存 ${key} 无法读取，原文件未删除。`);
      if (sourceKey(key)) try {
        const envelope = this.envelope(JSON.parse(await readFile(`${path}.previous`, 'utf8'))), data = validate(envelope.data);
        this.validSources.set(key, envelope); this.issue(`read:${key}`, `缓存 ${key} 已从上一有效备份恢复，原文件保留。`);
        return { data, fetchedAt: envelope.fetchedAt, raw: envelope.data, validators: envelope.validators };
      } catch { /* No valid previous source; the existing source warning remains. */ }
      return null;
    }
  }
  write(key: string, data: unknown, fetchedAt: string, validators?: Validators): Promise<void> {
    const path = this.path(key), envelope: Envelope = { version: 1, data, fetchedAt, ...(validators ? { validators } : {}) };
    const previous = this.writes.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      this.remember(key, envelope);
      try {
        await mkdir(this.directory, { recursive: true });
        const valid = this.validSources.get(key);
        if (sourceKey(key) && valid) await atomicWrite(`${path}.previous`, JSON.stringify(valid));
        const text = JSON.stringify(envelope); await atomicWrite(path, text);
        if (sourceKey(key)) this.validSources.set(key, envelope);
        this.issue(`write:${key}`); this.issue(`read:${key}`);
        if (derived.test(key)) {
          this.derivedWritten += Buffer.byteLength(text);
          const reserve = Math.min(8 * 1024 * 1024, this.maxDerivedBytes / 8);
          if (!this.swept || this.derivedWritten >= reserve) {
            this.sweeping ??= this.maintain({ maxBytes: this.maxDerivedBytes - reserve }).then(() => { this.issue('cleanup'); }, () => { this.issue('cleanup', '缓存容量整理暂未完成，已有资料仍可使用。'); }).finally(() => { this.sweeping = undefined; this.swept = true; this.derivedWritten = 0; });
            await this.sweeping;
          }
        }
      } catch (error) { this.issue(`write:${key}`, `缓存 ${key} 未保存，当前资料仅在内存中可用。`); throw error; }
    });
    this.writes.set(key, operation);
    const clear = () => { if (this.writes.get(key) === operation) this.writes.delete(key); };
    void operation.then(clear, clear); return operation;
  }
  async drain() { do { await Promise.allSettled([...this.writes.values()]); } while (this.writes.size); }
  private async entries() {
    let files; try { files = await readdir(this.directory, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const result: { key: string; path: string; size: number; at: number }[] = [];
    for (const file of files) {
      const key = file.name.replace(/\.json$/, '');
      if (!file.isFile() || !file.name.endsWith('.json') || !derived.test(key)) continue;
      const path = this.path(key);
      try { const value = await stat(path); result.push({ key, path, size: value.size, at: value.mtimeMs }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return result;
  }
  async derivedBytes() { return (await this.entries()).reduce((total, entry) => total + entry.size, 0); }
  async maintain({ maxBytes = 256 * 1024 * 1024, now = Date.now() } = {}) {
    const entries = (await this.entries()).sort((a, b) => a.at - b.at); let total = entries.reduce((value, entry) => value + entry.size, 0);
    for (const entry of entries) if (total > maxBytes || now - entry.at > 90 * 86_400_000) {
      if (this.writes.has(entry.key)) continue;
      await unlink(entry.path).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      this.hot.delete(entry.key); this.hotBytes -= this.hotSizes.get(entry.key) ?? 0; this.hotSizes.delete(entry.key); total -= entry.size;
    }
  }
}

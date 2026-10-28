import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isRecord } from './normalize.js';

export class CacheStore {
  readonly warnings: string[] = [];
  constructor(private readonly directory: string) {}

  async read<T>(key: string, validate: (value: unknown) => T): Promise<{ data: T; fetchedAt: string } | null> {
    try {
      const envelope: unknown = JSON.parse(await readFile(join(this.directory, `${key}.json`), 'utf8'));
      if (!isRecord(envelope) || envelope.version !== 1 || typeof envelope.fetchedAt !== 'string' || !Number.isFinite(Date.parse(envelope.fetchedAt))) throw new Error('缓存格式无效');
      return { data: validate(envelope.data), fetchedAt: envelope.fetchedAt };
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) this.warnings.push(`缓存 ${key} 无法读取：${error instanceof Error ? error.message : '未知错误'}。原文件未删除。`);
      return null;
    }
  }

  async write(key: string, data: unknown, fetchedAt: string): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const destination = join(this.directory, `${key}.json`), temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, fetchedAt, data }), 'utf8');
      await rename(temporary, destination);
    } finally {
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
}

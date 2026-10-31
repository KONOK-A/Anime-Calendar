import { listenTestServer } from './support/listen.js';
import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createViteServer } from 'vite';
import config from '../vite.config';
describe('本地开发媒体入口', () => {
  it('现有开发代理将媒体请求交给同一后端，而不是返回SPA页面', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'anime-dev-proxy-'));
    await writeFile(join(directory, 'index.html'), '<div>SPA fallback</div>');
    const backend = createServer((req, res) => res.end(`proxied:${req.url}`));
    await listenTestServer(backend);
    const address = backend.address(); if (!address || typeof address === 'string') throw new Error('port');
    const vite = await createViteServer({ configFile: false, root: directory, cacheDir: join(directory, 'cache'), logLevel: 'silent', server: { host: '127.0.0.1', port: 0, hmr: false, proxy: Object.fromEntries(Object.keys(config.server?.proxy ?? {}).map(prefix => [prefix, `http://127.0.0.1:${address.port}`])) } });
    try {
      await vite.listen(); const listening = vite.httpServer!.address(); if (!listening || typeof listening === 'string') throw new Error('port');
      expect(await (await fetch(`http://127.0.0.1:${listening.port}/media/posters/bgm:1/card`)).text()).toBe('proxied:/media/posters/bgm:1/card');
    } finally { await vite.close(); await new Promise<void>(resolve => backend.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
  });
});

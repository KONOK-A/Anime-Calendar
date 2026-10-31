import { listenTestServer } from './support/listen.js';
import { describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { assertOfflineUpdate } from '../server/update-guard.js';
describe('离线更新入口', () => {
  it('公开模式拒绝另起抓取器，端口已有服务时也拒绝', async () => {
    await expect(assertOfflineUpdate('https://anime.example.test')).rejects.toThrow(/刷新/);
    const server = createServer(socket => socket.end()); await listenTestServer(server);
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('port');
    try { await expect(assertOfflineUpdate(undefined, address.port)).rejects.toThrow(/运行|端口/); }
    finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    await expect(assertOfflineUpdate(undefined, address.port)).resolves.toBeUndefined();
  });
});

import { afterEach, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existingInstance } from '../server/launcher.js';

let server: Server | undefined;
afterEach(async () => { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); });
async function listen(payload: string) {
  server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(payload); });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('port missing');
  return `http://127.0.0.1:${address.port}`;
}
it('重复启动只认可具有本应用标识的实例', async () => {
  expect(await existingInstance(await listen('{"appId":"anime-calendar","version":"1.0.0"}'))).toBe(true);
});
it('被其他服务占用时不会冒充已启动成功', async () => {
  expect(await existingInstance(await listen('{"appId":"another-service"}'))).toBe(false);
});

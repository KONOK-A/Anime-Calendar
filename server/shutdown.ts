import type { Server } from 'node:http';

export async function shutdown(server: Server, service: { drain: () => Promise<void>; close: () => void }, stopMaintenance: () => void, timeoutMs = 10_000): Promise<boolean> {
  stopMaintenance();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const closed = new Promise<void>(resolve => server.close(() => resolve()));
  // A response can become keep-alive idle after close() inspected the sockets.
  const idle = setInterval(() => server.closeIdleConnections(), 50);
  const complete = Promise.all([closed, service.drain()]).then(() => true);
  const deadline = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); });
  const graceful = await Promise.race([complete, deadline]); clearTimeout(timer); clearInterval(idle);
  service.close(); if (!graceful) server.closeAllConnections();
  return graceful;
}

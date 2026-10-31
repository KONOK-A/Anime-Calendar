import { randomInt } from 'node:crypto';
import type { Server } from 'node:net';

/** Some environments assign low ephemeral ports that Fetch deliberately blocks. */
export async function listenTestServer<T extends Server>(server: T): Promise<T> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const clean = () => { server.off('listening', ready); server.off('error', failed); };
        const ready = () => { clean(); resolve(); };
        const failed = (error: Error) => { clean(); reject(error); };
        server.once('listening', ready); server.once('error', failed);
        server.listen(randomInt(32768, 61000), '127.0.0.1');
      });
      return server;
    } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EADDRINUSE')) throw error; }
  }
  throw new Error('No available test server port');
}

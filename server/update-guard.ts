import { createConnection } from 'node:net';

export async function assertOfflineUpdate(publicOrigin?: string, port = 4317): Promise<void> {
  if (publicOrigin) throw new Error('公开网站请使用正在运行服务的刷新入口，不能另起抓取进程。');
  const occupied = await new Promise<boolean>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(2000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('无法确认本机服务状态，请稍后重试。')); });
    socket.once('error', error => { socket.destroy(); if ('code' in error && error.code === 'ECONNREFUSED') resolve(false); else reject(new Error('无法确认本机端口状态。')); });
  });
  if (occupied) throw new Error('本机端口4317已有运行服务，请使用网页刷新，避免重复抓取。');
}

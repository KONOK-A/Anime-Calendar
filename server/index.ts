import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { AnimeService } from './service.js';
import { createApp } from './app.js';
import { existingInstance } from './launcher.js';
import { configureNetwork } from './network.js';
import { runtimeConfig } from './runtime.js';
import { startCatalogMaintenance } from './maintenance.js';
import { observeRuntime } from './observability.js';
import { shutdown } from './shutdown.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const config = runtimeConfig(process.env, root);
const url = 'http://127.0.0.1:4317';
function openBrowser() {
  if (config.publicOrigin || process.argv.includes('--no-open')) return;
  const browser = spawn('cmd.exe', ['/d', '/s', '/c', 'start "" "http://127.0.0.1:4317"'], { windowsHide: true, stdio: 'ignore' });
  browser.on('error', () => console.log(`请在浏览器打开 ${url}`));
}
async function main() {
  await configureNetwork();
  if (await existingInstance(url)) { console.log(`番时记已在运行：${url}`); openBrowser(); return; }
  if (!existsSync(resolve(root, 'dist/client/index.html'))) throw new Error('缺少页面构建，请在项目目录运行 npm run build。');
  const monitoring = observeRuntime(() => service.upstream.stats());
  const service = new AnimeService({ directory: config.dataDirectory, overridesPath: resolve(root, 'data/overrides.json'), observe: monitoring.observe, ratings: { malClientId: process.env.ANIME_CALENDAR_MAL_CLIENT_ID, aniListEnabled: process.env.ANIME_CALENDAR_ANILIST_RATINGS?.trim().toLowerCase() !== 'false' } });
  await service.initialize();
  const app = createApp(service, resolve(root, 'dist/client'), { publicOrigin: config.publicOrigin, assetOrigin: config.assetOrigin, assetsDirectory: config.publicOrigin ? join(config.dataDirectory, 'public-assets') : undefined, observe: monitoring.observe });
  const server = app.listen(4317, '127.0.0.1');
  let stopMaintenance: (() => void) | undefined;
  server.once('listening', () => {
    console.log(config.publicOrigin ? `\n番时记服务已启动：${config.publicOrigin}（内部监听 ${url}）\n` : `\n番时记已启动：${url}\n关闭此窗口或按 Ctrl+C 停止服务。\n`);
    openBrowser();
    if (config.publicOrigin) stopMaintenance = startCatalogMaintenance(service);
    if (service.needsRefresh()) void service.refresh('stale').then(() => { const status = service.status(); console.log(status.hasCatalog ? '目录已就绪。' : '首次获取未完成，可在网页重试。'); for (const [name, source] of Object.entries(status.sources)) if (source.error) console.error(`${name}: ${source.error}`); });
  });
  server.on('error', error => { console.error('code' in error && error.code === 'EADDRINUSE' ? '端口4317已被其他程序占用。请关闭占用程序后重试，工具不会自动换端口。' : error.message); process.exitCode = 1; });
  let closing = false;
  const stop = () => { if (closing) return; closing = true; void shutdown(server, service, () => { stopMaintenance?.(); monitoring.stop(); }).then(graceful => { console.log(JSON.stringify({ event: 'shutdown', graceful })); process.exitCode = graceful ? 0 : 1; if (!graceful) setImmediate(() => process.exit(1)); }); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

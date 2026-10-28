import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

interface Proxies { httpProxy?: string; httpsProxy?: string }
function proxyUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value.includes('://') ? value : `http://${value}`); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}
export function parseWindowsProxy(enabled: boolean, server: string): Proxies | null {
  if (!enabled || !server.trim()) return null;
  const endpoints = server.trim().split(';').map(value => value.trim()).filter(Boolean);
  const pairs = Object.fromEntries(endpoints.filter(value => value.includes('=')).map(value => { const index = value.indexOf('='); return [value.slice(0, index).toLowerCase(), value.slice(index + 1)]; }));
  const single = endpoints.find(value => !value.includes('='));
  const httpProxy = proxyUrl(pairs.http ?? single), httpsProxy = proxyUrl(pairs.https ?? single);
  return httpProxy || httpsProxy ? { ...(httpProxy ? { httpProxy } : {}), ...(httpsProxy ? { httpsProxy } : {}) } : null;
}
export function selectProxyOptions(env: Record<string, string | undefined>, system: Proxies | null) {
  return { httpProxy: env.http_proxy || env.HTTP_PROXY || system?.httpProxy, httpsProxy: env.https_proxy || env.HTTPS_PROXY || system?.httpsProxy, noProxy: [env.no_proxy || env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',') };
}
async function windowsProxy(): Promise<Proxies | null> {
  if (process.platform !== 'win32') return null;
  const execute = promisify(execFile), path = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
  try {
    const [enabled, server] = await Promise.all(['ProxyEnable', 'ProxyServer'].map(name => execute('reg.exe', ['query', path, '/v', name], { windowsHide: true, timeout: 2000, encoding: 'utf8' })));
    return parseWindowsProxy(/ProxyEnable\s+REG_DWORD\s+0x1\b/.test(enabled.stdout), server.stdout.match(/ProxyServer\s+REG_SZ\s+(.+)/)?.[1]?.trim() ?? '');
  } catch { return null; } // Windows未设置手动代理时reg查询可返回非零；继续环境代理/直连。
}
export async function configureNetwork(): Promise<void> {
  const options = selectProxyOptions(process.env, await windowsProxy());
  setGlobalDispatcher(new EnvHttpProxyAgent(options));
}

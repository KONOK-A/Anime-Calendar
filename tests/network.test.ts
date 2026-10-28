import { expect, it } from 'vitest';
import { parseWindowsProxy, selectProxyOptions } from '../server/network.js';

it('可复用Windows已启用的HTTP系统代理，不修改系统设置', () => {
  expect(parseWindowsProxy(true, '127.0.0.1:7897')).toEqual({ httpProxy: 'http://127.0.0.1:7897/', httpsProxy: 'http://127.0.0.1:7897/' });
  expect(parseWindowsProxy(false, '127.0.0.1:7897')).toBeNull();
  expect(parseWindowsProxy(true, 'http=127.0.0.1:7897;https=127.0.0.1:7898;socks=127.0.0.1:7899')).toEqual({ httpProxy: 'http://127.0.0.1:7897/', httpsProxy: 'http://127.0.0.1:7898/' });
});
it('现有环境代理优先，本地服务始终绕过代理，SOCKS不会误当HTTP', () => {
  expect(parseWindowsProxy(true, 'socks=127.0.0.1:7899')).toBeNull();
  expect(selectProxyOptions({ HTTPS_PROXY: 'http://proxy.example:8080', NO_PROXY: 'example.test' }, { httpsProxy: 'http://127.0.0.1:7897' })).toMatchObject({ httpsProxy: 'http://proxy.example:8080', noProxy: 'example.test,127.0.0.1,localhost' });
});

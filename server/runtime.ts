import { isAbsolute, resolve } from 'node:path';

export function runtimeConfig(env: Record<string, string | undefined>, root: string) {
  const configuredOrigin = env.ANIME_CALENDAR_ORIGIN?.trim();
  let publicOrigin: string | undefined;
  if (configuredOrigin) {
    let url: URL;
    try { url = new URL(configuredOrigin); }
    catch { throw new Error('ANIME_CALENDAR_ORIGIN 必须是有效的 HTTPS 网站地址。'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('ANIME_CALENDAR_ORIGIN 只能包含 HTTPS 协议、域名和可选端口。');
    }
    publicOrigin = url.origin;
  }
  const dataDirectory = env.ANIME_CALENDAR_DATA_DIR?.trim() || resolve(root, '.local');
  if (!isAbsolute(dataDirectory)) throw new Error('ANIME_CALENDAR_DATA_DIR 必须使用绝对路径。');
  const configuredAssets = env.ANIME_CALENDAR_STATIC_ORIGIN?.trim();
  let assetOrigin: string | undefined;
  if (configuredAssets) {
    if (!publicOrigin) throw new Error('静态分发域名只能在公开网站模式启用。');
    const url = new URL(configuredAssets);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin === publicOrigin) throw new Error('静态分发域名必须是独立的HTTPS Origin。');
    assetOrigin = url.origin;
  }
  return { publicOrigin, dataDirectory, ...(assetOrigin ? { assetOrigin } : {}) };
}

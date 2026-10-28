interface StorageTarget { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const FAVORITES_KEY = 'anime-calendar:favorites:v1';
function validIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 30_000 && value.every(x => typeof x === 'string' && /^(bgm:\d+|bd:[\w-]+)$/.test(x) && x.length < 120);
}
export function readFavorites(storage: StorageTarget): { ids: string[]; error?: string } {
  try {
    const raw = storage.getItem(FAVORITES_KEY);
    if (!raw) return { ids: [] };
    const value: unknown = JSON.parse(raw);
    if (!validIds(value)) throw new Error('格式无效');
    return { ids: [...new Set(value)] };
  } catch { return { ids: [], error: '无法读取收藏，现有存储未改动。可尝试重新载入或导入备份。' }; }
}
export function saveFavorites(storage: StorageTarget, ids: string[]): { saved: boolean; error?: string } {
  try {
    if (!validIds(ids)) throw new Error('收藏格式无效');
    storage.setItem(FAVORITES_KEY, JSON.stringify([...new Set(ids)]));
    return { saved: true };
  } catch { return { saved: false, error: '未保存：浏览器存储不可用或空间不足，请导出备份后重试。' }; }
}
export function parseBackup(text: string, existing: string[]): string[] {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('备份不是有效的 JSON 文件，现有收藏未改动。'); }
  if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1 || !('favorites' in value) || !validIds(value.favorites)) throw new Error('备份格式或版本不支持，现有收藏未改动。');
  return [...new Set([...existing, ...value.favorites])];
}
export function exportBackup(ids: string[], at: string): string {
  return JSON.stringify({ version: 1, exportedAt: at, favorites: [...new Set(ids)] }, null, 2);
}

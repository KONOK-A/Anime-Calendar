import type { CastCredit, CharacterName, StaffCredit } from '../shared/types.js';
import { isRecord } from './normalize.js';

const roles: Record<string, string> = {
  原作: '原作', 总导演: '总导演', 总监督: '总导演', 総監督: '总导演',
  导演: '导演', 监督: '导演', 監督: '导演', 副导演: '副导演', 副监督: '副导演', 副監督: '副导演',
  系列监督: '系列监督', シリーズディレクター: '系列监督', 系列构成: '系列构成', シリーズ構成: '系列构成',
  编剧: '编剧', 脚本: '编剧', 人物原案: '人设原案', 角色原案: '人设原案', 人设原案: '人设原案', キャラクター原案: '人设原案',
  人物设定: '动画人设', 角色设计: '动画人设', 动画人设: '动画人设', キャラクターデザイン: '动画人设',
  音乐: '音乐', 音楽: '音乐', 音响监督: '音响监督', 音響監督: '音响监督', 美术监督: '美术监督', 美術監督: '美术监督',
  色彩设计: '色彩设计', 色彩設計: '色彩设计', 摄影监督: '摄影监督', 撮影監督: '摄影监督', 剪辑: '剪辑', 編集: '剪辑',
  动画制作: '动画制作', アニメーション制作: '动画制作',
};
const order = ['原作', '总导演', '导演', '副导演', '系列监督', '系列构成', '编剧', '人设原案', '动画人设', '音乐', '音响监督', '美术监督', '色彩设计', '摄影监督', '剪辑', '动画制作'];
export function normalizeCharacterName(value: unknown, id: number): CharacterName {
  if (!isRecord(value) || value.id !== id || typeof value.name !== 'string' || !value.name.trim()) throw new Error('角色详情响应无效');
  const infobox = Array.isArray(value.infobox) ? value.infobox.filter(isRecord) : [];
  let chinese = '';
  for (const key of ['简体中文名', '中文名', '繁体中文名']) {
    const entry = infobox.find(item => item.key === key);
    const name = typeof entry?.value === 'string' ? entry.value : Array.isArray(entry?.value) ? entry.value.filter(isRecord).find(item => typeof item.v === 'string' && item.v.trim())?.v : '';
    if (typeof name === 'string' && name.trim()) { chinese = name.trim(); break; }
  }
  return { id, name: chinese || (typeof value.name_cn === 'string' ? value.name_cn.trim() : '') || value.name.trim(), originalName: value.name.trim() };
}
function grouped(entries: StaffCredit[]): StaffCredit[] {
  const result = new Map<string, Set<string>>();
  for (const entry of entries) {
    const names = result.get(entry.role) ?? new Set<string>();
    entry.names.map(name => name.trim()).filter(Boolean).forEach(name => names.add(name));
    if (names.size) result.set(entry.role, names);
  }
  return [...result].map(([role, names]) => ({ role, names: [...names] })).sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
}
export function infoboxStaff(value: unknown): StaffCredit[] {
  if (!Array.isArray(value)) return [];
  return grouped(value.filter(isRecord).flatMap(entry => {
    const role = Object.hasOwn(roles, String(entry.key)) ? roles[String(entry.key)] : undefined; if (!role) return [];
    const names = typeof entry.value === 'string' ? [entry.value] : Array.isArray(entry.value) ? entry.value.filter(isRecord).map(item => item.v).filter((name): name is string => typeof name === 'string') : [];
    return [{ role, names }];
  }));
}
export function normalizeStaff(value: unknown): StaffCredit[] {
  if (!Array.isArray(value) || !value.every(entry => isRecord(entry) && typeof entry.name === 'string' && typeof entry.relation === 'string')) throw new Error('制作人员响应格式无效');
  return grouped(value.flatMap(entry => {
    const role = Object.hasOwn(roles, entry.relation) ? roles[entry.relation] : undefined; return role ? [{ role, names: [entry.name] }] : [];
  }));
}
export function normalizeCast(value: unknown): CastCredit[] {
  if (!Array.isArray(value) || !value.every(entry => isRecord(entry) && Number.isSafeInteger(entry.id) && Number(entry.id) > 0 && typeof entry.name === 'string' && typeof entry.relation === 'string' && (entry.actors === undefined || Array.isArray(entry.actors)))) throw new Error('角色配音响应格式无效');
  const result: CastCredit[] = [], seen = new Set<number>();
  for (const entry of value) {
    if (!['主角', '配角'].includes(entry.relation) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const actors = new Map<number, { id: number; name: string }>();
    for (const actor of (entry.actors ?? []).filter(isRecord)) {
      if (Number.isSafeInteger(actor.id) && Number(actor.id) > 0 && typeof actor.name === 'string' && actor.name.trim()) actors.set(Number(actor.id), { id: Number(actor.id), name: actor.name.trim() });
    }
    result.push({ id: entry.id, name: entry.name, relation: entry.relation, actors: [...actors.values()] });
  }
  return result.sort((a, b) => Number(a.relation !== '主角') - Number(b.relation !== '主角'));
}
export function mergeStaff(primary: StaffCredit[], fallback: StaffCredit[]): StaffCredit[] {
  const known = new Set(primary.map(entry => entry.role));
  return grouped([...primary, ...fallback.filter(entry => !known.has(entry.role))]);
}

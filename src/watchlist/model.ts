import type { Anime } from '../../shared/types';
import { parseBackup } from '../favorites';

export const WATCH_STATUSES = ['wanted', 'watching', 'completed', 'paused', 'dropped'] as const;
export type WatchStatus = typeof WATCH_STATUSES[number];
export const WATCH_STATUS_LABELS: Record<WatchStatus, string> = {
  wanted: '想看', watching: '在看', completed: '看完', paused: '搁置', dropped: '弃番',
};

export const WATCH_LIMITS = { watched: 99_999, note: 1000, listName: 60, listDescription: 300, titles: 60_000 } as const;
const maxRecords = 30_000, maxLists = 500, maxMemberships = 150_000;
const maxTitle = 500, maxAliases = 32;

export interface WatchRecord {
  id: string;
  status: WatchStatus;
  watched: number | null;
  plannedDate: string | null;
  personalScore: number | null;
  note: string;
  archived: boolean;
  updatedAt: string;
}

export interface WatchList { id: string; name: string; description: string; pinned: boolean; createdAt: string }
export interface WatchMembership { listId: string; animeId: string }
export interface WatchTitle {
  id: string;
  title: string;
  originalTitle: string;
  aliases: string[];
  season: string;
  type: 'tv' | 'web';
  episodes: number | null;
}

export interface WatchSnapshot {
  records: WatchRecord[];
  lists: WatchList[];
  memberships: WatchMembership[];
  titles: WatchTitle[];
}

export interface ParsedWatchBackup { version: 1 | 2; favorites: string[]; snapshot: WatchSnapshot }
export type WatchRecordPatch = Partial<Omit<WatchRecord, 'id' | 'updatedAt'>>;

export function emptyWatchSnapshot(): WatchSnapshot {
  return { records: [], lists: [], memberships: [], titles: [] };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('追番资料格式无效。');
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, limit: number, label: string) {
  if (typeof value !== 'string' || value.length > limit) throw new Error(`${label}格式无效或超出长度限制。`);
  return value;
}

function validAnimeId(value: unknown): value is string {
  return typeof value === 'string' && value.length < 120 && /^(bgm:\d+|bd:[\w-]+)$/.test(value);
}

function animeId(value: unknown) {
  if (!validAnimeId(value)) throw new Error('作品 ID 无效。');
  return value;
}

function listId(value: unknown) {
  if (typeof value !== 'string' || !/^[\w-]{1,80}$/.test(value)) throw new Error('清单 ID 无效。');
  return value;
}

function isoTimestamp(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) throw new Error('记录时间格式无效。');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== (value.includes('.') ? value : value.replace('Z', '.000Z'))) throw new Error('记录时间格式无效。');
  return value;
}

export function normalizeWatchDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('请选择有效的观看日期。');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('请选择有效的观看日期。');
  return value;
}

function count(value: unknown, label: string, minimum = 0) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > WATCH_LIMITS.watched) throw new Error(`${label}必须是有效整数。`);
  return value;
}

function checkedRecord(raw: unknown): WatchRecord {
  const value = object(raw);
  if (!WATCH_STATUSES.includes(value.status as WatchStatus)) throw new Error('观看状态无效。');
  if (typeof value.archived !== 'boolean' || value.plannedDate === undefined) throw new Error('观看记录格式无效。');
  const personalScore = value.personalScore;
  if (personalScore !== null && (typeof personalScore !== 'number' || personalScore < .5 || personalScore > 10 || !Number.isInteger(personalScore * 2))) {
    throw new Error('个人评分须在 0.5 至 10 之间，以 0.5 为间隔。');
  }
  return {
    id: animeId(value.id), status: value.status as WatchStatus,
    watched: count(value.watched, '已看集数'), plannedDate: normalizeWatchDate(value.plannedDate), personalScore,
    note: boundedText(value.note, WATCH_LIMITS.note, '备注'), archived: value.archived,
    updatedAt: isoTimestamp(value.updatedAt),
  };
}

export function defaultWatchRecord(id: string): WatchRecord {
  return { id, status: 'wanted', watched: null, plannedDate: null, personalScore: null, note: '', archived: false, updatedAt: '' };
}

export function updateWatchRecord(previous: WatchRecord, patch: WatchRecordPatch, at: string): WatchRecord {
  const next = checkedRecord({ ...previous, ...patch, id: previous.id, updatedAt: at });
  if (previous.status === 'wanted' && (previous.watched ?? 0) === 0 && (next.watched ?? 0) > 0 && next.status === 'wanted') next.status = 'watching';
  return next;
}

function checkedList(raw: unknown): WatchList {
  const value = object(raw);
  const name = boundedText(value.name, WATCH_LIMITS.listName, '清单名').trim();
  if (!name || typeof value.pinned !== 'boolean') throw new Error('清单格式无效。');
  return { id: listId(value.id), name, description: boundedText(value.description, WATCH_LIMITS.listDescription, '清单简介'), pinned: value.pinned, createdAt: isoTimestamp(value.createdAt) };
}

function checkedMembership(raw: unknown): WatchMembership {
  const value = object(raw);
  return { listId: listId(value.listId), animeId: animeId(value.animeId) };
}

function checkedTitle(raw: unknown): WatchTitle {
  const value = object(raw);
  if (value.type !== 'tv' && value.type !== 'web') throw new Error('作品类型无效。');
  const season = boundedText(value.season, 12, '季度');
  if (season !== 'unknown' && !/^\d{4}-[1-4]$/.test(season)) throw new Error('作品季度无效。');
  if (!Array.isArray(value.aliases) || value.aliases.length > maxAliases) throw new Error('作品别名格式无效。');
  const id = animeId(value.id);
  return {
    id, title: boundedText(value.title, maxTitle, '作品名').trim() || id,
    originalTitle: boundedText(value.originalTitle, maxTitle, '作品原名'),
    aliases: [...new Set(value.aliases.map(alias => boundedText(alias, maxTitle, '作品别名')))],
    season, type: value.type, episodes: count(value.episodes, '条目收录集数', 1),
  };
}

export function watchTitle(anime: Pick<Anime, 'id' | 'title' | 'originalTitle' | 'aliases' | 'season' | 'type'>, episodes: number | null = null): WatchTitle {
  return checkedTitle({
    id: anime.id, title: anime.title.slice(0, maxTitle), originalTitle: anime.originalTitle.slice(0, maxTitle),
    aliases: anime.aliases.slice(0, maxAliases).map(alias => alias.slice(0, maxTitle)),
    season: anime.season, type: anime.type,
    episodes: episodes !== null && Number.isSafeInteger(episodes) && episodes > 0 && episodes <= WATCH_LIMITS.watched ? episodes : null,
  });
}

function rows<T>(input: unknown, max: number, check: (value: unknown) => T, key: (value: T) => string) {
  if (!Array.isArray(input) || input.length > max) throw new Error('追番资料格式无效或超出数量限制。');
  const seen = new Map<string, T>();
  for (const value of input) {
    const checked = check(value), identity = key(checked);
    if (!seen.has(identity)) seen.set(identity, checked);
  }
  return [...seen.values()];
}

export const watchMembershipKey = (value: WatchMembership) => `${value.listId}|${value.animeId}`;

export function validateWatchSnapshot(raw: unknown): WatchSnapshot {
  const value = object(raw);
  const records = rows(value.records, maxRecords, checkedRecord, row => row.id);
  const lists = rows(value.lists, maxLists, checkedList, row => row.id);
  const titles = rows(value.titles, WATCH_LIMITS.titles, checkedTitle, row => row.id);
  const memberships = rows(value.memberships, maxMemberships, checkedMembership, watchMembershipKey);
  const ids = new Set(lists.map(list => list.id));
  if (memberships.some(row => !ids.has(row.listId))) throw new Error('追番资料包含未定义的清单。');
  return { records, lists, memberships, titles };
}

function favoriteIds(value: unknown) {
  if (!Array.isArray(value) || value.length > maxRecords || !value.every(validAnimeId)) throw new Error('备份收藏 ID 无效或超出数量限制。');
  return [...new Set(value)];
}

export function parseWatchBackup(text: string): ParsedWatchBackup {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('备份不是有效的 JSON 文件，现有记录未改动。'); }
  const value = object(raw);
  if (value.version === 1) return { version: 1, favorites: parseBackup(text, []), snapshot: emptyWatchSnapshot() };
  if (value.version !== 2) throw new Error('备份版本不支持，现有记录未改动。');
  isoTimestamp(value.exportedAt);
  return { version: 2, favorites: favoriteIds(value.favorites), snapshot: validateWatchSnapshot(value) };
}

export function exportWatchBackup(favorites: string[], snapshot: WatchSnapshot, at: string): string {
  return JSON.stringify({ version: 2, exportedAt: isoTimestamp(at), favorites: favoriteIds(favorites), ...validateWatchSnapshot(snapshot) }, null, 2);
}

function listNameKey(name: string) { return name.normalize('NFKC').trim().toLocaleLowerCase('zh-CN'); }

function availableListName(name: string, taken: Set<string>) {
  let candidate = name, number = 0;
  while (taken.has(listNameKey(candidate))) {
    const suffix = `（导入 ${++number}）`;
    candidate = name.slice(0, WATCH_LIMITS.listName - suffix.length).trimEnd() + suffix;
  }
  taken.add(listNameKey(candidate));
  return candidate;
}

function differentRecord(left: WatchRecord, right: WatchRecord) {
  return left.status !== right.status || left.watched !== right.watched || left.plannedDate !== right.plannedDate ||
    left.personalScore !== right.personalScore || left.note !== right.note || left.archived !== right.archived;
}

export function mergeWatchBackup(current: WatchSnapshot, incoming: WatchSnapshot) {
  const records = new Map(current.records.map(record => [record.id, record]));
  const lists = new Map(current.lists.map(list => [list.id, list]));
  const titles = new Map(current.titles.map(title => [title.id, title]));
  const memberships = new Map(current.memberships.map(row => [watchMembershipKey(row), row]));
  const taken = new Set(current.lists.map(list => listNameKey(list.name)));
  let addedRecords = 0, conflicts = 0, addedLists = 0;
  for (const record of incoming.records) {
    const existing = records.get(record.id);
    if (!existing) { records.set(record.id, record); addedRecords++; }
    else if (differentRecord(existing, record)) conflicts++;
  }
  for (const list of incoming.lists) {
    if (lists.has(list.id)) continue;
    lists.set(list.id, { ...list, name: availableListName(list.name, taken) });
    addedLists++;
  }
  for (const title of incoming.titles) if (!titles.has(title.id)) titles.set(title.id, title);
  for (const membership of incoming.memberships) memberships.set(watchMembershipKey(membership), membership);
  const snapshot = validateWatchSnapshot({
    records: [...records.values()], lists: [...lists.values()], memberships: [...memberships.values()], titles: [...titles.values()],
  });
  return { snapshot, addedRecords, conflicts, addedLists };
}

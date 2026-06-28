import { normalizeTimestamp } from './time.js';

export const KEY = 'timelog.v1';
export const THEME_KEY = 'timelog.theme';
export const VIEW_KEY = 'timelog.view';
export const SELECTED_DATE_KEY = 'timelog.selectedDate';
export const OPEN_DATE_KEY = 'timelog.openDate';
export const SEEDS = ['求职推进', '研究·学工具·逃避', '未知', '杂'];

export function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || { version: 1, entries: [] };
  } catch {
    return { version: 1, entries: [] };
  }
}

export function save(d) {
  localStorage.setItem(KEY, JSON.stringify(d));
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function validateImportData(imported) {
  if (!imported || !Array.isArray(imported.entries)) {
    return { ok: false, msg: '文件格式不对：缺少 entries 数组。' };
  }
  const valid = imported.entries.every(en => en.id && en.ts && en.what && normalizeTimestamp(en.ts));
  if (!valid) {
    return { ok: false, msg: '文件格式不对：部分条目缺少必要字段（id/ts/what）或时间格式不正确。' };
  }
  return { ok: true };
}

export function mergeImportedEntries(current, importedEntries) {
  const map = {};
  current.entries.forEach(en => { map[en.id] = en; });
  importedEntries.forEach(en => { map[en.id] = en; });
  current.entries = Object.values(map).sort((a, b) => a.ts < b.ts ? -1 : 1);
  return current;
}

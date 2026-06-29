import { sortedEntriesFrom } from './stats.js';
import {
  addDays,
  localDateTimeKey,
  normalizeTimestamp,
  nowStr,
  p2,
  parseDateKey,
  startOfDay,
  todayStr
} from './time.js';

export function isPlaceholderEntry(entry) {
  return Boolean(entry && typeof entry.what === 'string' && entry.what.trim() === '');
}

export function entriesOnDate(entries, dateKey) {
  return sortedEntriesFrom(entries).filter(entry => entry.ts.slice(0, 10) === dateKey);
}

export function lastEntryOnDate(entries, dateKey) {
  const entriesForDay = entriesOnDate(entries, dateKey);
  return entriesForDay.length ? entriesForDay[entriesForDay.length - 1] : null;
}

export function openPlaceholderForDate(entries, dateKey) {
  const last = lastEntryOnDate(entries, dateKey);
  return isPlaceholderEntry(last) ? last : null;
}

export function defaultFormTimestamp(entries, dateKey) {
  const placeholder = openPlaceholderForDate(entries, dateKey);
  if (placeholder) return placeholder.ts;
  const last = lastEntryOnDate(entries, dateKey);
  if (last) return last.ts;
  return `${dateKey}T00:00`;
}

export function settlementEndFor(entries, startTs, dateKey, opts = {}) {
  const normalizedStart = normalizeTimestamp(startTs);
  if (!normalizedStart) return { endTs: '', isNow: false, isDayEnd: false };
  const startDateKey = normalizedStart.slice(0, 10);
  const targetDateKey = parseDateKey(startDateKey) ? startDateKey : dateKey;
  const next = entriesOnDate(entries, targetDateKey).find(entry => entry.ts > normalizedStart);
  if (next) return { endTs: next.ts, isNow: false, isDayEnd: false };
  const todayKey = opts.todayKey || todayStr();
  if (targetDateKey === todayKey) return { endTs: opts.nowTs || nowStr(), isNow: true, isDayEnd: false };
  const day = parseDateKey(targetDateKey);
  if (!day) return { endTs: opts.nowTs || nowStr(), isNow: true, isDayEnd: false };
  return { endTs: localDateTimeKey(addDays(startOfDay(day), 1)), isNow: false, isDayEnd: true };
}

export function findTimeConflict(entries, ts, selfId = '') {
  return entries.find(entry => entry.ts === ts && entry.id !== selfId) || null;
}

export function addOneMinute(ts) {
  const d = new Date(ts);
  d.setMinutes(d.getMinutes() + 1);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export function ensureOpenPlaceholderAt(entries, ts, completedId = '', createId) {
  const existing = entries.find(entry => entry.ts === ts && entry.id !== completedId);
  if (existing) {
    if (isPlaceholderEntry(existing)) {
      existing.what = '';
      existing.tags = [];
      delete existing.longConfirm;
    }
    return existing;
  }
  if (completedId && entries.some(entry => entry.id === completedId && entry.ts === ts)) return null;
  const placeholder = { id: createId(), ts, what: '', tags: [] };
  entries.push(placeholder);
  return placeholder;
}

function htmlEscape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function conflictMessage(conflict, ts, plusAction) {
  const what = htmlEscape((conflict.what || '未填写').replace(/\s+/g, ' ').slice(0, 36));
  return `同一时刻已有「${what}」。<button class="mini-btn" type="button" data-action="edit-conflict-entry" data-id="${htmlEscape(conflict.id)}">编辑那条</button><button class="mini-btn" type="button" data-action="${plusAction}" data-ts="${htmlEscape(ts)}">用+1min</button>`;
}

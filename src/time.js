// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
export function p2(n) {
  return String(n).padStart(2, '0');
}

export function localDateKey(d) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

export function localDateTimeKey(d) {
  return `${localDateKey(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export function nowStr() {
  return localDateTimeKey(new Date());
}

export function todayStr() {
  return localDateKey(new Date());
}

export function hhmm(ts) {
  const d = new Date(ts);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMonths(d, n) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

export function addYears(d, n) {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + n);
  return x;
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function startOfWeek(d) {
  const x = startOfDay(d);
  const day = x.getDay() || 7;
  x.setDate(x.getDate() - day + 1);
  return x;
}

export function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function startOfYear(d) {
  return new Date(d.getFullYear(), 0, 1);
}

export function minsBetweenDates(a, b) {
  return Math.max(0, (b - a) / 60000);
}

export function fmtMins(m) {
  if (m < 1) return '<1min';
  if (m < 60) return `~${Math.round(m)}min`;
  const h = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return rem ? `~${h}h${rem}min` : `~${h}h`;
}

export function fmtPlainMins(m) {
  return m > 0 ? fmtMins(m) : '0min';
}

export function fmtDateTime(d) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export function normalizeTimestamp(raw) {
  const value = String(raw || '').trim();
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T]+(\d{1,2}):(\d{1,2})$/.exec(value);
  if (!m) return '';
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const d = new Date(y, mo - 1, da, h, mi);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da || d.getHours() !== h || d.getMinutes() !== mi) return '';
  return `${y}-${p2(mo)}-${p2(da)}T${p2(h)}:${p2(mi)}`;
}

export function validateTs(raw) {
  const ts = normalizeTimestamp(raw);
  if (!ts) return { ok: false, msg: '请输入完整日期和时间，例如 2026-06-28 09:05。' };
  if (new Date(ts) > new Date(Date.now() + 5 * 60000)) return { ok: false, msg: '不能记录明显未来的时间。' };
  return { ok: true, ts };
}

export function validatePlannedTs(raw, dateKey) {
  const ts = normalizeTimestamp(raw);
  if (!ts) return { ok: false, msg: '请输入完整日期和时间，例如 2026-06-28 09:05。' };
  const when = new Date(ts);
  const now = new Date();
  if (when <= new Date(now.getTime() + 5 * 60000)) {
    return { ok: false, msg: '计划时间应晚于现在。' };
  }
  const dayStart = parseDateKey(dateKey) || startOfDay(now);
  const dayEnd = addDays(dayStart, 1);
  const maxFuture = addDays(now, 7);
  const max = dayEnd < maxFuture ? dayEnd : maxFuture;
  if (when >= max) return { ok: false, msg: '计划时间不能超出所选日或 7 天后。' };
  return { ok: true, ts };
}

export function validateTsForMode(raw, opts = {}) {
  if (opts.planned) return validatePlannedTs(raw, opts.dateKey);
  return validateTs(raw);
}

export function fmtTs(ts) {
  const value = normalizeTimestamp(ts);
  return value ? value.replace('T', ' ') : String(ts || '');
}

export function dateLabel(d) {
  return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} 周${'日一二三四五六'[d.getDay()]}`;
}

export function shortDateLabel(d) {
  return `${d.getMonth() + 1}/${d.getDate()} 周${'日一二三四五六'[d.getDay()]}`;
}

export function shortRangeLabel(start, end) {
  const last = addDays(end, -1);
  return `${p2(start.getMonth() + 1)}/${p2(start.getDate())}-${p2(last.getMonth() + 1)}/${p2(last.getDate())}`;
}

export function periodRange(view, dateKey) {
  const base = parseDateKey(dateKey) || new Date();
  if (view === 'week') {
    const start = startOfWeek(base);
    return { start, end: addDays(start, 7) };
  }
  if (view === 'month') {
    const start = startOfMonth(base);
    return { start, end: addMonths(start, 1) };
  }
  if (view === 'year') {
    const start = startOfYear(base);
    return { start, end: addYears(start, 1) };
  }
  const start = startOfDay(base);
  return { start, end: addDays(start, 1) };
}

export function periodLabel(view, dateKey, opts = {}) {
  const { start, end } = periodRange(view, dateKey);
  const last = addDays(end, -1);
  if (view === 'day') return dateLabel(start);
  if (view === 'week') return opts.short ? shortRangeLabel(start, end) : `${dateLabel(start)} - ${p2(last.getMonth() + 1)}/${p2(last.getDate())}`;
  if (view === 'month') return `${start.getFullYear()}年${start.getMonth() + 1}月`;
  return `${start.getFullYear()}年`;
}

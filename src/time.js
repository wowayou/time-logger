// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
import { getLocale, t, tList } from './i18n.js';

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

export function inclusiveCalendarDayCount(startKey, endKey) {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  if (!start || !end) return 1;
  // 用 UTC 日序只比较日历日期，避开夏令时造成的 23/25 小时自然日。
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(1, Math.round((endDay - startDay) / 86400000) + 1);
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

function startOfWeek(d) {
  const x = startOfDay(d);
  const day = x.getDay() || 7;
  x.setDate(x.getDate() - day + 1);
  return x;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfYear(d) {
  return new Date(d.getFullYear(), 0, 1);
}

export function minsBetweenDates(a, b) {
  return Math.max(0, (b - a) / 60000);
}

// SPEC-014 §3: the zh path below is byte-for-byte the pre-existing behavior
// (never touched) — the en branch is a separate early return, so switching
// locales cannot change a single byte of zh output.
function fmtMinsEn(m) {
  if (m < 1) return '<1m';
  if (m < 60) return `${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

export function fmtMins(m) {
  if (getLocale() === 'en') return fmtMinsEn(m);
  if (m < 1) return '<1min';
  if (m < 60) return `~${Math.round(m)}min`;
  const h = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return rem ? `~${h}h${rem}min` : `~${h}h`;
}

export function fmtPlainMins(m) {
  if (getLocale() === 'en') return m > 0 ? fmtMinsEn(m) : '0m';
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
  if (!ts) return { ok: false, msg: t('validate.needFullDateTime') };
  if (new Date(ts) > new Date(Date.now() + 5 * 60000)) return { ok: false, msg: t('validate.noFarFuture') };
  return { ok: true, ts };
}

function validNow(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value === undefined ? Date.now() : value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function planningWindow(now = new Date()) {
  const current = validNow(now);
  const todayStart = startOfDay(current);
  return {
    now: current,
    todayKey: localDateKey(todayStart),
    minExclusive: new Date(current.getTime() + 5 * 60000),
    maxExclusive: addDays(todayStart, 8),
    maxDateKey: localDateKey(addDays(todayStart, 8))
  };
}

export function entryModeForDate(dateKey, now = new Date()) {
  const window = planningWindow(now);
  if (!parseDateKey(dateKey)) return { kind: 'unavailable', forcedMode: '', canCreate: false, ...window };
  if (dateKey < window.todayKey) return { kind: 'history', forcedMode: 'log', canCreate: true, ...window };
  if (dateKey === window.todayKey) return { kind: 'today', forcedMode: '', canCreate: true, ...window };
  if (dateKey < window.maxDateKey) return { kind: 'future', forcedMode: 'plan', canCreate: true, ...window };
  return { kind: 'unavailable', forcedMode: '', canCreate: false, ...window };
}

export function defaultPlannedTimestamp(dateKey, now = new Date()) {
  const window = planningWindow(now);
  if (dateKey && dateKey > window.todayKey) return `${dateKey}T09:00`;
  const candidate = new Date(window.minExclusive);
  candidate.setSeconds(0, 0);
  const remainder = candidate.getMinutes() % 5;
  if (remainder) candidate.setMinutes(candidate.getMinutes() + (5 - remainder));
  if (candidate <= window.minExclusive) candidate.setMinutes(candidate.getMinutes() + 5);
  return localDateTimeKey(candidate);
}

function validatePlannedTs(raw, opts = {}) {
  const ts = normalizeTimestamp(raw);
  if (!ts) return { ok: false, msg: t('validate.needFullDateTime') };
  const when = new Date(ts);
  const window = planningWindow(opts.now);
  if (when <= window.minExclusive) {
    return { ok: false, msg: t('validate.planTooSoon') };
  }
  if (when >= window.maxExclusive) return { ok: false, msg: t('validate.planTooFar') };
  return { ok: true, ts };
}

export function validateTsForMode(raw, opts = {}) {
  if (opts.planned) return validatePlannedTs(raw, opts);
  return validateTs(raw);
}

export function fmtTs(ts) {
  const value = normalizeTimestamp(ts);
  return value ? value.replace('T', ' ') : String(ts || '');
}

function weekdayNarrow(d) {
  return tList('date.weekdayNarrow')[d.getDay()] || '';
}

// SPEC-014 §3: the only locale-branching date formatting in the app. The zh
// path is the pre-existing hand-written format, untouched byte-for-byte; en
// uses Intl.DateTimeFormat('en-US', …) with no `timeZone` option — the Date
// objects here are already local-wall-clock values, and passing a timeZone
// would introduce the timezone conversion CLAUDE.md forbids.
function dateLabel(d) {
  if (getLocale() === 'en') {
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(d);
  }
  return t('date.full', {
    y: d.getFullYear(), m: p2(d.getMonth() + 1), d: p2(d.getDate()), wd: weekdayNarrow(d)
  });
}

export function shortDateLabel(d) {
  if (getLocale() === 'en') {
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' }).format(d);
  }
  return t('date.short', { m: d.getMonth() + 1, d: d.getDate(), wd: weekdayNarrow(d) });
}

function shortRangeLabel(start, end) {
  const last = addDays(end, -1);
  return `${p2(start.getMonth() + 1)}/${p2(start.getDate())}-${p2(last.getMonth() + 1)}/${p2(last.getDate())}`;
}

function enMonthDay(d) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
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
  const isEn = getLocale() === 'en';
  if (view === 'day') return dateLabel(start);
  if (view === 'week') {
    if (opts.short) return shortRangeLabel(start, end);
    if (isEn) return `${enMonthDay(start)} – ${enMonthDay(last)}`;
    return `${dateLabel(start)} - ${p2(last.getMonth() + 1)}/${p2(last.getDate())}`;
  }
  if (view === 'month') {
    if (isEn) return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(start);
    return t('date.monthLabel', { y: start.getFullYear(), m: start.getMonth() + 1 });
  }
  if (isEn) return String(start.getFullYear());
  return t('date.yearLabel', { y: start.getFullYear() });
}

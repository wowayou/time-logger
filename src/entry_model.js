// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
import { GAP, isPlaceholderEntry, loggedEntriesFrom, primaryTag } from './stats.js';
// SPEC-013：保留标签 id 是数据常量（不是文案），本模块仍不访问 DOM / localStorage。
import { RESERVED_UNKNOWN_TAG } from './storage.js';
import { t } from './i18n.js';
import {
  addDays,
  hhmm,
  localDateKey,
  localDateTimeKey,
  minsBetweenDates,
  normalizeTimestamp,
  nowStr,
  p2,
  parseDateKey,
  startOfDay,
  todayStr
} from './time.js';

function entriesOnDate(entries, dateKey) {
  return loggedEntriesFrom(entries).filter(entry => entry.ts.slice(0, 10) === dateKey);
}

function lastEntryOnDate(entries, dateKey) {
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
  if (last && last.ongoing) return nowStr();
  if (last) {
    // v77：走到这里说明尾点是一条**真实**记录（占位与进行中都已在上面返回）。
    // 非今天的日子里，最后一条真实记录按定义一直覆盖到 24:00——那天没有「可续」
    // 的尾巴，返回它自己的 ts 会让默认起点恒撞同刻冲突（点 FAB 进表单直接保存
    // 必被拦，默认值从来不可用）。改取其后一分钟；若尾点已是 23:59，当天再无
    // 空位，返回空串由调用方收敛入口（renderChrome 隐藏 FAB），**绝不越过午夜
    // 把默认值写进第二天**——那会让「补记这一天」静默变成写另一天。
    const next = addOneMinute(last.ts);
    return next.slice(0, 10) === dateKey ? next : '';
  }
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

function ensureOpenPlaceholderAt(entries, ts, completedId = '', createId) {
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

// Drop redundant boundary points: a logged entry that starts a segment carrying
// the exact same content (primary tag AND `what` text) as the one before it adds
// no information. Comparing `what` too is essential — two back-to-back records
// that merely share a tag (写代码 / 写方案, both 求职推进) are distinct and must NOT
// merge; only a true duplicate boundary or two adjacent empty placeholders do.
// This is what lets a deleted split-middle self-heal (the synthetic restore point
// duplicates the owner) and folds stray placeholders together. Planned entries
// never participate. Mutates `entries` in place.
export function coalesceRedundant(entries) {
  const logged = entries
    .filter(entry => !entry.planned && normalizeTimestamp(entry.ts))
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const removeIds = new Set();
  let prevSig = null;
  let prevEntry = null;
  for (const entry of logged) {
    const sig = `${entry.ts.slice(0, 10)}\u0000${primaryTag(entry)}\u0000${(entry.what || '').trim()}`;
    if (prevSig === sig) {
      if (entry.ongoing && prevEntry) prevEntry.ongoing = true;
      removeIds.add(entry.id);
    } else {
      prevSig = sig;
      prevEntry = entry;
    }
  }
  if (removeIds.size) {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (removeIds.has(entries[i].id)) entries.splice(i, 1);
    }
  }
  return entries;
}

// The single post-write normalization out. Every mutation path funnels through
// here on the same object graph it will save (P1): fold redundant boundaries,
// then guarantee today keeps a tail placeholder at `now` so the hot-path default
// start can always fill it and never collide (kills the "+1min" friction).
export function normalizeEntries(d, opts = {}) {
  if (!d || !Array.isArray(d.entries)) return d;
  coalesceRedundant(d.entries);
  const todayKey = opts.todayKey || todayStr();
  const nowTs = opts.nowTs || nowStr();
  const createId = opts.createId;
  const logged = loggedEntriesFrom(d.entries);
  logged.forEach((entry, index) => {
    const next = logged[index + 1];
    if (entry.ongoing && next && next.ts.slice(0, 10) === entry.ts.slice(0, 10)) {
      delete entry.ongoing;
    }
  });
  const last = lastEntryOnDate(d.entries, todayKey);
  if (createId && last && !last.ongoing && !isPlaceholderEntry(last) && nowTs > last.ts) {
    ensureOpenPlaceholderAt(d.entries, nowTs, '', createId);
  }
  return d;
}

function cloneEntry(entry) {
  const copy = { ...entry };
  if (Array.isArray(entry.tags)) copy.tags = entry.tags.slice();
  if (entry.longConfirm && typeof entry.longConfirm === 'object') {
    copy.longConfirm = { ...entry.longConfirm };
  }
  return copy;
}

export function cloneEntries(entries) {
  return (entries || []).map(cloneEntry);
}

function comparableEntry(entry) {
  return {
    id: entry.id,
    ts: entry.ts,
    what: entry.what,
    tags: Array.isArray(entry.tags) ? entry.tags.slice() : [],
    planned: entry.planned === true || undefined,
    ongoing: entry.ongoing === true || undefined,
    longConfirm: entry.longConfirm
      ? { startTs: entry.longConfirm.startTs, endTs: entry.longConfirm.endTs }
      : undefined
  };
}

export function entriesRevision(entries) {
  const values = (entries || [])
    .map(comparableEntry)
    .sort((a, b) => a.ts === b.ts
      ? String(a.id).localeCompare(String(b.id))
      : (a.ts < b.ts ? -1 : 1));
  return JSON.stringify(values);
}

function shiftedMinute(ts, amount) {
  const value = normalizeTimestamp(ts);
  if (!value) return '';
  const d = new Date(value);
  d.setMinutes(d.getMinutes() + amount);
  return localDateTimeKey(d);
}

function dayBounds(dateKey) {
  const day = parseDateKey(dateKey);
  if (!day) return null;
  return {
    startTs: localDateTimeKey(startOfDay(day)),
    endTs: localDateTimeKey(addDays(startOfDay(day), 1))
  };
}

function entryLabel(entry) {
  if (!entry || isPlaceholderEntry(entry)) return t('entry.unrecordedLabel');
  return entry.what || primaryTag(entry) || t('entry.unrecordedLabel');
}

function entryTagsEqual(a, b) {
  const left = Array.isArray(a && a.tags) ? a.tags : [];
  const right = Array.isArray(b && b.tags) ? b.tags : [];
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function entryContentEqual(a, b) {
  return Boolean(a && b)
    && String(a.what || '') === String(b.what || '')
    && entryTagsEqual(a, b);
}

function loggedOnDay(entries, dateKey) {
  return loggedEntriesFrom(entries)
    .filter(entry => entry.ts.slice(0, 10) === dateKey);
}

/**
 * 事务 planner 统一返回形态：`ok` 必须保持字面量类型，`npm run typecheck`
 * 才能对 `if (!x.ok) return x` 之后的分支收窄。
 * @typedef {{ ok: true } & Record<string, any>} TxOk
 * @typedef {{ ok: false, reason: string, message: string } & Record<string, any>} TxError
 */

/** @returns {TxOk} */
function transactionResult(resultEntries, details = {}) {
  resultEntries.sort((a, b) => a.ts === b.ts
    ? String(a.id).localeCompare(String(b.id))
    : (a.ts < b.ts ? -1 : 1));
  return {
    ok: true,
    ...details,
    resultEntries,
    resultSignature: entriesRevision(resultEntries)
  };
}

/** @returns {TxError} */
function transactionError(reason, message, details = {}) {
  return { ok: false, reason, message, ...details };
}

function duplicateTimestamp(entries) {
  const seen = new Map();
  for (const entry of entries || []) {
    if (seen.has(entry.ts)) return { first: seen.get(entry.ts), second: entry };
    seen.set(entry.ts, entry);
  }
  return null;
}

function previewPart(role, entry, startTs, endTs, label) {
  if (!startTs || !endTs || endTs <= startTs) return null;
  return {
    role,
    id: entry && entry.id || '',
    label: label || entryLabel(entry),
    tag: entry ? primaryTag(entry) : RESERVED_UNKNOWN_TAG,
    startTs,
    endTs
  };
}

/** @returns {TxOk | TxError} */
export function overnightContinuationContext(entries, viewedDate, opts = {}) {
  const nowTs = normalizeTimestamp(opts.nowTs) || nowStr();
  const todayKey = opts.todayKey || nowTs.slice(0, 10) || todayStr();
  const today = parseDateKey(todayKey);
  if (!today) return transactionError('invalid-date', t('txn.invalidToday'));
  const yesterdayKey = localDateKey(addDays(startOfDay(today), -1));
  if (viewedDate !== yesterdayKey) return transactionError('not-yesterday', t('txn.notYesterday'));
  const yesterdayEntries = loggedOnDay(entries, yesterdayKey);
  const source = yesterdayEntries[yesterdayEntries.length - 1] || null;
  if (!source || !isPlaceholderEntry(source)) {
    return transactionError('no-placeholder', t('txn.noPlaceholder'));
  }
  const midnightTs = localDateTimeKey(startOfDay(today));
  const realToday = (entries || [])
    .filter(entry => !entry.planned
      && !isPlaceholderEntry(entry)
      && normalizeTimestamp(entry.ts)
      && entry.ts.slice(0, 10) === todayKey
      && entry.ts <= nowTs)
    .sort((a, b) => a.ts < b.ts ? -1 : (a.ts > b.ts ? 1 : String(a.id).localeCompare(String(b.id))));
  const hardEndEntry = realToday[0] || null;
  const hardEndTs = hardEndEntry ? hardEndEntry.ts : nowTs;
  if (hardEndTs <= midnightTs) {
    return transactionError('no-today-span', t('txn.noTodaySpan'));
  }
  return {
    ok: true,
    viewedDate,
    yesterdayKey,
    todayKey,
    source,
    sourceId: source.id,
    startTs: source.ts,
    startMin: source.ts,
    startMax: shiftedMinute(hardEndTs, -1),
    midnightTs,
    hardEndTs,
    hardEndEntry,
    hardEndIsNow: !hardEndEntry,
    dayEndTs: midnightTs
  };
}

export function planOvernightContinuation(entries, request, opts = {}) {
  const context = overnightContinuationContext(entries, request && request.viewedDate, opts);
  if (!context.ok) return context;
  if (request && request.sourceId && request.sourceId !== context.sourceId) {
    return transactionError('stale', t('txn.staleOvernight'), { context });
  }
  const frozenStart = normalizeTimestamp(request && request.frozenStart) || context.startTs;
  const startTs = normalizeTimestamp(request && request.startTs);
  if (!startTs) return transactionError('invalid-time', t('txn.needStart'), { context });
  const startMin = frozenStart > context.startTs ? frozenStart : context.startTs;
  if (startTs < startMin) {
    return transactionError('before-min', t('txn.beforeMin', { time: hhmm(startMin) }), { context: { ...context, startMin } });
  }
  if (startTs >= context.hardEndTs) {
    return transactionError('after-max', t('txn.afterMax', { time: hhmm(context.hardEndTs) }), { context: { ...context, startMin } });
  }
  if (startTs.slice(0, 10) !== context.yesterdayKey && startTs.slice(0, 10) !== context.todayKey) {
    return transactionError('outside-source', t('txn.outsideOvernight'), { context: { ...context, startMin } });
  }

  const what = String(request && request.what || '');
  const tags = Array.isArray(request && request.tags) ? request.tags.slice() : [];
  const resultEntries = cloneEntries(entries);
  const crossMidnight = startTs < context.midnightTs;
  const required = new Set([startTs, context.hardEndTs]);
  if (crossMidnight) required.add(context.midnightTs);
  for (let i = resultEntries.length - 1; i >= 0; i--) {
    const entry = resultEntries[i];
    if (isPlaceholderEntry(entry)
      && entry.ts > startTs
      && entry.ts < context.hardEndTs
      && !required.has(entry.ts)) {
      resultEntries.splice(i, 1);
    }
  }

  const createId = opts.createId || (() => `overnight-${Date.now()}`);
  /** @returns {TxOk | TxError} */
  const claimPoint = (ts, pointWhat, pointTags) => {
    const existing = resultEntries.find(entry => entry.ts === ts);
    if (existing && !isPlaceholderEntry(existing)) {
      return transactionError('conflict', t('txn.conflictAt', { time: hhmm(ts) }), { context, conflict: existing });
    }
    const point = existing || { id: createId(), ts, what: '', tags: [] };
    point.what = pointWhat;
    point.tags = pointTags.slice();
    delete point.longConfirm;
    delete point.planned;
    delete point.ongoing;
    if (!existing) resultEntries.push(point);
    return { ok: true, point };
  };

  const startPoint = claimPoint(startTs, what, tags);
  if (!startPoint.ok) return startPoint;
  let midnightPoint = null;
  if (crossMidnight) {
    midnightPoint = claimPoint(context.midnightTs, what, tags);
    if (!midnightPoint.ok) return midnightPoint;
  }
  if (context.hardEndIsNow) {
    const endPoint = claimPoint(context.hardEndTs, '', []);
    if (!endPoint.ok) return endPoint;
  }

  // D10/C7A：过夜表单两端都是用户显式断言，写入即视为已确认——只标超过
  // 确认阈值的段（短段标记无信息量）；若起点被 coalesceRedundant 并入前一条
  // 同内容记录，标记随点消亡，沿用「相邻边界变化即失效」的保守语义。
  const markConfirmed = (point, segStartTs, segEndTs) => {
    if (point && minsBetweenDates(new Date(segStartTs), new Date(segEndTs)) > GAP) {
      point.longConfirm = { startTs: segStartTs, endTs: segEndTs };
    }
  };
  markConfirmed(startPoint.point, startTs, crossMidnight ? context.midnightTs : context.hardEndTs);
  if (midnightPoint) markConfirmed(midnightPoint.point, context.midnightTs, context.hardEndTs);

  const duplicate = duplicateTimestamp(resultEntries);
  if (duplicate) return transactionError('conflict', t('txn.conflictOvernight'), { context, conflict: duplicate.second });
  coalesceRedundant(resultEntries);
  const preview = crossMidnight
    ? [
        previewPart('overnight-yesterday', startPoint.point, startTs, context.midnightTs, what || primaryTag(startPoint.point)),
        previewPart('overnight-today', startPoint.point, context.midnightTs, context.hardEndTs, what || primaryTag(startPoint.point))
      ]
    : [previewPart('overnight-today', startPoint.point, startTs, context.hardEndTs, what || primaryTag(startPoint.point))];
  return transactionResult(resultEntries, {
    kind: 'overnight-continuation',
    context: { ...context, startMin, crossMidnight },
    preview,
    durationMins: minsBetweenDates(new Date(startTs), new Date(context.hardEndTs))
  });
}

/** @returns {TxOk | TxError} */
export function intervalEditContext(entries, id, opts = {}) {
  const entry = (entries || []).find(item => item.id === id);
  if (!entry) return transactionError('missing', t('txn.missing'));
  if (entry.planned) return transactionError('planned', t('txn.plannedOnly'));
  if (isPlaceholderEntry(entry)) return transactionError('placeholder', t('txn.placeholderEdit'));
  const dateKey = entry.ts.slice(0, 10);
  const bounds = dayBounds(dateKey);
  if (!bounds) return transactionError('invalid-date', t('txn.invalidDate'));
  const onDay = loggedOnDay(entries, dateKey);
  const index = onDay.findIndex(item => item.id === id);
  if (index < 0) return transactionError('missing', t('txn.missing'));
  const previous = onDay[index - 1] || null;
  const next = onDay[index + 1] || null;
  const afterNext = onDay[index + 2] || null;
  const todayKey = opts.todayKey || todayStr();
  const nowTs = normalizeTimestamp(opts.nowTs) || nowStr();
  const limitTs = dateKey === todayKey && nowTs.slice(0, 10) === dateKey
    ? nowTs
    : bounds.endTs;
  const tailPlaceholder = Boolean(next && isPlaceholderEntry(next) && !afterNext);
  const isTail = !next || tailPlaceholder;
  const endTs = next ? next.ts : limitTs;
  let endMax = limitTs;
  if (next && !isTail) {
    const nextEnd = afterNext ? afterNext.ts : limitTs;
    endMax = shiftedMinute(nextEnd, -1);
  }
  const startMin = previous ? shiftedMinute(previous.ts, 1) : bounds.startTs;
  return {
    ok: true,
    entry,
    previous,
    next,
    afterNext,
    dateKey,
    dayStartTs: bounds.startTs,
    dayEndTs: bounds.endTs,
    limitTs,
    startTs: entry.ts,
    endTs,
    startMin,
    startMax: shiftedMinute(endTs, -1),
    endMin: shiftedMinute(entry.ts, 1),
    endMax,
    isTail,
    tailPlaceholder,
    canUseNow: isTail && dateKey === todayKey,
    startReason: previous
      ? t('txn.startAfterPrev', { label: entryLabel(previous) })
      : t('txn.startAfterMidnight'),
    endReason: isTail
      ? (dateKey === todayKey ? t('txn.endBeforeNow') : t('txn.endBeforeMidnight'))
      : t('txn.endBeforeNext', { label: entryLabel(next) })
  };
}

export function planIntervalEdit(entries, request, opts = {}) {
  const context = intervalEditContext(entries, request && request.id, opts);
  if (!context.ok) return context;
  const startTs = normalizeTimestamp(request && request.startTs);
  const requestedEnd = normalizeTimestamp(request && request.endTs);
  const endMode = request && request.endMode === 'now' ? 'now' : 'fixed';
  const endTs = endMode === 'now' ? context.limitTs : requestedEnd;
  if (!startTs || !endTs) return transactionError('invalid-time', t('txn.needStartEnd'), { context });
  if (startTs.slice(0, 10) !== context.dateKey
    || (endTs.slice(0, 10) !== context.dateKey && endTs !== context.dayEndTs)) {
    return transactionError('cross-day', t('txn.crossDay'), { context });
  }
  if (endMode === 'now' && !context.canUseNow) {
    return transactionError('not-tail', t('txn.notTail'), { context });
  }
  if (startTs < context.startMin) {
    return transactionError('before-min', context.startReason, { context });
  }
  if (endTs > context.endMax) {
    return transactionError('after-max', context.endReason, { context });
  }
  if (endTs <= startTs) {
    return transactionError('zero-duration', t('txn.zeroDuration'), { context });
  }
  const dynamicContext = {
    ...context,
    startMax: shiftedMinute(endTs, -1),
    endMin: shiftedMinute(startTs, 1)
  };

  const resultEntries = cloneEntries(entries);
  const current = resultEntries.find(item => item.id === context.entry.id);
  const previous = context.previous && resultEntries.find(item => item.id === context.previous.id);
  const next = context.next && resultEntries.find(item => item.id === context.next.id);
  current.ts = startTs;
  if (typeof request.what === 'string') current.what = request.what;
  if (Array.isArray(request.tags)) current.tags = request.tags.slice();
  if (startTs !== context.startTs || endTs !== context.endTs) delete current.longConfirm;
  if (previous && startTs !== context.startTs) delete previous.longConfirm;

  if (endMode === 'now') {
    current.ongoing = true;
    if (next && context.tailPlaceholder) {
      const index = resultEntries.findIndex(item => item.id === next.id);
      if (index >= 0) resultEntries.splice(index, 1);
    }
  } else if (context.isTail) {
    delete current.ongoing;
    if (next && context.tailPlaceholder) {
      next.ts = endTs;
      next.what = '';
      next.tags = [];
      delete next.longConfirm;
      delete next.ongoing;
      delete next.planned;
    } else if (endTs < context.limitTs || context.dateKey === (opts.todayKey || todayStr())) {
      resultEntries.push({ id: opts.createId ? opts.createId() : `boundary-${Date.now()}`, ts: endTs, what: '', tags: [] });
    }
  } else if (next) {
    delete current.ongoing;
    next.ts = endTs;
    delete next.longConfirm;
  }

  const duplicate = duplicateTimestamp(resultEntries);
  if (duplicate) return transactionError('conflict', t('txn.conflictBoundary'), { context, conflict: duplicate.second });
  coalesceRedundant(resultEntries);

  const nextEnd = context.afterNext ? context.afterNext.ts : context.limitTs;
  const preview = [
    previewPart('previous', context.previous, context.previous ? context.previous.ts : context.dayStartTs, startTs),
    previewPart('current', current, startTs, endTs, current.what || primaryTag(current)),
    endMode === 'now'
      ? null
      : previewPart('next', context.isTail ? null : context.next, endTs, context.isTail ? context.limitTs : nextEnd)
  ].filter(Boolean);
  return transactionResult(resultEntries, {
    kind: 'interval-edit',
    affectedIds: [context.previous, context.entry, context.next].filter(Boolean).map(item => item.id),
    context: dynamicContext,
    preview,
    endMode
  });
}

export function planSegmentSplit(entries, request, opts = {}) {
  const frozenStart = normalizeTimestamp(request && request.frozenStart);
  const frozenEnd = normalizeTimestamp(request && request.frozenEnd);
  const startTs = normalizeTimestamp(request && request.startTs);
  const endTs = normalizeTimestamp(request && request.endTs);
  if (!frozenStart || !frozenEnd || frozenEnd <= frozenStart) {
    return transactionError('stale', t('txn.splitStaleFrozen'));
  }
  if (!startTs || !endTs) return transactionError('invalid-time', t('txn.needStartEnd'));
  const frozenDay = dayBounds(frozenStart.slice(0, 10));
  if (startTs.slice(0, 10) !== frozenStart.slice(0, 10)
    || (endTs.slice(0, 10) !== frozenStart.slice(0, 10) && (!frozenDay || endTs !== frozenDay.endTs))) {
    return transactionError('cross-day', t('txn.splitCrossDay'));
  }
  if (startTs < frozenStart || endTs > frozenEnd) {
    return transactionError('outside-source', t('txn.splitOutside'));
  }
  if (endTs <= startTs) return transactionError('zero-duration', t('txn.splitZeroDuration'));

  const source = request && request.sourceId
    ? (entries || []).find(item => item.id === request.sourceId && !item.planned)
    : null;
  if (request && request.sourceId && !source) {
    return transactionError('stale', t('txn.splitStaleSource'));
  }
  const internal = loggedEntriesFrom(entries).find(item => item.ts > frozenStart && item.ts < frozenEnd);
  if (internal) return transactionError('stale', t('txn.splitInternal'));
  const sourceWhat = source ? source.what : '';
  const sourceTags = source && Array.isArray(source.tags) ? source.tags.slice() : [];
  const resultEntries = cloneEntries(entries);
  const target = source && resultEntries.find(item => item.id === source.id);
  let inserted = null;
  if (target && target.ts === startTs) {
    target.what = String(request.what || '');
    target.tags = Array.isArray(request.tags) ? request.tags.slice() : [];
    delete target.longConfirm;
    delete target.planned;
    delete target.ongoing;
    inserted = target;
  } else {
    inserted = {
      id: opts.createId ? opts.createId() : `split-${Date.now()}`,
      ts: startTs,
      what: String(request.what || ''),
      tags: Array.isArray(request.tags) ? request.tags.slice() : []
    };
    resultEntries.push(inserted);
    if (target) delete target.longConfirm;
  }
  if (endTs < frozenEnd) {
    resultEntries.push({
      id: opts.createId ? opts.createId() : `restore-${Date.now()}`,
      ts: endTs,
      what: sourceWhat,
      tags: sourceTags
    });
  }
  const duplicate = duplicateTimestamp(resultEntries);
  if (duplicate) return transactionError('conflict', t('txn.splitConflict'), { conflict: duplicate.second });
  coalesceRedundant(resultEntries);
  const preview = [
    previewPart('before', source, frozenStart, startTs),
    previewPart('new', inserted, startTs, endTs, inserted.what || primaryTag(inserted)),
    previewPart('after', source, endTs, frozenEnd)
  ].filter(Boolean);
  const mode = startTs === frozenStart && endTs === frozenEnd
    ? 'whole'
    : (startTs === frozenStart || endTs === frozenEnd ? 'edge' : 'inside');
  return transactionResult(resultEntries, {
    kind: 'segment-split',
    mode,
    affectedIds: [source && source.id, inserted.id].filter(Boolean),
    constraints: {
      dayEndTs: frozenDay && frozenDay.endTs,
      startMin: frozenStart,
      startMax: shiftedMinute(frozenEnd, -1),
      endMin: shiftedMinute(frozenStart, 1),
      endMax: frozenEnd,
      startReason: t('txn.splitStartReason', { time: frozenStart.slice(11) }),
      endReason: t('txn.splitEndReason', { time: frozenEnd.slice(11) })
    },
    preview
  });
}

export function planDeleteEntry(entries, id, opts = {}) {
  const entry = (entries || []).find(item => item.id === id);
  if (!entry) return transactionError('missing', t('txn.missing'));
  if (!entry.planned && isPlaceholderEntry(entry)) {
    return transactionError('placeholder', t('txn.placeholderDelete'));
  }
  const resultEntries = cloneEntries(entries);
  if (entry.planned) {
    const index = resultEntries.findIndex(item => item.id === id);
    resultEntries.splice(index, 1);
    return transactionResult(resultEntries, {
      kind: 'delete',
      outcome: 'remove-plan',
      affectedIds: [id],
      message: t('txn.deletePlanned', { what: entry.what || t('txn.deleteEmptyWhat') })
    });
  }

  const onDay = loggedOnDay(entries, entry.ts.slice(0, 10));
  const index = onDay.findIndex(item => item.id === id);
  const previous = index > 0 ? onDay[index - 1] : null;
  const next = index >= 0 ? onDay[index + 1] || null : null;
  const bounds = dayBounds(entry.ts.slice(0, 10));
  const todayKey = opts.todayKey || todayStr();
  const nowTs = normalizeTimestamp(opts.nowTs) || nowStr();
  const endTs = next
    ? next.ts
    : (entry.ts.slice(0, 10) === todayKey ? nowTs : bounds.endTs);
  const canJoin = previous && next
    && !isPlaceholderEntry(previous)
    && !isPlaceholderEntry(next)
    && entryContentEqual(previous, next);
  const stored = resultEntries.find(item => item.id === id);
  if (canJoin) {
    const storedIndex = resultEntries.findIndex(item => item.id === id);
    resultEntries.splice(storedIndex, 1);
    coalesceRedundant(resultEntries);
    return transactionResult(resultEntries, {
      kind: 'delete',
      outcome: 'join',
      affectedIds: [previous.id, id, next.id],
      previous,
      next,
      startTs: entry.ts,
      endTs,
      message: t('txn.deleteRejoin', { what: previous.what || primaryTag(previous) })
    });
  }
  stored.what = '';
  stored.tags = [];
  delete stored.longConfirm;
  delete stored.planned;
  delete stored.ongoing;
  coalesceRedundant(resultEntries);
  return transactionResult(resultEntries, {
    kind: 'delete',
    outcome: 'unrecorded',
    affectedIds: [id],
    previous,
    next,
    startTs: entry.ts,
    endTs,
    message: t('txn.deleteToUnrecorded')
  });
}

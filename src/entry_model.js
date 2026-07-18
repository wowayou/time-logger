// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
import { GAP, isPlaceholderEntry, loggedEntriesFrom, primaryTag } from './stats.js';
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
  if (!entry || isPlaceholderEntry(entry)) return '未记录';
  return entry.what || primaryTag(entry) || '未记录';
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
    tag: entry ? primaryTag(entry) : '未知',
    startTs,
    endTs
  };
}

/** @returns {TxOk | TxError} */
export function overnightContinuationContext(entries, viewedDate, opts = {}) {
  const nowTs = normalizeTimestamp(opts.nowTs) || nowStr();
  const todayKey = opts.todayKey || nowTs.slice(0, 10) || todayStr();
  const today = parseDateKey(todayKey);
  if (!today) return transactionError('invalid-date', '今天的日期无效。');
  const yesterdayKey = localDateKey(addDays(startOfDay(today), -1));
  if (viewedDate !== yesterdayKey) return transactionError('not-yesterday', '只有昨天的尾部空白可过夜续记。');
  const yesterdayEntries = loggedOnDay(entries, yesterdayKey);
  const source = yesterdayEntries[yesterdayEntries.length - 1] || null;
  if (!source || !isPlaceholderEntry(source)) {
    return transactionError('no-placeholder', '昨天最后一点不是未记录占位。');
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
    return transactionError('no-today-span', '今天 00:00 已有真实记录，按普通历史续记到 24:00。');
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
    return transactionError('stale', '昨天的尾部空白已经变化，请重新打开表单。', { context });
  }
  const frozenStart = normalizeTimestamp(request && request.frozenStart) || context.startTs;
  const startTs = normalizeTimestamp(request && request.startTs);
  if (!startTs) return transactionError('invalid-time', '请输入完整的开始时间。', { context });
  const startMin = frozenStart > context.startTs ? frozenStart : context.startTs;
  if (startTs < startMin) {
    return transactionError('before-min', `开始时间不能早于空白起点 ${hhmm(startMin)}。`, { context: { ...context, startMin } });
  }
  if (startTs >= context.hardEndTs) {
    return transactionError('after-max', `开始时间必须早于结束点 ${hhmm(context.hardEndTs)}。`, { context: { ...context, startMin } });
  }
  if (startTs.slice(0, 10) !== context.yesterdayKey && startTs.slice(0, 10) !== context.todayKey) {
    return transactionError('outside-source', '开始时间只能在昨晚空白到今天结束点之间选择。', { context: { ...context, startMin } });
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
      return transactionError('conflict', `${hhmm(ts)} 已有记录或计划，不能覆盖。`, { context, conflict: existing });
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
  if (duplicate) return transactionError('conflict', '新的过夜边界与其它记录重合。', { context, conflict: duplicate.second });
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
  if (!entry) return transactionError('missing', '这条记录已经不存在。');
  if (entry.planned) return transactionError('planned', '计划记录只编辑计划时刻。');
  if (isPlaceholderEntry(entry)) return transactionError('placeholder', '未记录占位不能按普通记录编辑。');
  const dateKey = entry.ts.slice(0, 10);
  const bounds = dayBounds(dateKey);
  if (!bounds) return transactionError('invalid-date', '记录日期无效。');
  const onDay = loggedOnDay(entries, dateKey);
  const index = onDay.findIndex(item => item.id === id);
  if (index < 0) return transactionError('missing', '这条记录已经不存在。');
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
      ? `不能早于上一段「${entryLabel(previous)}」之后`
      : '不能跨过当天 00:00',
    endReason: isTail
      ? (dateKey === todayKey ? '不能晚于当前时间' : '不能跨过当天 24:00')
      : `不能越过下一段「${entryLabel(next)}」`
  };
}

export function planIntervalEdit(entries, request, opts = {}) {
  const context = intervalEditContext(entries, request && request.id, opts);
  if (!context.ok) return context;
  const startTs = normalizeTimestamp(request && request.startTs);
  const requestedEnd = normalizeTimestamp(request && request.endTs);
  const endMode = request && request.endMode === 'now' ? 'now' : 'fixed';
  const endTs = endMode === 'now' ? context.limitTs : requestedEnd;
  if (!startTs || !endTs) return transactionError('invalid-time', '请输入完整的开始和结束时间。', { context });
  if (startTs.slice(0, 10) !== context.dateKey
    || (endTs.slice(0, 10) !== context.dateKey && endTs !== context.dayEndTs)) {
    return transactionError('cross-day', '开始和结束不能跨自然日。', { context });
  }
  if (endMode === 'now' && !context.canUseNow) {
    return transactionError('not-tail', '只有今天的尾段可以选择“至今”。', { context });
  }
  if (startTs < context.startMin) {
    return transactionError('before-min', context.startReason, { context });
  }
  if (endTs > context.endMax) {
    return transactionError('after-max', context.endReason, { context });
  }
  if (endTs <= startTs) {
    return transactionError('zero-duration', '结束时间必须晚于开始时间，记录不能为零时长。', { context });
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
  if (duplicate) return transactionError('conflict', '新的边界时间与其它记录重合。', { context, conflict: duplicate.second });
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
    return transactionError('stale', '原段边界已经失效，请重新打开“切一刀”。');
  }
  if (!startTs || !endTs) return transactionError('invalid-time', '请输入完整的开始和结束时间。');
  const frozenDay = dayBounds(frozenStart.slice(0, 10));
  if (startTs.slice(0, 10) !== frozenStart.slice(0, 10)
    || (endTs.slice(0, 10) !== frozenStart.slice(0, 10) && (!frozenDay || endTs !== frozenDay.endTs))) {
    return transactionError('cross-day', '切分不能跨自然日。');
  }
  if (startTs < frozenStart || endTs > frozenEnd) {
    return transactionError('outside-source', '两端只能在打开时冻结的原段内部选择。');
  }
  if (endTs <= startTs) return transactionError('zero-duration', '结束时间必须晚于开始时间。');

  const source = request && request.sourceId
    ? (entries || []).find(item => item.id === request.sourceId && !item.planned)
    : null;
  if (request && request.sourceId && !source) {
    return transactionError('stale', '原段已经变化，请重新打开“切一刀”。');
  }
  const internal = loggedEntriesFrom(entries).find(item => item.ts > frozenStart && item.ts < frozenEnd);
  if (internal) return transactionError('stale', '原段中已经出现其它记录，请重新打开“切一刀”。');
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
  if (duplicate) return transactionError('conflict', '新的切分边界与其它记录重合。', { conflict: duplicate.second });
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
      startReason: `不能早于原段起点 ${frozenStart.slice(11)}`,
      endReason: `不能晚于原段终点 ${frozenEnd.slice(11)}`
    },
    preview
  });
}

export function planDeleteEntry(entries, id, opts = {}) {
  const entry = (entries || []).find(item => item.id === id);
  if (!entry) return transactionError('missing', '这条记录已经不存在。');
  if (!entry.planned && isPlaceholderEntry(entry)) {
    return transactionError('placeholder', '未记录占位不需要删除。');
  }
  const resultEntries = cloneEntries(entries);
  if (entry.planned) {
    const index = resultEntries.findIndex(item => item.id === id);
    resultEntries.splice(index, 1);
    return transactionResult(resultEntries, {
      kind: 'delete',
      outcome: 'remove-plan',
      affectedIds: [id],
      message: `计划“${entry.what || '未填写'}”将直接移除。`
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
      message: `前后都是“${previous.what || primaryTag(previous)}”，删除后将接回一段。`
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
    message: '这段将原区间保留为“未记录”，不会拉长相邻记录。'
  });
}

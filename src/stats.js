// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
import {
  addDays,
  inclusiveCalendarDayCount,
  localDateTimeKey,
  minsBetweenDates,
  normalizeTimestamp,
  startOfDay
} from './time.js';
import { bucketForTag, longOkForTag, tagKnownForConfirmation } from './storage.js';

export const GAP = 180;

export function sortedEntriesFrom(entries) {
  return (entries || [])
    .filter(e => normalizeTimestamp(e.ts))
    .sort((a, b) => a.ts < b.ts ? -1 : 1);
}

export function loggedEntriesFrom(entries) {
  return sortedEntriesFrom(entries).filter(e => !e.planned);
}

export function isPlaceholderEntry(entry) {
  return Boolean(entry && typeof entry.what === 'string' && entry.what.trim() === '');
}

// 里程碑只认**真实记录**：计划条是未来意图，空占位条是「这段没记」的显式表达
// （normalizeEntries 恒给今天留一条尾占位），两者都不构成「记过一天」。
function recordedDayKeys(entries) {
  const seen = new Set();
  loggedEntriesFrom(entries).forEach(entry => {
    if (isPlaceholderEntry(entry)) return;
    seen.add(entry.ts.slice(0, 10));
  });
  return [...seen].sort();
}

// 两个用户里程碑都从**当前数据**派生，因此随完整备份天然恢复，不依赖本机
// 安装日期（`timelog.firstUsedDate` 已降为纯诊断值，不再是里程碑）。
// 注意：这里的「已记录 N 天」是「有真实记录的自然日数」，机器可判定；它不等于
// `docs/dogfood-freeze-handoff.md` 里需要人工判断的「有效记录日」，别混用。
export function recordingMilestones(entries, todayKey) {
  const days = recordedDayKeys(entries);
  const firstRecordedDate = days[0] || '';
  return {
    firstRecordedDate,
    journeyDay: firstRecordedDate ? inclusiveCalendarDayCount(firstRecordedDate, todayKey) : 0,
    recordedDays: days.length
  };
}

export function listPlannedEntries(entries, dateKey) {
  return sortedEntriesFrom(entries)
    .filter(e => e.planned && e.ts.slice(0, 10) === dateKey);
}

function emptyTotals() {
  return { job: 0, maintain: 0, leak: 0, unrecorded: 0, pending: 0, total: 0 };
}

export function primaryTag(entry) {
  return ((entry && entry.tags || [])[0] || '未知') || '未知';
}

export function isKnownTag(tag) {
  return tagKnownForConfirmation(tag);
}

function isSegmentConfirmed(entry, endTs) {
  const mark = entry && entry.longConfirm;
  return Boolean(mark && mark.startTs === entry.ts && mark.endTs === endTs);
}

export function classifySegment(entry, rawMins, endTs, isOngoing) {
  const tag = primaryTag(entry);
  const bucket = bucketForTag(tag);
  const needsConfirmation = bucket !== 'unrecorded' && !longOkForTag(tag) && rawMins > GAP;
  const confirmed = needsConfirmation && !isOngoing && isSegmentConfirmed(entry, endTs);
  const pendingConfirm = needsConfirmation && !confirmed;
  return {
    tag,
    bucket,
    unrecorded: bucket === 'unrecorded' || pendingConfirm,
    pendingConfirm,
    confirmable: pendingConfirm && !isOngoing
  };
}

/** @param {boolean | { unrecorded?: boolean, pending?: boolean }} [flags] */
function addBucket(totals, tag, mins, flags = {}) {
  if (mins <= 0) return;
  const unrecorded = typeof flags === 'boolean' ? flags : Boolean(flags.unrecorded);
  const pending = typeof flags === 'object' && Boolean(flags.pending);
  totals.total += mins;
  if (pending) totals.pending += mins;
  if (unrecorded) totals.unrecorded += mins;
  else {
    const bucket = bucketForTag(tag);
    if (bucket === 'job') totals.job += mins;
    else if (bucket === 'maintain') totals.maintain += mins;
    else if (bucket === 'leak') totals.leak += mins;
    else totals.unrecorded += mins;
  }
}

function pushUnknownSegment(segments, start, end) {
  const mins = minsBetweenDates(start, end);
  if (mins <= 0) return;
  segments.push({
    e: null,
    start,
    end,
    mins,
    rawMins: mins,
    endTs: '',
    isLast: false,
    isOngoing: false,
    tag: '未知',
    unrecorded: true,
    pendingConfirm: false,
    confirmable: false
  });
}

function segmentBoundsForEntry(entries, index, now) {
  const entry = entries[index];
  const rawStart = new Date(entry.ts);
  const next = entries[index + 1] || null;
  if (next) {
    return { rawStart, rawEnd: new Date(next.ts), endTs: next.ts, isOngoing: false, next };
  }

  const dayStart = startOfDay(rawStart);
  const dayEnd = addDays(dayStart, 1);
  if (now >= dayStart && now < dayEnd) {
    return { rawStart, rawEnd: new Date(now), endTs: '', isOngoing: true, next: null };
  }
  return { rawStart, rawEnd: dayEnd, endTs: localDateTimeKey(dayEnd), isOngoing: false, next: null };
}

export function buildRangeSegmentsFromEntries(inputEntries, start, end, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const s = new Date(start);
  let e = new Date(end);
  if (e > now) e = now;
  if (e <= s) return [];

  const entries = loggedEntriesFrom(inputEntries);
  if (!entries.length) return [];

  const segments = [];
  for (let dayStart = startOfDay(s); dayStart < e; dayStart = addDays(dayStart, 1)) {
    const dayEnd = addDays(dayStart, 1);
    const rangeStart = new Date(Math.max(+s, +dayStart));
    const rangeEnd = new Date(Math.min(+e, +dayEnd));
    if (rangeEnd <= rangeStart) continue;

    let cursor = new Date(rangeStart);
    entries.forEach((entry, index) => {
      const { rawStart, rawEnd, endTs, isOngoing, next } = segmentBoundsForEntry(entries, index, now);
      if (rawEnd <= rangeStart || rawStart >= rangeEnd) return;

      if (rawStart > cursor) {
        pushUnknownSegment(segments, new Date(cursor), new Date(Math.min(+rawStart, +rangeEnd)));
      }

      const segStart = new Date(Math.max(+rawStart, +rangeStart));
      const segEnd = new Date(Math.min(+rawEnd, +rangeEnd));
      const mins = minsBetweenDates(segStart, segEnd);
      if (mins > 0) {
        const rawMins = minsBetweenDates(rawStart, rawEnd);
        segments.push({
          e: entry,
          start: segStart,
          end: segEnd,
          mins,
          rawMins,
          endTs,
          isLast: !next,
          isOngoing,
          ...classifySegment(entry, rawMins, endTs, isOngoing)
        });
      }

      if (rawEnd > cursor) cursor = new Date(Math.min(+rawEnd, +rangeEnd));
    });
  }
  return segments;
}

export function summarizeEntries(entries, start, end, opts = {}) {
  const totals = emptyTotals();
  buildRangeSegmentsFromEntries(entries, start, end, opts).forEach(segment => {
    addBucket(totals, segment.tag, segment.mins, {
      unrecorded: segment.unrecorded,
      pending: segment.pendingConfirm
    });
  });
  return totals;
}

export function confirmSegmentInData(d, id, endTs, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const entries = sortedEntriesFrom(d && d.entries);
  const entry = entries.find(e => e.id === id);
  if (!entry) return { ok: false, reason: 'stale' };

  const start = new Date(entry.ts);
  const index = entries.findIndex(e => e.id === id);
  if (index < 0) return { ok: false, reason: 'stale' };

  const segmentEnd = segmentBoundsForEntry(entries, index, now);
  if (segmentEnd.isOngoing || segmentEnd.endTs !== endTs) {
    return { ok: false, reason: 'stale' };
  }

  const tag = primaryTag(entry);
  const rawMins = minsBetweenDates(start, segmentEnd.rawEnd);
  if (!isKnownTag(tag) || longOkForTag(tag) || rawMins <= GAP) {
    return { ok: false, reason: 'not-required' };
  }
  const stored = (d.entries || []).find(e => e.id === id);
  if (!stored) return { ok: false, reason: 'missing' };
  stored.longConfirm = { startTs: stored.ts, endTs };
  return { ok: true, entry: stored };
}

function percentValue(n, total) {
  if (total <= 0 || n <= 0) return 0;
  return Math.min(100, Math.max(0, n / total * 100));
}

export function formatPercent(n, total) {
  const p = percentValue(n, total);
  if (p === 0) return '0%';
  if (p < 0.1) return '<0.1%';
  if (p >= 99.95 && p < 100) return '>99.9%';
  if (p < 100) return `${p.toFixed(1).replace(/\.0$/, '')}%`;
  return '100%';
}

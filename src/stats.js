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
// SPEC-013：保留标签 id 是数据（config 的键、随备份走），不是文案；显示名在 ui/io 层
// 映射成 i18n 的 `tag.unknown`。本模块仍不访问 DOM / navigator / localStorage。
import { RESERVED_UNKNOWN_TAG } from './storage.js';
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
  return ((entry && entry.tags || [])[0] || RESERVED_UNKNOWN_TAG) || RESERVED_UNKNOWN_TAG;
}

export function isKnownTag(tag, config) {
  return tagKnownForConfirmation(tag, config);
}

function isSegmentConfirmed(entry, endTs) {
  const mark = entry && entry.longConfirm;
  return Boolean(mark && mark.startTs === entry.ts && mark.endTs === endTs);
}

// v87：`config` 是**可选**的第五参——不传时 storage.js 的默认参数照旧 loadConfig()，
// 与旧行为逐字等价。传了就省掉一次 localStorage 读 + JSON.parse + normalizeConfig：
// 本函数每个片段调两次桶查询，addBucket 里还有第三次，年视图一次 summarize 因此
// 会重复解析同一份 config 近两千次（实测 633 条数据 → 1994 次读）。本模块仍不 import
// loadConfig，config 由调用方注入，模块边界不变。
export function classifySegment(entry, rawMins, endTs, isOngoing, config) {
  const tag = primaryTag(entry);
  const bucket = bucketForTag(tag, config);
  // v89：长段核对默认关闭；开启后也只是正交的「时长待核」标记，不再把用户已经
  // 明确写下的标签整段改判为未记录。四桶统计因此不受开关影响，只有提醒层变化。
  const reviewEnabled = Boolean(config && config.longReview === true);
  const needsConfirmation = reviewEnabled && bucket !== 'unrecorded' && !longOkForTag(tag, config) && rawMins > GAP;
  const confirmed = needsConfirmation && !isOngoing && isSegmentConfirmed(entry, endTs);
  const pendingConfirm = needsConfirmation && !confirmed;
  return {
    tag,
    bucket,
    unrecorded: bucket === 'unrecorded',
    pendingConfirm,
    confirmable: pendingConfirm && !isOngoing
  };
}

/** @param {boolean | { unrecorded?: boolean, pending?: boolean }} [flags] */
function addBucket(totals, tag, mins, flags = {}, config = undefined) {
  if (mins <= 0) return;
  const unrecorded = typeof flags === 'boolean' ? flags : Boolean(flags.unrecorded);
  const pending = typeof flags === 'object' && Boolean(flags.pending);
  totals.total += mins;
  if (pending) totals.pending += mins;
  if (unrecorded) totals.unrecorded += mins;
  else {
    const bucket = bucketForTag(tag, config);
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
    tag: RESERVED_UNKNOWN_TAG,
    unrecorded: true,
    pendingConfirm: false,
    confirmable: false
  });
}

function segmentBoundsForEntry(entries, index, now) {
  const entry = entries[index];
  const rawStart = new Date(entry.ts);
  const next = entries[index + 1] || null;
  const dayStart = startOfDay(rawStart);
  const dayEnd = addDays(dayStart, 1);
  if (next) {
    const rawEnd = new Date(next.ts);
    // v87：跨日闭合段最多切入**次日**。旧代码把 rawEnd 一路铺到右邻，右邻在两天
    // 以后时（连着几天没打开 app，中间一条占位条都没有）中间那些**空日会被前一天
    // 最后一个标签填满 24h**——与「空日不继承前一天最后标签」正面冲突，而且那些天
    // 还各挂一颗「确认 22:00-09:00」按钮（起止时间来自两个相隔数日的日期），按下去
    // 就把整整一天记进那个桶。右邻落在 D+2 00:00 或更晚时止于当日 24:00，中间空日
    // 整日无记录（与从未记过的日子同一表现）。
    // 判据写成 `>=` 而不是 `>`：右邻恰在 D+2 00:00 时，D+1 是一整天没有任何记录的
    // 空日，同样不该被继承；右邻在 D+1 内（含 D+1 00:00）才是真正的「跨一次午夜」。
    if (+rawEnd >= +addDays(dayEnd, 1)) {
      return { rawStart, rawEnd: dayEnd, endTs: localDateTimeKey(dayEnd), isOngoing: false, next };
    }
    return { rawStart, rawEnd, endTs: next.ts, isOngoing: false, next };
  }

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

  const config = opts.config;
  // v87：段边界只算一次。旧代码在**每一天**的循环里对**全部**条目重跑
  // segmentBoundsForEntry（O(天数 × 条数)）——年视图一次 render 因此是
  // 365 × 全部条目：633 条时 ~170ms，5000 条时 ~1.5s，而年视图包含今天，
  // dataSignature 的 liveMinute 每分钟都变，于是每分钟整屏重算一次。
  const bounds = [];
  for (let index = 0; index < entries.length; index += 1) {
    bounds.push(segmentBoundsForEntry(entries, index, now));
  }
  // 两个游标都只前进，因为日循环的 rangeStart / rangeEnd 单调递增、entries 按 ts 升序：
  // - `firstLive` 只跳过 rawEnd <= rangeStart 的条目，而 rangeStart 只会更大，所以被跳过的
  //   条目对**后续每一天**同样出局（这条不依赖 rawEnd 单调，while 的判据自己保证）；
  // - `break` 用 rawStart >= rangeEnd，rawStart 即 ts，严格升序。
  const segments = [];
  let firstLive = 0;
  for (let dayStart = startOfDay(s); dayStart < e; dayStart = addDays(dayStart, 1)) {
    const dayEnd = addDays(dayStart, 1);
    const rangeStart = new Date(Math.max(+s, +dayStart));
    const rangeEnd = new Date(Math.min(+e, +dayEnd));
    if (rangeEnd <= rangeStart) continue;

    while (firstLive < bounds.length && bounds[firstLive].rawEnd <= rangeStart) firstLive += 1;

    let cursor = new Date(rangeStart);
    for (let index = firstLive; index < entries.length; index += 1) {
      const entry = entries[index];
      const { rawStart, rawEnd, endTs, isOngoing, next } = bounds[index];
      if (rawStart >= rangeEnd) break;
      if (rawEnd <= rangeStart) continue;

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
          ...classifySegment(entry, rawMins, endTs, isOngoing, config)
        });
      }

      if (rawEnd > cursor) cursor = new Date(Math.min(+rawEnd, +rangeEnd));
    }
  }
  return segments;
}

export function summarizeEntries(entries, start, end, opts = {}) {
  const totals = emptyTotals();
  buildRangeSegmentsFromEntries(entries, start, end, opts).forEach(segment => {
    addBucket(totals, segment.tag, segment.mins, {
      unrecorded: segment.unrecorded,
      pending: segment.pendingConfirm
    }, opts.config);
  });
  return totals;
}

export function confirmSegmentInData(d, id, endTs, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const config = opts.config;
  // v87：必须与渲染侧用**同一个**序列。这里原本是 sortedEntriesFrom（含计划条），
  // 而 buildRangeSegmentsFromEntries 用 loggedEntriesFrom（不含计划条）：段内只要
  // 坐着一条计划，两边算出的右邻就不同，endTs 对不上 → 永远返回 stale。表现是那颗
  // 「确认」按钮点了只弹「这一段已经变了」，怎么点都确认不掉（计划本身是未来意图，
  // 不构成已发生时间线的边界，所以正确的一侧是 loggedEntriesFrom）。
  const entries = loggedEntriesFrom(d && d.entries);
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
  if (!config || config.longReview !== true
    || !isKnownTag(tag, config) || longOkForTag(tag, config) || rawMins <= GAP) {
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

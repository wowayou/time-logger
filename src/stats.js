// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
import {
  addDays,
  inclusiveCalendarDayCount,
  localDateKey,
  localDateTimeKey,
  minsBetweenDates,
  normalizeTimestamp,
  periodRange,
  elapsedMatchedRange,
  previousPeriodRange,
  startOfDay
} from './time.js';
// SPEC-013：保留标签 id 是数据（config 的键、随备份走），不是文案；显示名在 ui/io 层
// 映射成 i18n 的 `tag.unknown`。本模块仍不访问 DOM / navigator / localStorage。
import { RESERVED_UNKNOWN_TAG, bucketForTag, longOkForTag, tagKey, tagKnownForConfirmation } from './storage.js';

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
  (entries || []).forEach(entry => {
    if (entry.planned || isPlaceholderEntry(entry) || !normalizeTimestamp(entry.ts)) return;
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
  const todayRank = days.indexOf(todayKey) + 1;
  return {
    firstRecordedDate,
    journeyDay: firstRecordedDate ? inclusiveCalendarDayCount(firstRecordedDate, todayKey) : 0,
    recordedDays: days.length,
    // v1.6.0（D32）：今天是第几个记录日，且恰好是里程碑节点时给出该节点，否则 0。
    // 只看「今天」的名次，所以第二天无论记不记，高亮都自然消失，不需要任何存储。
    milestoneDay: todayRank > 0 && isMilestoneCount(todayRank) ? todayRank : 0
  };
}

/**
 * @param {unknown[]} entries
 * @returns {number}
 */
export function recordedDayCount(entries) {
  return recordedDayKeys(entries).length;
}

/**
 * v1.6.0（D32）：里程碑节点，按**累计**记录日（与「已记录 N 天」同一口径），中断不清零。
 * 节点是 7 · 30 · 100 · 200 · 365，之后每满 100。
 * @param {number} n
 * @returns {boolean}
 */
export function isMilestoneCount(n) {
  if (!Number.isInteger(n) || n <= 0) return false;
  return n === 7 || n === 30 || n === 100 || n === 200 || n === 365 || (n > 365 && n % 100 === 0);
}

/**
 * 一次写入让累计记录日跨过的最大节点；没跨过（含减少、不变）返回 0。用「跨过」而不是
 * 「恰好等于」：过夜续记一次能新增昨天和今天两个记录日，99 → 101 也应当算到了 100。
 * @param {number} beforeCount
 * @param {number} afterCount
 * @returns {number}
 */
export function milestoneCrossed(beforeCount, afterCount) {
  for (let n = afterCount; n > beforeCount; n--) {
    if (isMilestoneCount(n)) return n;
  }
  return 0;
}

export function listPlannedEntries(entries, dateKey) {
  return sortedEntriesFrom((entries || []).filter(e => e.planned && typeof e.ts === 'string' && e.ts.slice(0, 10) === dateKey));
}

function emptyTotals() {
  return { job: 0, maintain: 0, leak: 0, unrecorded: 0, pending: 0, total: 0 };
}

export function primaryTag(entry) {
  return ((entry && entry.tags) || [])[0] || RESERVED_UNKNOWN_TAG;
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

  // Only the immediate predecessor and starts inside the range can overlap it.
  // Keep the complete list for next/endTs/isLast: dropping the right neighbour
  // would turn a closed segment into an ongoing one or change midnight rules.
  const lowerBound = target => {
    let lo = 0;
    let hi = entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (+new Date(entries[mid].ts) < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  // Legacy accepted formats sort by their original text, which need not be
  // chronological. Preserve their existing scan semantics instead of assuming
  // they can be searched by time. New app records use the canonical format.
  const canonical = entries.every(entry => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(entry.ts));
  const first = canonical ? Math.max(0, lowerBound(+s) - 1) : 0;
  const boundLast = canonical ? lowerBound(+e) : entries.length;

  const config = opts.config;
  // v87：段边界只算一次。旧代码在**每一天**的循环里对**全部**条目重跑
  // segmentBoundsForEntry（O(天数 × 条数)）——年视图一次 render 因此是
  // 365 × 全部条目：633 条时 ~170ms，5000 条时 ~1.5s，而年视图包含今天，
  // dataSignature 的 liveMinute 每分钟都变，于是每分钟整屏重算一次。
  const bounds = [];
  for (let index = first; index < boundLast; index += 1) {
    bounds.push(segmentBoundsForEntry(entries, index, now));
  }
  // 两个游标都只前进，因为日循环的 rangeStart / rangeEnd 单调递增、entries 按 ts 升序：
  // - `firstLive` 只跳过 rawEnd <= rangeStart 的条目，而 rangeStart 只会更大，所以被跳过的
  //   条目对**后续每一天**同样出局（这条不依赖 rawEnd 单调，while 的判据自己保证）；
  // - `break` 用 rawStart >= rangeEnd，rawStart 即 ts，严格升序。
  const segments = [];
  let firstLive = first;
  for (let dayStart = startOfDay(s); dayStart < e; dayStart = addDays(dayStart, 1)) {
    const dayEnd = addDays(dayStart, 1);
    const rangeStart = new Date(Math.max(+s, +dayStart));
    const rangeEnd = new Date(Math.min(+e, +dayEnd));
    if (rangeEnd <= rangeStart) continue;

    while (firstLive < boundLast && bounds[firstLive - first].rawEnd <= rangeStart) firstLive += 1;

    let cursor = new Date(rangeStart);
    for (let index = firstLive; index < boundLast; index += 1) {
      const entry = entries[index];
      const { rawStart, rawEnd, endTs, isOngoing, next } = bounds[index - first];
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

// 首屏统计卡片的「分布」图（v1.11.0 起的全天热力，v1.13.0 移进卡片并加周视图）。
// 一格＝一个本地壁钟时段：日视图 96 个 15 分钟格，周视图 7 天 × 24 个 1 小时格。每格按
// 占时最多的桶上色，深浅只看这个桶在本格里占了几分钟（阈值按格长给：15 分钟格 ≥11
// 实色、≥6 为 2 档；1 小时格 ≥44 实色、≥24 为 2 档；其余有分钟为 1 档），所以浅格
// 多出现在段的交界处；没有任何桶分钟的格是未记录，起点不早于 now 的格是未来，含 now
// 的格标 now。并列时按 job → maintain → leak 取第一个，结果与输入顺序无关。格界用
// new Date(y, m, d, h, min) 取，夏令时日不按毫秒累加，与统计的本地自然日一致。
// spans 只需桶段：未记录、占位与过短空隙都不必传——它们本来就落成未记录格。
const HEAT_BUCKETS = ['job', 'maintain', 'leak'];
export const DAY_HEAT_CELLS = 96;
export const WEEK_HEAT_CELLS = 7 * 24;

/**
 * @param {Array<{ start: Date, end: Date, bucket: string }>} spans
 * @param {Array<[number, number]>} slots 每格的 [起, 止) 毫秒
 * @param {Date} now
 * @param {[number, number]} thresholds [实色下限, 2 档下限]（分钟）
 * @returns {Array<{ bucket: string, level: number, future: boolean, now: boolean }>}
 */
function slotHeatCells(spans, slots, now, thresholds) {
  const nowMs = +now;
  const live = (spans || []).filter(span => HEAT_BUCKETS.includes(span.bucket) && +span.end > +span.start);
  return slots.map(([a, z]) => {
    if (a >= nowMs) return { bucket: 'future', level: 0, future: true, now: false };
    const mins = { job: 0, maintain: 0, leak: 0 };
    for (const span of live) {
      const overlap = Math.min(z, +span.end, nowMs) - Math.max(a, +span.start);
      if (overlap > 0) mins[span.bucket] += overlap / 60000;
    }
    let bucket = 'unrecorded';
    let best = 0;
    for (const b of HEAT_BUCKETS) {
      if (mins[b] > best) { best = mins[b]; bucket = b; }
    }
    const level = bucket === 'unrecorded' ? 0 : best >= thresholds[0] ? 3 : best >= thresholds[1] ? 2 : 1;
    return { bucket, level, future: false, now: a <= nowMs && nowMs < z };
  });
}

/**
 * @param {Array<{ start: Date, end: Date, bucket: string }>} spans
 * @param {Date} dayStart 当天本地 00:00
 * @param {Date} now
 */
export function dayHeatCells(spans, dayStart, now) {
  const y = dayStart.getFullYear();
  const m = dayStart.getMonth();
  const d = dayStart.getDate();
  /** @type {Array<[number, number]>} */
  const slots = [];
  for (let q = 0; q < DAY_HEAT_CELLS; q += 1) slots.push([+new Date(y, m, d, 0, q * 15), +new Date(y, m, d, 0, (q + 1) * 15)]);
  return slotHeatCells(spans, slots, now, [11, 6]);
}

/**
 * 周视图：按「第 r 天 × 第 h 小时」行优先排列，共 168 格。
 * @param {Array<{ start: Date, end: Date, bucket: string }>} spans
 * @param {Date} weekStart 本周第一天本地 00:00
 * @param {Date} now
 */
export function weekHeatCells(spans, weekStart, now) {
  const y = weekStart.getFullYear();
  const m = weekStart.getMonth();
  const d = weekStart.getDate();
  /** @type {Array<[number, number]>} */
  const slots = [];
  for (let r = 0; r < 7; r += 1) {
    for (let h = 0; h < 24; h += 1) slots.push([+new Date(y, m, d + r, h), +new Date(y, m, d + r, h + 1)]);
  }
  return slotHeatCells(spans, slots, now, [44, 24]);
}

// 月 / 年视图的「标签」环形图（v1.13.0）：按 tagKey 归并有桶标签的分钟；未记录桶
// （空隙、占位、孤儿标签）合成一块，放在最后。各块之和等于 summarizeSegments 的 total。
// 排序：先按桶 job → maintain → leak，同桶内按分钟降序（同桶相邻，才能用同一色系分深浅）。
/**
 * @param {Array<{ mins: number, tag: string, bucket: string, unrecorded: boolean }>} segments
 * @returns {{ total: number, slices: Array<{ tag: string, bucket: string, mins: number, rank: number }> }}
 */
export function tagShares(segments) {
  /** @type {Map<string, { tag: string, bucket: string, mins: number, rank: number }>} */
  const groups = new Map();
  let unrecorded = 0;
  let total = 0;
  for (const seg of segments || []) {
    if (!(seg.mins > 0)) continue;
    total += seg.mins;
    if (seg.unrecorded || !HEAT_BUCKETS.includes(seg.bucket)) { unrecorded += seg.mins; continue; }
    const key = `${seg.bucket}\u0000${tagKey(seg.tag)}`;
    const g = groups.get(key);
    if (g) g.mins += seg.mins;
    else groups.set(key, { tag: seg.tag, bucket: seg.bucket, mins: seg.mins, rank: 0 });
  }
  const slices = [...groups.values()].sort((a, b) => HEAT_BUCKETS.indexOf(a.bucket) - HEAT_BUCKETS.indexOf(b.bucket) || b.mins - a.mins);
  /** @type {Record<string, number>} */
  const seen = {};
  for (const slice of slices) { slice.rank = seen[slice.bucket] = (seen[slice.bucket] ?? -1) + 1; }
  if (unrecorded > 0) slices.push({ tag: '', bucket: 'unrecorded', mins: unrecorded, rank: 0 });
  return { total, slices };
}

// 统计累计只认分段产出的分钟与标记。主渲染可让时间轴、总览与明细共用同一份
// 分段，不再为每一行重新排序全部记录、计算全部边界；不缓存跨帧的可变对象。
export function summarizeSegments(segments, config = undefined) {
  const totals = emptyTotals();
  segments.forEach(segment => {
    addBucket(totals, segment.tag, segment.mins, {
      unrecorded: segment.unrecorded,
      pending: segment.pendingConfirm
    }, config);
  });
  return totals;
}

export function summarizeEntries(entries, start, end, opts = {}) {
  return summarizeSegments(buildRangeSegmentsFromEntries(entries, start, end, opts), opts.config);
}

// rows 按 rangeStart 升序、互不重叠；segments 是 buildRangeSegmentsFromEntries
// 的有序输出。游标只前进，仍保留空行；交集裁剪也支持行端点落在一个分段内部。
// 只创建新行和 totals，不修改输入行、分段、记录或配置。
export function summarizeSegmentRows(segments, rows, config = undefined) {
  let firstLive = 0;
  return rows.map(row => {
    const totals = emptyTotals();
    while (firstLive < segments.length && segments[firstLive].end <= row.rangeStart) firstLive += 1;
    for (let i = firstLive; i < segments.length && segments[i].start < row.rangeEnd; i += 1) {
      const segment = segments[i];
      const mins = minsBetweenDates(
        new Date(Math.max(+segment.start, +row.rangeStart)),
        new Date(Math.min(+segment.end, +row.rangeEnd))
      );
      addBucket(totals, segment.tag, mins, {
        unrecorded: segment.unrecorded,
        pending: segment.pendingConfirm
      }, config);
    }
    return { ...row, totals };
  });
}

// ── 周期对比与趋势（v1.3.0 分析页）。全是纯逻辑，config 由调用方注入，不碰
// DOM / localStorage / navigator。三条诚实前提落进代码：
//   ① 分钟是权威值，%/delta/趋势都是派生展示；
//   ② 当期进行中时按“同步进度”对比（elapsedMatchedRange），不拿半周比整周；
//   ③ 数据不足时不给方向——只显示水平，方向判 insufficient。
// 阈值是保守默认（维护者 2026-09-21 认可），集中在此，便于日后调。
export const COMPARE = {
  COMPARABLE_COVERAGE: 0.6, // 一期“可比”：已记录天数 / 该期已历天数 ≥ 60%
  TREND_PERIODS: 8,          // 趋势最多回看 8 个已完成同类周期
  MIN_TREND_PERIODS: 3,      // 少于 3 个可比周期 → 不给趋势方向
  FLAT_ABS_MIN: 30,          // 持平死区：绝对差 < 30 分钟
  FLAT_REL: 0.10             // 持平死区：相对差 < 10%
};

// 区间内有真实记录的自然日数（不含计划/占位）。
function recordedDayCountInRange(entries, start, end) {
  const s = +startOfDay(new Date(start));
  const e = +new Date(end);
  const seen = new Set();
  loggedEntriesFrom(entries).forEach(entry => {
    if (isPlaceholderEntry(entry)) return;
    const t = +new Date(entry.ts);
    if (t >= s && t < e) seen.add(entry.ts.slice(0, 10));
  });
  return seen.size;
}

// 区间跨越的自然日数（按已历部分算，用于当期覆盖率分母）。
function calendarDayCountInRange(start, end) {
  const s = startOfDay(new Date(start));
  const last = new Date(+end - 1);
  if (+last < +s) return 0;
  return inclusiveCalendarDayCount(localDateKey(s), localDateKey(last));
}

function coverageInRange(entries, start, end) {
  const days = calendarDayCountInRange(start, end);
  const loggedDays = recordedDayCountInRange(entries, start, end);
  return { loggedDays, days, ratio: days > 0 ? loggedDays / days : 0 };
}

// 区间内各标签的已发生分钟（不含未记录段）。返回 Map<tag, mins>。
export function tagMinutes(entries, start, end, opts = {}) {
  const map = new Map();
  buildRangeSegmentsFromEntries(entries, start, end, opts).forEach(segment => {
    if (segment.unrecorded || segment.mins <= 0) return;
    map.set(segment.tag, (map.get(segment.tag) || 0) + segment.mins);
  });
  return map;
}

// ── v1.9.0 事项排行（时间分析页）──
// 「事项」＝同一标签下正文相同的记录。正文归并只做最保守的规整：去首尾空白、折叠
// 连续空白、忽略大小写（与 tagKey 同用 toLowerCase，不随设备语言变）。不做前缀、
// 关键词或模糊归并——2026-11-18 用维护者真实备份测过（scripts/what_repeat_stats.mjs）：
// 主线正文多为描述句，前缀归并会把不同任务混在一起，宁可逐条列出。
export function itemTextKey(what) {
  return String(what || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * 区间内按「标签 + 正文」归并的已发生时长排行，不含未记录段。
 * opts.bucket 只取该桶；opts.tag 只取该标签（按 tagKey）；opts.query 只取正文含该词的
 * 记录（同样规整后比较）。每条记录只算一次出现：跨午夜被切成两段仍是一次，日期取它在
 * 区间内第一段所在的自然日。显示正文与标签取最近一次出现的原文。不修改输入。
 * @returns {Array<{key:string,text:string,tag:string,bucket:string,mins:number,count:number,occurrences:Array<{date:string,mins:number,count:number}>}>}
 */
export function itemRanking(entries, start, end, opts = {}) {
  const scopeTag = opts.tag != null ? tagKey(opts.tag) : null;
  const scopeBucket = opts.bucket || null;
  const query = opts.query ? itemTextKey(opts.query) : '';
  const perEntry = new Map();
  buildRangeSegmentsFromEntries(entries, start, end, opts).forEach(seg => {
    if (seg.unrecorded || !seg.e || seg.mins <= 0) return;
    if (scopeBucket && seg.bucket !== scopeBucket) return;
    if (scopeTag !== null && tagKey(seg.tag) !== scopeTag) return;
    const hit = perEntry.get(seg.e);
    if (hit) { hit.mins += seg.mins; return; }
    perEntry.set(seg.e, { entry: seg.e, tag: seg.tag, bucket: seg.bucket, mins: seg.mins, date: localDateKey(seg.start) });
  });
  const groups = new Map();
  perEntry.forEach(item => {
    const text = typeof item.entry.what === 'string' ? item.entry.what.trim() : '';
    if (query && !itemTextKey(text).includes(query)) return;
    const key = `${tagKey(item.tag)}\u0000${itemTextKey(text)}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, text, tag: item.tag, bucket: item.bucket, mins: 0, count: 0, days: new Map(), latest: '' };
      groups.set(key, group);
    }
    group.mins += item.mins;
    group.count += 1;
    const day = group.days.get(item.date) || { date: item.date, mins: 0, count: 0 };
    day.mins += item.mins;
    day.count += 1;
    group.days.set(item.date, day);
    if (item.entry.ts >= group.latest) {
      group.latest = item.entry.ts;
      group.text = text;
      group.tag = item.tag;
    }
  });
  const byText = (a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0);
  return [...groups.values()]
    .map(g => ({
      key: g.key, text: g.text, tag: g.tag, bucket: g.bucket, mins: g.mins, count: g.count,
      occurrences: [...g.days.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    }))
    .sort((a, b) => (b.mins - a.mins) || (b.count - a.count) || byText(a, b));
}

function diffTagMaps(curMap, prevMap) {
  const out = new Map();
  const keys = new Set([...curMap.keys(), ...prevMap.keys()]);
  keys.forEach(tag => out.set(tag, (curMap.get(tag) || 0) - (prevMap.get(tag) || 0)));
  return out;
}

/**
 * 当期 vs 上期（同步进度）对比。
 * @returns {{
 *   current: object, previousMatched: object,
 *   deltaByBucket: {job:number,maintain:number,leak:number,unrecorded:number},
 *   deltaByTag: Map<string,number>,
 *   coverage: { current: object, previous: object },
 *   comparable: boolean
 * }}
 */
export function comparePeriods(entries, view, dateKey, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const config = opts.config;
  const cur = periodRange(view, dateKey);
  const matched = elapsedMatchedRange(view, dateKey, now);
  const so = { now, config };

  const current = summarizeEntries(entries, cur.start, cur.end, so);
  // 上期只取“同样走到这个点”的裁剪区间；now 传该裁剪终点，避免 buildRange 用真实 now 把它顶回去。
  const previousMatched = summarizeEntries(entries, matched.start, matched.end, { now: matched.end, config });

  const curTags = tagMinutes(entries, cur.start, cur.end, so);
  const prevTags = tagMinutes(entries, matched.start, matched.end, { now: matched.end, config });

  const covCur = coverageInRange(entries, cur.start, matched.curElapsedEnd);
  const covPrev = coverageInRange(entries, matched.start, matched.end);

  return {
    current,
    previousMatched,
    deltaByBucket: {
      job: current.job - previousMatched.job,
      maintain: current.maintain - previousMatched.maintain,
      leak: current.leak - previousMatched.leak,
      unrecorded: current.unrecorded - previousMatched.unrecorded
    },
    deltaByTag: diffTagMaps(curTags, prevTags),
    coverage: { current: covCur, previous: covPrev },
    comparable: covCur.ratio >= COMPARE.COMPARABLE_COVERAGE && covPrev.ratio >= COMPARE.COMPARABLE_COVERAGE
  };
}

function mean(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

// 近半均值 vs 前半均值，带持平死区。刻意不做回归/显著性——那是假装严谨。
function classifyDirection(series) {
  if (series.length < 2) return 'flat';
  const mid = Math.floor(series.length / 2);
  const older = mean(series.slice(0, series.length - mid));
  const recent = mean(series.slice(series.length - mid));
  const diff = recent - older;
  if (Math.abs(diff) < Math.max(COMPARE.FLAT_ABS_MIN, COMPARE.FLAT_REL * older)) return 'flat';
  return diff > 0 ? 'up' : 'down';
}

// 末尾连续朝指定方向（'up'/'down'）的期数（“连续 N 周上升”）。方向为 flat/
// insufficient 时没有可展示的 run，返回 0——避免显示“连续上升”却没有趋势箭头。
function trailingRun(series, direction) {
  if (series.length < 2 || (direction !== 'up' && direction !== 'down')) return 0;
  const want = direction === 'up' ? 1 : -1;
  let run = 0;
  for (let i = series.length - 1; i > 0; i -= 1) {
    if (Math.sign(series[i] - series[i - 1]) === want) run += 1;
    else break;
  }
  return run;
}

/**
 * 某个桶（默认主线 job）在最近若干“已完成”同类周期上的走向。
 * 只用已完成周期（end <= now），当期进行中那期不混入。方向仅由“可比”周期决定，
 * 可比周期少于 MIN_TREND_PERIODS 时返回 insufficient——不编方向。
 * @returns {{ series:number[], comparableSeries:number[], direction:'up'|'down'|'flat'|'insufficient', runLength:number, bucket:string, tag:string|null }}
 */
export function periodTrend(entries, view, dateKey, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const config = opts.config;
  const scope = trendScope(opts);
  const bucket = scope.bucket || '';
  const periods = opts.periods || COMPARE.TREND_PERIODS;

  // 从当期起点往回，逐个取“已完成”周期（end <= now），最多 periods 个，按时间正序。
  const collected = [];
  let ref = dateKey;
  for (let i = 0; i < periods; i += 1) {
    const prev = previousPeriodRange(view, ref);
    if (+prev.end > +now) break; // 未完成的不算
    const mins = scopeMinutes(entries, prev.start, prev.end, { now: prev.end, config }, scope);
    const cov = coverageInRange(entries, prev.start, prev.end);
    collected.unshift({ mins, comparable: cov.ratio >= COMPARE.COMPARABLE_COVERAGE });
    ref = localDateKey(prev.start);
  }

  const series = collected.map(p => p.mins);
  const comparableSeries = collected.filter(p => p.comparable).map(p => p.mins);
  const direction = comparableSeries.length >= COMPARE.MIN_TREND_PERIODS
    ? classifyDirection(comparableSeries)
    : 'insufficient';
  return { series, comparableSeries, direction, runLength: trailingRun(comparableSeries, direction), bucket, tag: scope.tag != null ? scope.tag : null };
}

/**
 * 个人基线（「常态」，v1.9.0）：此前最多 TREND_PERIODS 个已完成同类周期里，与当期
 * **同样走到这一点**的那一段（当期已完成则整期）各花了多少，取可比那几期的中位数。
 * 可比＝该段已记录天数 / 该段天数 ≥ COMPARABLE_COVERAGE；可比期少于 MIN_TREND_PERIODS、
 * 或当期自身记录不足时不下结论。只和上一期比会被一次出差、生病带偏，中位数更稳。
 * opts.bucket（默认 job）或 opts.tag 指定范围，口径同 periodTrend。
 * @returns {{ median:number|null, periods:number, current:number, diff:number|null, matched:boolean, verdict:'above'|'below'|'near'|'insufficient' }}
 */
export function periodBaseline(entries, view, dateKey, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const config = opts.config;
  const scope = trendScope(opts);
  const periods = opts.periods || COMPARE.TREND_PERIODS;
  const cur = periodRange(view, dateKey);
  const complete = +now >= +cur.end;
  const curEnd = complete ? cur.end : (now < cur.start ? cur.start : now);
  const elapsedMs = +curEnd - +cur.start;
  const current = scopeMinutes(entries, cur.start, cur.end, { now, config }, scope);
  const currentComparable = elapsedMs > 0
    && coverageInRange(entries, cur.start, curEnd).ratio >= COMPARE.COMPARABLE_COVERAGE;

  const samples = [];
  let ref = dateKey;
  for (let i = 0; i < periods && elapsedMs > 0; i += 1) {
    const prev = previousPeriodRange(view, ref);
    ref = localDateKey(prev.start);
    if (+prev.end > +now) break;
    // 与 elapsedMatchedRange 同一规则：当期已完成→整期；否则按已过时长平移、不越过该期末。
    const end = complete ? prev.end : new Date(Math.min(+prev.end, +prev.start + elapsedMs));
    if (coverageInRange(entries, prev.start, end).ratio < COMPARE.COMPARABLE_COVERAGE) continue;
    samples.push(scopeMinutes(entries, prev.start, end, { now: end, config }, scope));
  }
  if (!currentComparable || samples.length < COMPARE.MIN_TREND_PERIODS) {
    return { median: null, periods: samples.length, current, diff: null, matched: !complete, verdict: 'insufficient' };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const diff = current - median;
  const near = Math.abs(diff) < Math.max(COMPARE.FLAT_ABS_MIN, COMPARE.FLAT_REL * median);
  return { median, periods: samples.length, current, diff, matched: !complete, verdict: near ? 'near' : (diff > 0 ? 'above' : 'below') };
}

// ── v1.9.0 时间分析「全部」与累计 ──
// 全部记录的范围：第一条真实记录（非计划、非占位）所在自然日 00:00 到今天结束。
// 没有真实记录返回 null，调用方不编造范围。
export function historyRange(entries, now = new Date()) {
  const first = loggedEntriesFrom(entries).find(entry => !isPlaceholderEntry(entry));
  if (!first) return null;
  const start = startOfDay(new Date(first.ts));
  const end = addDays(startOfDay(new Date(now)), 1);
  return { start, end: +end > +start ? end : addDays(start, 1) };
}

// 区间覆盖率（有真实记录的自然日 / 区间已历自然日），供「全部」这类不做对比的范围用。
export function periodCoverage(entries, start, end) {
  return coverageInRange(entries, start, end);
}

/**
 * 区间内某个桶或标签真正发生过的自然日：首日、末日与天数（只看已发生、非未记录的分段；
 * 跨午夜的记录两天都算）。opts.bucket / opts.tag 同 periodTrend。
 * @returns {{ days:number, first:string, last:string }}
 */
export function scopeActivity(entries, start, end, opts = {}) {
  const scope = trendScope(opts);
  const key = scope.tag != null ? tagKey(scope.tag) : null;
  const days = new Set();
  buildRangeSegmentsFromEntries(entries, start, end, opts).forEach(seg => {
    if (seg.unrecorded || seg.mins <= 0) return;
    if (key !== null ? tagKey(seg.tag) !== key : seg.bucket !== scope.bucket) return;
    days.add(localDateKey(seg.start));
  });
  const sorted = [...days].sort();
  return { days: sorted.length, first: sorted[0] || '', last: sorted[sorted.length - 1] || '' };
}

// 趋势/基线的范围：opts.tag（按 tagKey 匹配）优先，否则 opts.bucket，默认主线桶。
function trendScope(opts) {
  return opts.tag != null ? { tag: opts.tag } : { bucket: opts.bucket || 'job' };
}

function scopeMinutes(entries, start, end, segOpts, scope) {
  if (scope.tag != null) {
    const key = tagKey(scope.tag);
    let mins = 0;
    buildRangeSegmentsFromEntries(entries, start, end, segOpts).forEach(seg => {
      if (!seg.unrecorded && seg.mins > 0 && tagKey(seg.tag) === key) mins += seg.mins;
    });
    return mins;
  }
  return summarizeEntries(entries, start, end, segOpts)[scope.bucket] || 0;
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

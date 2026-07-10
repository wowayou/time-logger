#!/usr/bin/env python3
"""Smoke tests for Time Logger confirmation, percentage, and day-boundary logic."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


HARNESS = r'''
import {
  GAP,
  buildRangeSegmentsFromEntries,
  classifySegment,
  confirmSegmentInData,
  formatPercent,
  isKnownTag,
  primaryTag,
  summarizeEntries
} from './src/stats.js';
import {
  carveInsert,
  coalesceRedundant,
  normalizeEntries,
  planDeleteEntry,
  planIntervalEdit,
  planSegmentSplit
} from './src/entry_model.js';
import { inclusiveCalendarDayCount } from './src/time.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function approx(actual, expected, message) {
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertTotals(actual, expected, label) {
  for (const key of ['job', 'maintain', 'leak', 'unrecorded', 'pending', 'total']) {
    approx(actual[key], expected[key], `${label} ${key}`);
  }
}

function entry(id, ts, tag, mark) {
  const value = { id, ts, what: id, tags: [tag] };
  if (mark) value.longConfirm = mark;
  return value;
}

function p2(n) {
  return String(n).padStart(2, '0');
}

function formatDate(d) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

function addMinutes(base, minutes) {
  return formatDate(new Date(base.getTime() + minutes * 60000));
}

assert(formatPercent(0.5, 100) === '0.5%', '0.5% formatting changed');
assert(formatPercent(60.2, 100) === '60.2%', '60.2% formatting changed');
assert(formatPercent(39.3, 100) === '39.3%', '39.3% formatting changed');
assert(formatPercent(0.05, 100) === '<0.1%', 'tiny non-zero percentage formatting changed');
assert(formatPercent(99.95, 100) === '>99.9%', 'near-100 percentage formatting changed');
assert(formatPercent(0, 100) === '0%', 'zero percentage formatting changed');
assert(formatPercent(33.34, 100) === '33.3%', '33.34% formatting changed');
assert(formatPercent(33.33, 100) === '33.3%', '33.33% formatting changed');
assert(inclusiveCalendarDayCount('2026-03-08', '2026-03-09') === 2, 'usage days must count local calendar dates across DST');
assert(inclusiveCalendarDayCount('2026-06-29', '2026-06-29') === 1, 'first local usage date must be day 1');

const thresholdEntries = [
  entry('a', '2020-01-01T09:00', '求职推进'),
  entry('b', '2020-01-01T12:00', '杂'),
  entry('c', '2020-01-01T13:00', '求职推进')
];
assertTotals(
  summarizeEntries(thresholdEntries, new Date('2020-01-01T09:00'), new Date('2020-01-01T13:00')),
  { job: 180, maintain: 60, leak: 0, unrecorded: 0, pending: 0, total: 240 },
  '180 minute threshold'
);

const pendingEntries = [
  entry('a', '2020-01-01T09:00', '求职推进'),
  entry('b', '2020-01-01T12:01', '杂')
];
const pendingTotals = summarizeEntries(pendingEntries, new Date('2020-01-01T09:00'), new Date('2020-01-01T12:01'));
assertTotals(pendingTotals, { job: 0, maintain: 0, leak: 0, unrecorded: 181, pending: 181, total: 181 }, '181 minute pending');
const pendingSegments = buildRangeSegmentsFromEntries(pendingEntries, new Date('2020-01-01T09:00'), new Date('2020-01-01T12:01'));
assert(pendingSegments[0].confirmable === true, 'closed 181 minute known segment should be confirmable');

const confirmData = { version: 1, entries: pendingEntries.map(e => ({ ...e })) };
const confirmResult = confirmSegmentInData(confirmData, 'a', '2020-01-01T12:01');
assert(confirmResult.ok, 'confirming a closed long segment failed');
assertTotals(
  summarizeEntries(confirmData.entries, new Date('2020-01-01T09:00'), new Date('2020-01-01T12:01')),
  { job: 181, maintain: 0, leak: 0, unrecorded: 0, pending: 0, total: 181 },
  'confirmed segment returns to label'
);

const unknownEntries = [
  entry('a', '2020-01-01T09:00', '未知'),
  entry('b', '2020-01-01T14:00', '求职推进')
];
assertTotals(
  summarizeEntries(unknownEntries, new Date('2020-01-01T09:00'), new Date('2020-01-01T14:00')),
  { job: 0, maintain: 0, leak: 0, unrecorded: 300, pending: 0, total: 300 },
  'unknown tag remains unrecorded'
);
assert(confirmSegmentInData({ version: 1, entries: unknownEntries }, 'a', '2020-01-01T14:00').reason === 'not-required', 'unknown tag should not be confirmable');

const sleepEntries = [
  entry('a', '2020-01-01T00:00', '睡觉'),
  entry('b', '2020-01-01T06:00', '求职推进')
];
assertTotals(
  summarizeEntries(sleepEntries, new Date('2020-01-01T00:00'), new Date('2020-01-01T06:00')),
  { job: 0, maintain: 360, leak: 0, unrecorded: 0, pending: 0, total: 360 },
  'sleep longOk bypasses confirmation'
);
assert(confirmSegmentInData({ version: 1, entries: sleepEntries.map(e => ({ ...e })) }, 'a', '2020-01-01T06:00').reason === 'not-required', 'sleep should not require long confirmation');

const mealEntries = [
  entry('a', '2020-01-01T00:00', '吃饭'),
  entry('b', '2020-01-01T06:00', '求职推进')
];
assertTotals(
  summarizeEntries(mealEntries, new Date('2020-01-01T00:00'), new Date('2020-01-01T06:00')),
  { job: 0, maintain: 0, leak: 0, unrecorded: 360, pending: 360, total: 360 },
  'non-longOk maintain chip still requires confirmation'
);

assertTotals(
  summarizeEntries(
    [entry('a', '2020-01-01T09:00', '研究·学工具·逃避'), entry('b', '2020-01-01T10:00', '求职推进')],
    new Date('2020-01-01T09:00'),
    new Date('2020-01-01T10:00')
  ),
  { job: 0, maintain: 0, leak: 60, unrecorded: 0, pending: 0, total: 60 },
  'legacy leak alias maps to leak bucket'
);

const ongoingFlags = classifySegment(entry('a', '2020-01-01T09:00', '求职推进'), 181, '', true);
assert(ongoingFlags.pendingConfirm === true, 'ongoing long known segment should be pending');
assert(ongoingFlags.confirmable === false, 'ongoing long known segment must not be confirmable');

const insertedEntries = [
  entry('a', '2020-01-01T09:00', '求职推进', { startTs: '2020-01-01T09:00', endTs: '2020-01-01T15:00' }),
  entry('m', '2020-01-01T13:00', '杂'),
  entry('b', '2020-01-01T15:00', '杂')
];
assertTotals(
  summarizeEntries(insertedEntries, new Date('2020-01-01T09:00'), new Date('2020-01-01T15:00')),
  { job: 0, maintain: 120, leak: 0, unrecorded: 240, pending: 240, total: 360 },
  'inserted middle record invalidates old confirmation'
);

const changedStartEntries = [
  entry('a', '2020-01-01T09:05', '求职推进', { startTs: '2020-01-01T09:00', endTs: '2020-01-01T15:00' }),
  entry('b', '2020-01-01T15:00', '杂')
];
assertTotals(
  summarizeEntries(changedStartEntries, new Date('2020-01-01T09:05'), new Date('2020-01-01T15:00')),
  { job: 0, maintain: 0, leak: 0, unrecorded: 355, pending: 355, total: 355 },
  'changed start invalidates old confirmation'
);

const changedEndEntries = [
  entry('a', '2020-01-01T09:00', '求职推进', { startTs: '2020-01-01T09:00', endTs: '2020-01-01T15:00' }),
  entry('b', '2020-01-01T15:05', '杂')
];
assertTotals(
  summarizeEntries(changedEndEntries, new Date('2020-01-01T09:00'), new Date('2020-01-01T15:05')),
  { job: 0, maintain: 0, leak: 0, unrecorded: 365, pending: 365, total: 365 },
  'changed end invalidates old confirmation'
);

const changedLabelEntries = [
  entry('a', '2020-01-01T09:00', '杂', { startTs: '2020-01-01T09:00', endTs: '2020-01-01T13:00' }),
  entry('b', '2020-01-01T13:00', '求职推进')
];
assertTotals(
  summarizeEntries(changedLabelEntries, new Date('2020-01-01T09:00'), new Date('2020-01-01T13:00')),
  { job: 0, maintain: 240, leak: 0, unrecorded: 0, pending: 0, total: 240 },
  'changed explicit label keeps same time-bound confirmation'
);

assertTotals(
  summarizeEntries(
    [entry('y', '2020-01-01T23:00', '杂')],
    new Date('2020-01-02T00:00'),
    new Date('2020-01-03T00:00'),
    { now: '2020-01-03T00:00' }
  ),
  { job: 0, maintain: 0, leak: 0, unrecorded: 0, pending: 0, total: 0 },
  'empty day must not inherit previous day label'
);

const closedCrossDayEntries = [
  entry('a', '2020-01-01T23:00', '求职推进', { startTs: '2020-01-01T23:00', endTs: '2020-01-02T02:35' }),
  entry('b', '2020-01-02T02:35', '杂')
];
const closedCrossDaySegments = buildRangeSegmentsFromEntries(
  closedCrossDayEntries,
  new Date('2020-01-02T00:00'),
  new Date('2020-01-02T02:35'),
  { now: '2020-01-03T00:00' }
);
assert(closedCrossDaySegments.length === 1, 'closed cross-day segment should slice into next day');
assert(closedCrossDaySegments[0].e.id === 'a', 'closed cross-day slice should keep original entry id');
assert(formatDate(closedCrossDaySegments[0].start) === '2020-01-02T00:00', 'closed cross-day slice should start at local midnight');
assert(closedCrossDaySegments[0].endTs === '2020-01-02T02:35', 'closed cross-day segment should bind to the true right neighbor');
assertTotals(
  summarizeEntries(closedCrossDayEntries, new Date('2020-01-02T00:00'), new Date('2020-01-02T02:35'), { now: '2020-01-03T00:00' }),
  { job: 155, maintain: 0, leak: 0, unrecorded: 0, pending: 0, total: 155 },
  'confirmed closed cross-day segment returns to original label on next day'
);

const crossConfirmData = {
  version: 1,
  entries: [
    entry('a', '2020-01-01T23:00', '求职推进'),
    entry('b', '2020-01-02T02:35', '杂')
  ]
};
const crossConfirmResult = confirmSegmentInData(crossConfirmData, 'a', '2020-01-02T02:35', { now: '2020-01-03T00:00' });
assert(crossConfirmResult.ok, 'cross-day closed long segment confirmation failed');
assert(crossConfirmData.entries[0].longConfirm.startTs === '2020-01-01T23:00', 'cross-day long confirmation should bind original start');
assert(crossConfirmData.entries[0].longConfirm.endTs === '2020-01-02T02:35', 'cross-day long confirmation should bind true right neighbor');

const movedCrossDayEntries = [
  entry('a', '2020-01-01T23:00', '求职推进', { startTs: '2020-01-01T23:00', endTs: '2020-01-02T02:35' }),
  entry('b', '2020-01-02T02:40', '杂')
];
assertTotals(
  summarizeEntries(movedCrossDayEntries, new Date('2020-01-02T00:00'), new Date('2020-01-02T02:40'), { now: '2020-01-03T00:00' }),
  { job: 0, maintain: 0, leak: 0, unrecorded: 160, pending: 160, total: 160 },
  'cross-day adjacent time change invalidates old confirmation'
);

assertTotals(
  summarizeEntries(
    [entry('a', '2020-01-02T09:00', '求职推进'), entry('b', '2020-01-02T10:00', '杂')],
    new Date('2020-01-02T00:00'),
    new Date('2020-01-02T10:00')
  ),
  { job: 60, maintain: 0, leak: 0, unrecorded: 540, pending: 0, total: 600 },
  'midnight to first same-day record is unrecorded'
);

assertTotals(
  summarizeEntries(
    [entry('a', '2020-01-01T23:00', '杂')],
    new Date('2020-01-01T00:00'),
    new Date('2020-01-03T00:00'),
    { now: '2020-01-03T00:00' }
  ),
  { job: 0, maintain: 60, leak: 0, unrecorded: 1380, pending: 0, total: 1440 },
  'multi-day summary stops at local day boundary and leaves empty next day empty'
);

const boundaryEntries = [entry('a', '2020-01-01T20:00', '求职推进')];
const boundarySegments = buildRangeSegmentsFromEntries(
  boundaryEntries,
  new Date('2020-01-01T00:00'),
  new Date('2020-01-02T00:00'),
  { now: '2020-01-03T00:00' }
);
assert(boundarySegments.length === 2, 'boundary day should contain unknown prelude and one record segment');
assert(boundarySegments[1].endTs === '2020-01-02T00:00', 'cross-day segment end should bind to local midnight');
assert(boundarySegments[1].confirmable === true, 'closed day-boundary long segment should be confirmable');
const boundaryData = { version: 1, entries: boundaryEntries.map(e => ({ ...e })) };
assert(confirmSegmentInData(boundaryData, 'a', '2020-01-02T00:00', { now: '2020-01-03T00:00' }).ok, 'boundary segment confirmation failed');
assertTotals(
  summarizeEntries(boundaryData.entries, new Date('2020-01-01T20:00'), new Date('2020-01-02T00:00'), { now: '2020-01-03T00:00' }),
  { job: 240, maintain: 0, leak: 0, unrecorded: 0, pending: 0, total: 240 },
  'confirmed boundary segment returns to label'
);

let seed = 0x5eed1234;
function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
}

const tags = ['求职推进', '研究·学工具·逃避', '未知', '杂'];
const base = new Date(2020, 0, 2, 0, 0);
for (let round = 0; round < 250; round += 1) {
  const count = 4 + Math.floor(random() * 8);
  const entries = [];
  let offset = Math.floor(random() * 20);
  for (let i = 0; i < count; i += 1) {
    entries.push(entry(`r${round}-${i}`, addMinutes(base, offset), tags[Math.floor(random() * tags.length)]));
    offset += 1 + Math.floor(random() * 90);
  }

  for (let i = 0; i < entries.length - 1; i += 1) {
    if (random() >= 0.45) continue;
    const mode = Math.floor(random() * 3);
    entries[i].longConfirm = {
      startTs: mode === 1 ? addMinutes(base, 9999 + i) : entries[i].ts,
      endTs: mode === 2 ? addMinutes(base, 8888 + i) : entries[i + 1].ts
    };
  }

  const start = new Date(entries[0].ts);
  const end = new Date(entries[entries.length - 1].ts);
  const totals = summarizeEntries(entries, start, end);
  approx(totals.job + totals.maintain + totals.leak + totals.unrecorded, totals.total, `random ${round} bucket sum`);
  assert(totals.pending <= totals.unrecorded + 1e-9, `random ${round} pending exceeds unrecorded`);

  const segments = buildRangeSegmentsFromEntries(entries, start, end);
  for (const seg of segments) {
    if (!seg.e) continue;
    const tag = primaryTag(seg.e);
    const knownLong = isKnownTag(tag) && seg.rawMins > GAP;
    const mark = seg.e.longConfirm;
    const matched = Boolean(mark && mark.startTs === seg.e.ts && mark.endTs === seg.endTs);
    if (knownLong) {
      assert(seg.pendingConfirm === !matched, `random ${round} confirmation binding mismatch`);
      assert(seg.unrecorded === !matched, `random ${round} unrecorded binding mismatch`);
    } else if (tag === '未知') {
      assert(seg.unrecorded === true, `random ${round} unknown should be unrecorded`);
      assert(seg.pendingConfirm === false, `random ${round} unknown should not be pending`);
    } else {
      assert(seg.unrecorded === false, `random ${round} known short segment should be recorded`);
      assert(seg.pendingConfirm === false, `random ${round} known short segment should not be pending`);
    }
  }
}

// --- v30 backfill / normalization engine ---
let genSeq = 0;
const genId = () => `gen${genSeq += 1}`;

// Bounded insert splits a labeled segment and restores the original label at end.
const carveSplit = [
  { id: 'sleep', ts: '2026-07-01T04:47', what: '睡觉', tags: ['睡觉'] },
  { id: 'wash', ts: '2026-07-01T09:40', what: '洗漱', tags: ['洗漱'] }
];
carveInsert(carveSplit, { start: '2026-07-01T06:00', end: '2026-07-01T07:00', what: '写代码', tag: '求职推进', createId: genId });
const carveSorted = carveSplit.slice().sort((a, b) => (a.ts < b.ts ? -1 : 1));
assert(carveSorted.length === 4, 'carve splits into four points');
assert(carveSorted[0].ts === '2026-07-01T04:47' && carveSorted[0].tags[0] === '睡觉', 'carve keeps the head 睡觉');
assert(carveSorted[1].ts === '2026-07-01T06:00' && carveSorted[1].tags[0] === '求职推进', 'carve inserts the new label at start');
assert(carveSorted[2].ts === '2026-07-01T07:00' && carveSorted[2].tags[0] === '睡觉' && carveSorted[2].what === '睡觉', 'carve restores the original label at end');
assert(carveSorted[3].ts === '2026-07-01T09:40' && carveSorted[3].tags[0] === '洗漱', 'carve never touches the next segment');

// Carving into an unrecorded (placeholder) stretch leaves both sides unrecorded.
const carveGap = [
  { id: 'ph', ts: '2026-07-01T04:00', what: '', tags: [] },
  { id: 'wash', ts: '2026-07-01T09:40', what: '洗漱', tags: ['洗漱'] }
];
carveInsert(carveGap, { start: '2026-07-01T06:00', end: '2026-07-01T07:00', what: '写代码', tag: '求职推进', createId: genId });
const gapSorted = carveGap.slice().sort((a, b) => (a.ts < b.ts ? -1 : 1));
assert(gapSorted.length === 4, 'carve into a gap makes four points');
assert(gapSorted[0].what === '' && gapSorted[0].ts === '2026-07-01T04:00', 'left of the fill stays unrecorded');
assert(gapSorted[1].ts === '2026-07-01T06:00' && gapSorted[1].tags[0] === '求职推进', 'the filled middle carries the new label');
assert(gapSorted[2].ts === '2026-07-01T07:00' && gapSorted[2].what === '' && gapSorted[2].tags.length === 0, 'right of the fill restores an unrecorded placeholder');

// coalesceRedundant heals a carve-undo (identical adjacent) ...
const healEntries = [
  { id: 'a', ts: '2026-07-01T04:47', what: '睡觉', tags: ['睡觉'] },
  { id: 'b', ts: '2026-07-01T07:00', what: '睡觉', tags: ['睡觉'] },
  { id: 'c', ts: '2026-07-01T09:40', what: '洗漱', tags: ['洗漱'] }
];
coalesceRedundant(healEntries);
assert(healEntries.length === 2 && !healEntries.some(e => e.id === 'b'), 'adjacent identical segments coalesce');

// ... but never merges same-tag records that carry different content.
const distinctEntries = [
  { id: 'a', ts: '2026-07-01T09:00', what: '写代码', tags: ['求职推进'] },
  { id: 'b', ts: '2026-07-01T10:00', what: '写方案', tags: ['求职推进'] }
];
coalesceRedundant(distinctEntries);
assert(distinctEntries.length === 2, 'same tag but different content stays two records');

// normalizeEntries guarantees today keeps a tail placeholder at now (kills +1min).
const normData = { version: 1, entries: [{ id: 'x', ts: '2026-07-01T09:00', what: '写代码', tags: ['求职推进'] }] };
normalizeEntries(normData, { todayKey: '2026-07-01', nowTs: '2026-07-01T12:00', createId: genId });
assert(normData.entries.some(e => e.ts === '2026-07-01T12:00' && e.what === '' && e.tags.length === 0), 'normalize opens a tail placeholder at now');

import { listPlannedEntries } from './src/stats.js';
import {
  bucketForTag,
  mergeImportedConfig,
  mergeImportedEntries,
  migrateEntryTags,
  countEntriesWithTag,
  normalizeConfig,
  rememberCustomTagForBucket,
  loadConfig,
  validateImportData,
  CONFIG_KEY
} from './src/storage.js';

const plannedOnly = [
  { id: 'plan1', ts: '2020-01-01T20:00', what: '面试', tags: ['求职推进'], planned: true }
];
assertTotals(
  summarizeEntries(plannedOnly, new Date('2020-01-01T00:00'), new Date('2020-01-01T23:59')),
  { job: 0, maintain: 0, leak: 0, unrecorded: 0, pending: 0, total: 0 },
  'planned entries excluded from stats'
);
assert(listPlannedEntries(plannedOnly, '2020-01-01').length === 1, 'planned list for day');

const migrateList = [entry('m1', '2020-01-01T09:00', '旧标签')];
assert(countEntriesWithTag(migrateList, '旧标签') === 1, 'count entries with tag');
migrateEntryTags(migrateList, '旧标签', '新标签');
assert(primaryTag(migrateList[0]) === '新标签', 'migrate entry tags');

globalThis.localStorage = {
  data: new Map(),
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; },
  setItem(key, value) { this.data.set(key, String(value)); },
  removeItem(key) { this.data.delete(key); },
  clear() { this.data.clear(); }
};
localStorage.setItem(CONFIG_KEY, JSON.stringify({ version: 1, mainline: ['求职推进'], chips: [] }));
rememberCustomTagForBucket('临时拉伸', 'maintain', []);
assert(loadConfig().chips.some(chip => chip.name === '临时拉伸' && chip.bucket === 'maintain'), 'first custom tag use pins immediately');
rememberCustomTagForBucket('临时拉伸', 'maintain', [entry('pin1', '2020-01-01T09:00', '临时拉伸')]);
assert(loadConfig().chips.filter(chip => chip.name === '临时拉伸').length === 1, 'repeat use keeps a single pinned chip');

// Recording an existing chip with a different bucket selected must NOT re-bucket
// it (v30: 「同名按 chip 归类」). Re-bucketing is a config-page action only.
localStorage.setItem(CONFIG_KEY, JSON.stringify({ version: 1, mainline: ['求职推进'], chips: [{ name: '娱乐', bucket: 'leak', longOk: false }] }));
rememberCustomTagForBucket('娱乐', 'maintain', []);
assert(loadConfig().chips.find(chip => chip.name === '娱乐').bucket === 'leak', 'recording never silently re-buckets an existing chip');

// --- v48 interval transactions ---
let txSeq = 0;
const txId = () => `tx${txSeq += 1}`;
const editSource = [
  { id: 'various', ts: '2026-07-09T15:39', what: '各种', tags: ['杂'] },
  { id: 'focus', ts: '2026-07-09T16:14', what: '专注', tags: ['求职推进'] },
  { id: 'meal', ts: '2026-07-09T19:11', what: '吃饭', tags: ['吃饭'] }
];
const movedSharedBoundary = planIntervalEdit(editSource, {
  id: 'various',
  startTs: '2026-07-09T15:39',
  endTs: '2026-07-09T18:11',
  endMode: 'fixed',
  what: '各种',
  tags: ['杂']
}, { todayKey: '2026-07-10', nowTs: '2026-07-10T12:00', createId: txId });
assert(movedSharedBoundary.ok, 'v48 text reproduction should allow moving the shared end boundary');
assert(movedSharedBoundary.resultEntries.find(e => e.id === 'focus').ts === '2026-07-09T18:11', 'shared end moves the next record start');
assert(movedSharedBoundary.resultEntries.find(e => e.id === 'meal').ts === '2026-07-09T19:11', 'shared end never swallows the following boundary');
assert(movedSharedBoundary.preview.map(part => part.role).join(',') === 'previous,current,next', 'interval edit previews previous/current/next');

const zeroByNeighbor = planIntervalEdit(editSource, {
  id: 'focus', startTs: '2026-07-09T15:39', endTs: '2026-07-09T19:00', endMode: 'fixed', what: '专注', tags: ['求职推进']
}, { todayKey: '2026-07-10', nowTs: '2026-07-10T12:00', createId: txId });
assert(!zeroByNeighbor.ok && zeroByNeighbor.reason === 'before-min', 'edit cannot collapse the previous record to zero duration');

const crossNaturalDay = planIntervalEdit([
  { id: 'late', ts: '2026-07-09T22:00', what: '收尾', tags: ['求职推进'] }
], {
  id: 'late', startTs: '2026-07-09T22:00', endTs: '2026-07-10T00:01', endMode: 'fixed', what: '收尾', tags: ['求职推进']
}, { todayKey: '2026-07-10', nowTs: '2026-07-10T12:00', createId: txId });
assert(!crossNaturalDay.ok && crossNaturalDay.reason === 'cross-day', 'interval edit cannot cross the local natural day');

const fixedTail = planIntervalEdit([
  { id: 'tail', ts: '2026-07-10T10:00', what: '进行中', tags: ['求职推进'] }
], {
  id: 'tail', startTs: '2026-07-10T10:00', endTs: '2026-07-10T11:00', endMode: 'fixed', what: '进行中', tags: ['求职推进']
}, { todayKey: '2026-07-10', nowTs: '2026-07-10T12:00', createId: txId });
assert(fixedTail.ok, 'today tail accepts a fixed end');
assert(fixedTail.resultEntries.some(e => e.ts === '2026-07-10T11:00' && e.what === ''), 'fixed tail leaves an unrecorded tail boundary');
const ongoingTail = planIntervalEdit(fixedTail.resultEntries, {
  id: 'tail', startTs: '2026-07-10T10:00', endTs: '2026-07-10T11:00', endMode: 'now', what: '进行中', tags: ['求职推进']
}, { todayKey: '2026-07-10', nowTs: '2026-07-10T12:00', createId: txId });
assert(ongoingTail.ok && ongoingTail.resultEntries.find(e => e.id === 'tail').ongoing === true, 'today tail supports a true ongoing end');
assert(!ongoingTail.resultEntries.some(e => e.what === ''), 'ongoing tail removes the fixed unrecorded boundary');

const splitBase = [
  { id: 'source', ts: '2026-07-09T16:11', what: '原段', tags: ['求职推进'] },
  { id: 'right', ts: '2026-07-09T19:11', what: '右段', tags: ['吃饭'] }
];
const splitInside = planSegmentSplit(splitBase, {
  sourceId: 'source', frozenStart: '2026-07-09T16:11', frozenEnd: '2026-07-09T19:11',
  startTs: '2026-07-09T17:00', endTs: '2026-07-09T18:00', what: '新段', tags: ['刷手机']
}, { createId: txId });
assert(splitInside.ok && splitInside.mode === 'inside' && splitInside.preview.length === 3, 'internal split previews three segments');
assert(splitInside.resultEntries.some(e => e.ts === '2026-07-09T18:00' && e.what === '原段'), 'internal split restores the frozen source after the new segment');
const splitEdge = planSegmentSplit(splitBase, {
  sourceId: 'source', frozenStart: '2026-07-09T16:11', frozenEnd: '2026-07-09T19:11',
  startTs: '2026-07-09T16:11', endTs: '2026-07-09T18:00', what: '新段', tags: ['刷手机']
}, { createId: txId });
assert(splitEdge.ok && splitEdge.mode === 'edge' && splitEdge.preview.length === 2, 'edge split degrades to two segments');
const splitWhole = planSegmentSplit(splitBase, {
  sourceId: 'source', frozenStart: '2026-07-09T16:11', frozenEnd: '2026-07-09T19:11',
  startTs: '2026-07-09T16:11', endTs: '2026-07-09T19:11', what: '整段替换', tags: ['刷手机']
}, { createId: txId });
assert(splitWhole.ok && splitWhole.mode === 'whole' && splitWhole.preview.length === 1, 'whole split explicitly becomes one replacement segment');
const splitOutside = planSegmentSplit(splitBase, {
  sourceId: 'source', frozenStart: '2026-07-09T16:11', frozenEnd: '2026-07-09T19:11',
  startTs: '2026-07-09T16:00', endTs: '2026-07-09T18:00', what: '越界', tags: ['刷手机']
}, { createId: txId });
assert(!splitOutside.ok && splitOutside.reason === 'outside-source', 'split picker cannot escape frozen source boundaries');

const sameTagDifferentWhat = [
  { id: 'left', ts: '2026-07-09T08:00', what: '写代码', tags: ['求职推进'] },
  { id: 'middle', ts: '2026-07-09T09:00', what: '开会', tags: ['维持'] },
  { id: 'right', ts: '2026-07-09T10:00', what: '写方案', tags: ['求职推进'] }
];
const deleteDifferent = planDeleteEntry(sameTagDifferentWhat, 'middle', { todayKey: '2026-07-10', nowTs: '2026-07-10T12:00' });
assert(deleteDifferent.ok && deleteDifferent.outcome === 'unrecorded', 'same tag with different content must not reconnect');
assert(deleteDifferent.resultEntries.find(e => e.id === 'middle').what === '', 'non-matching delete preserves the exact span as unrecorded');
const deleteJoin = planDeleteEntry([
  { id: 'left', ts: '2026-07-09T08:00', what: '同一内容', tags: ['求职推进'] },
  { id: 'middle', ts: '2026-07-09T09:00', what: '插入段', tags: ['吃饭'] },
  { id: 'right', ts: '2026-07-09T10:00', what: '同一内容', tags: ['求职推进'] },
  { id: 'after', ts: '2026-07-09T11:00', what: '后续', tags: ['吃饭'] }
], 'middle', { todayKey: '2026-07-10', nowTs: '2026-07-10T12:00' });
assert(deleteJoin.ok && deleteJoin.outcome === 'join', 'exactly matching content and tags reconnect');
assert(!deleteJoin.resultEntries.some(e => e.id === 'middle' || e.id === 'right'), 'reconnect coalesces the redundant right boundary');
const deleteFirst = planDeleteEntry(sameTagDifferentWhat, 'left', { todayKey: '2026-07-10', nowTs: '2026-07-10T12:00' });
assert(deleteFirst.outcome === 'unrecorded', 'first record deletion never stretches a neighbor backward');
const deleteTail = planDeleteEntry(sameTagDifferentWhat, 'right', { todayKey: '2026-07-10', nowTs: '2026-07-10T12:00' });
assert(deleteTail.outcome === 'unrecorded', 'tail deletion never stretches a neighbor forward');
const deletePlan = planDeleteEntry([{ id: 'p', ts: '2026-07-11T09:00', what: '计划', tags: ['求职推进'], planned: true }], 'p');
assert(deletePlan.outcome === 'remove-plan' && deletePlan.resultEntries.length === 0, 'planned entry deletes directly');

// Config normalization respects explicit saved state: renamed defaults stay renamed,
// and a mainline name can never be shadowed by a chip with the same name.
const renamedDefaults = normalizeConfig({
  version: 1,
  mainline: ['求职推进'],
  chips: [{ name: '休息', bucket: 'maintain', longOk: true }]
});
assert(!renamedDefaults.chips.some(chip => chip.name === '睡觉'), 'renamed default chip must not reappear');
const noCrossBucketDuplicate = normalizeConfig({
  version: 1,
  mainline: ['同名'],
  chips: [{ name: '同名', bucket: 'leak', longOk: false }]
});
assert(noCrossBucketDuplicate.chips.length === 0 && bucketForTag('同名', noCrossBucketDuplicate) === 'job', 'mainline wins and duplicate chip is removed');
const mergedConfig = mergeImportedConfig(
  { version: 1, mainline: ['本机'], chips: [{ name: '同名', bucket: 'maintain', longOk: true }] },
  { version: 1, mainline: ['导入主线'], chips: [{ name: '同名', bucket: 'leak', longOk: false }, { name: '新增', bucket: 'leak', longOk: false }] }
);
assert(mergedConfig.chips.find(chip => chip.name === '同名').bucket === 'maintain', 'local same-name tag config wins import');
assert(mergedConfig.mainline.includes('导入主线') && mergedConfig.chips.some(chip => chip.name === '新增'), 'new imported tags append');

const currentImport = { version: 1, entries: [{ id: 'a', ts: '2026-07-09T09:00', what: '已有', tags: ['求职推进'] }] };
const identicalImport = mergeImportedEntries(currentImport, [{ id: 'a', ts: '2026-07-09T09:00', what: '已有', tags: ['求职推进'] }]);
assert(identicalImport.ok && identicalImport.imported === 0 && identicalImport.skipped === 1, 'identical import entry is skipped');
const idConflict = mergeImportedEntries(currentImport, [{ id: 'a', ts: '2026-07-09T09:00', what: '不同', tags: ['求职推进'] }]);
assert(!idConflict.ok && idConflict.conflicts[0].type === 'id', 'same id with different content blocks entire import');
const timeConflict = mergeImportedEntries(currentImport, [{ id: 'b', ts: '2026-07-09T09:00', what: '同时刻', tags: ['吃饭'] }]);
assert(!timeConflict.ok && timeConflict.conflicts[0].type === 'time', 'different record at same timestamp blocks entire import');
assert(!validateImportData({ entries: [{ id: 42, ts: 'bad', what: '<img>', tags: 'nope' }] }).ok, 'import validates string ids, timestamps, content, and tags');

console.log('confirm_logic_smoke passed');
'''


def main() -> int:
    if not shutil.which("node"):
        print("confirm_logic_smoke failed: node executable was not found", file=sys.stderr)
        return 1

    result = subprocess.run(
        ["node", "--input-type=module"],
        input=HARNESS,
        text=True,
        encoding="utf-8",
        capture_output=True,
        cwd=ROOT,
        check=False,
    )
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())

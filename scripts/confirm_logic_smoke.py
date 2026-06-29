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

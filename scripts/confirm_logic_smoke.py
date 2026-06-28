#!/usr/bin/env python3
"""Smoke tests for Time Logger confirmation and percentage logic."""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read_inline_script() -> str:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    scripts = re.findall(r"<script>\s*(.*?)\s*</script>", html, re.DOTALL)
    if len(scripts) != 1:
        raise RuntimeError(f"expected exactly one inline script, found {len(scripts)}")
    return scripts[0]


def build_harness(script: str) -> str:
    return f"""
"use strict";

const window = {{
  __TIMELOG_TEST__: true,
  location: {{ reload() {{}} }},
  matchMedia() {{
    return {{ matches: false, addEventListener() {{}} }};
  }}
}};
const localStorage = {{
  _data: {{}},
  getItem(key) {{
    return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null;
  }},
  setItem(key, value) {{
    this._data[key] = String(value);
  }},
  removeItem(key) {{
    delete this._data[key];
  }}
}};
const navigator = {{}};
const document = {{}};
const alert = () => {{}};

Object.defineProperty(globalThis, "window", {{ value: window, configurable: true }});
Object.defineProperty(globalThis, "localStorage", {{ value: localStorage, configurable: true }});
Object.defineProperty(globalThis, "navigator", {{ value: navigator, configurable: true }});
Object.defineProperty(globalThis, "document", {{ value: document, configurable: true }});
Object.defineProperty(globalThis, "alert", {{ value: alert, configurable: true }});

{script}

const api = window.__timelogTest;

function assert(condition, message) {{
  if (!condition) throw new Error(message);
}}

function approx(actual, expected, message) {{
  if (Math.abs(actual - expected) > 1e-9) {{
    throw new Error(`${{message}}: expected ${{expected}}, got ${{actual}}`);
  }}
}}

function assertTotals(actual, expected, label) {{
  for (const key of ["job", "other", "unrecorded", "pending", "total"]) {{
    approx(actual[key], expected[key], `${{label}} ${{key}}`);
  }}
}}

function entry(id, ts, tag, mark) {{
  const value = {{ id, ts, what: id, tags: [tag] }};
  if (mark) value.longConfirm = mark;
  return value;
}}

function p2(n) {{
  return String(n).padStart(2, "0");
}}

function formatDate(d) {{
  return `${{d.getFullYear()}}-${{p2(d.getMonth() + 1)}}-${{p2(d.getDate())}}T${{p2(d.getHours())}}:${{p2(d.getMinutes())}}`;
}}

function addMinutes(base, minutes) {{
  return formatDate(new Date(base.getTime() + minutes * 60000));
}}

assert(api && typeof api === "object", "test API was not exposed");
assert(typeof api.confirmSegmentInData === "function", "confirm core is missing");
assert(typeof api.summarizeEntries === "function", "summarize core is missing");

assert(api.formatPercent(0.5, 100) === "0.5%", "0.5% formatting changed");
assert(api.formatPercent(60.2, 100) === "60.2%", "60.2% formatting changed");
assert(api.formatPercent(39.3, 100) === "39.3%", "39.3% formatting changed");
assert(api.formatPercent(0.05, 100) === "<0.1%", "tiny non-zero percentage formatting changed");
assert(api.formatPercent(99.95, 100) === ">99.9%", "near-100 percentage formatting changed");
assert(api.formatPercent(0, 100) === "0%", "zero percentage formatting changed");
assert(api.formatPercent(33.34, 100) === "33.3%", "33.34% formatting changed");
assert(api.formatPercent(33.33, 100) === "33.3%", "33.33% formatting changed");

const thresholdEntries = [
  entry("a", "2020-01-01T09:00", "求职推进"),
  entry("b", "2020-01-01T12:00", "杂"),
  entry("c", "2020-01-01T13:00", "求职推进")
];
assertTotals(
  api.summarizeEntries(thresholdEntries, new Date("2020-01-01T09:00"), new Date("2020-01-01T13:00")),
  {{ job: 180, other: 60, unrecorded: 0, pending: 0, total: 240 }},
  "180 minute threshold"
);

const pendingEntries = [
  entry("a", "2020-01-01T09:00", "求职推进"),
  entry("b", "2020-01-01T12:01", "杂")
];
const pendingTotals = api.summarizeEntries(pendingEntries, new Date("2020-01-01T09:00"), new Date("2020-01-01T12:01"));
assertTotals(pendingTotals, {{ job: 0, other: 0, unrecorded: 181, pending: 181, total: 181 }}, "181 minute pending");
const pendingSegments = api.buildRangeSegmentsFromEntries(pendingEntries, new Date("2020-01-01T09:00"), new Date("2020-01-01T12:01"));
assert(pendingSegments[0].confirmable === true, "closed 181 minute known segment should be confirmable");

const confirmData = {{ version: 1, entries: pendingEntries.map(e => ({{ ...e }})) }};
const confirmResult = api.confirmSegmentInData(confirmData, "a", "2020-01-01T12:01");
assert(confirmResult.ok, "confirming a closed long segment failed");
assertTotals(
  api.summarizeEntries(confirmData.entries, new Date("2020-01-01T09:00"), new Date("2020-01-01T12:01")),
  {{ job: 181, other: 0, unrecorded: 0, pending: 0, total: 181 }},
  "confirmed segment returns to label"
);

const unknownEntries = [
  entry("a", "2020-01-01T09:00", "未知"),
  entry("b", "2020-01-01T14:00", "求职推进")
];
assertTotals(
  api.summarizeEntries(unknownEntries, new Date("2020-01-01T09:00"), new Date("2020-01-01T14:00")),
  {{ job: 0, other: 0, unrecorded: 300, pending: 0, total: 300 }},
  "unknown tag remains unrecorded"
);
assert(api.confirmSegmentInData({{ version: 1, entries: unknownEntries }}, "a", "2020-01-01T14:00").reason === "not-required", "unknown tag should not be confirmable");

const ongoingFlags = api.classifySegment(entry("a", "2020-01-01T09:00", "求职推进"), 181, "", true);
assert(ongoingFlags.pendingConfirm === true, "ongoing long known segment should be pending");
assert(ongoingFlags.confirmable === false, "ongoing long known segment must not be confirmable");

const insertedEntries = [
  entry("a", "2020-01-01T09:00", "求职推进", {{ startTs: "2020-01-01T09:00", endTs: "2020-01-01T15:00" }}),
  entry("m", "2020-01-01T13:00", "杂"),
  entry("b", "2020-01-01T15:00", "杂")
];
assertTotals(
  api.summarizeEntries(insertedEntries, new Date("2020-01-01T09:00"), new Date("2020-01-01T15:00")),
  {{ job: 0, other: 120, unrecorded: 240, pending: 240, total: 360 }},
  "inserted middle record invalidates old confirmation"
);

const changedStartEntries = [
  entry("a", "2020-01-01T09:05", "求职推进", {{ startTs: "2020-01-01T09:00", endTs: "2020-01-01T15:00" }}),
  entry("b", "2020-01-01T15:00", "杂")
];
assertTotals(
  api.summarizeEntries(changedStartEntries, new Date("2020-01-01T09:05"), new Date("2020-01-01T15:00")),
  {{ job: 0, other: 0, unrecorded: 355, pending: 355, total: 355 }},
  "changed start invalidates old confirmation"
);

const changedEndEntries = [
  entry("a", "2020-01-01T09:00", "求职推进", {{ startTs: "2020-01-01T09:00", endTs: "2020-01-01T15:00" }}),
  entry("b", "2020-01-01T15:05", "杂")
];
assertTotals(
  api.summarizeEntries(changedEndEntries, new Date("2020-01-01T09:00"), new Date("2020-01-01T15:05")),
  {{ job: 0, other: 0, unrecorded: 365, pending: 365, total: 365 }},
  "changed end invalidates old confirmation"
);

const changedLabelEntries = [
  entry("a", "2020-01-01T09:00", "杂", {{ startTs: "2020-01-01T09:00", endTs: "2020-01-01T13:00" }}),
  entry("b", "2020-01-01T13:00", "求职推进")
];
assertTotals(
  api.summarizeEntries(changedLabelEntries, new Date("2020-01-01T09:00"), new Date("2020-01-01T13:00")),
  {{ job: 0, other: 240, unrecorded: 0, pending: 0, total: 240 }},
  "changed explicit label keeps same time-bound confirmation"
);

let seed = 0x5eed1234;
function random() {{
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
}}

const tags = ["求职推进", "研究·学工具·逃避", "未知", "杂"];
const base = new Date(2020, 0, 2, 0, 0);
for (let round = 0; round < 250; round += 1) {{
  const count = 4 + Math.floor(random() * 8);
  const entries = [];
  let offset = Math.floor(random() * 20);
  for (let i = 0; i < count; i += 1) {{
    entries.push(entry(`r${{round}}-${{i}}`, addMinutes(base, offset), tags[Math.floor(random() * tags.length)]));
    offset += 1 + Math.floor(random() * 260);
  }}

  for (let i = 0; i < entries.length - 1; i += 1) {{
    if (random() >= 0.45) continue;
    const mode = Math.floor(random() * 3);
    entries[i].longConfirm = {{
      startTs: mode === 1 ? addMinutes(base, 9999 + i) : entries[i].ts,
      endTs: mode === 2 ? addMinutes(base, 8888 + i) : entries[i + 1].ts
    }};
  }}

  const start = new Date(entries[0].ts);
  const end = new Date(entries[entries.length - 1].ts);
  const totals = api.summarizeEntries(entries, start, end);
  approx(totals.job + totals.other + totals.unrecorded, totals.total, `random ${{round}} bucket sum`);
  assert(totals.pending <= totals.unrecorded + 1e-9, `random ${{round}} pending exceeds unrecorded`);

  const segments = api.buildRangeSegmentsFromEntries(entries, start, end);
  for (const seg of segments) {{
    if (!seg.e) continue;
    const tag = api.primaryTag(seg.e);
    const knownLong = api.isKnownTag(tag) && seg.rawMins > api.GAP;
    const mark = seg.e.longConfirm;
    const matched = Boolean(mark && mark.startTs === seg.e.ts && mark.endTs === seg.endTs);
    if (knownLong) {{
      assert(seg.pendingConfirm === !matched, `random ${{round}} confirmation binding mismatch`);
      assert(seg.unrecorded === !matched, `random ${{round}} unrecorded binding mismatch`);
    }} else if (tag === "未知") {{
      assert(seg.unrecorded === true, `random ${{round}} unknown should be unrecorded`);
      assert(seg.pendingConfirm === false, `random ${{round}} unknown should not be pending`);
    }} else {{
      assert(seg.unrecorded === false, `random ${{round}} known short segment should be recorded`);
      assert(seg.pendingConfirm === false, `random ${{round}} known short segment should not be pending`);
    }}
  }}
}}

console.log("confirm_logic_smoke passed");
"""


def main() -> int:
    if not shutil.which("node"):
        print("confirm_logic_smoke failed: node executable was not found", file=sys.stderr)
        return 1

    try:
        script = read_inline_script()
    except RuntimeError as exc:
        print(f"confirm_logic_smoke failed: {exc}", file=sys.stderr)
        return 1

    result = subprocess.run(
        ["node"],
        input=build_harness(script),
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

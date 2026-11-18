#!/usr/bin/env node
// 开发期一次性分析工具：完整备份里「做了什么」正文的重复程度。
// 用来回答「按事项归并统计」该用什么规则——同样的正文出现几次、各种归并规则能覆盖多少时长。
//
// 用法：node scripts/what_repeat_stats.mjs <备份.json> [--show-tags] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
//
// 隐私：只读备份、不写任何文件、不联网；只输出聚合数字，从不打印正文；标签名默认打码为
// 「桶-T序号」，加 --show-tags 才显示。备份是真实数据，不要放进仓库（.gitignore 已忽略
// timelog-*.json），输出里若显示了标签名也不要贴进 issue/提交。
//
// 时长口径：直接导入本仓 src/stats.js 的 buildRangeSegmentsFromEntries，与应用统计一致
// （本地自然日硬边界、跨日最多切入次日、计划与空占位不算、未记录段不计入事项）。
// 每条记录算一次出现，跨午夜被切成两段的仍算一条。
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const USAGE = '用法：node scripts/what_repeat_stats.mjs <备份.json> [--show-tags] [--since YYYY-MM-DD] [--until YYYY-MM-DD]';
const args = process.argv.slice(2);
const optValue = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const valueIdx = new Set(['--since', '--until'].map(n => args.indexOf(n) + 1).filter(i => i > 0));
const file = args.find((a, i) => !a.startsWith('--') && !valueIdx.has(i));
if (!file || args.includes('--help')) {
  console.error(USAGE);
  process.exit(file ? 0 : 2);
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
for (const name of ['--since', '--until']) {
  const v = optValue(name);
  if (args.includes(name) && !(v && DATE.test(v))) { console.error(`${name} 需要 YYYY-MM-DD`); process.exit(2); }
}

// stats.js / storage.js 只在函数调用时读 localStorage；配置显式传入，这里只给一个空壳。
globalThis.localStorage = {
  data: new Map(),
  getItem(k) { return this.data.has(k) ? this.data.get(k) : null; },
  setItem(k, v) { this.data.set(k, String(v)); },
  removeItem(k) { this.data.delete(k); },
  clear() { this.data.clear(); }
};
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const mod = p => import(pathToFileURL(path.join(SRC, p)).href);
const { buildRangeSegmentsFromEntries, loggedEntriesFrom, isPlaceholderEntry } = await mod('stats.js');
const { normalizeConfig, bucketForTag, tagKey } = await mod('storage.js');

let backup;
try {
  backup = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`读不了备份：${err.message}`);
  process.exit(2);
}
if (!backup || !Array.isArray(backup.entries)) {
  console.error('不是时间尺完整备份：缺少 entries 数组');
  process.exit(2);
}
const config = normalizeConfig(backup.config || {});
const real = loggedEntriesFrom(backup.entries).filter(e => !isPlaceholderEntry(e));
if (!real.length) { console.log('没有真实记录'); process.exit(0); }

const now = new Date();
const since = optValue('--since') || real[0].ts.slice(0, 10);
const until = optValue('--until');
const start = new Date(`${since}T00:00`);
const end = until ? new Date(+new Date(`${until}T00:00`) + 86400000) : now;
const segments = buildRangeSegmentsFromEntries(backup.entries, start, end, { now, config });

// ── 归并规则 ──
const normalize = what => what.trim().replace(/\s+/g, ' ').toLowerCase();
const RULES = [
  ['A 全文', normalize],
  ['B 冒号前', w => { const a = normalize(w); const m = a.match(/^([^:：]+)[:：]/); return m && m[1].trim() ? m[1].trim() : a; }],
  ['C 首个短句', w => normalize(w).split(/[，。、；;,.!?！？\n（(]/)[0].trim() || normalize(w)],
  ['D 前 4 字', w => [...normalize(w).replace(/\s/g, '')].slice(0, 4).join('')],
  ['E 前 2 字', w => [...normalize(w).replace(/\s/g, '')].slice(0, 2).join('')]
];

// 每条记录汇总一次：{ mins, what, tag(tagKey), bucket }
const perEntry = new Map();
let emptyTextMins = 0;
for (const seg of segments) {
  if (seg.unrecorded || !seg.e || seg.mins <= 0) continue;
  const what = typeof seg.e.what === 'string' ? seg.e.what : '';
  if (!what.trim()) { emptyTextMins += seg.mins; continue; }
  const item = perEntry.get(seg.e) || { mins: 0, what, tag: tagKey(seg.tag), tagName: seg.tag, bucket: bucketForTag(seg.tag, config) };
  item.mins += seg.mins;
  perEntry.set(seg.e, item);
}
const items = [...perEntry.values()];

// 同一标签内按规则分组（不同标签下同名事项不合并）。
function measure(list, keyFn) {
  const groups = new Map();
  for (const it of list) {
    const k = `${it.tag}\u0000${keyFn(it.what)}`;
    const g = groups.get(k) || { n: 0, mins: 0 };
    g.n += 1; g.mins += it.mins;
    groups.set(k, g);
  }
  const total = list.reduce((s, it) => s + it.mins, 0);
  const sorted = [...groups.values()].sort((a, b) => b.mins - a.mins);
  const share = gs => total ? gs.reduce((s, g) => s + g.mins, 0) / total : 0;
  return {
    groups: groups.size,
    singles: sorted.filter(g => g.n === 1).length,
    rep2: share(sorted.filter(g => g.n >= 2)),
    rep3: share(sorted.filter(g => g.n >= 3)),
    top1: share(sorted.slice(0, 1)),
    top5: share(sorted.slice(0, 5))
  };
}

const pct = x => `${(x * 100).toFixed(0)}%`;
const hrs = m => `${(m / 60).toFixed(1)}h`;
const BUCKET = { job: '主线', maintain: '维持', leak: '偏航', unrecorded: '未记录' };
const ORDER = ['job', 'maintain', 'leak', 'unrecorded'];
const width = s => [...s].reduce((w, ch) => w + (/[　-鿿＀-￯]/.test(ch) ? 2 : 1), 0);
function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map(r => width(r[i]))));
  rows.forEach(r => console.log(r.map((c, i) => c + ' '.repeat(widths[i] - width(c))).join('  ').trimEnd()));
}

console.log(`范围 ${since} → ${until || '现在'}；真实记录 ${real.length} 条；有正文的已发生时长 ${hrs(items.reduce((s, it) => s + it.mins, 0))}`);
if (emptyTextMins) console.log(`（正文为空、已归入标签的时长 ${hrs(emptyTextMins)}，不参与事项统计）`);
console.log('重复占时＝同一组出现 ≥2（或 ≥3）次的记录占该范围时长；组只在同一标签内合并。');

// ── 一、按桶比较各归并规则 ──
console.log('\n一、按桶比较归并规则');
const bucketRows = [['桶', '记录', '时长', '字数中位', '字数P90', '规则', '分组', '≥2次占时', '≥3次占时']];
for (const bucket of ORDER) {
  const list = items.filter(it => it.bucket === bucket);
  if (!list.length) continue;
  const lens = list.map(it => [...it.what.trim()].length).sort((a, b) => a - b);
  RULES.forEach(([name, fn], i) => {
    const m = measure(list, fn);
    bucketRows.push(i === 0
      ? [BUCKET[bucket], String(list.length), hrs(list.reduce((s, it) => s + it.mins, 0)), String(lens[lens.length >> 1]), String(lens[Math.floor(lens.length * 0.9)]), name, String(m.groups), pct(m.rep2), pct(m.rep3)]
      : ['', '', '', '', '', name, String(m.groups), pct(m.rep2), pct(m.rep3)]);
  });
}
table(bucketRows);

// ── 二、按标签（规则 A 全文 / B 冒号前）──
console.log('\n二、按标签（A＝全文相同，B＝第一个冒号前相同；冒号＝写成「事项：细节」的记录占比）');
const byTag = new Map();
items.forEach(it => { if (!byTag.has(it.tag)) byTag.set(it.tag, []); byTag.get(it.tag).push(it); });
const tagList = [...byTag.entries()]
  .map(([tag, list]) => ({ tag, name: list[0].tagName, bucket: list[0].bucket, list, mins: list.reduce((s, it) => s + it.mins, 0) }))
  .sort((a, b) => (ORDER.indexOf(a.bucket) - ORDER.indexOf(b.bucket)) || (b.mins - a.mins));
const showTags = args.includes('--show-tags');
const seq = {};
const tagRows = [['标签', '桶', '时长', '记录', 'A分组', 'A单次', 'A≥2次占时', 'A-Top1', 'A-Top5', 'B分组', 'B≥2次占时', '冒号']];
for (const t of tagList) {
  seq[t.bucket] = (seq[t.bucket] || 0) + 1;
  const a = measure(t.list, RULES[0][1]);
  const b = measure(t.list, RULES[1][1]);
  const colon = t.list.filter(it => /^[^:：]+[:：]/.test(it.what.trim())).length / t.list.length;
  tagRows.push([showTags ? t.name : `${BUCKET[t.bucket]}-T${seq[t.bucket]}`, BUCKET[t.bucket], hrs(t.mins), String(t.list.length),
    String(a.groups), String(a.singles), pct(a.rep2), pct(a.top1), pct(a.top5), String(b.groups), pct(b.rep2), pct(colon)]);
}
table(tagRows);

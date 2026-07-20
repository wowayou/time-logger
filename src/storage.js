// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
import { normalizeTimestamp, parseDateKey } from './time.js';

const KEY = 'timelog.v1';
export const CONFIG_KEY = 'timelog.config';
export const THEME_KEY = 'timelog.theme';
export const VIEW_KEY = 'timelog.view';
export const SELECTED_DATE_KEY = 'timelog.selectedDate';
export const OPEN_DATE_KEY = 'timelog.openDate';
export const RECORD_MODE_KEY = 'timelog.recordMode';
const FIRST_USED_DATE_KEY = 'timelog.firstUsedDate';
// v69（D11 追加）：第三桶显示名 漏损→偏航。**内部键 `leak` 不变**——所有存量
// config、备份 JSON 和 CSS 令牌（--leak/.chip-leak）都按键走，改键会要求数据迁移
// 且让旧备份读不回来。语义也随之调整：偏航＝偏离当前主线的时间，不是道德意义上
// 的浪费（维护者原话：适时地放空是必要的）。
export const BUCKETS = {
  job: '主线',
  maintain: '维持',
  leak: '偏航',
  unrecorded: '未记录'
};
export const BUCKET_ORDER = ['job', 'maintain', 'leak', 'unrecorded'];
const LEGACY_ALIASES = {
  '研究·学工具·逃避': { bucket: 'leak', longOk: false },
  '小說': { bucket: 'leak', longOk: false },
  '睡覺': { bucket: 'maintain', longOk: true },
  '標準活動塊': { bucket: 'maintain', longOk: false },
  '杂': { bucket: 'maintain', longOk: false },
  '網絡問題': { bucket: 'maintain', longOk: false },
  '網絡': { bucket: 'maintain', longOk: false },
  '求职推进': { bucket: 'job', longOk: false },
  '未知': { bucket: 'unrecorded', longOk: false }
};
// 阶段格言（v69，C13）三态：config 键缺失＝未设置（跟随默认）；空串＝显式隐藏；
// 非空＝自定义。恰等于默认文案时归一化回「未设置」，让没改过主意的用户在未来
// 默认文案更新时继续跟随，而不是被钉在旧句子上。
export const DEFAULT_MOTTO = '记录是手段，推进主线才是目的。';
const MOTTO_MAX_LEN = 60;

function normalizeMotto(raw) {
  if (typeof raw !== 'string') return undefined;
  // 末尾再 trim 一次：截断点恰好落在空格上时（第 60 个字符是空格）会留下尾空格，
  // 渲染成「…… 」。v70 修。
  const clean = raw.replace(/\s+/g, ' ').trim().slice(0, MOTTO_MAX_LEN).trim();
  return clean === DEFAULT_MOTTO ? undefined : clean;
}

// 展示层唯一入口：返回要显示的文案，'' 表示隐藏。
export function resolveMotto(config = loadConfig()) {
  return config.motto === undefined ? DEFAULT_MOTTO : config.motto;
}

const DEFAULT_CONFIG = {
  version: 1,
  mainline: ['求职推进'],
  chips: [
    { name: '睡觉', bucket: 'maintain', longOk: true },
    { name: '吃饭', bucket: 'maintain', longOk: false },
    { name: '洗漱', bucket: 'maintain', longOk: false },
    { name: '通勤', bucket: 'maintain', longOk: false },
    { name: '家务', bucket: 'maintain', longOk: false },
    { name: '运动健康', bucket: 'maintain', longOk: false },
    { name: '娱乐', bucket: 'leak', longOk: false },
    { name: '刷手机', bucket: 'leak', longOk: false },
    { name: '发呆', bucket: 'leak', longOk: false }
  ]
};

function cleanName(name) {
  return String(name || '').trim();
}

function uniqueNames(names) {
  const seen = new Set();
  const out = [];
  names.forEach(name => {
    const clean = cleanName(name);
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    out.push(clean);
  });
  return out;
}

function normalizeChip(chip) {
  const name = cleanName(chip && chip.name);
  const bucket = chip && BUCKETS[chip.bucket] && chip.bucket !== 'job' ? chip.bucket : '';
  if (!name || !bucket) return null;
  return { name, bucket, longOk: Boolean(chip.longOk) };
}

export function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      version: 1,
      mainline: DEFAULT_CONFIG.mainline.slice(),
      chips: DEFAULT_CONFIG.chips.map(chip => ({ ...chip })),
      motto: undefined
    };
  }
  const mainlineSource = Array.isArray(raw.mainline) ? raw.mainline : DEFAULT_CONFIG.mainline;
  const chipsSource = Array.isArray(raw.chips) ? raw.chips : DEFAULT_CONFIG.chips;
  const mainline = uniqueNames(mainlineSource);
  const chips = [];
  const seen = new Set(mainline);
  chipsSource.forEach(chip => {
    const clean = normalizeChip(chip);
    if (!clean || seen.has(clean.name)) return;
    seen.add(clean.name);
    chips.push(clean);
  });
  // motto: undefined 会被 JSON.stringify 丢掉——「未设置」在 localStorage 里
  // 就是没有这个键，与三态模型一致。
  return { version: 1, mainline, chips, motto: normalizeMotto(raw.motto) };
}

export function loadConfig() {
  try {
    return normalizeConfig(JSON.parse(localStorage.getItem(CONFIG_KEY)));
  } catch {
    return normalizeConfig(null);
  }
}

export function saveConfig(config) {
  const normalized = normalizeConfig(config);
  localStorage.setItem(CONFIG_KEY, JSON.stringify(normalized));
  return normalized;
}

function addMainlineTag(tag) {
  const name = cleanName(tag);
  if (!name || name === '未知') return loadConfig();
  const config = loadConfig();
  if (!config.mainline.includes(name) && !config.chips.some(chip => chip.name === name)) {
    config.mainline.unshift(name);
    saveConfig(config);
  }
  return config;
}

function addChipTag(tag, bucket) {
  const name = cleanName(tag);
  if (!name || name === '未知' || bucket === 'job' || bucket === 'unrecorded') return loadConfig();
  const config = loadConfig();
  const existing = config.chips.find(chip => chip.name === name);
  if (existing) {
    // Recording an existing chip never re-buckets it: the chip's current bucket
    // wins (「同名按 chip 归类」). Silently moving it here retroactively reclassified
    // all history (v30 fix). Re-bucketing is an explicit config-page action only.
    return config;
  }
  if (config.mainline.includes(name)) return config;
  config.chips.push({ name, bucket, longOk: false });
  saveConfig(config);
  return config;
}

function rememberTagForBucket(tag, bucket) {
  if (bucket === 'job') return addMainlineTag(tag);
  if (bucket === 'maintain' || bucket === 'leak') return addChipTag(tag, bucket);
  return loadConfig();
}

export function rememberCustomTagForBucket(tag, bucket) {
  return rememberTagForBucket(tag, bucket);
}

export function countEntriesWithTag(entries, name) {
  const target = cleanName(name);
  if (!target) return 0;
  return (entries || []).filter(entry => cleanName((entry.tags || [])[0]) === target).length;
}

export function migrateEntryTags(entries, from, to) {
  const source = cleanName(from);
  const dest = cleanName(to);
  if (!source || !dest || source === dest) return entries;
  (entries || []).forEach(entry => {
    if (cleanName((entry.tags || [])[0]) === source) entry.tags = [dest];
  });
  return entries;
}

export function chipGroups(config = loadConfig()) {
  return {
    maintain: config.chips.filter(chip => chip.bucket === 'maintain'),
    leak: config.chips.filter(chip => chip.bucket === 'leak')
  };
}

export function bucketForTag(tag, config = loadConfig()) {
  const name = cleanName(tag);
  if (!name || name === '未知') return 'unrecorded';
  if (config.mainline.includes(name)) return 'job';
  const chip = config.chips.find(item => item.name === name);
  if (chip) return chip.bucket;
  return (LEGACY_ALIASES[name] && LEGACY_ALIASES[name].bucket) || 'unrecorded';
}

export function longOkForTag(tag, config = loadConfig()) {
  const name = cleanName(tag);
  if (!name) return false;
  const chip = config.chips.find(item => item.name === name);
  if (chip) return Boolean(chip.longOk);
  return Boolean(LEGACY_ALIASES[name] && LEGACY_ALIASES[name].longOk);
}

export function tagKnownForConfirmation(tag, config = loadConfig()) {
  return bucketForTag(tag, config) !== 'unrecorded';
}

export function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || { version: 1, entries: [] };
  } catch {
    return { version: 1, entries: [] };
  }
}

export function ensureFirstUsedDate(todayKey, entries = []) {
  if (!parseDateKey(todayKey)) return todayKey;
  try {
    const stored = localStorage.getItem(FIRST_USED_DATE_KEY);
    if (parseDateKey(stored)) return stored;
  } catch {}

  // 老用户首次升级时用本机现有记录的最早日期初始化；以后只读固定键，导入更早
  // 的历史数据也不会倒拨“使用第 N 天”。未来计划不应把起点推到今天之后。
  const firstDate = (entries || []).reduce((earliest, entry) => {
    const dateKey = typeof entry?.ts === 'string' ? entry.ts.slice(0, 10) : '';
    if (!parseDateKey(dateKey) || dateKey > todayKey) return earliest;
    return dateKey < earliest ? dateKey : earliest;
  }, todayKey);
  try { localStorage.setItem(FIRST_USED_DATE_KEY, firstDate); } catch {}
  return firstDate;
}

export function readFirstUsedDate() {
  try {
    const stored = localStorage.getItem(FIRST_USED_DATE_KEY);
    return parseDateKey(stored) ? stored : '';
  } catch {
    return '';
  }
}

// 完整备份带上起始日，删掉主屏 PWA 重装或换设备后 N 才能接上；否则只能退回
// 按最早记录日期推导。导入只允许把起点往**更早**挪（N 单调不减），并拒绝未来
// 日期——规范要求「不因联网、版本更新或导入更早历史而倒拨」，取较早值即满足。
export function mergeImportedFirstUsedDate(importedValue, todayKey) {
  const local = readFirstUsedDate();
  if (!parseDateKey(importedValue) || !parseDateKey(todayKey)) return local;
  if (importedValue > todayKey) return local;
  const next = !local || importedValue < local ? importedValue : local;
  if (next === local) return local;
  try { localStorage.setItem(FIRST_USED_DATE_KEY, next); } catch {}
  return next;
}

// 启动诊断（v62，P33 取证）：用户在「更多」里显式开启后，每次启动记一条只含
// 计时、布尔与缓存命中数的样本——绝不含记录内容、标签或备份数据。样本是本机
// 诊断值，不进备份；关闭开关即整键删除。
const BOOT_DIAG_KEY = 'timelog.bootDiag.v1';
const BOOT_DIAG_MAX_SAMPLES = 30;

export function readBootDiag() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BOOT_DIAG_KEY));
    if (parsed && typeof parsed === 'object') {
      return {
        enabled: parsed.enabled === true,
        samples: Array.isArray(parsed.samples) ? parsed.samples : []
      };
    }
  } catch {}
  return { enabled: false, samples: [] };
}

export function setBootDiagEnabled(on) {
  try {
    if (on) localStorage.setItem(BOOT_DIAG_KEY, JSON.stringify({ enabled: true, samples: readBootDiag().samples }));
    else localStorage.removeItem(BOOT_DIAG_KEY);
  } catch {}
}

export function appendBootDiagSample(sample) {
  const diag = readBootDiag();
  if (!diag.enabled) return;
  const previous = diag.samples[diag.samples.length - 1];
  // 距上次打开的间隔是「起床/久不开才慢」假说的关键变量，落库时一并算好。
  const gapMin = previous && Number.isFinite(previous.at)
    ? Math.max(0, Math.round((sample.at - previous.at) / 60000))
    : null;
  const samples = [...diag.samples, { ...sample, gapMin }].slice(-BOOT_DIAG_MAX_SAMPLES);
  try { localStorage.setItem(BOOT_DIAG_KEY, JSON.stringify({ enabled: true, samples })); } catch {}
}

export function save(d) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
    return true;
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      console.error('[timelog] 存储已满，本次保存失败。请导出备份后删除旧数据。');
      return false;
    }
    throw e;
  }
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function validateImportData(imported) {
  if (!imported || !Array.isArray(imported.entries)) {
    return { ok: false, msg: '文件格式不对：缺少 entries 数组。' };
  }
  const errors = [];
  imported.entries.forEach((entry, index) => {
    const at = `第 ${index + 1} 条`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${at}不是记录对象`);
      return;
    }
    if (typeof entry.id !== 'string' || !entry.id.trim()) errors.push(`${at}的 id 必须是非空字符串`);
    if (typeof entry.ts !== 'string' || !normalizeTimestamp(entry.ts)) errors.push(`${at}的时间无效`);
    if (typeof entry.what !== 'string') errors.push(`${at}的内容必须是字符串`);
    if (!Array.isArray(entry.tags) || entry.tags.some(tag => typeof tag !== 'string')) {
      errors.push(`${at}的 tags 必须是字符串数组`);
    }
    if ('planned' in entry && typeof entry.planned !== 'boolean') errors.push(`${at}的 planned 必须是布尔值`);
    if ('ongoing' in entry && typeof entry.ongoing !== 'boolean') errors.push(`${at}的 ongoing 必须是布尔值`);
    if ('longConfirm' in entry) {
      const mark = entry.longConfirm;
      if (!mark || typeof mark !== 'object'
        || typeof mark.startTs !== 'string' || !normalizeTimestamp(mark.startTs)
        || typeof mark.endTs !== 'string' || !normalizeTimestamp(mark.endTs)) {
        errors.push(`${at}的 longConfirm 无效`);
      }
    }
  });
  if (imported.config !== undefined && (!imported.config || typeof imported.config !== 'object' || Array.isArray(imported.config))) {
    errors.push('config 必须是对象');
  } else if (imported.config) {
    if (imported.config.mainline !== undefined
      && (!Array.isArray(imported.config.mainline) || imported.config.mainline.some(name => typeof name !== 'string'))) {
      errors.push('config.mainline 必须是字符串数组');
    }
    if (imported.config.chips !== undefined) {
      if (!Array.isArray(imported.config.chips)) errors.push('config.chips 必须是数组');
      else imported.config.chips.forEach((chip, index) => {
        if (!chip || typeof chip !== 'object'
          || typeof chip.name !== 'string'
          || !['maintain', 'leak'].includes(chip.bucket)
          || typeof chip.longOk !== 'boolean') {
          errors.push(`config.chips 第 ${index + 1} 项无效`);
        }
      });
    }
    if (imported.config.motto !== undefined && typeof imported.config.motto !== 'string') {
      errors.push('config.motto 必须是字符串');
    }
  }
  if (imported.meta !== undefined && (!imported.meta || typeof imported.meta !== 'object' || Array.isArray(imported.meta))) {
    errors.push('meta 必须是对象');
  } else if (imported.meta) {
    const offset = imported.meta.sourceTimezoneOffsetMinutes;
    if (offset !== undefined && !Number.isFinite(Number(offset))) errors.push('meta.sourceTimezoneOffsetMinutes 必须是数字');
    if (imported.meta.sourceTimeZone !== undefined && typeof imported.meta.sourceTimeZone !== 'string') errors.push('meta.sourceTimeZone 必须是字符串');
    if (imported.meta.exportedAt !== undefined && typeof imported.meta.exportedAt !== 'string') errors.push('meta.exportedAt 必须是字符串');
  }
  if (imported.firstUsedDate !== undefined
    && (typeof imported.firstUsedDate !== 'string' || !parseDateKey(imported.firstUsedDate))) {
    errors.push('firstUsedDate 必须是 YYYY-MM-DD 本地日期');
  }
  if (errors.length) {
    return {
      ok: false,
      errors,
      msg: `文件格式不对：${errors.slice(0, 4).join('；')}${errors.length > 4 ? `；另有 ${errors.length - 4} 项` : ''}。`
    };
  }
  return { ok: true };
}

function shiftedTimestamp(ts, shiftMinutes) {
  const normalized = normalizeTimestamp(ts);
  if (!normalized || !shiftMinutes) return normalized;
  const d = new Date(normalized);
  d.setMinutes(d.getMinutes() + shiftMinutes);
  return normalizeTimestamp(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`);
}

function shiftedEntry(entry, shiftMinutes) {
  const next = {
    ...entry,
    tags: Array.isArray(entry.tags) ? entry.tags.slice() : [],
    ts: shiftedTimestamp(entry.ts, shiftMinutes)
  };
  if (entry.longConfirm) {
    next.longConfirm = {
      ...entry.longConfirm,
      startTs: shiftedTimestamp(entry.longConfirm.startTs, shiftMinutes),
      endTs: shiftedTimestamp(entry.longConfirm.endTs, shiftMinutes)
    };
  }
  return next;
}

function comparableImportEntry(entry) {
  return JSON.stringify({
    id: entry.id,
    ts: entry.ts,
    what: entry.what,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    planned: entry.planned === true || undefined,
    ongoing: entry.ongoing === true || undefined,
    longConfirm: entry.longConfirm
      ? { startTs: entry.longConfirm.startTs, endTs: entry.longConfirm.endTs }
      : undefined
  });
}

function preflightImportedEntries(current, importedEntries, opts = {}) {
  const shiftMinutes = Number(opts.shiftMinutes || 0);
  const currentEntries = Array.isArray(current && current.entries) ? current.entries : [];
  const byId = new Map();
  const byTime = new Map();
  currentEntries.forEach(entry => {
    byId.set(entry.id, entry);
    if (!byTime.has(entry.ts)) byTime.set(entry.ts, entry);
  });
  const additions = [];
  const conflicts = [];
  let skipped = 0;
  for (const [importIndex, raw] of (importedEntries || []).entries()) {
    const entry = shiftedEntry(raw, shiftMinutes);
    const sameId = byId.get(entry.id);
    if (sameId) {
      if (comparableImportEntry(sameId) === comparableImportEntry(entry)) skipped += 1;
      else conflicts.push({
        key: `conflict-${importIndex}-id`,
        index: importIndex,
        type: 'id',
        id: entry.id,
        ts: entry.ts,
        incoming: shiftedEntry(entry, 0),
        local: shiftedEntry(sameId, 0),
        signature: `${comparableImportEntry(entry)}|${comparableImportEntry(sameId)}`,
        message: `ID ${entry.id} 的内容不同`
      });
      continue;
    }
    const sameTime = byTime.get(entry.ts);
    if (sameTime) {
      conflicts.push({
        key: `conflict-${importIndex}-time`,
        index: importIndex,
        type: 'time',
        id: entry.id,
        ts: entry.ts,
        incoming: shiftedEntry(entry, 0),
        local: shiftedEntry(sameTime, 0),
        signature: `${comparableImportEntry(entry)}|${comparableImportEntry(sameTime)}`,
        message: `${entry.ts.replace('T', ' ')} 的导入记录 ${entry.id} 与本机记录 ${sameTime.id} 冲突`
      });
      continue;
    }
    byId.set(entry.id, entry);
    byTime.set(entry.ts, entry);
    additions.push(entry);
  }
  if (conflicts.length) {
    return { ok: false, imported: 0, skipped, conflicts, resultEntries: currentEntries.map(entry => shiftedEntry(entry, 0)) };
  }
  const resultEntries = [...currentEntries.map(entry => shiftedEntry(entry, 0)), ...additions]
    .sort((a, b) => a.ts === b.ts
      ? String(a.id).localeCompare(String(b.id))
      : (a.ts < b.ts ? -1 : 1));
  return { ok: true, imported: additions.length, skipped, conflicts: [], resultEntries };
}

function mergedImportText(localWhat, incomingWhat) {
  const local = String(localWhat || '').trim();
  const incoming = String(incomingWhat || '').trim();
  if (!local) return incoming;
  if (!incoming || incoming === local) return local;
  return `${local}\n\n${incoming}`;
}

function applyImportedResolutions(current, importedEntries, opts, basePlan) {
  const shiftMinutes = Number(opts.shiftMinutes || 0);
  const resolutions = opts.resolutions || {};
  const working = (current.entries || []).map(entry => shiftedEntry(entry, 0));
  const byId = new Map(working.map(entry => [entry.id, entry]));
  const byTime = new Map(working.map(entry => [entry.ts, entry]));
  const conflictsByIndex = new Map(basePlan.conflicts.map(conflict => [conflict.index, conflict]));
  let imported = 0;
  let skipped = 0;

  const removeEntry = entry => {
    if (!entry) return;
    const index = working.findIndex(item => item.id === entry.id);
    if (index >= 0) working.splice(index, 1);
    byId.delete(entry.id);
    if (byTime.get(entry.ts)?.id === entry.id) byTime.delete(entry.ts);
  };
  const addEntry = entry => {
    const sameId = byId.get(entry.id);
    const sameTime = byTime.get(entry.ts);
    if (sameId || sameTime) return false;
    const clean = shiftedEntry(entry, 0);
    working.push(clean);
    byId.set(clean.id, clean);
    byTime.set(clean.ts, clean);
    return true;
  };

  for (const [importIndex, raw] of (importedEntries || []).entries()) {
    const incoming = shiftedEntry(raw, shiftMinutes);
    const conflict = conflictsByIndex.get(importIndex);
    if (conflict) {
      const resolution = resolutions[conflict.key];
      if (!resolution || resolution.signature !== conflict.signature) {
        return { ...basePlan, stale: Boolean(resolution), resolutionError: resolution ? '本机数据或平移结果已变化，请重新选择冲突处理方式。' : '' };
      }
      if (resolution.action === 'local') {
        skipped += 1;
        continue;
      }
      removeEntry(conflict.local);
      const candidate = resolution.action === 'merge'
        ? { ...conflict.local, what: mergedImportText(conflict.local.what, conflict.incoming.what) }
        : incoming;
      if (!addEntry(candidate)) {
        return { ...basePlan, resolutionError: '所选结果又产生了同 ID 或同时刻冲突，请改选“保留本机”或调整平移小时数。' };
      }
      imported += 1;
      continue;
    }

    const sameId = byId.get(incoming.id);
    if (sameId && comparableImportEntry(sameId) === comparableImportEntry(incoming)) {
      skipped += 1;
      continue;
    }
    if (!addEntry(incoming)) {
      return { ...basePlan, resolutionError: '导入结果在重新计算时出现新的同 ID 或同时刻冲突。' };
    }
    imported += 1;
  }

  const resultEntries = working.sort((a, b) => a.ts === b.ts
    ? String(a.id).localeCompare(String(b.id))
    : (a.ts < b.ts ? -1 : 1));
  return {
    ok: true,
    imported,
    skipped,
    conflicts: basePlan.conflicts,
    resolvedConflicts: basePlan.conflicts.length,
    resultEntries,
    data: { ...current, entries: resultEntries }
  };
}

export function mergeImportedEntries(current, importedEntries, opts = {}) {
  const plan = preflightImportedEntries(current, importedEntries, opts);
  if (!plan.ok) {
    if (opts.resolutions) return applyImportedResolutions(current, importedEntries, opts, plan);
    return plan;
  }
  return {
    ...plan,
    data: { ...current, entries: plan.resultEntries }
  };
}

export function mergeImportedConfig(localConfig, importedConfig) {
  const local = normalizeConfig(localConfig);
  if (!importedConfig || typeof importedConfig !== 'object') return local;
  const imported = normalizeConfig(importedConfig);
  const occupied = new Set([...local.mainline, ...local.chips.map(chip => chip.name)]);
  const mainline = local.mainline.slice();
  const chips = local.chips.map(chip => ({ ...chip }));
  imported.mainline.forEach(name => {
    if (occupied.has(name)) return;
    occupied.add(name);
    mainline.push(name);
  });
  imported.chips.forEach(chip => {
    if (occupied.has(chip.name)) return;
    occupied.add(chip.name);
    chips.push({ ...chip });
  });
  // 格言合并与标签同一精神——本机优先：本机的显式值（含显式隐藏 ''）保留，
  // 只有本机从未设置过时才采用备份里的值。
  const motto = local.motto !== undefined ? local.motto : imported.motto;
  return normalizeConfig({ version: 1, mainline, chips, motto });
}

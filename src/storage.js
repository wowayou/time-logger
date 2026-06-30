import { normalizeTimestamp } from './time.js';

export const KEY = 'timelog.v1';
export const CONFIG_KEY = 'timelog.config';
export const THEME_KEY = 'timelog.theme';
export const VIEW_KEY = 'timelog.view';
export const SELECTED_DATE_KEY = 'timelog.selectedDate';
export const OPEN_DATE_KEY = 'timelog.openDate';
export const RECORD_MODE_KEY = 'timelog.recordMode';
export const BUCKETS = {
  job: '主线',
  maintain: '维持',
  leak: '漏损',
  unrecorded: '未记录'
};
export const BUCKET_ORDER = ['job', 'maintain', 'leak', 'unrecorded'];
export const LEGACY_ALIASES = {
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
export const DEFAULT_CONFIG = {
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
  const mainline = uniqueNames([...(raw && raw.mainline || []), ...DEFAULT_CONFIG.mainline]);
  const chips = [];
  const seen = new Set();
  [...(raw && raw.chips || []), ...DEFAULT_CONFIG.chips].forEach(chip => {
    const clean = normalizeChip(chip);
    if (!clean || seen.has(clean.name)) return;
    seen.add(clean.name);
    chips.push(clean);
  });
  return { version: 1, mainline, chips };
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

export function addMainlineTag(tag) {
  const name = cleanName(tag);
  if (!name || name === '未知') return loadConfig();
  const config = loadConfig();
  if (!config.mainline.includes(name) && !config.chips.some(chip => chip.name === name)) {
    config.mainline.unshift(name);
    saveConfig(config);
  }
  return config;
}

export function addChipTag(tag, bucket) {
  const name = cleanName(tag);
  if (!name || name === '未知' || bucket === 'job' || bucket === 'unrecorded') return loadConfig();
  const config = loadConfig();
  const existing = config.chips.find(chip => chip.name === name);
  if (existing) {
    if (existing.bucket !== bucket) {
      existing.bucket = bucket;
      saveConfig(config);
    }
    return config;
  }
  if (config.mainline.includes(name)) return config;
  config.chips.push({ name, bucket, longOk: false });
  saveConfig(config);
  return config;
}

export function rememberTagForBucket(tag, bucket) {
  if (bucket === 'job') return addMainlineTag(tag);
  if (bucket === 'maintain' || bucket === 'leak') return addChipTag(tag, bucket);
  return loadConfig();
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

export function removeMainlineName(config, name) {
  const target = cleanName(name);
  if (!target) return config;
  config.mainline = config.mainline.filter(item => item !== target);
  return config;
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
  const chip = config.chips.find(item => item.name === name);
  if (chip) return chip.bucket;
  if (config.mainline.includes(name)) return 'job';
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

export function save(d) {
  localStorage.setItem(KEY, JSON.stringify(d));
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function validateImportData(imported) {
  if (!imported || !Array.isArray(imported.entries)) {
    return { ok: false, msg: '文件格式不对：缺少 entries 数组。' };
  }
  const valid = imported.entries.every(en => en.id && en.ts && typeof en.what === 'string' && normalizeTimestamp(en.ts));
  if (!valid) {
    return { ok: false, msg: '文件格式不对：部分条目缺少必要字段（id/ts/what 字段）或时间格式不正确。' };
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
  if (!shiftMinutes) return entry;
  const next = { ...entry, ts: shiftedTimestamp(entry.ts, shiftMinutes) };
  if (entry.longConfirm) {
    next.longConfirm = {
      ...entry.longConfirm,
      startTs: shiftedTimestamp(entry.longConfirm.startTs, shiftMinutes),
      endTs: shiftedTimestamp(entry.longConfirm.endTs, shiftMinutes)
    };
  }
  return next;
}

export function mergeImportedEntries(current, importedEntries, opts = {}) {
  const shiftMinutes = Number(opts.shiftMinutes || 0);
  const map = {};
  current.entries.forEach(en => { map[en.id] = en; });
  importedEntries.forEach(en => { map[en.id] = shiftedEntry(en, shiftMinutes); });
  current.entries = Object.values(map).sort((a, b) => a.ts < b.ts ? -1 : 1);
  return current;
}

// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
import { normalizeTimestamp, parseDateKey } from './time.js';
import { getLocale, t, tAll } from './i18n.js';

const KEY = 'timelog.v1';
export const CONFIG_KEY = 'timelog.config';
export const THEME_KEY = 'timelog.theme';
export const VIEW_KEY = 'timelog.view';
export const SELECTED_DATE_KEY = 'timelog.selectedDate';
export const OPEN_DATE_KEY = 'timelog.openDate';
export const RECORD_MODE_KEY = 'timelog.recordMode';
// SPEC-013：语言偏好。'' / 键缺失＝跟随系统。是**设备偏好不是用户数据**——
// 不进备份、导入不得改语言（与 timelog.theme 同类）。
export const LOCALE_KEY = 'timelog.locale';

/** @returns {string} 存储的语言偏好（'' ＝ 跟随系统） */
export function loadLocalePref() {
  try {
    return localStorage.getItem(LOCALE_KEY) || '';
  } catch {
    return '';
  }
}

/** @param {string} code 空串＝跟随系统 */
export function saveLocalePref(code) {
  try {
    if (code) localStorage.setItem(LOCALE_KEY, code);
    else localStorage.removeItem(LOCALE_KEY);
  } catch {
    /* 存不下不影响本次会话内的语言 */
  }
}

// SPEC-014 修复（维护者拍板方案 A，2026-08-01）：v78 之前 SUPPORTED_LOCALES 只有
// 'zh'，resolveLocale() 里按 navigator.languages 探测英文的分支从未真正生效过；
// 'en' 成为受支持语言后，任何**从未显式选过语言**（＝全部存量用户，这个开关
// 今天才出现）且**浏览器偏好英文**的设备，升级到 v78 后会被静默切成英文界面——
// 这不是他们的选择。一次性把这类用户钉在中文（持久化写入，而不是每次都在
// 内存里探测）；全新安装（timelog.v1 与 timelog.config 都不存在）不受影响，
// 继续走 navigator 探测，首次打开英文浏览器的新用户仍是英文。
const LOCALE_MIGRATED_KEY = 'timelog.localeMigrated.v1';

/**
 * 用独立的一次性标记键，而不是靠 `timelog.locale` 是否为空判断「是否已处理
 * 过」：用户后续可能显式选择「跟随系统」（语言开关三态之一），那个动作同样会
 * 清空 `timelog.locale`——如果复用同一个键当「已处理」标记，会把用户明确的
 * 「跟随系统」选择误判成「从未处理」，下次启动又被强行按回中文。
 *
 * 形态参照 `ensureFirstUsedDate`（老用户以最早本机记录日期迁移）：一次性、只
 * 读判定用的现有键，不改 `timelog.v1` 的任何内容；语言仍不进备份（SPEC-013
 * 已定）。**必须在 app.js 的 `init()` 里 `resolveLocale()` 之前调用**。
 */
export function ensureLegacyLocalePinned() {
  try {
    if (localStorage.getItem(LOCALE_MIGRATED_KEY)) return;
    localStorage.setItem(LOCALE_MIGRATED_KEY, '1');
    if (localStorage.getItem(LOCALE_KEY)) return;
    const hasData = Boolean(localStorage.getItem(KEY) || localStorage.getItem(CONFIG_KEY));
    if (hasData) localStorage.setItem(LOCALE_KEY, 'zh');
  } catch {
    /* 存不下就照常走 navigator 探测，不阻塞启动 */
  }
}
const FIRST_USED_DATE_KEY = 'timelog.firstUsedDate';
// v69（D11 追加）：第三桶显示名 漏损→偏航。**内部键 `leak` 不变**——所有存量
// config、备份 JSON 和 CSS 令牌（--leak/.chip-leak）都按键走，改键会要求数据迁移
// 且让旧备份读不回来。语义也随之调整：偏航＝偏离当前主线的时间，不是道德意义上
// 的浪费（维护者原话：适时地放空是必要的）。
// SPEC-013：保持**对象**形态而不是改成函数——测试直接 `import { BUCKETS }` 后读
// `BUCKETS.leak`，改形态会要求改既有断言（规格禁止）。值由 refreshBucketLabels()
// 按当前 locale 就地刷新（const 绑定不可变，内容可变）。
export const BUCKETS = { job: '', maintain: '', leak: '', unrecorded: '' };
export const BUCKET_ORDER = ['job', 'maintain', 'leak', 'unrecorded'];

/** 按当前 locale 刷新桶显示名。app.js 在 setLocale 之后调用。 */
export function refreshBucketLabels() {
  BUCKET_ORDER.forEach(key => { BUCKETS[key] = t('bucket.' + key); });
  return BUCKETS;
}
refreshBucketLabels();
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
// SPEC-013：保留标签 id。这是**数据**不是文案——它是 `timelog.config` 的键、
// 随完整备份导出、并按名字参与导入合并。翻译它＝改数据（旧备份读不回、
// 桶归类查不中），与 `leak` 桶键不改名同一条判据。显示名走 i18n 的
// `tag.unknown`，运行时其它文件一律 import 本常量、不再写字面量。
export const RESERVED_UNKNOWN_TAG = '未知';
// 阶段格言（v69，C13）三态：config 键缺失＝未设置（跟随默认）；空串＝显式隐藏；
// 非空＝自定义。恰等于默认文案时归一化回「未设置」，让没改过主意的用户在未来
// 默认文案更新时继续跟随，而不是被钉在旧句子上。
export function defaultMotto() {
  return t('motto.default');
}
const MOTTO_MAX_LEN = 60;

function normalizeMotto(raw) {
  if (typeof raw !== 'string') return undefined;
  // 末尾再 trim 一次：截断点恰好落在空格上时（第 60 个字符是空格）会留下尾空格，
  // 渲染成「…… 」。v70 修。
  const clean = raw.replace(/\s+/g, ' ').trim().slice(0, MOTTO_MAX_LEN).trim();
  // 对**所有** locale 的默认句都归一化回「未设置」：否则切一次语言，原本
  // 「跟随默认」的用户会被钉成「自定义」。
  return tAll('motto.default').includes(clean) ? undefined : clean;
}

// 展示层唯一入口：返回要显示的文案，'' 表示隐藏。
export function resolveMotto(config = loadConfig()) {
  return config.motto === undefined ? defaultMotto() : config.motto;
}

// SPEC-014 §1.5（维护者拍板方案 B，2026-07-31）：默认标签种子按当前 locale 分流，
// 但**只在首次初始化**生效——见下面 normalizeConfig 的 `!raw` 分支，那是唯一
// 读这张表的地方。已有 config 的用户切换语言**不会**触发重新种子：这里只
// `getLocale()` 读一次当前语言，不写 locale、不订阅语言变化、也不在
// mainlineSource/chipsSource 的「已有 raw 但字段缺失」兜底分支之外被使用。
// 英文种子与中文种子一一对应（睡觉→Sleep、吃饭→Meals……），`longOk` 逐项一致。
const DEFAULT_SEED_BY_LOCALE = {
  zh: {
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
  },
  en: {
    mainline: ['Job search'],
    chips: [
      { name: 'Sleep', bucket: 'maintain', longOk: true },
      { name: 'Meals', bucket: 'maintain', longOk: false },
      { name: 'Wash up', bucket: 'maintain', longOk: false },
      { name: 'Commute', bucket: 'maintain', longOk: false },
      { name: 'Chores', bucket: 'maintain', longOk: false },
      { name: 'Exercise', bucket: 'maintain', longOk: false },
      { name: 'Entertainment', bucket: 'leak', longOk: false },
      { name: 'Phone', bucket: 'leak', longOk: false },
      { name: 'Zoning out', bucket: 'leak', longOk: false }
    ]
  }
};

function defaultSeed() {
  return DEFAULT_SEED_BY_LOCALE[getLocale()] || DEFAULT_SEED_BY_LOCALE.zh;
}

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
  const bucket = chip && BUCKET_ORDER.includes(chip.bucket) && chip.bucket !== 'job' ? chip.bucket : '';
  if (!name || !bucket) return null;
  return { name, bucket, longOk: Boolean(chip.longOk) };
}

/**
 * 标签配置的形状。`mainlineLongOk` 与 `motto` 都是**可选键**——空集/未设置时
 * 根本不写进 localStorage（见 normalizeConfig 里的说明），所以类型上必须是
 * optional 而不是必填。不显式声明的话，tsc 会把 normalizeConfig 的两个 return
 * 分支推成一个联合类型，其中早退分支不含该键，任何 `config.mainlineLongOk`
 * 的读取都会报 TS2339。
 * @typedef {object} TagConfig
 * @property {number} version
 * @property {string[]} mainline
 * @property {string[]} [mainlineLongOk]
 * @property {{ name: string, bucket: string, longOk: boolean }[]} chips
 * @property {string} [motto]
 */

/**
 * @param {any} raw
 * @returns {TagConfig}
 */
export function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    const seed = defaultSeed();
    return {
      version: 1,
      mainline: seed.mainline.slice(),
      chips: seed.chips.map(chip => ({ ...chip })),
      motto: undefined
    };
  }
  const seed = defaultSeed();
  const mainlineSource = Array.isArray(raw.mainline) ? raw.mainline : seed.mainline;
  const chipsSource = Array.isArray(raw.chips) ? raw.chips : seed.chips;
  const mainline = uniqueNames(mainlineSource);
  const chips = [];
  const seen = new Set(mainline);
  chipsSource.forEach(chip => {
    const clean = normalizeChip(chip);
    if (!clean || seen.has(clean.name)) return;
    seen.add(clean.name);
    chips.push(clean);
  });
  // SPEC-007：主线的 longOk 存成**独立名字数组**而不是把 mainline 改成对象数组。
  // 理由是爆炸半径：`mainline` 是 string[] 这件事被 addMainlineTag / bucketForTag /
  // mergeImportedConfig / uniqueNames 等多处按值使用，改形态要动一大片并强制迁移
  // 存量 config；追加一个字段则「老备份没有它＝空集」天然成立，零迁移。
  // 只保留仍在 mainline 里的名字——改名/移除后残留的条目会在这里被自然清掉。
  const mainlineSet = new Set(mainline);
  const mainlineLongOk = uniqueNames(Array.isArray(raw.mainlineLongOk) ? raw.mainlineLongOk : [])
    .filter(name => mainlineSet.has(name));
  // motto: undefined 会被 JSON.stringify 丢掉——「未设置」在 localStorage 里
  // 就是没有这个键，与三态模型一致。
  // 与 motto 的 undefined 同一处理：空集就**不写这个键**。否则每个从未用过主线
  // longOk 的用户，config 与完整备份里都会凭空多出一个 `"mainlineLongOk": []`，
  // 白白改变所有人的存量数据形态。读侧一律用 `config.mainlineLongOk || []`。
  return {
    version: 1,
    mainline,
    ...(mainlineLongOk.length ? { mainlineLongOk } : {}),
    chips,
    motto: normalizeMotto(raw.motto)
  };
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
  if (!name || name === RESERVED_UNKNOWN_TAG) return loadConfig();
  const config = loadConfig();
  if (!config.mainline.includes(name) && !config.chips.some(chip => chip.name === name)) {
    config.mainline.unshift(name);
    saveConfig(config);
  }
  return config;
}

function addChipTag(tag, bucket) {
  const name = cleanName(tag);
  if (!name || name === RESERVED_UNKNOWN_TAG || bucket === 'job' || bucket === 'unrecorded') return loadConfig();
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

/**
 * 主线改名：替换 `mainline` 里的名字并带走它的 longOk 归属。
 * **只返回新 config，不碰 entries**——历史迁移由调用方在同一次 load() 的对象图上
 * 用 migrateEntryTags 完成（CLAUDE.md 写路径红线：禁止改一张图、保存另一张图）。
 * @param {object} config
 * @param {string} from
 * @param {string} to
 * @returns {object} 新 config（未落库）
 */
export function renameMainlineTag(config, from, to) {
  const source = cleanName(from);
  const dest = cleanName(to);
  const next = normalizeConfig(config);
  if (!source || !dest || source === dest || !next.mainline.includes(source)) return next;
  next.mainline = next.mainline.map(name => (name === source ? dest : name));
  next.mainlineLongOk = (next.mainlineLongOk || []).map(name => (name === source ? dest : name));
  return normalizeConfig(next);
}

/**
 * 把某个主线历史名移到 `mainline[0]`。`mainline` 本就是 unshift 语义的历史数组
 * （录入时 addMainlineTag 就是 unshift），本函数只是把这个既有语义放上台面。
 * 不产生任何记录变化。
 * @param {object} config
 * @param {string} name
 * @returns {object} 新 config（未落库）
 */
export function setCurrentMainline(config, name) {
  const target = cleanName(name);
  const next = normalizeConfig(config);
  if (!target || !next.mainline.includes(target)) return next;
  next.mainline = [target, ...next.mainline.filter(item => item !== target)];
  return normalizeConfig(next);
}

/**
 * 设置某个主线名的超长段免确认。
 * @param {object} config
 * @param {string} name
 * @param {boolean} longOk
 * @returns {object} 新 config（未落库）
 */
export function setMainlineLongOk(config, name, longOk) {
  const target = cleanName(name);
  const next = normalizeConfig(config);
  if (!target || !next.mainline.includes(target)) return next;
  const current = new Set(next.mainlineLongOk || []);
  if (longOk) current.add(target); else current.delete(target);
  next.mainlineLongOk = [...current];
  return normalizeConfig(next);
}

/**
 * D18 新增范围：给存量 config 一个拿到**本语言默认标签**的出口。
 * SPEC-014 §1.5 定的「只在首次初始化种子、切语言不动数据」不变——这是**显式动作**，
 * 且只追加：不删除、不改名、不覆盖同名（同名一律跳过，绝不静默改桶）。
 * @param {object} [config]
 * @returns {{ additions: {name: string, bucket: string, longOk: boolean}[], skipped: string[] }}
 *   additions＝将要新增的；skipped＝因同名已存在而跳过的。调用方先预览再落库。
 */
export function previewLocaleDefaultTags(config = loadConfig()) {
  const current = normalizeConfig(config);
  const occupied = new Set([...current.mainline, ...current.chips.map(chip => chip.name)]);
  const seed = defaultSeed();
  const additions = [];
  const skipped = [];
  seed.chips.forEach(chip => {
    if (occupied.has(chip.name)) skipped.push(chip.name);
    else additions.push({ ...chip });
  });
  return { additions, skipped };
}

/**
 * 把 previewLocaleDefaultTags 的结果落成新 config（仍不落库）。
 * @param {object} [config]
 * @returns {object}
 */
export function appendLocaleDefaultTags(config = loadConfig()) {
  const current = normalizeConfig(config);
  const { additions } = previewLocaleDefaultTags(current);
  if (!additions.length) return current;
  return normalizeConfig({ ...current, chips: [...current.chips, ...additions] });
}

export function chipGroups(config = loadConfig()) {
  return {
    maintain: config.chips.filter(chip => chip.bucket === 'maintain'),
    leak: config.chips.filter(chip => chip.bucket === 'leak')
  };
}

export function bucketForTag(tag, config = loadConfig()) {
  const name = cleanName(tag);
  if (!name || name === RESERVED_UNKNOWN_TAG) return 'unrecorded';
  if (config.mainline.includes(name)) return 'job';
  const chip = config.chips.find(item => item.name === name);
  if (chip) return chip.bucket;
  return (LEGACY_ALIASES[name] && LEGACY_ALIASES[name].bucket) || 'unrecorded';
}

export function longOkForTag(tag, config = loadConfig()) {
  const name = cleanName(tag);
  if (!name) return false;
  // SPEC-007：主线段 >3h 是常态（写代码、面试准备），此前每段都要手动确认是真实
  // 摩擦。主线名的豁免存在 mainlineLongOk 里，与 chip 的 per-tag longOk 并列。
  if ((config.mainlineLongOk || []).includes(name)) return true;
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
      console.error(t('storage.quotaExceeded'));
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
    return { ok: false, msg: t('import.errNoEntries') };
  }
  const errors = [];
  imported.entries.forEach((entry, index) => {
    const at = t('import.itemAt', { n: index + 1 });
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(t('import.errNotObject', { at }));
      return;
    }
    if (typeof entry.id !== 'string' || !entry.id.trim()) errors.push(t('import.errId', { at }));
    if (typeof entry.ts !== 'string' || !normalizeTimestamp(entry.ts)) errors.push(t('import.errTs', { at }));
    if (typeof entry.what !== 'string') errors.push(t('import.errWhat', { at }));
    if (!Array.isArray(entry.tags) || entry.tags.some(tag => typeof tag !== 'string')) {
      errors.push(t('import.errTags', { at }));
    }
    if ('planned' in entry && typeof entry.planned !== 'boolean') errors.push(t('import.errPlanned', { at }));
    if ('ongoing' in entry && typeof entry.ongoing !== 'boolean') errors.push(t('import.errOngoing', { at }));
    if ('longConfirm' in entry) {
      const mark = entry.longConfirm;
      if (!mark || typeof mark !== 'object'
        || typeof mark.startTs !== 'string' || !normalizeTimestamp(mark.startTs)
        || typeof mark.endTs !== 'string' || !normalizeTimestamp(mark.endTs)) {
        errors.push(t('import.errLongConfirm', { at }));
      }
    }
  });
  if (imported.config !== undefined && (!imported.config || typeof imported.config !== 'object' || Array.isArray(imported.config))) {
    errors.push(t('import.errConfigObject'));
  } else if (imported.config) {
    if (imported.config.mainline !== undefined
      && (!Array.isArray(imported.config.mainline) || imported.config.mainline.some(name => typeof name !== 'string'))) {
      errors.push(t('import.errConfigMainline'));
    }
    if (imported.config.chips !== undefined) {
      if (!Array.isArray(imported.config.chips)) errors.push(t('import.errConfigChips'));
      else imported.config.chips.forEach((chip, index) => {
        if (!chip || typeof chip !== 'object'
          || typeof chip.name !== 'string'
          || !['maintain', 'leak'].includes(chip.bucket)
          || typeof chip.longOk !== 'boolean') {
          errors.push(t('import.errConfigChipAt', { n: index + 1 }));
        }
      });
    }
    if (imported.config.mainlineLongOk !== undefined
      && (!Array.isArray(imported.config.mainlineLongOk)
        || imported.config.mainlineLongOk.some(name => typeof name !== 'string'))) {
      errors.push(t('import.errConfigMainlineLongOk'));
    }
    if (imported.config.motto !== undefined && typeof imported.config.motto !== 'string') {
      errors.push(t('import.errConfigMotto'));
    }
  }
  if (imported.meta !== undefined && (!imported.meta || typeof imported.meta !== 'object' || Array.isArray(imported.meta))) {
    errors.push(t('import.errMetaObject'));
  } else if (imported.meta) {
    const offset = imported.meta.sourceTimezoneOffsetMinutes;
    if (offset !== undefined && !Number.isFinite(Number(offset))) errors.push(t('import.errMetaOffset'));
    if (imported.meta.sourceTimeZone !== undefined && typeof imported.meta.sourceTimeZone !== 'string') errors.push(t('import.errMetaTimeZone'));
    if (imported.meta.exportedAt !== undefined && typeof imported.meta.exportedAt !== 'string') errors.push(t('import.errMetaExportedAt'));
  }
  if (imported.firstUsedDate !== undefined
    && (typeof imported.firstUsedDate !== 'string' || !parseDateKey(imported.firstUsedDate))) {
    errors.push(t('import.errFirstUsedDate'));
  }
  if (errors.length) {
    return {
      ok: false,
      errors,
      msg: t('import.errSummary', {
        details: errors.slice(0, 4).join(t('import.errJoin')),
        more: errors.length > 4 ? t('import.errMore', { n: errors.length - 4 }) : ''
      })
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
        message: t('import.conflictSameId', { id: entry.id })
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
        message: t('import.conflictSameTime', { ts: entry.ts.replace('T', ' '), id: entry.id, localId: sameTime.id })
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
        return { ...basePlan, stale: Boolean(resolution), resolutionError: resolution ? t('import.staleResolution') : '' };
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
        return { ...basePlan, resolutionError: t('import.resolutionConflict') };
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
      return { ...basePlan, resolutionError: t('import.recomputeConflict') };
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
  // 主线 longOk 与标签同一精神：并集，但只对最终仍在 mainline 里的名字生效
  // （normalizeConfig 会再过滤一次）。本机已有的条目不会被备份删掉。
  const mainlineLongOk = [...new Set([...(local.mainlineLongOk || []), ...(imported.mainlineLongOk || [])])];
  const motto = local.motto !== undefined ? local.motto : imported.motto;
  return normalizeConfig({ version: 1, mainline, mainlineLongOk, chips, motto });
}

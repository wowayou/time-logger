// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
//
// SPEC-013：取词与 locale 解析。**纯模块**——不访问 DOM、不访问任何存储、
// 不 import 其它业务模块。locale 偏好的持久化归 storage.js（`timelog.locale`），
// 由 app.js 在启动时读出来喂给 setLocale()；这样 storage.js 可以自由 import
// 本模块取校验文案而不形成循环依赖。
import zh from './locales/zh.js';
import en from './locales/en.js';

export const DEFAULT_LOCALE = 'zh';
export const SUPPORTED_LOCALES = ['zh', 'en'];

const CATALOGS = { zh, en };

let current = DEFAULT_LOCALE;

/**
 * 把「存储的偏好 + 浏览器语言」解析成一个受支持的 locale。
 * 纯函数，可单测：存储偏好优先，其次按 navigator 语言前缀匹配，最后回落默认。
 * @param {string} [stored] 用户显式选择（'' / undefined ＝ 跟随系统）
 * @param {readonly string[]} [navLangs] 形如 navigator.languages
 * @returns {string}
 */
export function resolveLocale(stored, navLangs) {
  const pref = String(stored || '').trim();
  if (SUPPORTED_LOCALES.includes(pref)) return pref;
  const list = Array.isArray(navLangs) ? navLangs : [];
  for (const raw of list) {
    const tag = String(raw || '').toLowerCase();
    const hit = SUPPORTED_LOCALES.find((code) => tag === code || tag.startsWith(code + '-'));
    if (hit) return hit;
  }
  return DEFAULT_LOCALE;
}

/** @returns {string} 当前生效的 locale */
export function getLocale() {
  return current;
}

/**
 * 设置当前 locale。不持久化（持久化归 storage.js），不触发渲染（归 app.js）。
 * @param {string} code
 * @returns {string} 实际生效的 locale
 */
export function setLocale(code) {
  current = SUPPORTED_LOCALES.includes(code) ? code : DEFAULT_LOCALE;
  return current;
}

/**
 * 取词。占位符写 `{name}`，用 vars 填。
 * 缺 key 时**不抛异常**——界面不能因为一条缺词白屏；开发期 console.error，
 * 运行时返回 key 本身（肉眼可见但不致命）。
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
export function t(key, vars) {
  const catalog = CATALOGS[current] || CATALOGS[DEFAULT_LOCALE];
  let value = catalog[key];
  if (value === undefined) {
    value = CATALOGS[DEFAULT_LOCALE][key];
    if (value === undefined) {
      if (typeof console !== 'undefined' && console.error) console.error('[i18n] missing key: ' + key);
      return key;
    }
  }
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (whole, name) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
  ));
}

/**
 * 取一个数组型词条（星期名、月名等按下标取用的序列）。
 * @param {string} key
 * @returns {string[]}
 */
export function tList(key) {
  const catalog = CATALOGS[current] || CATALOGS[DEFAULT_LOCALE];
  const value = catalog[key] ?? CATALOGS[DEFAULT_LOCALE][key];
  if (!Array.isArray(value)) {
    if (typeof console !== 'undefined' && console.error) console.error('[i18n] missing list key: ' + key);
    return [];
  }
  return value;
}

/**
 * 取某个 key 在**所有**受支持 locale 下的值。
 * 用途：把「用户输入恰等于默认句」归一化回「未设置」时，必须对所有语言的
 * 默认句都成立——否则切一次语言就会把「跟随默认」的用户变成「自定义」。
 * @param {string} key
 * @returns {string[]}
 */
export function tAll(key) {
  const out = [];
  for (const code of SUPPORTED_LOCALES) {
    const value = CATALOGS[code] && CATALOGS[code][key];
    if (typeof value === 'string' && !out.includes(value)) out.push(value);
  }
  return out;
}

/**
 * SPEC-014 §3：最小两形复数 helper（英文 one/other 两形足够，不为一个用途引入
 * `Intl.PluralRules`）。只用于「已记录 N 天」这类需要按数量换词尾的少数场景——
 * 调用方先把 one/other 两种取词结果都算出来，这里只挑一个。
 * @param {number} n
 * @param {{ one: string, other: string }} forms
 * @returns {string}
 */
export function plural(n, forms) {
  return n === 1 ? forms.one : forms.other;
}

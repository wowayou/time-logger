// SPEC-014: a self-contained boot helper for the English-locale test files.
// Deliberately NOT added to ui_fixture.js — the acceptance bar for this spec
// is "git diff --numstat -- tests/ has zero deletions," and ui_fixture.js's
// existing boot() signature is relied on by 272 zh assertions we must not
// touch even cosmetically. This is a new file, so it only ever adds lines.
//
// It mirrors the parts of ui_fixture.js's boot() that the en-locale specs
// actually need (fixed clock, seeded localStorage, locale preference) without
// reusing its zh-specific fixture-state vocabulary.

export const FIXED_NOW = '2026-06-29T12:34:30';
export const TODAY_KEY = '2026-06-29';
export const YESTERDAY_KEY = '2026-06-28';

/**
 * @param {import('@playwright/test').Page} page
 * @param {object} [opts]
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 * @param {string} [opts.locale] '' = follow system, 'zh' | 'en' = explicit pref
 * @param {string} [opts.now] fixed Date.now() ISO string
 * @param {Array<object>} [opts.entries]
 * @param {object|null} [opts.config]
 * @param {string} [opts.selectedDate] local date key, defaults to today
 * @param {string} [opts.path]
 */
export async function bootLocale(page, opts = {}) {
  const {
    width = 390,
    height = 820,
    locale = 'en',
    now = FIXED_NOW,
    entries = [],
    config = null,
    selectedDate = TODAY_KEY,
    path = '/'
  } = opts;
  await page.setViewportSize({ width, height });
  await page.addInitScript(({ locale, now, entries, config, selectedDate, todayKey }) => {
    if (now) {
      const RealDate = Date;
      let fixedNow = new RealDate(now).getTime();
      class FixedDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [fixedNow]));
        }
        static now() { return fixedNow; }
        static parse(value) { return RealDate.parse(value); }
        static UTC(...args) { return RealDate.UTC(...args); }
      }
      window.Date = FixedDate;
    }
    localStorage.clear();
    if (locale) localStorage.setItem('timelog.locale', locale);
    localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries }));
    if (config) localStorage.setItem('timelog.config', JSON.stringify(config));
    localStorage.setItem('timelog.view', 'day');
    localStorage.setItem('timelog.selectedDate', selectedDate);
    localStorage.setItem('timelog.openDate', todayKey);
  }, { locale, now, entries, config, selectedDate, todayKey: TODAY_KEY });
  await page.goto(path);
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
}

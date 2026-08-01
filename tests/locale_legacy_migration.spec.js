// SPEC-014 fix (maintainer-approved plan A, review round 2): before v78,
// SUPPORTED_LOCALES only had 'zh', so resolveLocale()'s navigator.languages
// branch never actually fired. Now that 'en' is supported, an existing
// device that has never explicitly chosen a language (== every pre-v78
// user, since the switch did not exist) and whose browser prefers English
// would silently flip to an English UI on upgrade. storage.js's
// ensureLegacyLocalePinned() pins such devices to zh on first v78 boot,
// exactly once, without touching timelog.v1's content; a genuinely fresh
// install (no timelog.v1/timelog.config at all) is left alone and still
// follows the browser locale.
//
// This file overrides the browser context's locale to en-US (the global
// playwright.config.js pin is zh-CN, chosen so the existing zh suite keeps
// resolving 'zh' in this sandbox where navigator.languages defaults to
// en-US) specifically to exercise the migration guard against a real
// English-preferring browser.
import { expect, test } from '@playwright/test';
import { bootLocale, TODAY_KEY } from './i18n_fixture.js';

test.use({ locale: 'en-US' });

// The regression case: existing data, no stored locale preference (this
// switch never existed before v78, so no pre-v78 user could have set one),
// English browser — must stay in Chinese.
test('existing data with no stored locale preference stays pinned to Chinese despite an English browser', async ({ page }) => {
  await bootLocale(page, {
    locale: '',
    entries: [{ id: 'today-1', ts: `${TODAY_KEY}T09:00`, what: '写代码', tags: ['求职推进'] }]
  });
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh');
  await expect(page.locator('#view-tabs button').first()).toHaveText('天');
});

// The control case: proves the fix does not also disable navigator
// detection outright. A device with no timelog.v1 and no timelog.config at
// all (never used the app before) must still follow the browser's English
// preference on its very first boot.
test('a brand-new install with no existing data still follows an English browser locale', async ({ page }) => {
  await bootLocale(page, {
    locale: '',
    freshDevice: true
  });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#view-tabs button').first()).toHaveText('Day');
});

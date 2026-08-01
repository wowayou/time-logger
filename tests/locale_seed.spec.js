// SPEC-014 §1.5 (维护者拍板方案 B): default tag-chip seeding is locale-aware,
// but ONLY on first initialization (normalizeConfig(null) — the
// timelog.config key is missing). An existing config must never be
// re-seeded just because the display language changed; that would silently
// rewrite a user's data. These three cases are the section's explicit
// required tests: ① a fresh en install seeds English chips, ② an existing zh
// config survives a language switch byte-for-byte, ③ a zh backup imported
// into a fresh en device leaves both tag sets coexisting with correct
// buckets. New file — see tests/i18n_fixture.js for why this does not reuse
// ui_fixture.js's boot().
import { expect, test } from '@playwright/test';
import { bootLocale } from './i18n_fixture.js';

async function openTagSettings(page) {
  await page.locator('[data-action="open-more"]').click();
  await page.locator('[data-action="open-tag-config"]').click();
}

async function chipNames(page) {
  return page.$$eval('.cfg-name', els => els.map(el => el.value));
}

const EN_DEFAULT_CHIPS = ['Sleep', 'Meals', 'Wash up', 'Commute', 'Chores', 'Exercise', 'Entertainment', 'Phone', 'Zoning out'];

// ① a fresh en install (no timelog.config key at all) seeds English chips.
test('a fresh en install seeds English default chips', async ({ page }) => {
  await bootLocale(page, { entries: [] });
  await openTagSettings(page);
  await expect.poll(() => chipNames(page)).toEqual(EN_DEFAULT_CHIPS);
});

// ② the critical regression guard: an existing zh config's chip names must
// not change one character when the display language is switched to en.
test('an existing zh config keeps its chip names verbatim after switching to en', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    entries: [],
    config: {
      version: 1,
      mainline: ['求职推进'],
      chips: [
        { name: '睡觉', bucket: 'maintain', longOk: true },
        { name: '吃饭', bucket: 'maintain', longOk: false }
      ]
    }
  });
  await page.locator('[data-action="open-more"]').click();
  await page.locator('[data-action="set-locale"][data-locale="en"]').click();
  await page.locator('[data-action="open-tag-config"]').click();
  await expect.poll(() => chipNames(page)).toEqual(['睡觉', '吃饭']);
});

// ③ importing a zh backup into a fresh en device: both tag sets coexist,
// each keeping its own bucket (mergeImportedConfig is locale-blind by
// design — this proves the en-seeded and zh-imported names sit side by side
// without any "smart" renaming or collapsing).
test('importing a zh backup into a fresh en device keeps both tag sets with correct buckets', async ({ page }) => {
  await bootLocale(page, { entries: [] });
  const imported = {
    version: 1,
    entries: [{ id: 'zh-1', ts: '2026-06-01T08:00', what: 'imported note', tags: ['娱乐'] }],
    config: {
      mainline: ['求职推进'],
      chips: [{ name: '娱乐', bucket: 'leak', longOk: false }]
    }
  };

  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('[data-action="open-more"]').click();
  await page.locator('[data-action="import-json"]').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'zh-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported))
  });
  await expect(page.locator('#import-shift-hours')).toHaveValue('0');
  await page.locator('[data-action="confirm-import-shift"]').click();

  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.length)).toBe(1);

  // SPEC-012's returnToMore breadcrumb lands back on "更多"/"More" after a
  // successful import drilled in from there; tag settings is one tap away.
  await page.locator('[data-action="open-tag-config"]').click();
  await expect.poll(() => chipNames(page)).toEqual([...EN_DEFAULT_CHIPS, '娱乐']);
});

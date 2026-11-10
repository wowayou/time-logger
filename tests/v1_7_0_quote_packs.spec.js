// D36 (v1.7.0): the three theme line packs are built into Rotating lines.
// A pack only changes the draft; Done saves it. Lines already in the box are
// not repeated; a late read belongs to the draft that started it; the legacy
// read-only origin gets no new entry point.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { boot, expectNoHorizontalOverflow, FIXED_NOW, openBackupSheet, routeStaticOrigin } from './ui_fixture.js';
import { bootLocale } from './i18n_fixture.js';

const packLines = (key, lang) => readFileSync(`packs/${key}-${lang}.txt`, 'utf8').trim().split('\n');
const packButton = (page, key) => page.locator(`[data-action="add-quote-pack"][data-pack="${key}"]`);
const draft = page => page.locator('[data-role="quotes-input"]');
const status = page => page.locator('[data-role="quote-pack-status"]');

async function openQuotes(page) {
  await page.locator('#motto-line').click();
  await page.locator('[data-action="pick-motto-mode"][data-mode="quote"]').click();
}

// Lets an already-released fetch continuation run before a negative assertion.
const settle = page => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 150)));

test('zh: a pack appends after the existing line, saves only on Done, and travels in the backup', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  const records = await page.evaluate(() => localStorage.getItem('timelog.v1'));
  await openQuotes(page);
  await expect(packButton(page, 'focus')).toHaveAccessibleName('把主题句库「把注意力放回来」追加到文本框');
  await draft(page).fill('已有的一句。');
  await packButton(page, 'focus').click();
  await expect(draft(page)).toHaveValue(['已有的一句。', ...packLines('focus', 'zh')].join('\n'));
  await expect(status(page)).toHaveText('已追加 14 句，检查后点「完成」保存。');
  await expect(page.locator('[data-role="quotes-count"]')).toContainText('共 15 句');
  // Nothing is stored before Done.
  expect(await page.evaluate(() => localStorage.getItem('timelog.quotes'))).toBeNull();
  await page.getByRole('button', { name: '保存阶段格言' }).click();
  await expect(page.locator('#motto-line')).toHaveText('已有的一句。');
  const stored = await page.evaluate(() => ({
    records: localStorage.getItem('timelog.v1'),
    quotes: JSON.parse(localStorage.getItem('timelog.quotes'))
  }));
  expect(stored.records).toBe(records);
  expect(stored.quotes.items).toEqual(['已有的一句。', ...packLines('focus', 'zh')]);
  await openBackupSheet(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-action="download-json"]').click()
  ]);
  const backup = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(backup.quotes.items).toEqual(stored.quotes.items);
});

test('en: the interface language picks the English file and English feedback', async ({ page }) => {
  await bootLocale(page, { locale: 'en' });
  await openQuotes(page);
  await expect(packButton(page, 'rest')).toContainText('Leave a little space');
  await packButton(page, 'rest').click();
  await expect(draft(page)).toHaveValue(packLines('rest', 'en').join('\n'));
  await expect(status(page)).toHaveText('Added 14 lines. Check them, then tap Done to save.');
  await page.locator('[data-action="save-motto"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.quotes')).items))
    .toEqual(packLines('rest', 'en'));
});

test('lines already in the box are not repeated, including a line written with a list marker', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  const lines = packLines('restart', 'zh');
  await openQuotes(page);
  const start = `- ${lines[0]}\n${lines[1]}`;
  await draft(page).fill(start);
  await packButton(page, 'restart').click();
  await expect(draft(page)).toHaveValue([start, ...lines.slice(2)].join('\n'));
  await expect(status(page)).toHaveText('已追加 12 句，检查后点「完成」保存。');
  const afterFirst = await draft(page).inputValue();
  await packButton(page, 'restart').click();
  await expect(status(page)).toHaveText('这套句子已经都在文本框里。');
  await expect(draft(page)).toHaveValue(afterFirst);
});

test('cancel discards an added pack', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  await openQuotes(page);
  await packButton(page, 'focus').click();
  await expect(status(page)).toContainText('14');
  await page.getByRole('button', { name: '取消编辑阶段格言' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('timelog.quotes'))).toBeNull();
  await openQuotes(page);
  await expect(draft(page)).toHaveValue('');
});

test('a failed read shows a visible error and leaves the draft alone', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  await page.route('**/packs/focus-zh.txt', route => route.abort());
  await openQuotes(page);
  await draft(page).fill('草稿。');
  await packButton(page, 'focus').click();
  await expect(page.locator('[data-role="motto-error"]')).toHaveText('暂时读不到这套句库，联网后再试。');
  await expect(draft(page)).toHaveValue('草稿。');
  await expect(status(page)).toHaveText('');
});

for (const fail of [false, true]) {
  test(`a pending pack ${fail ? 'error' : 'result'} cannot enter a reopened draft`, async ({ page }) => {
    await boot(page, 390, 'one-record', false, FIXED_NOW);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let markRequested;
    const requested = new Promise(resolve => { markRequested = resolve; });
    await page.route('**/packs/focus-zh.txt', async route => {
      markRequested();
      await gate;
      if (fail) await route.abort();
      else await route.fallback();
    });
    await openQuotes(page);
    await packButton(page, 'focus').click();
    await requested;
    await page.getByRole('button', { name: '取消编辑阶段格言' }).click();
    await expect(page.locator('#form-sheet')).toBeHidden();
    await openQuotes(page);
    await draft(page).fill('新草稿。');
    const finished = page.waitForEvent(fail ? 'requestfailed' : 'requestfinished');
    release();
    await finished;
    await settle(page);
    await expect(draft(page)).toHaveValue('新草稿。');
    await expect(page.locator('[data-role="motto-error"]')).toBeHidden();
    await expect(status(page)).toHaveText('');
    await page.getByRole('button', { name: '保存阶段格言' }).click();
    await expect(page.locator('#motto-line')).toHaveText('新草稿。');
  });
}

test('legacy read-only origin keeps file import but shows no pack entry point', async ({ page }) => {
  const origin = 'https://wowayou.github.io';
  const path = '/time-logger/';
  await routeStaticOrigin(page, origin, path);
  await boot(page, 768, 'one-record', false, FIXED_NOW, null, null, null, `${origin}${path}`);
  await openQuotes(page);
  await expect(page.locator('[data-action="pick-quotes-file"]')).toBeVisible();
  await expect(page.locator('[data-action="add-quote-pack"]')).toHaveCount(0);
});

for (const scheme of ['light', 'dark']) {
  test(`narrow ${scheme} sheet: packs fit, and Done stays reachable on a short screen`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await boot(page, 320, 'one-record', false, FIXED_NOW);
    await openQuotes(page);
    await expectNoHorizontalOverflow(page);
    for (const key of ['focus', 'rest', 'restart']) {
      const box = await packButton(page, key).boundingBox();
      expect(box && box.height).toBeGreaterThanOrEqual(44);
    }
    await page.setViewportSize({ width: 375, height: 600 });
    await packButton(page, 'restart').scrollIntoViewIfNeeded();
    await packButton(page, 'restart').click();
    await expect(status(page)).toContainText('14');
    await expect(page.getByRole('button', { name: '保存阶段格言' })).toBeInViewport();
    await expectNoHorizontalOverflow(page);
  });
}

test.describe('with the real service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('packs are precached: adding works offline once the worker controls the page', async ({ page, context, browserName }) => {
    // Playwright's WebKit offline emulation fails every fetch, even for an
    // already-precached src/app.js (probed 2026-11-10: Chromium 200 for app.js,
    // styles.css, icon.svg and the pack; WebKit "Load failed" for all four).
    // That is the harness, not the app, so offline WebKit stays a device check.
    test.skip(browserName === 'webkit', 'WebKit offline emulation bypasses the service worker cache');
    await page.goto('/');
    await page.waitForFunction(() => document.body.classList.contains('app-ready'));
    await page.waitForFunction(() => Boolean(navigator.serviceWorker && navigator.serviceWorker.controller));
    await context.setOffline(true);
    try {
      await openQuotes(page);
      await packButton(page, 'focus').click();
      await expect(draft(page)).toHaveValue(packLines('focus', 'zh').join('\n'));
      await expect(page.locator('[data-role="motto-error"]')).toBeHidden();
    } finally {
      await context.setOffline(false);
    }
  });
});

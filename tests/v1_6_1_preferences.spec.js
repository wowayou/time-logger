import { test, expect } from '@playwright/test';
import { boot, FIXED_NOW, openBackupMenu, openBackupSheet } from './ui_fixture.js';

// Run after boot(): fixture writes must succeed, only the operation under test fails.
async function rejectPreferences(page, { reads = false } = {}) {
  await page.evaluate(({ reads }) => {
    const keys = new Set([
      'timelog.view', 'timelog.selectedDate', 'timelog.openDate',
      'timelog.theme', 'timelog.recordMode', 'timelog.helpSeen.v16', 'timelog.locale'
    ]);
    for (const method of reads ? ['getItem', 'setItem', 'removeItem'] : ['setItem', 'removeItem']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function(key, ...args) {
        if (this === localStorage && keys.has(key)) {
          throw new DOMException('synthetic preference failure', reads ? 'SecurityError' : 'QuotaExceededError');
        }
        return original.call(this, key, ...args);
      };
    }
  }, { reads });
}

test('v1.6.1: denied preference reads cannot block startup', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/src/app.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `
      const originalGet = Storage.prototype.getItem;
      Storage.prototype.getItem = function(key) {
        if (this === localStorage && ['timelog.view', 'timelog.selectedDate', 'timelog.theme', 'timelog.recordMode'].includes(key)) {
          throw new DOMException('synthetic denied read', 'SecurityError');
        }
        return originalGet.call(this, key);
      };
    \n${await response.text()}` });
  });
  await boot(page, 390, 'two-records', false, FIXED_NOW);
  await expect(page.locator('.entry[data-id="today-1"]')).toBeVisible();
  await openBackupSheet(page);
  await expect(page.locator('[data-action="download-json"]')).toBeVisible();
  expect(errors).toEqual([]);
});

for (const reads of [false, true]) {
  test(`v1.6.1: preferences denied (reads=${reads}) keep theme, mode and help usable`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
    await rejectPreferences(page, { reads });
    await openBackupMenu(page);
    await page.locator('[data-action="theme"][data-theme="light"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator('button[data-action="close-form"]').click();
    await expect(page.locator('#form-sheet')).toBeHidden();
    await openBackupMenu(page);
    await expect(page.locator('[data-action="theme"][data-theme="light"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-action="open-help"]').click();
    await expect(page.locator('#form-sheet-title')).toHaveText('说明');
    await page.locator('button[data-action="close-form"]').click();
    await page.locator('button[data-action="close-form"]').click();
    await expect(page.locator('#form-sheet')).toBeHidden();

    await page.locator('#add-btn').click();
    await page.locator('[data-action="pick-record-mode"][data-mode="plan"]').click();
    await page.locator('button[data-action="close-form"]').click();
    await expect(page.locator('#form-sheet')).toBeHidden();
    await expect(page.locator('#add-btn')).toContainText('计划');
    await page.locator('#add-btn').click();
    await expect(page.locator('[data-action="pick-record-mode"][data-mode="plan"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#form-what').fill('测试计划');
    await page.locator('[data-action="save-entry"]').click();
    await expect(page.locator('#form-sheet')).toBeHidden();
    const data = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')));
    expect(data.entries.filter(e => e.what === '测试计划' && e.planned)).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}

for (const [field, key, rendered] of [
  ['view', 'timelog.view', 'month'],
  ['selectedDate', 'timelog.selectedDate', '2026-06-28'],
  ['recordMode', 'timelog.recordMode', 'plan']
]) {
  test(`v1.6.1: an unpersisted ${field} cannot restore a mismatched boot snapshot`, async ({ page }) => {
    await boot(page, 390, 'two-records', false, FIXED_NOW, null, null, 'log');
    const persisted = await page.evaluate(key => localStorage.getItem(key), key);
    await rejectPreferences(page);
    if (field === 'view') {
      await page.locator('[data-action="view"][data-view="month"]').click();
      await expect(page.locator('.sum-row')).toHaveCount(30);
    } else if (field === 'selectedDate') {
      await page.locator('[data-action="shift-period"][data-delta="-1"]').click();
      await expect(page.locator('#today-btn')).toBeVisible();
    } else {
      await page.locator('#add-btn').click();
      await page.locator('[data-action="pick-record-mode"][data-mode="plan"]').click();
      await page.locator('button[data-action="close-form"]').click();
      await expect(page.locator('#form-sheet')).toBeHidden();
      // A full render writes a boot frame containing the session-only FAB mode.
      await page.locator('[data-action="view"][data-view="day"]').click();
      await expect(page.locator('#add-btn')).toContainText('计划');
    }
    const snapshot = await page.evaluate(() => JSON.parse(sessionStorage.getItem('timelog.bootSnapshot.v1')));
    expect(snapshot[field], 'the snapshot must describe what was rendered, not reread storage').toBe(rendered);
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(persisted);
    await page.reload();
    await page.waitForFunction(() => document.body.classList.contains('app-ready'));
    await expect(page.locator('[data-action="view"][data-view="day"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.entry[data-id="today-1"]')).toBeVisible();
    await expect(page.locator('.sum-row')).toHaveCount(0);
    await expect(page.locator('#today-btn')).toBeHidden();
    await expect(page.locator('#add-btn')).not.toContainText('计划');
  });
}

test('v1.6.1: a successful preference retry clears the session-only override', async ({ page }) => {
  await boot(page, 390, 'empty', false, FIXED_NOW);
  const result = await page.evaluate(async () => {
    const { readUiPreference, saveUiPreference, THEME_KEY } = await import('/src/storage.js');
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (this === localStorage && key === THEME_KEY) throw new DOMException('full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
    const failed = saveUiPreference(THEME_KEY, 'dark');
    const sessionValue = readUiPreference(THEME_KEY);
    Storage.prototype.setItem = original;
    const saved = saveUiPreference(THEME_KEY, 'light');
    // A later external change must be read from storage, not a stale in-memory copy.
    localStorage.setItem(THEME_KEY, 'auto');
    return { failed, sessionValue, saved, latest: readUiPreference(THEME_KEY) };
  });
  expect(result).toEqual({ failed: false, sessionValue: 'dark', saved: true, latest: 'auto' });
});

test('v1.6.1: failed locale removal keeps the system preference only for this session', async ({ page }) => {
  await boot(page, 390, 'empty', false, FIXED_NOW);
  const result = await page.evaluate(async () => {
    const { loadLocalePref, saveLocalePref, LOCALE_KEY } = await import('/src/storage.js');
    localStorage.setItem(LOCALE_KEY, 'en');
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function(key) {
      if (this === localStorage && key === LOCALE_KEY) throw new DOMException('denied', 'SecurityError');
      return original.call(this, key);
    };
    saveLocalePref('');
    const sessionValue = loadLocalePref();
    const storedValue = localStorage.getItem(LOCALE_KEY);
    Storage.prototype.removeItem = original;
    saveLocalePref('');
    const removed = localStorage.getItem(LOCALE_KEY);
    localStorage.setItem(LOCALE_KEY, 'zh');
    return { sessionValue, storedValue, removed, latest: loadLocalePref() };
  });
  expect(result).toEqual({ sessionValue: '', storedValue: 'en', removed: null, latest: 'zh' });
});

test('v1.6.1: actual record quota failure still keeps the draft and permits backup', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  const before = await page.evaluate(() => localStorage.getItem('timelog.v1'));
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('不能假称已保存');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (this === localStorage) throw new DOMException('full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.locator('[data-action="save-entry"]').click();
  await expect(page.locator('[data-role="conflict-error"]')).toContainText('存储空间不足');
  await expect(page.locator('#form-what')).toHaveValue('不能假称已保存');
  expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(before);
  await page.locator('button[data-action="close-form"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  await openBackupSheet(page);
  const download = page.waitForEvent('download');
  await page.locator('[data-action="download-json"]').click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
});

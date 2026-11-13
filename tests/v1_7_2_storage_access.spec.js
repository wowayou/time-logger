import { expect, test } from '@playwright/test';
import { boot, FIXED_NOW, openBackupMenu, openBackupSheet } from './ui_fixture.js';
import { bootLocale } from './i18n_fixture.js';

// Only the isolated synthetic context is denied. No real browser quota/settings
// are changed. Leave reads available so the original raw data can be compared.
async function denyWrites(page, key) {
  await page.evaluate(key => {
    const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function(k, value) {
      if (this === localStorage && k === key) throw new DOMException('Synthetic denied storage', 'SecurityError');
      return set.call(this, k, value);
    };
    Storage.prototype.removeItem = function(k) {
      if (this === localStorage && k === key) throw new DOMException('Synthetic denied storage', 'SecurityError');
      return remove.call(this, k);
    };
    window.__restoreStorageWrites = () => { Storage.prototype.setItem = set; Storage.prototype.removeItem = remove; };
  }, key);
}

const stored = page => page.evaluate(() => ({ records: localStorage.getItem('timelog.v1'), config: localStorage.getItem('timelog.config'), quotes: localStorage.getItem('timelog.quotes') }));

for (const mode of ['new', 'edit', 'fill', 'plan']) {
  test(`R03: denied ${mode} save preserves the draft and raw records, and recovery saves exactly once`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page, 768, mode === 'plan' ? 'planned-expired' : 'mid-placeholder', false, FIXED_NOW);
    const before = await stored(page);
    if (mode === 'new') await page.locator('#add-btn').click();
    else if (mode === 'fill') await page.locator('.entry[data-id="mid-open"] .mini-btn').click();
    else await page.locator(`.entry[data-id="${mode === 'plan' ? 'plan-expired' : 'mid-a'}"] .e-what`).click();
    const input = page.locator(mode === 'edit' || mode === 'plan' ? '[data-role="edit-what"]' : '#form-what');
    await input.fill('拒绝存储时保留的合成草稿');
    await denyWrites(page, 'timelog.v1');
    const save = page.locator(mode === 'edit' || mode === 'plan' ? '[data-action="commit-edit"]' : '[data-action="save-entry"]');
    for (let i = 0; i < 2; i++) {
      await save.click();
      await expect(page.locator('[data-role="conflict-error"]')).toContainText('不允许');
      await expect(input).toHaveValue('拒绝存储时保留的合成草稿');
      expect(await stored(page)).toEqual(before);
    }
    expect(errors).toEqual([]);
    await page.evaluate(() => window.__restoreStorageWrites());
    await save.click();
    await expect(page.locator('#form-sheet')).toBeHidden();
    const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
    expect(entries.filter(e => e.what === '拒绝存储时保留的合成草稿')).toHaveLength(1);
  });
}

test('R03: denied tag settings save rolls back records, retains staged inputs and reports the failure', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await boot(page, 390, 'mid-placeholder', false, FIXED_NOW);
  const before = await stored(page);
  await openBackupMenu(page);
  await page.locator('[data-action="open-tag-config"]').click();
  const row = page.locator('.cfg-row[data-original-name="睡觉"]');
  await row.locator('.cfg-chip').click();
  await row.locator('.cfg-name').fill('合成睡眠');
  await denyWrites(page, 'timelog.config');
  await page.locator('[data-action="save-tag-config"]').click();
  await expect(page.locator('[data-role="config-error"]')).toContainText('不允许');
  await expect(row.locator('.cfg-name')).toHaveValue('合成睡眠');
  expect(await stored(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('R03: denied rotating-lines save keeps the text and the stored library', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await boot(page, 390, 'mid-placeholder', false, FIXED_NOW);
  const before = await stored(page);
  await page.locator('#motto-line').click();
  await page.locator('[data-action="pick-motto-mode"][data-mode="quote"]').click();
  const input = page.locator('[data-role="quotes-input"]');
  await input.fill('合成的一句。');
  await denyWrites(page, 'timelog.quotes');
  await page.locator('[data-action="save-motto"]').click();
  await expect(page.locator('[data-role="motto-error"]')).toContainText('不允许');
  await expect(input).toHaveValue('合成的一句。');
  expect(await stored(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('R04: denied import commits nothing and keeps the import review available', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await boot(page, 390, 'mid-placeholder', false, FIXED_NOW);
  const before = await stored(page);
  await openBackupSheet(page);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-action="import-json"]').click();
  await (await chooser).setFiles({ name: 'synthetic-review.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, entries: [{ id: 'synthetic-import', ts: '2026-06-28T07:00', what: '合成导入内容', tags: ['睡觉'] }] })) });
  await expect(page.locator('#import-confirm-btn')).toBeEnabled();
  await denyWrites(page, 'timelog.v1');
  await page.locator('#import-confirm-btn').click();
  await expect(page.locator('[data-role="import-error"]')).toContainText('不允许');
  await expect(page.locator('#import-confirm-btn')).toBeEnabled();
  expect(await stored(page)).toEqual(before);
  expect(errors).toEqual([]);
});

// A tolerant rendering read's empty fallback must not authorize a write.
test('R03: all checked writers refuse a denied read without calling setItem', async ({ page }) => {
  await boot(page, 768, 'mid-placeholder', false, FIXED_NOW);
  const result = await page.evaluate(async () => {
    const storage = await import('/src/storage.js');
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    let deniedKey = '', writes = 0;
    Storage.prototype.getItem = function(key) {
      if (this === localStorage && key === deniedKey) throw new DOMException('Synthetic denied read', 'SecurityError');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function(key, value) { writes += 1; return set.call(this, key, value); };
    try {
      deniedKey = 'timelog.v1';
      const records = storage.saveChecked({ version: 1, entries: [] }, '');
      deniedKey = 'timelog.config';
      const config = storage.saveConfigChecked({ mainline: [], chips: [] }, '');
      deniedKey = 'timelog.quotes';
      const quotes = storage.saveQuotesChecked({ items: ['合成一句。'] }, null);
      return { records, config, quotes, writes };
    } finally { Storage.prototype.getItem = get; Storage.prototype.setItem = set; }
  });
  for (const key of ['records', 'config', 'quotes']) expect(result[key]).toMatchObject({ ok: false, reason: 'denied' });
  expect(result.writes).toBe(0);
});

test('R03: an unexpected programming error is not disguised as quota or permission failure', async ({ page }) => {
  await boot(page, 768, 'mid-placeholder', false, FIXED_NOW);
  const result = await page.evaluate(async () => {
    const storage = await import('/src/storage.js');
    const { data, raw } = storage.loadSnapshot();
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new TypeError('Synthetic programmer error'); };
    try { storage.saveChecked(data, raw); return 'not-thrown'; }
    catch (e) { return e.name; }
    finally { Storage.prototype.setItem = set; }
  });
  expect(result).toBe('TypeError');
});

test('R03: denied custom-tag configuration rolls the entry back without losing its draft', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await boot(page, 768, 'mid-placeholder', false, FIXED_NOW);
  const before = await stored(page);
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('合成自定义标签草稿');
  await page.locator('#form-ctag').fill('合成新标签');
  await denyWrites(page, 'timelog.config');
  await page.locator('[data-action="save-entry"]').click();
  await expect(page.locator('[data-role="conflict-error"]')).toContainText('不允许');
  await expect(page.locator('#form-what')).toHaveValue('合成自定义标签草稿');
  await expect(page.locator('#form-ctag')).toHaveValue('合成新标签');
  expect(await stored(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('R03: a denied Undo retains the original eight-second window for recovery', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page, 768, 'three-labels', false, FIXED_NOW);
  const before = await stored(page);
  await page.locator('.entry[data-id="tl-b"]').click();
  await page.locator('#form-sheet [data-action="request-delete"]').click();
  await page.locator('[data-action="confirm-delete"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  const deleted = await stored(page);
  await denyWrites(page, 'timelog.v1');
  await page.locator('[data-action="undo-delete"]').click();
  await expect(page.locator('#info-toast')).toContainText('不允许');
  await expect(page.locator('[data-action="undo-delete"]')).toBeVisible();
  expect(await stored(page)).toEqual(deleted);
  await page.evaluate(() => window.__restoreStorageWrites());
  await page.locator('[data-action="undo-delete"]').click();
  expect(await stored(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('R03: English denied-storage feedback is actionable and announced as an alert', async ({ page }) => {
  await bootLocale(page, { width: 390 });
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('Synthetic unsaved draft');
  await denyWrites(page, 'timelog.v1');
  await page.locator('[data-action="save-entry"]').click();
  const error = page.locator('[data-role="conflict-error"]');
  await expect(error).toContainText('does not allow');
  await expect(error).toHaveAttribute('role', 'alert');
  await expect(error).toHaveAttribute('aria-atomic', 'true');
  await expect(page.locator('#form-what')).toHaveValue('Synthetic unsaved draft');
});

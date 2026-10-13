import { test, expect } from '@playwright/test';
import { boot, FIXED_NOW, openBackupSheet } from './ui_fixture.js';

// Quota is injected after the fixture has seeded storage but before app.init().
// Hook the prototype (not the Storage instance), so both engines really fail.
async function failPreferenceWrites(page) {
  await page.route('**/src/app.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (this === localStorage && !['timelog.v1', 'timelog.config'].includes(key)) {
          throw new DOMException('synthetic full storage', 'QuotaExceededError');
        }
        return originalSet.call(this, key, value);
      };
    \n${await response.text()}` });
  });
}

async function stored(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')));
}

async function openEdit(page, id) {
  await page.locator(`.entry[data-id="${id}"]`).click();
  await expect(page.locator('.form-sheet-panel')).toHaveAttribute('data-mode', 'edit');
}

async function changeElsewhere(page, id, action) {
  return page.evaluate(({ id, action }) => {
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    if (action === 'delete') data.entries = data.entries.filter(e => e.id !== id);
    else data.entries.find(e => e.id === id).what = '另一页已经保存的内容';
    localStorage.setItem('timelog.v1', JSON.stringify(data));
    window.dispatchEvent(new StorageEvent('storage', { key: 'timelog.v1', storageArea: localStorage }));
    return localStorage.getItem('timelog.v1');
  }, { id, action });
}

test('v1.6.1: full preference storage cannot block startup, navigation or backup', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await failPreferenceWrites(page);
  await boot(page, 390, 'two-records', false, FIXED_NOW);
  const before = await stored(page);
  await page.locator('[data-action="view"][data-view="month"]').click();
  await expect(page.locator('.summary-list .sum-row')).toHaveCount(30);
  await page.locator('[data-action="view"][data-view="day"]').click();
  await page.locator('[data-action="shift-period"][data-delta="-1"]').click();
  await page.locator('#today-btn').click();
  await expect(page.locator('.entry[data-id="today-1"]')).toBeVisible();
  await openBackupSheet(page);
  const download = page.waitForEvent('download');
  await page.locator('[data-action="download-json"]').click();
  const stream = await (await download).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString()).entries).toEqual(before.entries);
  expect(await stored(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('v1.6.1: failed navigation preference after a successful save must not leave a stuck form', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('已经完成的工作');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (this === localStorage && ['timelog.view', 'timelog.selectedDate'].includes(key)) {
        throw new DOMException('synthetic full storage', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };
  });
  await page.locator('[data-action="save-entry"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  expect((await stored(page)).entries.filter(e => e.what === '已经完成的工作')).toHaveLength(1);
  await expect(page.locator('#timeline')).toContainText('已经完成的工作');
  expect(errors).toEqual([]);
});

for (const state of ['two-records', 'planned-expired']) {
  for (const action of ['change', 'delete']) {
    test(`v1.6.1: ${state} ${action} during editing preserves newer data and the draft`, async ({ page }) => {
      await boot(page, 768, state, false, FIXED_NOW);
      const id = state === 'two-records' ? 'today-1' : 'plan-expired';
      await openEdit(page, id);
      await page.locator('[data-role="edit-what"]').fill('本页尚未保存的草稿');
      const latestRaw = await changeElsewhere(page, id, action);
      await page.locator('[data-action="commit-edit"]').click();
      await expect(page.locator('[data-role="edit-what"]')).toHaveValue('本页尚未保存的草稿');
      const error = page.locator('[data-role="conflict-error"]');
      await expect(error).toBeVisible();
      await expect(error).toContainText(action === 'delete' ? '已经不存在' : '重新打开');
      expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(latestRaw);
      // A second save cannot silently accept the stale draft either.
      await page.locator('[data-action="commit-edit"]').click();
      expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(latestRaw);
    });
  }
}

test('v1.6.1: editing still allows an unrelated concurrent addition after preview confirmation', async ({ page }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);
  await openEdit(page, 'today-1');
  await page.locator('[data-role="edit-what"]').fill('本页正常修改');
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    data.entries.push({ id: 'unrelated', ts: '2026-06-28T09:00', what: '无关记录', tags: ['睡觉'] });
    localStorage.setItem('timelog.v1', JSON.stringify(data));
  });
  await page.locator('[data-action="commit-edit"]').click();
  await expect(page.locator('[data-role="conflict-error"]')).toContainText('预览已按最新记录');
  await page.locator('[data-action="commit-edit"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  const data = await stored(page);
  expect(data.entries.find(e => e.id === 'today-1').what).toBe('本页正常修改');
  expect(data.entries.find(e => e.id === 'unrelated').what).toBe('无关记录');
});

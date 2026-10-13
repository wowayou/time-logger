import { test, expect } from '@playwright/test';
import { boot, FIXED_NOW } from './ui_fixture.js';

async function openSplitDraft(page, range = 'whole') {
  // A live tail uses the ordinary recording form; bounded backfill belongs to a closed gap.
  await boot(page, 390, range === 'placeholder' ? 'mid-placeholder' : 'two-records', false, FIXED_NOW);
  if (range === 'placeholder') {
    await page.locator('.entry[data-id="mid-open"] [data-action="backfill-seg"]').click();
  } else {
    await page.locator('.entry[data-id="today-1"]').click();
    await page.getByRole('button', { name: '在这条记录内部切一刀' }).click();
    if (range === 'whole') {
      await page.getByRole('button', { name: '开始时刻贴到原段起点 09:00' }).click();
      await page.getByRole('button', { name: '结束时刻贴到原段终点 10:00' }).click();
    }
  }
  await page.locator('#form-what').fill('本页切分草稿');
}

async function changeEntry(page, id, what, notify = false) {
  return page.evaluate(({ id, what, notify }) => {
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    if (what === null) data.entries = data.entries.filter(e => e.id !== id);
    else data.entries.find(e => e.id === id).what = what;
    const raw = JSON.stringify(data);
    localStorage.setItem('timelog.v1', raw);
    if (notify) window.dispatchEvent(new StorageEvent('storage', { key: 'timelog.v1', storageArea: localStorage }));
    return raw;
  }, { id, what, notify });
}

for (const range of ['whole', 'inside', 'placeholder']) {
  test(`v1.6.1: ${range} fill/split preserves a changed source and the draft`, async ({ page }) => {
    await openSplitDraft(page, range);
    const id = range === 'placeholder' ? 'mid-open' : 'today-1';
    // No storage event: the save preflight itself must detect the changed source.
    const raw = await changeEntry(page, id, '另一页刚保存的原文');
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.locator('[data-action="save-entry"]').click();
      expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(raw);
      await expect(page.locator('[data-role="conflict-error"]')).toContainText('重新打开');
      await expect(page.locator('[data-role="conflict-error"]')).toBeInViewport();
      await expect(page.locator('#form-what')).toHaveValue('本页切分草稿');
    }
  });
}

test('v1.6.1: a deleted split source is not recreated from an old draft', async ({ page }) => {
  await openSplitDraft(page);
  const raw = await changeEntry(page, 'today-1', null);
  await page.locator('[data-action="save-entry"]').click();
  expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(raw);
  await expect(page.locator('[data-role="conflict-error"]')).toContainText('已经不存在');
  await expect(page.locator('#form-what')).toHaveValue('本页切分草稿');
});

test('v1.6.1: a split still accepts unrelated changes after preview reconfirmation', async ({ page }) => {
  await openSplitDraft(page);
  const raw = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    data.entries.push({ id: 'unrelated-split', ts: '2026-06-28T09:00', what: '无关记录', tags: ['睡觉'] });
    const raw = JSON.stringify(data);
    localStorage.setItem('timelog.v1', raw);
    return raw;
  });
  await page.locator('[data-action="save-entry"]').click();
  expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(raw);
  await expect(page.locator('[data-role="conflict-error"]')).toContainText('预览已按最新记录');
  await page.locator('[data-action="save-entry"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries.find(e => e.id === 'today-1').what).toBe('本页切分草稿');
  expect(entries.find(e => e.id === 'unrelated-split').what).toBe('无关记录');
});

for (const planned of [false, true]) {
  test(`v1.6.1: deletion rechecks the original before every confirmation (planned=${planned})`, async ({ page }) => {
    await boot(page, 390, planned ? 'planned-expired' : 'two-records', false, FIXED_NOW);
    const id = planned ? 'plan-expired' : 'today-1';
    await page.locator(`.entry[data-id="${id}"]`).click();
    await page.locator('#form-sheet [data-action="request-delete"]').click();
    await expect(page.locator('.form-sheet-panel')).toHaveAttribute('data-mode', 'delete-confirm');
    let raw;
    for (const what of ['另一页第一次修改', '另一页第二次修改']) {
      raw = await changeEntry(page, id, what, true);
      await page.locator('[data-action="confirm-delete"]').click();
      expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(raw);
      await expect(page.locator('.delete-what')).toHaveText(what);
      await expect(page.locator('.delete-confirm-body [role="alert"]')).toContainText('请再次确认');
      await expect(page.locator('.delete-what')).toBeInViewport();
    }
    // With no further change, the explicit confirmation is allowed. Undo must
    // restore the actual latest source, not the original confirmation's old note.
    await page.locator('[data-action="confirm-delete"]').click();
    await expect(page.locator('#form-sheet')).toBeHidden();
    const after = await page.evaluate(id => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(e => e.id === id), id);
    if (planned) expect(after).toBeUndefined();
    else expect(after.what).toBe('');
    await page.locator('[data-action="undo-delete"]').click();
    expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(raw);
  });
}

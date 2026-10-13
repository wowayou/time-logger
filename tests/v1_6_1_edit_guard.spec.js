import { test, expect } from '@playwright/test';
import { boot, FIXED_NOW } from './ui_fixture.js';
import { bootLocale } from './i18n_fixture.js';

async function openDraft(page, id) {
  await page.locator(`.entry[data-id="${id}"]`).click();
  await page.locator('[data-role="edit-what"]').fill('本页草稿');
}

for (const state of ['two-records', 'planned-expired']) {
  for (const field of ['ts', 'tags', 'planned', 'ongoing', 'longConfirm']) {
    test(`v1.6.1: ${state} detects a concurrent ${field} change before saving`, async ({ page }) => {
      await boot(page, 390, state, false, FIXED_NOW);
      const id = state === 'two-records' ? 'today-1' : 'plan-expired';
      await openDraft(page, id);
      const raw = await page.evaluate(({ id, field }) => {
        const data = JSON.parse(localStorage.getItem('timelog.v1'));
        const entry = data.entries.find(e => e.id === id);
        if (field === 'ts') entry.ts = entry.ts.slice(0, -2) + '01';
        if (field === 'tags') entry.tags = ['睡觉'];
        if (field === 'planned') entry.planned = !entry.planned;
        if (field === 'ongoing') entry.ongoing = !entry.ongoing;
        if (field === 'longConfirm') entry.longConfirm = { startTs: entry.ts, endTs: '2026-06-29T12:34' };
        const raw = JSON.stringify(data);
        localStorage.setItem('timelog.v1', raw);
        // Deliberately omit storage events: correctness must come from the save preflight.
        return raw;
      }, { id, field });
      await page.locator('[data-action="commit-edit"]').click();
      const error = page.locator('[data-role="conflict-error"]');
      await expect(error).toContainText('重新打开');
      await expect(error).toBeInViewport();
      await expect(page.locator('[data-role="edit-what"]')).toHaveValue('本页草稿');
      expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(raw);
      await page.locator('[data-action="commit-edit"]').click();
      expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(raw);
    });
  }
}

test('v1.6.1: equivalent entry property order is not a conflict', async ({ page }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);
  await openDraft(page, 'today-1');
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    data.entries = data.entries.map(e => Object.fromEntries(Object.entries(e).reverse()));
    localStorage.setItem('timelog.v1', JSON.stringify(data));
  });
  await page.locator('[data-action="commit-edit"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(e => e.id === 'today-1').what)).toBe('本页草稿');
});

test('v1.6.1: preview reconfirmation cannot adopt a later change to the edited entry', async ({ page }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);
  await openDraft(page, 'today-1');
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    data.entries.find(e => e.id === 'today-2').what = '先修改右邻';
    localStorage.setItem('timelog.v1', JSON.stringify(data));
  });
  await page.locator('[data-action="commit-edit"]').click();
  await expect(page.locator('[data-role="conflict-error"]')).toContainText('预览已按最新记录');
  const raw = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    data.entries.find(e => e.id === 'today-1').what = '然后修改原记录';
    const raw = JSON.stringify(data);
    localStorage.setItem('timelog.v1', raw);
    return raw;
  });
  await page.locator('[data-action="commit-edit"]').click();
  await expect(page.locator('[data-role="conflict-error"]')).toContainText('重新打开');
  await expect(page.locator('[data-role="edit-what"]')).toHaveValue('本页草稿');
  expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(raw);
});

for (const deleted of [false, true]) {
  test(`v1.6.1: English stale edit feedback (deleted=${deleted}) keeps the draft`, async ({ page }) => {
    await bootLocale(page, {
      locale: 'en',
      entries: [{ id: 'original', ts: '2026-06-29T09:00', what: 'Original note', tags: ['Main focus'] }]
    });
    await openDraft(page, 'original');
    await page.evaluate(deleted => {
      const data = JSON.parse(localStorage.getItem('timelog.v1'));
      if (deleted) data.entries = [];
      else data.entries[0].what = 'Newer note';
      localStorage.setItem('timelog.v1', JSON.stringify(data));
    }, deleted);
    await page.locator('[data-action="commit-edit"]').click();
    await expect(page.locator('[data-role="conflict-error"]')).toContainText(deleted ? 'no longer exists' : 'reopen');
    await expect(page.locator('[data-role="edit-what"]')).toHaveValue('本页草稿');
  });
}

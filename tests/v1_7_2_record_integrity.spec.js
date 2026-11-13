import { expect, test } from '@playwright/test';
import { boot, FIXED_NOW } from './ui_fixture.js';

async function dayTotals(page, day) {
  return page.evaluate(async day => {
    const { summarizeEntries } = await import('/src/stats.js');
    const { loadConfig } = await import('/src/storage.js');
    const { addDays, parseDateKey, localDateTimeKey } = await import('/src/time.js');
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    return summarizeEntries(data.entries, `${day}T00:00`, localDateTimeKey(addDays(parseDateKey(day), 1)), { now: '2026-06-29T12:34', config: loadConfig() });
  }, day);
}

// This is preservation of accepted legacy data, not the unapproved multi-tag UI.
test('R01: an unrelated save preserves legacy secondary tags, exact text and all four bucket minutes', async ({ page }) => {
  await boot(page, 768, 'mid-placeholder', false, FIXED_NOW);
  const originals = [
    { id: 'original-a', ts: '2026-06-28T09:00', what: '合成原记录', tags: ['求职推进', '附加A'] },
    { id: 'original-b', ts: '2026-06-28T10:00', what: '合成原记录', tags: ['求职推进', '附加B'] },
    { id: 'original-c', ts: '2026-06-28T11:00', what: '保留空格 ', tags: ['求职推进'] },
    { id: 'original-d', ts: '2026-06-28T12:00', what: '保留空格', tags: ['求职推进'] },
    { id: 'original-e', ts: '2026-06-28T13:00', what: '合成维持', tags: ['吃饭'] },
    { id: 'original-end', ts: '2026-06-28T14:00', what: '', tags: [] }
  ];
  await page.evaluate(entries => {
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    data.entries.push(...entries);
    localStorage.setItem('timelog.v1', JSON.stringify(data));
  }, originals);
  const before = await dayTotals(page, '2026-06-28');
  expect(before).toMatchObject({ job: 240, maintain: 60, leak: 0, unrecorded: 1140, pending: 0, total: 1440 });
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('今天的一条合成记录');
  await page.locator('[data-action="save-entry"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  const remaining = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.filter(e => e.id.startsWith('original-')));
  expect(remaining).toEqual(originals);
  expect(await dayTotals(page, '2026-06-28')).toEqual(before);
});

test('R01: cancelling a new draft does not write records, tags or rotating lines', async ({ page }) => {
  await boot(page, 375, 'mid-placeholder', false, FIXED_NOW);
  const raw = () => page.evaluate(() => ['timelog.v1', 'timelog.config', 'timelog.quotes'].map(key => localStorage.getItem(key)));
  const before = await raw();
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('只在草稿里的合成长正文\n第二行');
  await page.locator('#form-ctag').fill('未保存的合成标签');
  await page.locator('.sh-cancel').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  expect(await raw()).toEqual(before);
});

test('R01: Enter remains a newline and duplicate save activation persists exactly one record', async ({ page }) => {
  await boot(page, 390, 'empty', false, FIXED_NOW);
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('合成第一行');
  await page.locator('#form-what').press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Synthetic second line');
  await expect(page.locator('#form-what')).toHaveValue('合成第一行\nSynthetic second line');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries)).toEqual([]);
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  // Real double-click events, no force click or custom retry.
  await page.locator('[data-action="save-entry"]').dblclick();
  await expect(page.locator('#form-sheet')).toBeHidden();
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(records.filter(e => e.what === '合成第一行\nSynthetic second line')).toHaveLength(1);
  expect(new Set(records.map(e => e.ts)).size).toBe(records.length);
  expect(await dayTotals(page, '2026-06-29')).toMatchObject({ job: 754, maintain: 0, leak: 0, unrecorded: 0, total: 754 });
});

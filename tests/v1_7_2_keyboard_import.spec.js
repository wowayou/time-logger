import { expect, test } from '@playwright/test';
import { boot, FIXED_NOW, openBackupSheet } from './ui_fixture.js';

for (const key of ['Enter', 'Space']) {
  test(`R07: ${key} opens a log row, Tab stays in the dialog, and Escape returns focus to the row`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page, 390, 'two-records', false, FIXED_NOW);
    const row = page.locator('.entry[data-id="today-1"]');
    await row.focus();
    await page.keyboard.press(key);
    const panel = page.locator('.form-sheet-panel');
    await expect(panel).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#form-sheet .sh-cancel')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#form-sheet [data-action="request-delete"]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#form-sheet .sh-cancel')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#form-sheet')).toBeHidden();
    await expect(row).toBeFocused();
  });
}

test('R07: minute redraw retains a keyboard-focused record without changing scroll', async ({ page }) => {
  await boot(page, 390, 'two-records', false, FIXED_NOW);
  const row = page.locator('.entry[data-id="today-1"]');
  await row.focus();
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => {
    window.__setFixedNow('2026-06-29T12:40:00');
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.locator('#now-strip .now-dur')).toHaveText('已 2h40min');
  await expect(row).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
});

test('R04: real second-page writes invalidate same-ID/same-minute import choices, without discarding the newer entry', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page, 390, 'two-records', false, FIXED_NOW);
  const incoming = [
    { id: 'today-1', ts: '2026-06-29T09:00', what: '合成备份同ID', tags: ['睡觉'] },
    { id: 'incoming-time', ts: '2026-06-29T10:00', what: '合成备份同刻', tags: ['吃饭'] },
    { id: 'incoming-new', ts: '2026-06-28T08:00', what: '合成备份新增', tags: ['吃饭'] }
  ];
  const before = await page.evaluate(() => localStorage.getItem('timelog.v1'));
  await openBackupSheet(page);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-action="import-json"]').click();
  await (await chooser).setFiles({ name: 'synthetic-conflicts.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, entries: incoming })) });
  const cards = page.locator('.import-conflict-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('同一记录的内容不同');
  await expect(cards.nth(1)).toContainText('同一时刻有两条记录');
  await cards.nth(0).getByRole('button', { name: '保留本机', exact: true }).click();
  await cards.nth(1).getByRole('button', { name: '合并文字', exact: true }).click();
  await expect(page.locator('#import-confirm-btn')).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(before);
  const other = await context.newPage();
  await other.goto('/');
  await other.waitForFunction(() => document.body.classList.contains('app-ready'));
  const newer = await other.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    data.entries.find(e => e.id === 'today-1').what = '另一页的新原文';
    data.entries.push({ id: 'other-page-new', ts: '2026-06-27T07:00', what: '另一页独立新增', tags: ['睡觉'] });
    const raw = JSON.stringify(data);
    localStorage.setItem('timelog.v1', raw);
    return raw;
  });
  await expect(page.locator('#cross-tab-banner')).toBeVisible();
  await page.locator('#import-confirm-btn').click();
  await expect(page.locator('[data-role="import-error"]')).toContainText('本机数据或平移结果已变化');
  await expect(page.locator('#import-confirm-btn')).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(newer);
  await cards.nth(0).getByRole('button', { name: '保留本机', exact: true }).click();
  await cards.nth(1).getByRole('button', { name: '合并文字', exact: true }).click();
  await page.locator('#import-confirm-btn').click();
  await expect(page.locator('#form-sheet-title')).toHaveText('备份与导入');
  const final = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(final.find(e => e.id === 'today-1')).toMatchObject({ what: '另一页的新原文', ts: '2026-06-29T09:00', tags: ['求职推进'] });
  expect(final.find(e => e.id === 'today-2')).toMatchObject({ what: '改 bug\n\n合成备份同刻', ts: '2026-06-29T10:00', tags: ['求职推进'] });
  expect(final.find(e => e.id === 'other-page-new')).toMatchObject({ what: '另一页独立新增' });
  expect(final.find(e => e.id === 'incoming-new')).toEqual(incoming[2]);
  expect(new Set(final.map(e => e.ts)).size).toBe(final.length);
  await other.close();
});

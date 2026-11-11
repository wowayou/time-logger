// v1.7.1: a delayed picker-focus request must not interrupt user editing.
// Run the real controller callback in the selection-to-insert handoff. This is
// deterministic scheduling of an existing requestAnimationFrame, not a test-only
// runtime branch, a replaced input event, or a weakened storage assertion.
import { expect, test } from '@playwright/test';
import { boot, FIXED_NOW } from './ui_fixture.js';

const EVENING = '2026-06-29T20:30:00';

async function queuePickerFocus(trigger) {
  const count = await trigger.evaluate(el => {
    const raf = window.requestAnimationFrame;
    const callbacks = [];
    // Only hold frames requested during this synchronous toggle action. Restore
    // native rAF before Playwright or the browser performs any input operation.
    window.requestAnimationFrame = callback => {
      callbacks.push(callback);
      return callbacks.length;
    };
    try {
      el.focus();
      el.click();
    } finally {
      window.requestAnimationFrame = raf;
    }
    window.__pendingTimeFocus = callbacks;
    return callbacks.length;
  });
  expect(count).toBe(1);
}

async function deliverPickerFocus(page) {
  await page.evaluate(() => {
    for (const callback of window.__pendingTimeFocus.splice(0)) callback(performance.now());
  });
}

async function selectTimestamp(input) {
  await input.focus();
  await input.evaluate(el => el.select());
  await expect(input).toBeFocused();
  const selection = await input.evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, length: el.value.length }));
  expect(selection).toEqual({ start: 0, end: selection.length, length: selection.length });
}

test('queued new-picker focus cannot steal a selected timestamp before insert or change the backfill result', async ({ page }) => {
  await boot(page, 768, 'empty', false, EVENING);
  await page.locator('#add-btn').click();
  await page.locator('[data-action="toggle-start-time"]').click();
  await page.locator('[data-role="text"]').fill('2026-06-29 18:00');
  await page.locator('[data-role="text"]').blur();
  await page.locator('#form-what').fill('前一条合成记录');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  await page.getByRole('button', { name: '保存时间记录' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();

  await page.locator('#add-btn').click();
  await queuePickerFocus(page.locator('[data-action="toggle-start-time"]'));
  const input = page.locator('[data-role="start-time-section"] [data-role="text"]');
  await expect(input).toHaveValue('2026-06-29 20:30');
  await selectTimestamp(input);
  // This is the same boundary used by keyboard/paste and Playwright fill:
  // the editable text is selected, but native insertText has not run yet.
  await deliverPickerFocus(page);
  await expect(input).toBeFocused();
  await page.keyboard.insertText('2026-06-29 14:00');
  await input.blur();
  await expect(input).toHaveValue('2026-06-29 14:00');
  await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T14:00');
  await expect(page.locator('[data-role="start-time-label"]')).toHaveText('14:00');
  await expect(page.locator('[data-role="end-label"]')).toHaveText('18:00');
  await expect(page.locator('[data-role="duration-label"]')).toHaveText('4h');

  await page.locator('#form-what').fill('受控时序补录');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  await page.getByRole('button', { name: '保存时间记录' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries.find(e => e.what === '受控时序补录')).toMatchObject({ ts: '2026-06-29T14:00', tags: ['求职推进'] });
  expect(entries.find(e => e.what === '前一条合成记录')).toMatchObject({ ts: '2026-06-29T18:00', tags: ['求职推进'] });
  expect(entries.find(e => e.what === '' && e.ts === '2026-06-29T20:30')).toBeTruthy();
});

test('queued edit-picker focus cannot steal a selected start before insert or change the saved interval', async ({ page }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);
  await page.locator('.entry[data-id="today-1"] .e-what').click();
  await queuePickerFocus(page.locator('[data-action="toggle-edit-start-time"]'));
  const input = page.locator('[data-role="edit-start-wheel"] [data-role="text"]');
  await expect(input).toHaveValue('2026-06-29 09:00');
  await selectTimestamp(input);
  await deliverPickerFocus(page);
  await expect(input).toBeFocused();
  await page.keyboard.insertText('2026-06-29 09:10');
  await input.blur();
  await expect(input).toHaveValue('2026-06-29 09:10');
  await expect(page.locator('[data-role="edit-ts"]')).toHaveValue('2026-06-29T09:10');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries.find(e => e.id === 'today-1').ts).toBe('2026-06-29T09:10');
  expect(entries.find(e => e.id === 'today-2').ts).toBe('2026-06-29T10:00');
});

test('queued picker focus leaves a user-selected content field alone', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);
  await page.locator('#add-btn').click();
  await queuePickerFocus(page.locator('[data-action="toggle-start-time"]'));
  const what = page.locator('#form-what');
  await what.fill('用户已切到内容');
  await deliverPickerFocus(page);
  await expect(what).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('继续输入');
  await expect(what).toHaveValue('用户已切到内容\n继续输入');
  await expect(page.locator('#form-sheet')).toBeVisible();
});

test('queued picker focus still enters the picker when its original owner has not changed', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);
  await page.locator('#add-btn').click();
  const trigger = page.locator('[data-action="toggle-start-time"]');
  await queuePickerFocus(trigger);
  await expect(trigger).toBeFocused();
  await deliverPickerFocus(page);
  const calendar = page.locator('[data-role="start-time-section"] .dt-trigger');
  await expect(calendar).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-role="start-time-section"] .dt-pop')).toBeVisible();
});

test('queued picker focus does not transfer an obsolete request to a remounted picker', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);
  await page.locator('#add-btn').click();
  const trigger = page.locator('[data-action="toggle-start-time"]');
  await queuePickerFocus(trigger);
  await page.setViewportSize({ width: 390, height: 820 });
  await expect(page.locator('[data-role="start-time-section"] .wheel-col')).toHaveCount(3);
  await expect(trigger).toBeFocused();
  await deliverPickerFocus(page);
  await expect(trigger).toBeFocused();
  await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T00:00');
});

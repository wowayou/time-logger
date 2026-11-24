// v1.14.0 · 连点防穿透。
//
// 现象：390px 下双击「完成」——第一下保存并关闭表单，第二下落到正下方 header 的「···」，
// 顺手打开「更多」（v1_7_2_record_integrity R01 在 WebKit 上的概率性失败，v1.13.0 同样复现）。
// 减少动效时 sheet 同步隐藏，鼠标双击与触摸连点都必现；默认动效下取决于关闭兜底定时器与
// 第二下输入谁先被处理。
//
// 锁的是：关闭 sheet 的那一下之后 500ms 内、同一处（30px 内）的第二下——鼠标双击的第二击
// （detail≥2）或触摸连点——被吞掉；鼠标单击（detail 1）照常放行，关掉后立刻点同一处或别处
// 都是有意的，不能吞。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot } from './ui_fixture.js';

const moreSheet = page => page.locator('#form-sheet .form-sheet-panel[data-mode="more"]');

async function openFilledForm(page) {
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('合成连点保存');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
}

async function savedCount(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.filter(e => e.what === '合成连点保存').length);
}

async function doneCenter(page) {
  const box = await page.locator('#form-sheet [data-action="save-entry"]').boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('减少动效 + 鼠标双击「完成」：只保存一条，第二击不打开「更多」', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page, 390, 'empty', false, FIXED_NOW);
  await openFilledForm(page);
  await page.locator('[data-action="save-entry"]').dblclick();
  await expect(page.locator('#form-sheet')).toBeHidden();
  await expect(moreSheet(page)).toHaveCount(0);
  expect(await savedCount(page)).toBe(1);
});

test('默认动效 + 鼠标双击「完成」：只保存一条，表单关闭后不残留任何面板', async ({ page }) => {
  await boot(page, 390, 'empty', false, FIXED_NOW);
  await openFilledForm(page);
  await page.locator('[data-action="save-entry"]').dblclick();
  await expect(page.locator('#form-sheet')).toBeHidden();
  await expect(moreSheet(page)).toHaveCount(0);
  expect(await savedCount(page)).toBe(1);
});

test.describe('触摸', () => {
  test.use({ hasTouch: true });

  test('减少动效 + 手指连点两下「完成」：只保存一条，第二下不打开「更多」', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page, 390, 'empty', false, FIXED_NOW);
    await openFilledForm(page);
    const { x, y } = await doneCenter(page);
    await page.touchscreen.tap(x, y);
    await page.touchscreen.tap(x + 4, y + 3);
    await expect(page.locator('#form-sheet')).toBeHidden();
    await expect(moreSheet(page)).toHaveCount(0);
    expect(await savedCount(page)).toBe(1);
  });
});

test('哨兵：保存后立刻用鼠标单击同一处（「···」），照常打开「更多」', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page, 390, 'empty', false, FIXED_NOW);
  await openFilledForm(page);
  const { x, y } = await doneCenter(page);
  await page.mouse.click(x, y);
  await expect(page.locator('#form-sheet')).toBeHidden();
  await page.mouse.click(x, y);
  await expect(moreSheet(page)).toBeVisible();
  expect(await savedCount(page)).toBe(1);
});

test('哨兵：取消表单后立刻点别处（「记一条」），照常打开新表单', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page, 390, 'empty', false, FIXED_NOW);
  await page.locator('#add-btn').click();
  await page.getByRole('button', { name: '取消新增记录' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  await page.locator('#add-btn').click();
  await expect(page.locator('#form-sheet .form-sheet-panel[data-mode="new"]')).toBeVisible();
});

// v1.5.0：自定义标签撞上**别的桶**已登记的同名标签时，保存前必须看得见。
//
// 真机反馈：主线里已有「阅读」，新记录在「维持」里敲「阅读」，灰字提示仍是「自定义标签
// 将归入『维持』」，保存后记录静默记进主线。「已登记标签从不因录入改桶」（v30，
// storage.addChipTag）这条规则不变——变的是提示判据：旧判据只查 chip、且逐字相等，
// 主线同名与大小写变体都漏掉。本组用例锁：醒目归属提醒 + 一键改选 + 联想按所选桶 +
// 同桶/新名不误报。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot } from './ui_fixture.js';

async function seedConfig(page, config) {
  await page.evaluate(value => localStorage.setItem('timelog.config', JSON.stringify(value)), { version: 1, ...config });
}

const READING_IN_MAINLINE = {
  mainline: ['求职推进', '阅读'],
  chips: [{ name: '睡觉', bucket: 'maintain', longOk: true }, { name: '刷手机', bucket: 'leak', longOk: false }]
};

test('v1.5.0: a mainline name typed under 维持 shows the owner warning, and 改选主线 picks the existing chip', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await seedConfig(page, READING_IN_MAINLINE);
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('读书');
  await page.locator('[data-action="pick-form-bucket"][data-bucket="maintain"]').click();
  await page.locator('#form-ctag').fill('阅读');

  const warn = page.locator('[data-role="tag-bucket-warn"]');
  await expect(warn).toBeVisible();
  await expect(warn).toHaveAttribute('data-b', 'job');
  await expect(warn).toContainText('「阅读」已是主线标签');
  await expect(warn).toContainText('不会记入维持');
  // 灰字「将归入维持」与醒目提醒互斥，不能同时说两件相反的事。
  await expect(page.locator('[data-role="mainline-hint"]')).toBeHidden();
  // 维持一栏里冒出一个主线色的草稿 chip。
  await expect(page.locator('#form-chips .chip-draft')).toHaveClass(/chip-job/);

  await page.getByRole('button', { name: '改为选择主线里已有的「阅读」' }).click();
  await expect(page.locator('[data-role="form-bucket-seg"] button.active')).toHaveText('主线');
  await expect(page.locator('#form-chips .chip.sel')).toHaveText('阅读');
  await expect(page.locator('#form-ctag')).toHaveValue('');
  await expect(warn).toBeHidden();
  await expect(page.locator('[data-role="mainline-hint"]')).toBeVisible();

  await page.locator('#form-sheet .sh-done').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  const saved = await page.evaluate(() => ({
    entry: JSON.parse(localStorage.getItem('timelog.v1')).entries.find(e => e.what === '读书'),
    config: JSON.parse(localStorage.getItem('timelog.config'))
  }));
  expect(saved.entry.tags).toEqual(['阅读']);
  expect(saved.config.chips.some(chip => chip.name === '阅读')).toBe(false);
  expect(errors).toEqual([]);
});

test('v1.5.0: saving through the warning keeps the old rule — the existing bucket wins, config is untouched', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await seedConfig(page, READING_IN_MAINLINE);
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('读书');
  await page.locator('[data-action="pick-form-bucket"][data-bucket="maintain"]').click();
  await page.locator('#form-ctag').fill('阅读');
  await expect(page.locator('[data-role="tag-bucket-warn"]')).toBeVisible();
  await page.locator('#form-sheet .sh-done').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  const config = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.config')));
  expect(config.mainline).toEqual(['求职推进', '阅读']);
  expect(config.chips.map(chip => chip.name)).toEqual(['睡觉', '刷手机']);
});

test('v1.5.0: the owner check is case-insensitive and names the canonical spelling', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await seedConfig(page, { mainline: ['求职推进'], chips: [{ name: 'Reading', bucket: 'leak', longOk: false }] });
  await page.locator('#add-btn').click();
  await page.locator('[data-action="pick-form-bucket"][data-bucket="maintain"]').click();
  await page.locator('#form-ctag').fill('reading');
  const warn = page.locator('[data-role="tag-bucket-warn"]');
  await expect(warn).toBeVisible();
  await expect(warn).toHaveAttribute('data-b', 'leak');
  await expect(warn).toContainText('「Reading」已是偏航标签');
});

test('v1.5.0: no false alarm for a same-bucket name or a brand-new name', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await seedConfig(page, READING_IN_MAINLINE);
  await page.locator('#add-btn').click();
  const warn = page.locator('[data-role="tag-bucket-warn"]');
  const hint = page.locator('[data-role="mainline-hint"]');
  await page.locator('[data-action="pick-form-bucket"][data-bucket="job"]').click();
  await page.locator('#form-ctag').fill('阅读');
  await expect(warn).toBeHidden();
  await expect(hint).toBeVisible();
  await page.locator('[data-action="pick-form-bucket"][data-bucket="maintain"]').click();
  await page.locator('#form-ctag').fill('冥想');
  await expect(warn).toBeHidden();
  await expect(hint).toContainText('维持');
  // 切桶会清空自定义输入，提醒随之消失，不留悬空态。
  await page.locator('#form-ctag').fill('阅读');
  await expect(warn).toBeVisible();
  await page.locator('[data-action="pick-form-bucket"][data-bucket="leak"]').click();
  await expect(page.locator('#form-ctag')).toHaveValue('');
  await expect(warn).toBeHidden();
});

test('v1.5.0: tag suggestions follow the picked bucket instead of always listing mainline names', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await seedConfig(page, READING_IN_MAINLINE);
  await page.locator('#add-btn').click();
  const options = () => page.locator('#tag-suggestions option').evaluateAll(els => els.map(el => el.value));
  await page.locator('[data-action="pick-form-bucket"][data-bucket="maintain"]').click();
  expect(await options()).toEqual(['睡觉']);
  await page.locator('[data-action="pick-form-bucket"][data-bucket="leak"]').click();
  expect(await options()).toEqual(['刷手机']);
  await page.locator('[data-action="pick-form-bucket"][data-bucket="job"]').click();
  expect(await options()).toEqual(['求职推进', '阅读']);
});

test('v1.5.0: the edit sheet warns the same way', async ({ page }) => {
  await boot(page, 390, 'three-labels', false, FIXED_NOW);
  await seedConfig(page, { mainline: ['求职推进', '阅读'], chips: [{ name: '睡觉', bucket: 'maintain', longOk: true }, { name: '吃饭', bucket: 'maintain', longOk: false }] });
  await page.locator('.entry[data-id="tl-c"] .e-what').click();
  await expect(page.locator('[data-role="edit-bucket-seg"] button.active')).toHaveText('维持');
  await page.locator('[data-role="edit-custom-tag"]').fill('阅读');
  const warn = page.locator('[data-role="tag-bucket-warn"]');
  await expect(warn).toBeVisible();
  await expect(warn).toContainText('不会记入维持');
  await warn.locator('[data-action="adopt-tag-bucket"]').click();
  await expect(page.locator('[data-role="edit-bucket-seg"] button.active')).toHaveText('主线');
  await expect(page.locator('[data-role="edit-chips"] .chip.sel')).toHaveText('阅读');
});

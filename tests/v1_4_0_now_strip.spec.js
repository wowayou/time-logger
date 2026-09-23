// v1.4.0：日视图「现在」条——把「正在做：X · 已 Ymin」提到 hero 与时间轴之间一眼
// 可见。R2 方案 1 的最小落地（gate 已由维护者裁定解锁）。核心判据：只对**今天、且尾
// 段是非空 what 的已发生段**显示；未记录尾段沿用 FAB「续 X 起」入口、不显示本条；周/月/
// 年视图整块隐藏；点整条＝编辑该段。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot } from './ui_fixture.js';

test('v1.4.0: an ongoing real segment shows 正在做 X · 已 Ymin with its bucket color', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  // ongoing-tail：今天 10:00 起一条「进行中的事」（求职推进＝主线/job），FIXED_NOW
  // 是 12:34，尾段进行中。
  await boot(page, 390, 'ongoing-tail', false, FIXED_NOW);
  const strip = page.locator('#now-strip');
  await expect(strip).toBeVisible();
  await expect(strip.locator('.now-label')).toHaveText('正在做');
  await expect(strip.locator('.now-what')).toHaveText('进行中的事');
  // 时长复用 dur.ongoing＝「已 X」，与 FAB 副文案同语。
  await expect(strip.locator('.now-dur')).toContainText('已');
  // 桶色竖脊沿用 .entry 的 data-b→--rail 语法（求职推进＝主线）。
  await expect(strip).toHaveAttribute('data-b', 'job');
  expect(errors).toEqual([]);
});

test('v1.4.0: tapping the strip opens the edit sheet for that ongoing entry', async ({ page }) => {
  await boot(page, 390, 'ongoing-tail', false, FIXED_NOW);
  await page.locator('#now-strip').click();
  // 进了编辑既有记录的二级页：删除按钮只在编辑已存在记录时出现。
  await expect(page.getByRole('button', { name: '删除这条记录' })).toBeVisible();
  await expect(page.locator('#form-sheet')).toContainText('进行中的事');
});

test('v1.4.0: an unrecorded tail does NOT show the strip (FAB 续 X 起 already covers it)', async ({ page }) => {
  // tail-placeholder：09:00 一条真实记录 + 10:00 起一条空占位尾段。当前段＝未记录占位，
  // 不是「正在做某事」——本条不显示，避免与 FAB「续 X 起」三重冗余。
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await expect(page.locator('#now-strip')).toBeHidden();
});

test('v1.4.0: the strip is hidden outside the day view', async ({ page }) => {
  await boot(page, 390, 'ongoing-tail', false, FIXED_NOW);
  await expect(page.locator('#now-strip')).toBeVisible();
  await page.locator('[data-action="view"][data-view="week"]').click();
  await expect(page.locator('#now-strip')).toBeHidden();
  await page.locator('[data-action="view"][data-view="day"]').click();
  await expect(page.locator('#now-strip')).toBeVisible();
});

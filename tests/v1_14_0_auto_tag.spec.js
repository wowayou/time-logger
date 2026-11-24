// v1.14.0 · 正文自动选标签。
//
// 锁的是：新建表单里「做了什么」与已登记标签同名（规整后、大小写不敏感），或与以前记过的
// 某件事完全相同时，自动选中那个标签（必要时切到它的桶），正文框下说明为什么、可一键「不选」；
// 继续打字不再匹配时撤回（桶回到原来）；用户亲手点过 chip、敲过自定义标签或点过「不选」后
// 不再自动改；亲手切过桶后只在该桶里自动选、不替用户换桶；编辑表单不自动改；补录预览跟着变。
// 另锁自定义标签只差大小写时点亮已登记 chip、不再画草稿。
//
// 夹具 tail-placeholder + FIXED_NOW：今天 09:00「写代码」#求职推进 + 10:00 占位，默认桶＝主线；
// config 为夹具钉死的「求职推进 / 睡觉 吃饭 … / 娱乐 刷手机 发呆」。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot, expectNoHorizontalOverflow } from './ui_fixture.js';
import { bootLocale } from './i18n_fixture.js';

const note = page => page.locator('#form-sheet [data-role="auto-tag-note"]');
const bucketBtn = (page, bucket) => page.locator(`[data-action="pick-form-bucket"][data-bucket="${bucket}"]`);
const chip = (page, name) => page.locator(`#form-chips .chip[data-tag="${name}"]`);
const pressedChips = page => page.locator('#form-chips .chip[aria-pressed="true"]');

async function seedConfig(page, config) {
  await page.evaluate(value => localStorage.setItem('timelog.config', JSON.stringify(value)), { version: 1, ...config });
}

async function savedEntry(page, what) {
  return page.evaluate(text => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(e => e.what === text), what);
}

test('正文与已有标签同名：自动选中并切到它的桶，说明原因，保存记入该标签', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await page.locator('#add-btn').click();
  await expect(bucketBtn(page, 'job')).toHaveAttribute('aria-pressed', 'true');
  await expect(note(page)).toBeHidden();

  await page.locator('#form-what').fill('刷手机');
  await expect(bucketBtn(page, 'leak')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, '刷手机')).toHaveAttribute('aria-pressed', 'true');
  await expect(note(page)).toBeVisible();
  await expect(note(page)).toHaveAttribute('data-b', 'leak');
  await expect(note(page)).toContainText('已选中 #刷手机（偏航）：与已有标签同名');
  await expect(note(page).locator('[data-action="clear-auto-tag"]')).toHaveAttribute('aria-label', '不选标签 #刷手机');

  await page.locator('#form-sheet .sh-done').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  expect((await savedEntry(page, '刷手机')).tags).toEqual(['刷手机']);
  expect(errors).toEqual([]);
});

test('与以前记过的事完全相同：选中它上次的标签；同名比较不分大小写与首尾空白', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await seedConfig(page, { mainline: ['求职推进'], chips: [{ name: 'Sleep', bucket: 'maintain', longOk: true }] });
  await page.locator('#add-btn').click();
  const what = page.locator('#form-what');

  await what.fill(' 写代码 ');
  await expect(chip(page, '求职推进')).toHaveAttribute('aria-pressed', 'true');
  await expect(note(page)).toContainText('已选中 #求职推进（主线）：上次记这件事用的标签');

  await what.fill('SLEEP');
  await expect(bucketBtn(page, 'maintain')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, 'Sleep')).toHaveAttribute('aria-pressed', 'true');
  await expect(pressedChips(page)).toHaveCount(1);
  await expect(note(page)).toContainText('已选中 #Sleep（维持）：与已有标签同名');

  await page.locator('#form-sheet .sh-done').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  expect((await savedEntry(page, 'SLEEP')).tags).toEqual(['Sleep']);
});

test('继续打字不再匹配时撤回：桶回到原来、chip 取消、提示消失；换成别的匹配就跟着换', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await page.locator('#add-btn').click();
  const what = page.locator('#form-what');

  await what.fill('睡觉');
  await expect(chip(page, '睡觉')).toHaveAttribute('aria-pressed', 'true');
  await what.fill('刷手机');
  await expect(bucketBtn(page, 'leak')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, '刷手机')).toHaveAttribute('aria-pressed', 'true');
  await expect(pressedChips(page)).toHaveCount(1);

  // 以标签名开头的更长正文不算同名。
  await what.fill('刷手机好久');
  await expect(bucketBtn(page, 'job')).toHaveAttribute('aria-pressed', 'true');
  await expect(pressedChips(page)).toHaveCount(0);
  await expect(note(page)).toBeHidden();

  await page.locator('#form-sheet .sh-done').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  expect((await savedEntry(page, '刷手机好久')).tags).toEqual(['未知']);
});

test('亲手选过标签后不再自动改；亲手切过桶后只在该桶里自动选', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await page.locator('#add-btn').click();
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  await page.locator('#form-what').fill('刷手机');
  await expect(bucketBtn(page, 'job')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, '求职推进')).toHaveAttribute('aria-pressed', 'true');
  await expect(note(page)).toBeHidden();
  await page.locator('#form-sheet .sh-done').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  expect((await savedEntry(page, '刷手机')).tags).toEqual(['求职推进']);

  await page.locator('#add-btn').click();
  await bucketBtn(page, 'maintain').click();
  const what = page.locator('#form-what');
  await what.fill('刷手机');
  await expect(bucketBtn(page, 'maintain')).toHaveAttribute('aria-pressed', 'true');
  await expect(pressedChips(page)).toHaveCount(0);
  await expect(note(page)).toBeHidden();
  await what.fill('睡觉');
  await expect(chip(page, '睡觉')).toHaveAttribute('aria-pressed', 'true');
  await expect(note(page)).toBeVisible();
});

test('「不选」撤回自动选择、焦点回到正文，此后不再自动选；点亮的 chip 点掉也一样', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await page.locator('#add-btn').click();
  const what = page.locator('#form-what');
  await what.fill('刷手机');
  await page.getByRole('button', { name: '不选标签 #刷手机' }).click();
  await expect(bucketBtn(page, 'job')).toHaveAttribute('aria-pressed', 'true');
  await expect(pressedChips(page)).toHaveCount(0);
  await expect(note(page)).toBeHidden();
  await expect(what).toBeFocused();
  await what.fill('睡觉');
  await expect(pressedChips(page)).toHaveCount(0);
  await expect(note(page)).toBeHidden();

  await page.getByRole('button', { name: '取消新增记录' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  await page.locator('#add-btn').click();
  await what.fill('刷手机');
  await chip(page, '刷手机').click();
  await expect(chip(page, '刷手机')).toHaveAttribute('aria-pressed', 'false');
  await expect(note(page)).toBeHidden();
  await what.fill('睡觉');
  await expect(pressedChips(page)).toHaveCount(0);
});

test('自定义标签只差大小写：点亮已登记的 chip，不另画草稿，保存用登记拼写', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await seedConfig(page, { mainline: ['求职推进'], chips: [{ name: 'Sleep', bucket: 'maintain', longOk: true }] });
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('午睡');
  await bucketBtn(page, 'maintain').click();
  await page.locator('#form-ctag').fill('sleep');
  await expect(chip(page, 'Sleep')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#form-chips .chip-draft')).toHaveCount(0);
  await page.locator('#form-sheet .sh-done').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  const saved = await page.evaluate(() => ({
    entry: JSON.parse(localStorage.getItem('timelog.v1')).entries.find(e => e.what === '午睡'),
    chips: JSON.parse(localStorage.getItem('timelog.config')).chips.map(c => c.name)
  }));
  expect(saved.entry.tags).toEqual(['Sleep']);
  expect(saved.chips).toEqual(['Sleep']);
});

test('编辑表单改正文不自动改标签', async ({ page }) => {
  await boot(page, 390, 'three-labels', false, FIXED_NOW);
  await page.locator('.entry[data-id="tl-c"] .e-what').click();
  await page.locator('[data-role="edit-what"]').fill('刷手机');
  await expect(page.locator('[data-role="edit-bucket-seg"] button.active')).toHaveText('维持');
  await expect(page.locator('[data-role="edit-chips"] .chip.sel')).toHaveText('吃饭');
  await expect(note(page)).toHaveCount(0);
});

test('补录：自动选中的标签同步到切分预览', async ({ page }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);
  await page.locator('.entry.gap[data-action="backfill-seg"]').first().click();
  const newPart = page.locator('[data-role="cut-bar"] .cut-new');
  await expect(newPart).toHaveAttribute('data-b', 'pending');
  await page.locator('#form-what').fill('刷手机');
  await expect(newPart).toHaveAttribute('data-b', 'leak');
  await page.getByRole('button', { name: '不选标签 #刷手机' }).click();
  await expect(newPart).toHaveAttribute('data-b', 'pending');
});

test('320px：提示行不溢出、不压正文框，「不选」的命中区在行内', async ({ page }) => {
  await boot(page, 320, 'tail-placeholder', false, FIXED_NOW);
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('运动健康');
  await expect(note(page)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const geo = await page.evaluate(() => {
    const ta = document.querySelector('#form-what').getBoundingClientRect();
    const box = document.querySelector('[data-role="auto-tag-note"]');
    const nb = box.getBoundingClientRect();
    const btn = box.querySelector('[data-action="clear-auto-tag"]');
    const bb = btn.getBoundingClientRect();
    const cx = bb.left + bb.width / 2;
    const cy = bb.top + bb.height / 2;
    const hit = y => document.elementFromPoint(cx, y) === btn;
    return {
      gap: nb.top - ta.bottom,
      height: nb.height,
      noteInsidePanel: nb.right <= document.querySelector('#form-sheet .form-sheet-panel').getBoundingClientRect().right + 0.5,
      hitAbove: hit(cy - 18),
      hitBelow: hit(cy + 18),
      textareaBottomIsTextarea: document.elementFromPoint(ta.left + ta.width / 2, ta.bottom - 2) === document.querySelector('#form-what')
    };
  });
  expect(geo.gap).toBeGreaterThanOrEqual(0);
  expect(geo.height).toBeGreaterThanOrEqual(44);
  expect(geo.noteInsidePanel).toBe(true);
  expect(geo.hitAbove && geo.hitBelow).toBe(true);
  expect(geo.textareaBottomIsTextarea).toBe(true);
});

test('English: the note and Clear button are translated', async ({ page }) => {
  await bootLocale(page, { locale: 'en' });
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('phone');
  await expect(page.locator('#form-chips .chip[data-tag="Phone"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(note(page)).toContainText('Picked #Phone (Drift): same name as an existing tag');
  await expect(page.getByRole('button', { name: 'Clear tag #Phone' })).toHaveText('Clear');
});

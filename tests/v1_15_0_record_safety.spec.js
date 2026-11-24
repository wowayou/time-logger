// v1.15.0 · 记录防错：新建草稿不丢、未选标签提示（v1.15.0 的「新建保存可撤销」v1.15.1 去掉）。
//
// 锁的是：
// ① 点取消/遮罩/Esc 关掉新建表单，没保存的正文与标签选择只留在内存，同一页面再打开同一种
//    新建表单时填回并显示「已恢复上次没保存的内容 · 清空」；关闭不写任何存储；保存即作废；
//    草稿只回到同一种表单（普通新建 / 同一段补录）；超过 1 小时不恢复；标签已删只填正文。
// ② v1.15.1 维护者要求去掉新建撤销：新建记录（普通、计划、补录）保存后不出撤销横幅，
//    顺带登记的新标签留在 config 里；撤销窗口只属于删除（删除撤销由既有用例守）。
// ③ 写了正文却没选标签时，标签区提示会记为「未知」、计入未记录；选了标签即消失，不拦保存。
//
// 夹具 tail-placeholder + FIXED_NOW：今天 09:00「写代码」#求职推进 + 10:00 占位，默认桶＝主线。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot } from './ui_fixture.js';
import { bootLocale } from './i18n_fixture.js';

const what = page => page.locator('#form-what');
const draftNote = page => page.locator('#form-sheet [data-role="draft-note"]');
const noTagHint = page => page.locator('#form-sheet [data-role="no-tag-hint"]');
const bucketBtn = (page, bucket) => page.locator(`[data-action="pick-form-bucket"][data-bucket="${bucket}"]`);
const chip = (page, name) => page.locator(`#form-chips .chip[data-tag="${name}"]`);
const undoToast = page => page.locator('#undo-toast');
const rawAll = page => page.evaluate(() => ['timelog.v1', 'timelog.config', 'timelog.quotes'].map(key => localStorage.getItem(key)));
const entries = page => page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);

async function cancelForm(page) {
  await page.getByRole('button', { name: '取消新增记录' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
}

test('① 取消后再打开：正文与标签选择原样恢复，关闭不写存储；保存后草稿作废', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  const before = await rawAll(page);
  await page.locator('#add-btn').click();
  await expect(draftNote(page)).toBeHidden();
  await what(page).fill('合成草稿正文\n第二行');
  await bucketBtn(page, 'maintain').click();
  await chip(page, '吃饭').click();
  await cancelForm(page);
  expect(await rawAll(page)).toEqual(before);

  await page.locator('#add-btn').click();
  await expect(what(page)).toHaveValue('合成草稿正文\n第二行');
  await expect(bucketBtn(page, 'maintain')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, '吃饭')).toHaveAttribute('aria-pressed', 'true');
  await expect(draftNote(page)).toBeVisible();
  await expect(draftNote(page)).toContainText('已恢复上次没保存的内容');

  await page.locator('#form-sheet .sh-done').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  expect((await entries(page)).find(e => e.what === '合成草稿正文\n第二行').tags).toEqual(['吃饭']);
  await page.locator('#add-btn').click();
  await expect(what(page)).toHaveValue('');
  await expect(draftNote(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test('① 遮罩与 Esc 关闭同样保留；「清空」回到默认桶、焦点回正文，之后关再开是空的', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await page.locator('#add-btn').click();
  await what(page).fill('合成遮罩草稿');
  await bucketBtn(page, 'leak').click();
  await page.locator('#form-sheet .form-sheet-backdrop').click({ position: { x: 10, y: 10 } });
  await expect(page.locator('#form-sheet')).toBeHidden();
  await page.locator('#add-btn').click();
  await expect(what(page)).toHaveValue('合成遮罩草稿');
  await expect(bucketBtn(page, 'leak')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#form-sheet')).toBeHidden();
  await page.locator('#add-btn').click();
  await expect(what(page)).toHaveValue('合成遮罩草稿');

  await page.getByRole('button', { name: '清空恢复的草稿' }).click();
  await expect(what(page)).toHaveValue('');
  await expect(what(page)).toBeFocused();
  await expect(bucketBtn(page, 'job')).toHaveAttribute('aria-pressed', 'true');
  await expect(draftNote(page)).toBeHidden();
  await cancelForm(page);
  await page.locator('#add-btn').click();
  await expect(what(page)).toHaveValue('');
});

test('① 自定义标签与自动选标签也随草稿恢复', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await page.locator('#add-btn').click();
  await what(page).fill('合成自定义草稿');
  await bucketBtn(page, 'maintain').click();
  await page.locator('#form-ctag').fill('合成冥想');
  await cancelForm(page);
  await page.locator('#add-btn').click();
  await expect(page.locator('#form-ctag')).toHaveValue('合成冥想');
  await expect(page.locator('#form-chips .chip-draft')).toHaveText('合成冥想');
  await page.getByRole('button', { name: '清空恢复的草稿' }).click();

  await what(page).fill('刷手机');
  await expect(chip(page, '刷手机')).toHaveAttribute('aria-pressed', 'true');
  await cancelForm(page);
  await page.locator('#add-btn').click();
  await expect(chip(page, '刷手机')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#form-sheet [data-role="auto-tag-note"]')).toContainText('已选中 #刷手机');
});

test('① 草稿只回到同一种表单；超过 1 小时不恢复；标签已删只恢复正文', async ({ page }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);
  await page.locator('#add-btn').click();
  await what(page).fill('合成普通草稿');
  await cancelForm(page);
  // 补录表单不出现普通新建的草稿，也不把它冲掉。
  await page.locator('.entry.gap[data-action="backfill-seg"]').first().click();
  await expect(what(page)).toHaveValue('');
  await expect(draftNote(page)).toBeHidden();
  await cancelForm(page);
  await page.locator('#add-btn').click();
  await expect(what(page)).toHaveValue('合成普通草稿');
  await cancelForm(page);

  await page.evaluate(() => window.__setFixedNow('2026-06-29T13:36:00'));
  await page.locator('#add-btn').click();
  await expect(what(page)).toHaveValue('');
  await expect(draftNote(page)).toBeHidden();

  await bucketBtn(page, 'maintain').click();
  await chip(page, '吃饭').click();
  await what(page).fill('合成标签被删');
  await cancelForm(page);
  await page.evaluate(() => {
    const config = JSON.parse(localStorage.getItem('timelog.config'));
    config.chips = config.chips.filter(c => c.name !== '吃饭');
    localStorage.setItem('timelog.config', JSON.stringify(config));
  });
  await page.locator('#add-btn').click();
  await expect(what(page)).toHaveValue('合成标签被删');
  await expect(page.locator('#form-chips .chip[aria-pressed="true"]')).toHaveCount(0);
  const config = await page.evaluate(() => localStorage.getItem('timelog.config'));
  expect(config).not.toContain('吃饭');
});

// 否定断言用一次性读取，不用带自动重试的 toBeHidden()：撤销横幅会自己消失（8 秒、或做
// 别的事即收起），重试会等它过期再判过。提交是同步的——表单收起时横幅若要出现已经出现了。
async function expectNoUndoBanner(page) {
  expect(await undoToast(page).isVisible()).toBe(false);
}

test('② 新建保存（普通、计划、补录）不出撤销横幅，顺带登记的新标签留在 config 里', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await page.locator('#add-btn').click();
  await what(page).fill('合成普通保存');
  await bucketBtn(page, 'maintain').click();
  await page.locator('#form-ctag').fill('合成冥想');
  await page.locator('#form-sheet .sh-done').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  await expectNoUndoBanner(page);
  expect((await entries(page)).find(e => e.what === '合成普通保存').tags).toEqual(['合成冥想']);
  expect(await page.evaluate(() => localStorage.getItem('timelog.config'))).toContain('合成冥想');

  await page.locator('#add-btn').click();
  await page.getByRole('button', { name: '记录计划中' }).click();
  await what(page).fill('合成计划保存');
  await bucketBtn(page, 'job').click();
  await chip(page, '求职推进').click();
  await page.locator('#form-sheet .sh-done').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  await expectNoUndoBanner(page);
  expect((await entries(page)).some(e => e.what === '合成计划保存' && e.planned)).toBe(true);

  await boot(page, 768, 'two-records', false, FIXED_NOW);
  await page.locator('.entry.gap[data-action="backfill-seg"]').first().click();
  await what(page).fill('合成补录保存');
  await bucketBtn(page, 'job').click();
  await chip(page, '求职推进').click();
  await page.locator('#form-sheet .sh-done').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  await expectNoUndoBanner(page);
  expect((await entries(page)).some(e => e.what === '合成补录保存')).toBe(true);
});

test('③ 写了正文却没选标签时提示会记为未知；选了标签、填了自定义标签或自动选中后消失', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await page.locator('#add-btn').click();
  await expect(noTagHint(page)).toBeHidden();
  await what(page).fill('合成没选标签');
  await expect(noTagHint(page)).toBeVisible();
  await expect(noTagHint(page)).toHaveText('还没选标签：这条会记为「未知」，计入未记录。');
  await chip(page, '求职推进').click();
  await expect(noTagHint(page)).toBeHidden();
  await chip(page, '求职推进').click();
  await expect(noTagHint(page)).toBeVisible();
  await page.locator('#form-ctag').fill('合成新标签');
  await expect(noTagHint(page)).toBeHidden();
  await page.locator('#form-ctag').fill('');
  await expect(noTagHint(page)).toBeVisible();
  await what(page).fill('刷手机');
  await expect(noTagHint(page)).toBeVisible();
  // 亲手动过自定义标签后不再自动选，所以这里仍提示；新开一张表单验证自动选中时不提示。
  await cancelForm(page);
  await page.locator('#add-btn').click();
  await page.getByRole('button', { name: '清空恢复的草稿' }).click();
  await what(page).fill('刷手机');
  await expect(chip(page, '刷手机')).toHaveAttribute('aria-pressed', 'true');
  await expect(noTagHint(page)).toBeHidden();
});

test('③ 编辑表单取消已选标签时同样提示，不拦保存', async ({ page }) => {
  await boot(page, 390, 'three-labels', false, FIXED_NOW);
  await page.locator('.entry[data-id="tl-c"] .e-what').click();
  await expect(noTagHint(page)).toBeHidden();
  await page.locator('[data-role="edit-chips"] .chip.sel').click();
  await expect(noTagHint(page)).toBeVisible();
  await page.locator('#form-sheet [data-action="commit-edit"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  expect((await entries(page)).find(e => e.id === 'tl-c').tags).toEqual(['未知']);
});

test('English: draft note and no-tag hint are translated', async ({ page }) => {
  await bootLocale(page, { locale: 'en' });
  await page.locator('#add-btn').click();
  await what(page).fill('Synthetic draft');
  await expect(noTagHint(page)).toHaveText('No tag picked: this will be saved as "Unknown" and count as Unlogged.');
  await page.locator('#form-sheet .sh-cancel').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  await page.locator('#add-btn').click();
  await expect(draftNote(page)).toContainText('Restored what you had not saved');
});

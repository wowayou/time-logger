// v1.10.0 ·「做了什么」联想。
//
// 锁的是：新建表单里输入至少一个字才联想（最多三条历史事项）；点一下填入正文并选回它
// 上次用的、仍登记在标签设置里的标签（先切桶再点 chip，与手动同一条路径）；标签已不在
// 设置里只填正文；选定后收起；空输入/与输入完全相同不推荐；编辑表单没有联想；窄屏不溢出。
//
// 夹具 analytics-weeks + 周三 14:00：历史里有「写代码」#求职推进（主线）与「睡觉」#睡觉（维持）。
import { expect, test } from '@playwright/test';
import { boot, expectNoHorizontalOverflow } from './ui_fixture.js';

const WED_NOW = '2026-06-24T14:00:00';
const box = page => page.locator('#form-sheet [data-role="what-suggest"]');
const sugs = page => page.locator('#form-sheet .what-sug');

test('输入一个字就联想；点一下填入正文并选回原标签，保存后记录正确', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  await page.locator('#add-btn').click();
  await expect(box(page)).toBeHidden();

  // 先切到「维持」，验证选中联想后会切回它真正的桶。
  await page.locator('[data-action="pick-form-bucket"][data-bucket="maintain"]').click();
  await page.locator('#form-what').click();
  await page.keyboard.type('写');
  await expect(box(page)).toBeVisible();
  await expect(sugs(page)).toHaveCount(1);
  await expect(sugs(page).first()).toHaveText('写代码#求职推进');
  await expect(sugs(page).first()).toHaveAttribute('aria-label', '填入「写代码」，标签 #求职推进');

  await sugs(page).first().click();
  await expect(page.locator('#form-what')).toHaveValue('写代码');
  await expect(page.locator('#form-what')).toBeFocused();
  await expect(box(page)).toBeHidden();
  await expect(page.locator('[data-action="pick-form-bucket"][data-bucket="job"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#form-chips .chip[data-tag="求职推进"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#form-sheet [data-action="save-entry"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.filter(e => e.ts.startsWith('2026-06-24') && e.what === '写代码'));
  expect(saved.length).toBe(2);
  expect(saved.every(e => e.tags[0] === '求职推进')).toBe(true);
  expect(errors).toEqual([]);
});

test('空输入、与历史完全相同或无匹配时不出联想；继续打字会重新联想', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  await page.locator('#add-btn').click();
  const what = page.locator('#form-what');
  await what.fill('写代码');
  await expect(box(page)).toBeHidden();
  await what.fill('   ');
  await expect(box(page)).toBeHidden();
  await what.fill('完全没有出现过');
  await expect(box(page)).toBeHidden();
  await what.fill('睡');
  await expect(sugs(page)).toHaveCount(1);
  await expect(sugs(page).first()).toContainText('睡觉');
});

test('上次的标签已不在标签设置里时只填正文，不替用户新建或改桶', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  await page.addInitScript(() => {
    const d = JSON.parse(localStorage.getItem('timelog.v1'));
    d.entries.push({ id: 'old-tag', ts: '2026-06-23T20:00', what: '读一本旧书', tags: ['已删除的标签'] });
    d.entries.sort((a, b) => (a.ts < b.ts ? -1 : 1));
    localStorage.setItem('timelog.v1', JSON.stringify(d));
  });
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  await page.locator('#add-btn').click();
  const bucketBefore = await page.locator('[data-action="pick-form-bucket"][aria-pressed="true"]').getAttribute('data-bucket');
  await page.locator('#form-what').fill('旧书');
  await expect(sugs(page).first()).toContainText('#已删除的标签');
  await sugs(page).first().click();
  await expect(page.locator('#form-what')).toHaveValue('读一本旧书');
  await expect(page.locator('[data-action="pick-form-bucket"][aria-pressed="true"]')).toHaveAttribute('data-bucket', bucketBefore);
  await expect(page.locator('#form-chips .chip[aria-pressed="true"]')).toHaveCount(0);
  const config = await page.evaluate(() => localStorage.getItem('timelog.config'));
  expect(config).not.toContain('已删除的标签');
});

test('编辑表单没有联想', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  await page.locator('.log .entry[data-action]').first().click();
  await expect(page.locator('#form-sheet [data-role="edit-what"]')).toBeVisible();
  await expect(page.locator('#form-sheet [data-role="what-suggest"]')).toHaveCount(0);
});

test('320px 下长事项联想单行省略、不横向溢出，Tab 可从正文框走到联想', async ({ page }) => {
  await boot(page, 320, 'analytics-weeks', false, WED_NOW);
  await page.addInitScript(() => {
    const d = JSON.parse(localStorage.getItem('timelog.v1'));
    d.entries.push({ id: 'long', ts: '2026-06-23T20:00', what: '写一段非常非常长的作品集案例说明用来检查联想按钮在窄屏上会不会把表单撑宽', tags: ['求职推进'] });
    d.entries.sort((a, b) => (a.ts < b.ts ? -1 : 1));
    localStorage.setItem('timelog.v1', JSON.stringify(d));
  });
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('写');
  await expect(sugs(page)).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
  const clipped = await page.locator('#form-sheet .what-sug-text').evaluateAll(els => els.some(el => el.scrollWidth > el.clientWidth));
  expect(clipped).toBe(true);
  const panelBox = await page.locator('#form-sheet .form-sheet-panel').boundingBox();
  for (const b of await sugs(page).all()) {
    const r = await b.boundingBox();
    expect(r.x + r.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 0.5);
  }
  await page.locator('#form-what').focus();
  await page.keyboard.press('Tab');
  await expect(sugs(page).first()).toBeFocused();
});

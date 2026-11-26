// 直接请求浏览器的 CloseWatcher 关闭，不把 Esc 当成 Android 手势证据。
import { expect, test } from '@playwright/test';
import { boot, FIXED_NOW } from './ui_fixture.js';

async function observeWatcher(page) {
  await page.addInitScript(() => {
    if (!window.CloseWatcher) return;
    const Native = window.CloseWatcher;
    window.CloseWatcher = class extends Native {
      constructor() { super(); window.testSheetWatcher = this; }
    };
  });
}
const request = page => page.evaluate(() => window.testSheetWatcher.requestClose());
const raw = page => page.evaluate(() => ['timelog.v1', 'timelog.config', 'timelog.quotes'].map(k => localStorage.getItem(k)));
const panel = page => page.locator('.form-sheet-panel');

test('展开说明答案后一次系统关闭只回到更多，焦点回说明入口', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '目标浏览器的原生 CloseWatcher');
  await observeWatcher(page);
  await boot(page, 375, 'three-labels', false, FIXED_NOW);
  const before = await raw(page);
  const more = page.locator('[data-action="open-more"]');
  const help = page.locator('[data-action="open-help"]');
  await more.click();
  await help.click();
  await page.locator('.help-body summary').last().click();
  await expect(page.locator('.help-body details[open] p')).toContainText('导入是合并');
  await request(page);
  await expect(panel(page)).toHaveAttribute('data-mode', 'more');
  await expect(help).toBeFocused();
  await request(page);
  await expect(panel(page)).toBeHidden();
  await expect(more).toBeFocused();
  expect(await raw(page)).toEqual(before);
});

test('系统关闭请求：新建草稿、编辑和取消删除都不写原始数据', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '目标浏览器的原生 CloseWatcher');
  await observeWatcher(page);
  await boot(page, 390, 'three-labels', false, FIXED_NOW);
  const before = await raw(page);
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('合成草稿');
  await request(page);
  await expect(panel(page)).toBeHidden();
  await page.locator('#add-btn').click();
  await expect(page.locator('#form-what')).toHaveValue('合成草稿');
  await request(page);
  await expect(panel(page)).toBeHidden();
  await page.locator('.entry[data-id="tl-b"] .e-what').click();
  await page.getByRole('button', { name: '删除这条记录' }).click();
  await request(page);
  await expect(panel(page)).toHaveAttribute('data-mode', 'edit');
  await page.locator('[data-role="edit-what"]').fill('不能保存');
  await request(page);
  await expect(panel(page)).toBeHidden();
  expect(await raw(page)).toEqual(before);
});

test('系统关闭与 Esc 从导入检查逐层退出；恢复入口焦点、不叠历史', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '目标浏览器的原生 CloseWatcher');
  await observeWatcher(page);
  await boot(page, 390, 'three-labels', false, FIXED_NOW);
  const before = await raw(page);
  const historySize = await page.evaluate(() => history.length);
  const more = page.locator('[data-action="open-more"]');
  await more.click();
  await page.locator('[data-action="open-backup"]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入 JSON 备份' }).click();
  await (await chooser).setFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await expect(panel(page)).toHaveAttribute('data-mode', 'import-shift');
  await request(page);
  await expect(panel(page)).toHaveAttribute('data-mode', 'backup');
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveAttribute('data-mode', 'more');
  await expect(page.locator('[data-action="open-backup"]')).toBeFocused();
  await request(page);
  await expect(panel(page)).toBeHidden();
  await expect(more).toBeFocused();
  expect(await raw(page)).toEqual(before);
  expect(await page.evaluate(() => history.length)).toBe(historySize);
});

test('原生关闭先收日历；保存后的旧监听不能关闭新面板', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '目标浏览器的原生 CloseWatcher');
  await observeWatcher(page);
  await boot(page, 768, 'mid-placeholder', false, FIXED_NOW);
  await page.locator('#add-btn').click();
  await page.locator('[data-action="toggle-start-time"]').click();
  await page.locator('.dt-trigger').click();
  await request(page);
  await expect(page.locator('.dt-pop')).toBeHidden();
  await expect(page.locator('.dt-trigger')).toBeFocused();
  await page.evaluate(() => { window.oldWatcher = window.testSheetWatcher; });
  await page.locator('#form-what').fill('合成保存');
  await page.locator('.sh-done').click();
  await expect(panel(page)).toBeHidden();
  await page.locator('[data-action="open-more"]').click();
  await page.evaluate(() => window.oldWatcher.requestClose());
  await expect(panel(page)).toHaveAttribute('data-mode', 'more');
  await expect(panel(page)).toBeVisible();
  await request(page);
  await expect(panel(page)).toBeHidden();
});

test('没有 CloseWatcher 时按钮和 Esc 仍逐层返回', async ({ page }) => {
  await page.addInitScript(() => { delete window.CloseWatcher; });
  await boot(page, 390, 'three-labels', false, FIXED_NOW);
  await page.locator('[data-action="open-more"]').click();
  await page.locator('[data-action="open-backup"]').click();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveAttribute('data-mode', 'more');
  await page.locator('.sh-cancel').click();
  await expect(panel(page)).toBeHidden();
});

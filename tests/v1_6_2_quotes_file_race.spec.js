import { expect, test } from '@playwright/test';
import { boot, FIXED_NOW } from './ui_fixture.js';

async function openQuotes(page) {
  await page.locator('#motto-line').click();
  await page.locator('[data-action="pick-motto-mode"][data-mode="quote"]').click();
}

for (const fail of [false, true]) {
  test(`a pending quote file ${fail ? 'error' : 'result'} cannot enter a reopened draft`, async ({ page }) => {
    await boot(page, 390, 'one-record', false, FIXED_NOW);
    await openQuotes(page);
    await page.evaluate(() => {
      File.prototype.arrayBuffer = function () {
        return new Promise((resolve, reject) => {
          window.finishQuoteRead = () => resolve(new TextEncoder().encode('旧文件里的句子。').buffer);
          window.failQuoteRead = () => reject(new Error('read failed'));
        });
      };
    });
    await page.locator('[data-role="quotes-file"]').setInputFiles({ name: 'lines.txt', mimeType: 'text/plain', buffer: Buffer.from('old') });
    await page.waitForFunction(() => !!window.finishQuoteRead);
    await page.getByRole('button', { name: '取消编辑阶段格言' }).click();
    await expect(page.locator('#form-sheet')).toBeHidden();
    await openQuotes(page);
    await page.locator('[data-role="quotes-input"]').fill('新草稿。');
    await page.evaluate(fail => fail ? window.failQuoteRead() : window.finishQuoteRead(), fail);
    await expect(page.locator('[data-role="quotes-input"]')).toHaveValue('新草稿。');
    await expect(page.locator('[data-role="motto-error"]')).toBeHidden();
    await page.getByRole('button', { name: '保存阶段格言' }).click();
    await expect(page.locator('#motto-line')).toHaveText('新草稿。');
  });
}

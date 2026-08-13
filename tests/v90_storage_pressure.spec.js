// v90：配置 key 的配额失败不能抛异常，更不能留下「记录已改、配置没改」的半事务。
import { expect, test } from '@playwright/test';
import { bootLocale, TODAY_KEY } from './i18n_fixture.js';
import { boot, FIXED_NOW } from './ui_fixture.js';

const CONFIG = {
  version: 1,
  mainline: ['求职推进', '杂'],
  chips: [{ name: '睡觉', bucket: 'maintain', longOk: true }]
};

async function rejectConfigWrites(page) {
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'timelog.config') throw new DOMException('quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
}

test('v90: tag rename rolls entries back when config storage is full', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    config: CONFIG,
    entries: [{ id: 'job', ts: `${TODAY_KEY}T09:00`, what: '投简历', tags: ['求职推进'] }]
  });
  const before = await page.evaluate(() => ({
    data: localStorage.getItem('timelog.v1'),
    config: localStorage.getItem('timelog.config')
  }));
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.locator('[data-action="open-more"]').click();
  await page.getByRole('button', { name: '配置标签' }).click();
  await page.locator('.cfg-row[data-original-name="求职推进"] .cfg-name').fill('Job search');
  await rejectConfigWrites(page);
  await page.getByRole('button', { name: '保存标签配置' }).click();

  await expect(page.locator('#form-sheet')).toBeVisible();
  await expect(page.locator('[data-role="config-error"]')).toContainText('存储空间不足');
  await expect(page.locator('.cfg-row[data-original-name="求职推进"] .cfg-name')).toHaveValue('Job search');
  const after = await page.evaluate(() => ({
    data: localStorage.getItem('timelog.v1'),
    config: localStorage.getItem('timelog.config')
  }));
  expect(after).toEqual(before);
  expect(pageErrors).toHaveLength(0);
});

test('v90: motto save failure keeps the sheet and input intact', async ({ page }) => {
  await boot(page, 375, 'one-record', false, FIXED_NOW);
  const before = await page.evaluate(() => localStorage.getItem('timelog.config'));
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.locator('#motto-line').click();
  await page.locator('[data-role="motto-input"]').fill('先保存数据，再继续');
  await rejectConfigWrites(page);
  await page.getByRole('button', { name: '保存阶段格言' }).click();

  await expect(page.locator('#form-sheet')).toBeVisible();
  await expect(page.locator('[data-role="motto-input"]')).toHaveValue('先保存数据，再继续');
  await expect(page.locator('[data-role="motto-error"]')).toContainText('存储空间不足');
  expect(await page.evaluate(() => localStorage.getItem('timelog.config'))).toBe(before);
  expect(pageErrors).toHaveLength(0);
});

test('v90: a custom-tag entry is rolled back when the tag cannot be persisted', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);
  const before = await page.evaluate(() => localStorage.getItem('timelog.v1'));

  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.getByRole('button', { name: '维持' }).click();
  await page.locator('#form-what').fill('配额压力下的拉伸');
  await page.locator('#form-ctag').fill('临时拉伸');
  await rejectConfigWrites(page);
  await page.getByRole('button', { name: '保存时间记录' }).click();

  await expect(page.locator('#form-sheet')).toBeVisible();
  await expect(page.locator('#form-what')).toHaveValue('配额压力下的拉伸');
  await expect(page.locator('#form-ctag')).toHaveValue('临时拉伸');
  await expect(page.locator('[data-role="conflict-error"]')).toContainText('自定义标签和本次记录都没有保存');
  expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(before);
});

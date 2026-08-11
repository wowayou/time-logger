// v89：长段确认从默认统计闸门降为默认关闭的可选提醒。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot, openAdvancedSheet } from './ui_fixture.js';

async function seedLongSegment(page) {
  await page.evaluate(() => {
    localStorage.setItem('timelog.v1', JSON.stringify({
      version: 1,
      entries: [
        { id: 'long-meal', ts: '2026-06-29T08:00', what: '吃饭', tags: ['吃饭'] },
        { id: 'work', ts: '2026-06-29T12:00', what: '下午工作', tags: ['求职推进'] }
      ]
    }));
  });
  await page.locator('#view-tabs button[data-view="week"]').click();
  await page.locator('#view-tabs button[data-view="day"]').click();
}

test('v89: long review is off by default and enabling it adds a tag-preserving reminder', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);
  await seedLongSegment(page);

  const meal = page.locator('.entry[data-id="long-meal"]');
  await expect(meal).toHaveAttribute('data-b', 'maintain');
  await expect(page.locator('[data-action="confirm-segment"]')).toHaveCount(0);
  await expect(page.locator('#ruler')).not.toContainText('待核');

  await openAdvancedSheet(page);
  const toggle = page.locator('[data-action="toggle-long-review"]');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toContainText('长段提醒：关');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toContainText('长段提醒：开');

  // 提醒是正交状态：仍保留维持桶色与维持统计，不再冒充未记录。
  await expect(meal).toHaveAttribute('data-b', 'maintain');
  await expect(page.locator('#ruler')).toContainText('维持 4h');
  await expect(page.locator('#ruler')).toContainText('其中待核 4h');
  await expect(page.locator('[data-action="confirm-segment"]')).toHaveCount(1);
  const storedConfig = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.config')));
  expect(storedConfig.longReview).toBe(true);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('[data-action="confirm-segment"]').click();
  await expect(page.locator('#ruler')).not.toContainText('待核');
  const mark = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries
    .find(entry => entry.id === 'long-meal').longConfirm);
  expect(mark).toEqual({ startTs: '2026-06-29T08:00', endTs: '2026-06-29T12:00' });
});

test('v89: per-tag reminder exemptions stay hidden while the global option is off', async ({ page }) => {
  await boot(page, 768, 'one-record', false, FIXED_NOW);
  await page.locator('[data-action="open-more"]').click();
  await page.getByRole('button', { name: '配置标签' }).click();
  await expect(page.locator('.cfg-long:visible')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.locator('[data-action="open-advanced"]').click();
  await expect(page.locator('#form-sheet-title')).toHaveText('高级');
  await page.locator('[data-action="toggle-long-review"]').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('[data-action="open-more"]').click();
  await page.getByRole('button', { name: '配置标签' }).click();
  await expect(page.locator('.cfg-long:visible').first()).toBeVisible();
});

test('v89: imports validate the option but never enable this local preference', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);
  const result = await page.evaluate(async () => {
    const storage = await import(new URL('./src/storage.js', location.href).href);
    const base = { version: 1, mainline: ['求职推进'], chips: [] };
    return {
      importedOn: storage.mergeImportedConfig(base, { ...base, longReview: true }).longReview,
      localOn: storage.mergeImportedConfig({ ...base, longReview: true }, base).longReview,
      normalizedFalseHasKey: Object.hasOwn(storage.normalizeConfig({ ...base, longReview: false }), 'longReview'),
      validBoolean: storage.validateImportData({ entries: [], config: { ...base, longReview: true } }).ok,
      validString: storage.validateImportData({ entries: [], config: { ...base, longReview: 'true' } }).ok
    };
  });
  expect(result).toEqual({
    importedOn: undefined,
    localOn: true,
    normalizedFalseHasKey: false,
    validBoolean: true,
    validString: false
  });
});

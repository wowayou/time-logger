import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { boot, FIXED_NOW, openBackupSheet } from './ui_fixture.js';

for (const locale of ['zh', 'en']) {
  test(`public ${locale} gifts are downloadable without submitting personal data`, async ({ page, request }) => {
    // In production build_site maps site/ to / and runtime assets to /app/.
    // The development server exposes the source tree directly.
    await page.route('**/site/app/**', route => route.continue({ url: route.request().url().replace('/site/app/', '/') }));
    await page.setViewportSize({ width: 320, height: 640 });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(locale === 'zh' ? '/site/support/' : '/site/en/support/');
    await expect(page.locator('form, input, script, iframe')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('a[href="#gifts"]').click();
    const downloads = page.locator('a[download]');
    await expect(downloads).toHaveCount(4);
    for (const link of await downloads.all()) {
      const url = await link.evaluate(el => el.href);
      const response = await request.get(url);
      expect(response.ok()).toBe(true);
      expect((await response.body()).length).toBeGreaterThan(100);
    }
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      downloads.first().click()
    ]);
    expect(download.suggestedFilename()).toBe(`eigentime-focus-${locale}.txt`);
    // A keyboard user can reach each gift and the disclosure without a pointer.
    await downloads.last().focus();
    await expect(downloads.last()).toBeFocused();
    await page.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('details')).toHaveAttribute('open', '');
    expect(errors).toEqual([]);
  });
}

test('all six packs keep their lines intact and append without changing time records', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  const before = await page.evaluate(() => localStorage.getItem('timelog.v1'));
  for (const lang of ['zh', 'en']) {
    for (const key of ['focus', 'rest', 'restart']) {
      const text = readFileSync(`site/support/packs/${key}-${lang}.txt`, 'utf8');
      const lines = text.trim().split('\n');
      expect(lines).toHaveLength(14);
      expect(new Set(lines).size).toBe(14);
      const split = await page.evaluate(async text => (await import('/src/storage.js')).splitQuoteText(text).items, text);
      expect(split).toEqual(lines);
    }
  }
  await page.locator('#motto-line').click();
  await page.locator('[data-action="pick-motto-mode"][data-mode="quote"]').click();
  await page.locator('[data-role="quotes-input"]').fill('已有的一句。');
  await page.locator('[data-role="quotes-file"]').setInputFiles('site/support/packs/focus-zh.txt');
  await expect(page.locator('[data-role="quotes-count"]')).toContainText('共 15 句');
  await page.getByRole('button', { name: '保存阶段格言' }).click();
  await expect(page.locator('#motto-line')).toHaveText('已有的一句。');
  const stored = await page.evaluate(() => ({ records: localStorage.getItem('timelog.v1'), quotes: JSON.parse(localStorage.getItem('timelog.quotes')) }));
  expect(stored.records).toBe(before);
  expect(stored.quotes.items).toHaveLength(15);
  await openBackupSheet(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-action="download-json"]').click()
  ]);
  const backup = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(backup.quotes.items).toEqual(stored.quotes.items);
});

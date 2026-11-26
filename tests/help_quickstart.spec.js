import { expect, test } from '@playwright/test';
import { bootLocale } from './i18n_fixture.js';

for (const [locale, width, height] of [['zh', 375, 667], ['en', 320, 568], ['en', 1024, 768]]) {
  test(`help: visible essentials and offline keyboard disclosures (${locale}, ${width}px)`, async ({ page, context }) => {
    await bootLocale(page, { locale, width, height });
    await page.emulateMedia({ colorScheme: width === 375 ? 'dark' : 'light', reducedMotion: 'reduce' });
    await context.setOffline(true);
    await page.locator('[data-action="open-more"]').click();
    await page.locator('[data-action="open-help"]').click();
    const intro = page.locator('.help-body section');
    await expect(intro).toBeInViewport({ ratio: 1 });
    await expect(intro).toContainText(locale === 'zh' ? '摘要不能用来恢复' : 'a summary cannot restore');
    const questions = page.locator('.help-body summary');
    const answers = page.locator('.help-body details p');
    await expect(questions).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(answers.nth(i)).toBeHidden();
      const row = questions.nth(i);
      expect((await row.boundingBox()).height).toBeGreaterThanOrEqual(48);
      await questions.nth(i).focus();
      await page.keyboard.press('Enter');
      await expect(answers.nth(i)).toBeVisible();
      await expect(answers.nth(i)).not.toHaveText('');
      await expect(row.locator('.cell-chevron')).toHaveCSS('transform', 'matrix(0, 1, -1, 0, 0, 0)');
      if (i === 0) await test.info().attach(`expanded-${locale}-${width}`, {
        body: await page.screenshot(), contentType: 'image/png'
      });
      await expect(row).toBeFocused();
      await page.keyboard.press('Space');
      await expect(answers.nth(i)).toBeHidden();
    }
    expect(await page.locator('.help-body').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.keyboard.press('Tab');
    await expect(page.locator('.sh-cancel')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#form-sheet-title')).toHaveText(locale === 'zh' ? '更多' : 'More');
  });
}

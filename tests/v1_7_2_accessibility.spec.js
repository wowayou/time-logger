import { expect, test } from '@playwright/test';
import { boot, FIXED_NOW, openBackupMenu } from './ui_fixture.js';
import { composedContrast, targetHits } from './accessibility_helpers.js';

async function expectTextContrast(locator) {
  const report = await composedContrast(locator);
  expect.soft(report.ratio, JSON.stringify(report)).toBeGreaterThanOrEqual(report.textMinimum);
}

async function configRow(page) {
  await page.evaluate(() => {
    const config = JSON.parse(localStorage.getItem('timelog.config'));
    config.longReview = true;
    localStorage.setItem('timelog.config', JSON.stringify(config));
  });
  await openBackupMenu(page);
  await page.locator('[data-action="open-tag-config"]').click();
  const row = page.locator('.cfg-row[data-original-name="睡觉"]');
  await row.locator('.cfg-chip').click();
  return row;
}

for (const theme of ['light', 'dark']) {
  test(`R06: filled actions use readable actual composed colors (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await boot(page, 768, 'mid-placeholder', false, FIXED_NOW);
    await expectTextContrast(page.locator('.fab-main'));
    await expectTextContrast(page.locator('.fab-sub'));
    // Color-only fixture. Real waiting-worker behavior is covered separately.
    await page.evaluate(() => { document.getElementById('update-banner').hidden = false; });
    await expectTextContrast(page.locator('#update-banner [data-action="update-app"]'));
    await page.evaluate(() => { document.getElementById('update-banner').hidden = true; });
    await page.locator('#add-btn').click();
    await page.locator('[data-action="toggle-start-time"]').click();
    await page.locator('.dt-trigger').click();
    await expectTextContrast(page.locator('.dt-day.is-sel'));
  });

  test(`R06: checkbox states and an enabled pending-delete Undo remain distinguishable (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await boot(page, 390, 'mid-placeholder', false, FIXED_NOW);
    const row = await configRow(page);
    const checkbox = row.locator('input[type="checkbox"]');
    expect.soft((await composedContrast(checkbox, { property: 'borderTopColor', pseudo: '::before' })).ratio).toBeGreaterThanOrEqual(3);
    await checkbox.uncheck();
    expect.soft((await composedContrast(checkbox, { property: 'borderTopColor' })).ratio).toBeGreaterThanOrEqual(3);
    await row.locator('[data-action="cfg-toggle-delete"]').click();
    await expect(row).toHaveAttribute('data-pending-delete', '1');
    const undo = row.locator('.cfg-delete');
    await expectTextContrast(undo);
    await undo.click();
    await expect(row).not.toHaveAttribute('data-pending-delete', '1');
  });

  test(`R07: the small fill link has a real 44px hot area, not just a declared pseudo-element (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await boot(page, 390, 'mid-placeholder', false, FIXED_NOW);
    const fill = page.locator('.entry[data-id="mid-open"] .mini-btn');
    // AA is 24px with spacing/inline exceptions; this specific primary touch
    // action uses the project's stronger 44px baseline. Check actual hit tests.
    const hits = await targetHits(fill, 44);
    expect(hits.every(point => point.hit), JSON.stringify(hits)).toBe(true);
    const r = await fill.boundingBox();
    await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2 + 20);
    await expect(page.locator('#form-sheet-title')).toHaveText('补录 · 6月29日');
    await expect(page.locator('[data-role="cut-source"]')).toContainText('09:00–11:00');
  });

  test(`R07: expanded action targets never steal the row text or mutate a plan during Edit (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await boot(page, 390, 'planned-expired', false, FIXED_NOW);
    const raw = await page.evaluate(() => localStorage.getItem('timelog.v1'));
    const text = page.locator('.entry[data-id="plan-expired"] .e-what');
    expect(await text.evaluate(el => {
      const r = el.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-action]')?.dataset.action;
    })).toBe('start-edit');
    await text.click();
    await expect(page.locator('[data-role="edit-what"]')).toHaveValue('过期计划');
    expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(raw);
    await page.locator('#form-sheet .sh-cancel').click();
    expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(raw);
  });

  test(`R06: an unbreakable long tag is fully contained and can be selected at 320px (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await boot(page, 320, 'mid-placeholder', false, FIXED_NOW);
    const longTag = 'SyntheticLongTag_' + 'x'.repeat(100);
    await page.evaluate(name => {
      const config = JSON.parse(localStorage.getItem('timelog.config'));
      config.chips.push({ name, bucket: 'maintain', longOk: false });
      localStorage.setItem('timelog.config', JSON.stringify(config));
    }, longTag);
    const raw = await page.evaluate(() => localStorage.getItem('timelog.v1'));
    await page.setViewportSize({ width: 320, height: 600 });
    await page.locator('#add-btn').click();
    await page.locator('[data-action="pick-form-bucket"][data-bucket="maintain"]').click();
    const chip = page.getByRole('button', { name: `选择标签：${longTag}`, exact: true });
    await chip.scrollIntoViewIfNeeded();
    const bounds = await chip.evaluate(el => {
      const r = el.getBoundingClientRect(), p = el.closest('.form-sheet-body').getBoundingClientRect();
      return { left: r.left, right: r.right, bodyLeft: p.left, bodyRight: p.right, scrollWidth: el.scrollWidth, width: el.clientWidth };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(bounds.bodyLeft - 1);
    expect(bounds.right).toBeLessThanOrEqual(bounds.bodyRight + 1);
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width + 1);
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expectTextContrast(chip);
    await page.locator('.sh-cancel').click();
    expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(raw);
  });

  test(`R07: analytics pagination has real touch targets and its action icon has 3:1 contrast (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await boot(page, 390, 'mid-placeholder', false, FIXED_NOW);
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('timelog.v1'));
      const config = JSON.parse(localStorage.getItem('timelog.config'));
      for (let i = 0; i < 14; i++) {
        const name = `合成标签${i}`;
        data.entries.push({ id: `target-${i}`, ts: `2026-06-29T00:${String(i + 10).padStart(2, '0')}`, what: `合成目标检查 ${i}`, tags: [name] });
        config.chips.push({ name, bucket: 'maintain', longOk: false });
      }
      localStorage.setItem('timelog.v1', JSON.stringify(data));
      localStorage.setItem('timelog.config', JSON.stringify(config));
    });
    await openBackupMenu(page);
    await page.locator('[data-action="open-analytics"]').click();
    expect((await composedContrast(page.locator('.an-call svg'), { property: 'fill' })).ratio).toBeGreaterThanOrEqual(3);
    const dots = page.locator('.an-dot');
    await expect(dots).toHaveCount(2);
    for (const dot of await dots.all()) {
      await dot.scrollIntoViewIfNeeded();
      expect((await targetHits(dot)).every(point => point.hit)).toBe(true);
      expect((await composedContrast(dot, { property: 'backgroundColor', pseudo: '::before', surfaceForeground: true })).ratio).toBeGreaterThanOrEqual(3);
    }
    const next = page.locator('.an-arrow:not([disabled])');
    await next.scrollIntoViewIfNeeded();
    expect((await targetHits(next)).every(point => point.hit)).toBe(true);
    await next.click();
    await expect(dots.nth(1)).toHaveClass(/on/);
  });
}

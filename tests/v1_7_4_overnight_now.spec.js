import { expect, test } from './startup_fixture.js';
import { boot, FIXED_NOW, expectNoHorizontalOverflow } from './ui_fixture.js';

const nowButtons = page => page.locator('[data-role="overnight-time-row"] .wheel-now-btn, [data-role="overnight-time-row"] .dt-now');

async function openOvernight(page, width, fixture = 'yesterday-placeholder') {
  await boot(page, width, fixture, false, FIXED_NOW, -1);
  await page.locator('#add-btn').click();
  await expect(page.locator('#form-sheet-title')).toContainText('过夜续记');
  await expect(page.locator('#form-ts')).toHaveValue('2026-06-28T23:00');
  if (width >= 720) await page.locator('[data-role="overnight-time-row"] .dt-trigger').click();
}

for (const width of [390, 768]) {
  for (const theme of ['light', 'dark']) {
    test(`overnight start offers no invalid Now shortcut at ${width}px (${theme})`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await openOvernight(page, width);
      const raw = await page.evaluate(() => localStorage.getItem('timelog.v1'));
      await expect(nowButtons(page)).toHaveCount(0);
      await expect(page.locator('[data-role="overnight-summary"]')).toContainText('到今天 12:34');
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath('overnight-start.png') });
      // Removing an invalid shortcut must not alter either date or the draft.
      expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(raw);
      await page.locator('#form-what').fill('合成过夜续记');
      await page.getByRole('button', { name: '选择标签：求职推进', exact: true }).click();
      await page.locator('[data-action="save-entry"]').click();
      await expect(page.locator('#form-sheet')).toBeHidden();
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.filter(e => e.what === '合成过夜续记').map(e => e.ts).sort()))
        .toEqual(['2026-06-28T23:00', '2026-06-29T00:00']);
    });
  }

  test(`overnight with an existing today boundary retains that original at ${width}px`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openOvernight(page, width, 'overnight-with-today-real');
    const original = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(e => e.id === 'today-real'));
    await expect(nowButtons(page)).toHaveCount(0);
    await expect(page.locator('[data-role="overnight-summary"]')).toContainText('到今天 07:30');
    await page.locator('#form-what').fill('合成续到硬终点');
    await page.locator('[data-action="save-entry"]').click();
    await expect(page.locator('#form-sheet')).toBeHidden();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(e => e.id === 'today-real'))).toEqual(original);
  });
}

test('overnight remount and day-end switching retain the start without reintroducing Now', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOvernight(page, 390);
  await page.locator('#form-what').fill('合成只记到午夜');
  for (const width of [719, 720, 721, 320]) {
    await page.setViewportSize({ width, height: 820 });
    const mount = page.locator('[data-role="overnight-time-row"] [data-role="form-wheel-mount"]');
    await expect(mount).toHaveAttribute('data-picker-compact', width < 720 ? '1' : '0');
    if (width >= 720) await mount.locator('.dt-trigger').click();
    await expect(nowButtons(page)).toHaveCount(0);
    await expect(page.locator('#form-ts')).toHaveValue('2026-06-28T23:00');
    await expect(page.locator('#form-what')).toHaveValue('合成只记到午夜');
    await expectNoHorizontalOverflow(page);
  }
  await page.locator('[data-action="pick-overnight-end-mode"][data-mode="day-end"]').click();
  await expect(nowButtons(page)).toHaveCount(0);
  await page.locator('[data-action="save-entry"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.filter(e => e.ts.startsWith('2026-06-29')))).toEqual([]);
});

test('manual overnight input remains validated instead of relying on the missing shortcut', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openOvernight(page, 768);
  const raw = await page.evaluate(() => localStorage.getItem('timelog.v1'));
  const precise = page.locator('[data-role="overnight-time-row"] [data-role="text"]');
  await precise.fill('2026-06-29 12:34');
  await precise.press('Tab');
  await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T12:34');
  await page.locator('#form-what').fill('合成非法零长度');
  await page.locator('[data-action="save-entry"]').click();
  await expect(page.locator('[data-role="conflict-error"]')).toContainText('早于结束点');
  expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(raw);
  await precise.fill('2026-06-28 23:30');
  await precise.press('Tab');
  await expect(page.locator('#form-ts')).toHaveValue('2026-06-28T23:30');
  await page.locator('[data-action="save-entry"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(e => e.what === '合成非法零长度' && e.ts.startsWith('2026-06-28')).ts)).toBe('2026-06-28T23:30');
});

for (const width of [390, 768]) {
  test(`ordinary single-point pickers still offer Now at ${width}px`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page, width, 'empty', false, FIXED_NOW);
    await page.locator('#add-btn').click();
    await page.locator('[data-action="toggle-start-time"]').click();
    if (width >= 720) await page.locator('[data-role="start-time-section"] .dt-trigger').click();
    const now = page.locator('#form-sheet .wheel-now-btn, #form-sheet .dt-now');
    await expect(now).toBeVisible();
    await now.click();
    await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T12:34');
  });
}

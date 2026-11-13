import { expect, test } from './startup_fixture.js';
import { boot, FIXED_NOW, expectNoHorizontalOverflow } from './ui_fixture.js';
import { targetHits } from './accessibility_helpers.js';

async function expectSheetUsable(page) {
  const geometry = await page.locator('.form-sheet-panel').evaluate(panel => {
    const p = panel.getBoundingClientRect(), body = panel.querySelector('.form-sheet-body');
    const notice = document.getElementById('cross-tab-banner');
    return { left: p.left, right: p.right, top: p.top, bottom: p.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight,
      bodyWidth: body.clientWidth, bodyScrollWidth: body.scrollWidth,
      noticeBottom: notice.hidden ? 0 : notice.getBoundingClientRect().bottom };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.noticeBottom - 1);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.bodyWidth + 1);
  for (const control of await page.locator('#form-sheet .sh-cancel, #form-sheet .sh-done').all()) {
    const r = await control.boundingBox();
    expect(r.width).toBeGreaterThanOrEqual(44);
    expect(r.height).toBeGreaterThanOrEqual(44);
    await expect(control).toBeInViewport({ ratio: 1 });
    // Rounded corners need not contain a 44px square. Check the target's real
    // axis edges and center rather than rejecting a legitimate rounded target.
    expect((await targetHits(control)).filter(p => !p.dx || !p.dy).every(p => p.hit)).toBe(true);
  }
}

for (const theme of ['light', 'dark']) {
  for (const width of [320, 375, 390, 719, 720, 721, 1440]) {
    test(`R06: day and expanded long form remain usable at ${width}px (${theme}), including error plus notice`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await boot(page, width, 'long-note', false, FIXED_NOW);
      await expectNoHorizontalOverflow(page);
      expect(await page.evaluate(() => getComputedStyle(document.body).overflowX)).not.toBe('hidden');
      await page.setViewportSize({ width, height: width >= 720 ? 400 : 600 });
      await page.locator('.entry[data-id="today-long"]').click();
      await expectSheetUsable(page);
      await expect(page.locator('[data-role="edit-time-section"]')).toBeHidden();
      await page.locator('[data-action="toggle-edit-start-time"]').click();
      const mount = page.locator('[data-role="edit-start-wheel"]');
      await expect(mount).toHaveAttribute('data-picker-compact', width < 720 ? '1' : '0');
      await expect(page.locator('[data-role="edit-ts"]')).toHaveValue('2026-06-29T09:00');
      const input = page.locator('[data-role="edit-what"]');
      await input.fill('本页的合成长草稿\n' + 'LongUnbrokenDraft_'.repeat(40));
      const latest = await page.evaluate(() => {
        const data = JSON.parse(localStorage.getItem('timelog.v1'));
        data.entries.find(e => e.id === 'today-long').what = '合成另一页已保存的内容';
        const raw = JSON.stringify(data);
        localStorage.setItem('timelog.v1', raw);
        // Deterministic layout-state injection; actual two-page races are in
        // v1_6_1_reliability/edit_guard/source_guard and v93_cas_snapshot.
        window.dispatchEvent(new StorageEvent('storage', { key: 'timelog.v1', storageArea: localStorage }));
        return raw;
      });
      await expect(page.locator('#cross-tab-banner')).toBeVisible();
      await page.locator('[data-action="commit-edit"]').click();
      const error = page.locator('[data-role="conflict-error"]');
      await expect(error).toContainText('重新打开');
      await expect(error).toBeInViewport({ ratio: 1 });
      await expect(error).toHaveAttribute('role', 'alert');
      await expectSheetUsable(page);
      await expect(input).toHaveValue('本页的合成长草稿\n' + 'LongUnbrokenDraft_'.repeat(40));
      expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(latest);
      // No force click and no dismiss-notice workaround.
      await page.locator('#form-sheet .sh-cancel').click();
      await expect(page.locator('#form-sheet')).toBeHidden();
      await expect(page.locator('.entry[data-id="today-long"]')).toContainText('合成另一页已保存的内容');
    });
  }

  for (const width of [320, 1440]) {
    test(`R06: 200% font-token pressure preserves the collapsed long form at ${width}px (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await boot(page, width, 'long-note', false, FIXED_NOW);
      // Author-font pressure fixture, not a claim about mobile OS text scaling
      // or browser zoom. Real font/keyboard/rotation behavior remains device QA.
      await page.evaluate(() => {
        const root = document.documentElement;
        const tokens = ['cap', 'ui', 'ui-strong', 'body', 'input', 'title'];
        const sizes = tokens.map(key => parseFloat(getComputedStyle(root).getPropertyValue('--fs-' + key)));
        tokens.forEach((key, i) => root.style.setProperty('--fs-' + key, sizes[i] * 2 + 'px'));
      });
      await expectNoHorizontalOverflow(page);
      await page.setViewportSize({ width, height: 600 });
      await page.locator('.entry[data-id="today-long"]').click();
      await expectSheetUsable(page);
      await expect(page.locator('[data-role="edit-what"]')).toHaveClass(/ta-capped/);
      await page.locator('#form-sheet .sh-cancel').click();
      await expect(page.locator('#form-sheet')).toBeHidden();
    });
  }
}

for (const reducedMotion of ['reduce', 'no-preference']) {
  test(`R07: native wheel keyboard/Now scrolling respects ${reducedMotion}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await boot(page, 390, 'empty', false, FIXED_NOW);
    await page.locator('#add-btn').click();
    await page.locator('[data-action="toggle-start-time"]').click();
    await page.evaluate(() => {
      window.__wheelScrollBehaviors = [];
      const scrollTo = Element.prototype.scrollTo;
      Element.prototype.scrollTo = function(...args) {
        if (this.classList.contains('wheel-col')) window.__wheelScrollBehaviors.push(args[0]?.behavior);
        return scrollTo.apply(this, args);
      };
    });
    await page.getByRole('listbox', { name: '小时', exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T01:00');
    await page.getByRole('button', { name: '重置为当前时间' }).click();
    await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T12:34');
    const behaviors = await page.evaluate(() => window.__wheelScrollBehaviors);
    expect(behaviors.length).toBeGreaterThanOrEqual(4);
    expect(new Set(behaviors)).toEqual(new Set([reducedMotion === 'reduce' ? 'auto' : 'smooth']));
  });
}

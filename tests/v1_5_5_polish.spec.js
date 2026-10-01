// v1.5.5：v1.5.3/v1.5.4 收尾时发现的两处——
// ① 默认标签预览的「添加 / 取消」与旧合并两键同病（两颗一样的贴字小胶囊、主次不分）；
// ② 英文界面的条数不分单复数（「1 entries」），标签设置的条数、chip 读屏名称、合并提示都中。
import { expect, test } from '@playwright/test';
import { bootLocale, TODAY_KEY } from './i18n_fixture.js';
import { cfgRow, openCfgRow } from './cfg_fixture.js';

for (const scheme of ['light', 'dark']) {
  test(`default-tag preview buttons are equal-width with cancel neutral on the left (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await bootLocale(page, {
      locale: 'zh',
      width: 320,
      config: { version: 1, mainline: ['求职推进'], chips: [{ name: '睡觉', bucket: 'maintain', longOk: true }] }
    });
    await page.locator('[data-action="open-more"]').click();
    await page.getByRole('button', { name: '配置标签' }).click();
    await page.locator('[data-action="preview-locale-defaults"]').click();
    await expect(page.locator('[data-action="apply-locale-defaults"]')).toBeFocused();

    const m = await page.evaluate(() => {
      const row = document.querySelector('.cfg-defaults-actions');
      const cancel = row.querySelector('[data-action="cancel-locale-defaults"]');
      const apply = row.querySelector('[data-action="apply-locale-defaults"]');
      const probe = document.createElement('div');
      probe.style.cssText = 'background: var(--chrome)';
      row.append(probe);
      const chrome = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const r = el => el.getBoundingClientRect();
      return {
        rowW: r(row).width,
        cancelW: r(cancel).width,
        applyW: r(apply).width,
        cancelH: r(cancel).height,
        gap: r(apply).left - r(cancel).right,
        cancelBg: getComputedStyle(cancel).backgroundColor,
        applyBg: getComputedStyle(apply).backgroundColor,
        chrome
      };
    });
    expect(Math.abs(m.cancelW - m.applyW)).toBeLessThan(1);
    expect(m.cancelW + m.applyW + m.gap).toBeGreaterThan(m.rowW - 1);
    expect(m.gap).toBeGreaterThan(0); // 取消在左、添加在右
    expect(m.cancelH).toBeGreaterThanOrEqual(44);
    expect(m.cancelBg).toBe(m.chrome);
    expect(m.applyBg).not.toBe(m.cancelBg); // 主次分明
  });
}

test('English counts use singular for one entry: tag settings and the merge prompt', async ({ page }) => {
  await bootLocale(page, {
    locale: 'en',
    config: { version: 1, mainline: ['Focus A', 'Reading', 'blog'], chips: [] },
    entries: [
      { id: 'a', ts: `${TODAY_KEY}T08:00`, what: 'read', tags: ['Reading'] },
      { id: 'b', ts: `${TODAY_KEY}T09:00`, what: 'read more', tags: ['Reading'] },
      { id: 'c', ts: `${TODAY_KEY}T10:00`, what: 'post', tags: ['blog'] }
    ]
  });
  await page.locator('[data-action="open-more"]').click();
  await page.getByRole('button', { name: 'Configure tags' }).click();
  await expect(cfgRow(page, 'blog').locator(':scope > .cfg-chip')).toHaveAttribute('aria-label', 'blog, 1 entry');
  await expect(cfgRow(page, 'Reading').locator(':scope > .cfg-chip')).toHaveAttribute('aria-label', 'Reading, 2 entries');
  const blog = await openCfgRow(page, 'blog');
  await expect(blog.locator('.cfg-count')).toHaveText('1 entry');
  await blog.locator('.cfg-name').fill('Reading');
  await page.getByRole('button', { name: 'Save tag settings' }).click();
  await expect(page.locator('[data-role="config-error"]')).toContainText('Merging moves 1 entry from "blog" to "Reading"');
});

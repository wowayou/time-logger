// v1.5.4：合并提示「先不合并 / 合并」两键的观感（2026-10-01 真机反馈「显示一般」）。
// 旧版沿用 cell-action / cell-danger：无水平内边距、贴字缩成宽窄不一的小胶囊，10% 色调底
// 融进同为 danger 色调的提示框。现在等宽撑满一行、卡片底托出、「合并」用 danger 字色。
// 既有的「两键等高、顶边对齐、danger class、焦点归还」由 tag_config_staging.spec.js 守着。
import { expect, test } from '@playwright/test';
import { bootLocale, TODAY_KEY } from './i18n_fixture.js';
import { openCfgRow } from './cfg_fixture.js';

for (const scheme of ['light', 'dark']) {
  test(`merge prompt buttons are equal-width, fill the row and sit on the card surface (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await bootLocale(page, {
      locale: 'zh',
      width: 320,
      config: { version: 1, mainline: ['求职推进', '阅读', 'blog'], chips: [] },
      entries: [
        { id: 'a', ts: `${TODAY_KEY}T08:00`, what: '读书', tags: ['阅读'] },
        { id: 'b', ts: `${TODAY_KEY}T09:00`, what: '写博客', tags: ['blog'] }
      ]
    });
    await page.locator('[data-action="open-more"]').click();
    await page.getByRole('button', { name: '配置标签' }).click();
    const blog = await openCfgRow(page, 'blog');
    await blog.locator('.cfg-name').fill('阅读');
    await page.getByRole('button', { name: '保存标签配置' }).click();
    await expect(page.locator('[data-action="confirm-tag-merge"]')).toBeVisible();

    const m = await page.evaluate(() => {
      const box = document.querySelector('[data-role="config-error"]');
      const row = box.querySelector('.cfg-merge-actions');
      const cancel = row.querySelector('[data-action="dismiss-tag-merge"]');
      const confirm = row.querySelector('[data-action="confirm-tag-merge"]');
      const probe = document.createElement('div');
      probe.style.cssText = 'background: var(--card); color: var(--danger)';
      box.append(probe);
      const card = getComputedStyle(probe).backgroundColor;
      const danger = getComputedStyle(probe).color;
      probe.remove();
      const rect = el => el.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(box).paddingLeft) + parseFloat(getComputedStyle(box).paddingRight);
      return {
        inner: rect(box).width - pad - 2, // 2 = 左右 1px 描边
        cancelW: rect(cancel).width,
        confirmW: rect(confirm).width,
        cancelH: rect(cancel).height,
        gap: rect(confirm).left - rect(cancel).right,
        cancelBg: getComputedStyle(cancel).backgroundColor,
        confirmBg: getComputedStyle(confirm).backgroundColor,
        confirmColor: getComputedStyle(confirm).color,
        card,
        danger
      };
    });
    // 等宽，且两键加间距撑满提示框内宽（不再是贴字的小胶囊）。
    expect(Math.abs(m.cancelW - m.confirmW)).toBeLessThan(1);
    expect(m.cancelW + m.confirmW + m.gap).toBeGreaterThan(m.inner - 2);
    // 44px 触控红线。
    expect(m.cancelH).toBeGreaterThanOrEqual(44);
    // 卡片底把按钮从 danger 色调的提示框里托出来；「合并」用 danger 字色。
    expect(m.cancelBg).toBe(m.card);
    expect(m.confirmBg).toBe(m.card);
    expect(m.confirmColor).toBe(m.danger);
  });
}

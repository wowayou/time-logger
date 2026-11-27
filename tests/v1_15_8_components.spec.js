// v1.15.8 · SPEC-016 B 期：按钮组件收敛（维护者 2026-11-27「P3 也按你的建议做」）。
//
// 锁的是：
// ① 整行动作（.cell-action / .cell-danger）同一基类：高 48、同圆角、同字号字重、两侧有内边距；
//    「复制本期摘要」并入该家族（此前是 44 高的胶囊）。
// ② 标签设置里的两组并排键（补回默认标签、合并提示）等宽、高 48（此前各写 44）；默认标签那组
//    保留 cell-action 的 10px 下边距（tag_config_staging 也守着）。
// ③ 组件清单核对时补上的按下反馈：标签 chip、联想项等按住时变淡。
// 模板里的按钮类与 docs/components.md 一一对应由 audit_button_inventory 守。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot } from './ui_fixture.js';
import { bootLocale } from './i18n_fixture.js';

const look = el => {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return { h: Math.round(r.height), w: Math.round(r.width), radius: cs.borderTopLeftRadius, size: cs.fontSize, weight: cs.fontWeight, padL: cs.paddingLeft, padR: cs.paddingRight, mb: cs.marginBottom };
};

test('① 切一刀、删除这条、复制本期摘要同属整行动作：48 高、同圆角同字号', async ({ page }) => {
  await boot(page, 390, 'two-records', false, FIXED_NOW);
  await page.locator('#timeline .entry[role="button"]').first().click();
  await expect(page.locator('#form-sheet [data-role="edit-what"]')).toBeVisible();
  const split = await page.locator('#form-sheet [data-action="backfill-seg"]').evaluate(look);
  const del = await page.locator('#form-sheet [data-action="request-delete"]').evaluate(look);
  for (const b of [split, del]) {
    expect(b.h).toBe(48);
    expect(b.padL).toBe('12px');
    expect(b.padR).toBe('12px');
  }
  expect(del.radius).toBe(split.radius);
  expect(del.size).toBe(split.size);
  expect(del.weight).toBe(split.weight);
  await page.locator('#form-sheet .sh-cancel').click();
  await expect(page.locator('#form-sheet')).toBeHidden();

  await page.locator('[data-action="open-more"]').click();
  await page.locator('[data-action="open-analytics"]').click();
  const copy = await page.locator('#form-sheet .an-copy').evaluate(look);
  expect(copy.h).toBe(48);
  expect(copy.radius).toBe(split.radius);
  expect(copy.size).toBe(split.size);
  expect(copy.weight).toBe(split.weight);
  expect(copy.mb).toBe('0px');
});

test('② 补回默认标签的两键等宽、48 高、保留 10px 下边距', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', width: 320, config: { version: 1, mainline: ['求职推进'], chips: [{ name: '睡觉', bucket: 'maintain', longOk: true }] } });
  await page.locator('[data-action="open-more"]').click();
  await page.locator('[data-action="open-tag-config"]').click();
  await page.locator('[data-action="preview-locale-defaults"]').click();
  const cancel = await page.locator('[data-action="cancel-locale-defaults"]').evaluate(look);
  const apply = await page.locator('[data-action="apply-locale-defaults"]').evaluate(look);
  expect(cancel.h).toBe(48);
  expect(apply.h).toBe(48);
  expect(Math.abs(cancel.w - apply.w)).toBeLessThanOrEqual(1);
  expect(apply.mb).toBe('10px');
});

test('② 合并提示两键等宽、48 高、无下边距', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh', width: 320,
    config: { version: 1, mainline: ['求职推进', '阅读', 'blog'], chips: [] },
    entries: [{ id: 'a', ts: '2026-06-29T08:00', what: '读书', tags: ['阅读'] }, { id: 'b', ts: '2026-06-29T09:00', what: '写博客', tags: ['blog'] }]
  });
  await page.locator('[data-action="open-more"]').click();
  await page.locator('[data-action="open-tag-config"]').click();
  const row = page.locator('.cfg-row[data-original-name="blog"]');
  const face = row.locator(':scope > .cfg-chip');
  if (!(await face.isVisible())) await page.locator('.cfg-fold').first().click();
  await face.click();
  await row.locator('.cfg-name').fill('阅读');
  await page.locator('#form-sheet .sh-done').click();
  await expect(page.locator('[data-action="confirm-tag-merge"]')).toBeVisible();
  const keep = await page.locator('[data-action="dismiss-tag-merge"]').evaluate(look);
  const merge = await page.locator('[data-action="confirm-tag-merge"]').evaluate(look);
  expect(keep.h).toBe(48);
  expect(merge.h).toBe(48);
  expect(Math.abs(keep.w - merge.w)).toBeLessThanOrEqual(1);
  expect(keep.mb).toBe('0px');
});

test('③ 标签 chip 按住时变淡，松开复原', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await page.locator('#add-btn').click();
  const chip = page.locator('#form-chips .chip').first();
  await expect(chip).toBeVisible();
  const box = await chip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // 一次性读取：按住期间 :active 必然生效，不存在「还没来得及」的竞态。
  expect(await chip.evaluate(el => getComputedStyle(el).opacity)).toBe('0.75');
  await page.mouse.up();
  await expect.poll(() => chip.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
});

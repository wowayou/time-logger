// v1.15.0 · tooltip 不出界。
//
// 现象：气泡以按钮为中心展开，贴边的按钮（header「···」、年、下一段、回到今天…）会伸出视口；
// 且悬停时宽度立即生效（只是 800ms 后才可见），隐藏的宽盒子照样撑宽页面——390px 下悬停「···」
// scrollWidth 从 390 变 481（v1.14.0 起即有；保存后指针停在「完成」原处，表单一关就悬停在
// 「···」上，同样复现）。红线：tooltip 不能生成撑宽页面的盒子。
//
// 锁的是：各宽度下悬停每个带 data-tip 的按钮，页面不变宽，800ms 后气泡完整落在视口内；键盘
// 聚焦立即显示且同样在视口内；表单关闭后指针原地不动也不撑宽；悬停延迟与聚焦无延迟不变。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot } from './ui_fixture.js';

async function tipBox(locator) {
  return locator.evaluate(btn => {
    const s = getComputedStyle(btn, '::after');
    const r = btn.getBoundingClientRect();
    const m = /matrix\(([^)]+)\)/.exec(s.transform);
    const tx = m ? Number(m[1].split(',')[4]) : 0;
    const w = parseFloat(s.width) + parseFloat(s.paddingLeft) + parseFloat(s.paddingRight);
    const left = r.left + r.width / 2 + tx;
    return {
      left,
      right: left + w,
      width: w,
      visibility: s.visibility,
      // 可用宽度：scrollbar-gutter: stable 时 Chromium 的 clientWidth 含滚动条槽，取 html 自身宽度较小者。
      vw: Math.min(document.documentElement.clientWidth, document.documentElement.getBoundingClientRect().width),
      sw: document.documentElement.scrollWidth
    };
  });
}

async function expectInside(locator, label) {
  const box = await tipBox(locator);
  expect(box.visibility, `${label} visible`).toBe('visible');
  expect(box.width, `${label} has width`).toBeGreaterThan(20);
  expect(box.left, `${label} left edge`).toBeGreaterThanOrEqual(0);
  expect(box.right, `${label} right edge`).toBeLessThanOrEqual(box.vw);
  expect(box.sw, `${label} page width`).toBeLessThanOrEqual(box.vw);
}

for (const width of [320, 390, 768, 1280]) {
  test(`${width}px：悬停每个 header / 导航按钮，页面不变宽，气泡落在视口内`, async ({ page }) => {
    await boot(page, width, 'tail-placeholder', false, FIXED_NOW);
    // 翻到上一天，让「回到今天」出现。
    await page.locator('[data-action="shift-period"][data-delta="-1"]').click();
    const buttons = page.locator('.hdr button[data-tip], .view-box button[data-tip]');
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(8);
    for (let i = 0; i < count; i += 1) {
      const btn = buttons.nth(i);
      if (!(await btn.isVisible())) continue;
      const label = `${await btn.getAttribute('data-action')}#${i}`;
      await btn.hover();
      // 悬停当下（还没显示）页面就不能变宽。
      const now = await page.evaluate(() => [document.documentElement.scrollWidth, Math.min(document.documentElement.clientWidth, document.documentElement.getBoundingClientRect().width)]);
      expect(now[0], `${label} immediate`).toBeLessThanOrEqual(now[1]);
      await page.waitForTimeout(900);
      await expectInside(btn, label);
    }
  });
}

test('390px：悬停 800ms 前不显示，键盘聚焦立即显示且在视口内', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  const more = page.locator('[data-action="open-more"]');
  await more.hover();
  await page.waitForTimeout(300);
  expect((await tipBox(more)).visibility).toBe('hidden');
  await page.mouse.move(10, 600);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(more).toBeFocused();
  await expectInside(more, 'focused more');
});

test('390px：保存后指针停在原处、表单关闭露出「···」，页面不变宽', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('合成悬停');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  const box = await page.locator('#form-sheet .sh-done').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#form-sheet')).toBeHidden();
  await page.waitForTimeout(1000);
  const dims = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(dims[0]).toBeLessThanOrEqual(dims[1]);
});

test('390px：周视图下钻按钮与时间选择器「现在」的气泡也在视口内', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, '2026-06-24T14:00:00');
  await page.locator('[data-action="view"][data-view="week"]').click();
  const drills = page.locator('button[data-action="drill"][data-tip]');
  await expect(drills.first()).toBeVisible();
  await drills.first().hover();
  await page.waitForTimeout(900);
  await expectInside(drills.first(), 'drill');

  await page.locator('[data-action="view"][data-view="day"]').click();
  await page.locator('#add-btn').click();
  await page.locator('[data-action="toggle-start-time"]').click();
  const now = page.locator('#form-sheet button[data-tip]').first();
  await expect(now).toBeVisible();
  await now.hover();
  await page.waitForTimeout(900);
  const tip = await tipBox(now);
  expect(tip.visibility).toBe('visible');
  expect(tip.left).toBeGreaterThanOrEqual(0);
  expect(tip.right).toBeLessThanOrEqual(tip.vw);
});

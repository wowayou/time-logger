// Native Contract 验证：Web → Android 契约声明的 selector 在真实渲染 DOM 中必须可用。
// audit_native_contract() 只做静态文本预检，这里用 Playwright 验证完整 selector。
//
// 红灯纪律：守护的红灯以「临时变异 → 上面的用例（或安卓对侧闸）必须红 → 恢复」的
// 过程证据为准（见提交 9699781 / 0cf0338 与 docs/HANDOFF.md）。套件里不保留
// 「先破坏 DOM 再断言命中 0」的自证式用例——它们验证的是 CSS 选择器语义而非应用，
// 无论契约怎么被破坏都照样绿，不是哨兵。
import { expect, test } from '@playwright/test';
import { boot } from './ui_fixture.js';

test('native contract: all selectors resolve in the rendered DOM', async ({ page }) => {
  await boot(page, 768, 'one-record');

  // 读取契约
  const contract = await page.evaluate(async () => {
    const resp = await fetch('/native-contract.json');
    return resp.json();
  });

  expect(contract.version).toBe(1);
  expect(contract.selectors).toBeInstanceOf(Array);

  for (const selector of contract.selectors) {
    // #form-* 相关 selector 需要打开表单才能验证
    if (selector.includes('#form-')) {
      await page.locator('#add-btn').click();
      await expect(page.locator('#form-sheet')).toBeVisible();
    }

    // 验证 selector 能命中至少一个元素（querySelector 返回非 null）
    const count = await page.locator(selector).count();
    expect(count, `selector "${selector}" 必须在真实 DOM 中命中至少一个元素`).toBeGreaterThan(0);

    // 关闭表单，恢复初始状态
    if (selector.includes('#form-')) {
      await page.keyboard.press('Escape');
      await expect(page.locator('#form-sheet')).toBeHidden();
    }
  }
});

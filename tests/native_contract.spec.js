// Native Contract 验证：Web → Android 契约声明的 selector 在真实渲染 DOM 中必须可用。
// audit_native_contract() 只做静态文本预检，这里用 Playwright 验证完整 selector。
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

test('native contract REDLIGHT: removing .chip class breaks the contract', async ({ page }) => {
  // 临时注入破坏：移除所有 chip 按钮的 .chip class
  await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      const observer = new MutationObserver(() => {
        const chips = document.querySelectorAll('.chip');
        if (chips.length > 0) {
          chips.forEach(chip => chip.classList.remove('chip'));
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  });

  await boot(page, 768, 'one-record');
  await page.locator('#add-btn').click();
  await expect(page.locator('#form-sheet')).toBeVisible();

  // 契约 selector `#form-chips .chip[data-tag]` 应该命中 0 个（因为 .chip 已被移除）
  const count = await page.locator('#form-chips .chip[data-tag]').count();
  expect(count, 'class 被破坏后 selector 不得命中').toBe(0);
});

test('native contract REDLIGHT: moving chip buttons outside container breaks the contract', async ({ page }) => {
  // 临时注入破坏：把所有 chip 按钮移出 #form-chips 容器
  await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      const observer = new MutationObserver(() => {
        const container = document.querySelector('#form-chips');
        const chips = container?.querySelectorAll('.chip');
        if (chips && chips.length > 0) {
          chips.forEach(chip => document.body.appendChild(chip));
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  });

  await boot(page, 768, 'one-record');
  await page.locator('#add-btn').click();
  await expect(page.locator('#form-sheet')).toBeVisible();

  // 契约 selector `#form-chips .chip[data-tag]` 应该命中 0 个（按钮已移出容器）
  const count = await page.locator('#form-chips .chip[data-tag]').count();
  expect(count, '按钮移出容器后 selector 不得命中').toBe(0);
});

test('native contract REDLIGHT: removing GitHub link breaks the contract', async ({ page }) => {
  // 临时注入破坏：删除所有 GitHub 链接
  await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('a[href^="https://github.com"]').forEach(a => a.remove());
    });
  });

  await boot(page, 768, 'one-record');

  // 契约 selector `a[href^="https://github.com"]` 应该命中 0 个
  const count = await page.locator('a[href^="https://github.com"]').count();
  expect(count, 'GitHub 链接被删除后 selector 不得命中').toBe(0);
});

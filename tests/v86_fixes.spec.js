// v86：v84/v85 真机验收第二轮的反馈（`docs/device-acceptance.md`）。
import { expect, test } from '@playwright/test';
import { bootLocale } from './i18n_fixture.js';

const MANY_CHIPS = {
  version: 1,
  mainline: ['求职推进'],
  chips: Array.from({ length: 12 }, (_, i) => ({
    name: `标签${i + 1}`, bucket: i % 2 ? 'leak' : 'maintain', longOk: false
  }))
};

async function openConfig(page) {
  await page.locator('[data-action="open-more"]').click();
  await page.getByRole('button', { name: '配置标签' }).click();
  await expect(page.locator('#form-sheet-title')).toHaveText('标签高级设置');
}

// 判据必须是「在视口里」，不是「在布局里」。v84 把滚动目标改成出错行之后，错误条
// 留在了正文末尾的屏幕外——`toBeVisible()` 照样通过（它只看盒子非空、没被
// display:none），于是真机上「保存被拦下却没有任何提示」溜了过去。
async function expectInViewport(locator) {
  const box = await locator.boundingBox();
  expect(box, 'element has no box').not.toBeNull();
  const view = await locator.page().viewportSize();
  expect(box.y + box.height).toBeGreaterThan(0);
  expect(box.y).toBeLessThan(view.height);
}

test('v86: a blocked save shows the message on screen, not below the fold', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: MANY_CHIPS, width: 390, height: 700 });
  await openConfig(page);
  const row = page.locator('.cfg-row[data-original-name="标签1"]');
  await row.locator('.cfg-name').fill('');
  await page.getByRole('button', { name: '保存标签配置' }).click();

  const error = page.locator('[data-role="config-error"]');
  await expect(error).toBeVisible();
  await expectInViewport(error);          // ← v84 的缺陷正是在这一条上漏掉的
  await expectInViewport(row);            // 出错行也仍在视口里（v84 的行为保留）
  await expect(row.locator('.cfg-name')).toBeFocused();
});

test('v86: the same holds for the reserved name and duplicate blocks', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: MANY_CHIPS, width: 390, height: 700 });
  await openConfig(page);
  await page.locator('.cfg-section').filter({ hasText: '维持标签' }).locator('[data-action="cfg-add-row"]').click();
  await page.locator('.cfg-row[data-new="1"] .cfg-name').fill('未知');
  await page.getByRole('button', { name: '保存标签配置' }).click();
  await expectInViewport(page.locator('[data-role="config-error"]'));
  await expect(page.locator('[data-role="config-error"]')).toContainText('保留名');

  await page.locator('.cfg-row[data-new="1"] .cfg-name').fill('标签1');
  await page.getByRole('button', { name: '保存标签配置' }).click();
  await expectInViewport(page.locator('[data-role="config-error"]'));
  await expect(page.locator('[data-role="config-error"]')).toContainText('重复');
});

test('v86: the root scrollbar takes no space on narrow screens (white-edge candidate)', async ({ page }) => {
  // 真机录屏逐帧确认：窗口右缘那道浅色带内部有滚动条滑块——是经典滚动条占的轨道。
  // 无头 Chromium 一律 overlay 滚动条，量不出宽度差，所以这里只能锁**声明**；
  // 视觉确认必须回到真机（已写进 docs/device-acceptance.md）。
  await bootLocale(page, { locale: 'zh', width: 390, height: 800 });
  const narrow = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { width: cs.scrollbarWidth, gutter: cs.scrollbarGutter };
  });
  expect(narrow).toEqual({ width: 'none', gutter: 'auto' });

  await page.setViewportSize({ width: 900, height: 800 });
  const wide = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { width: cs.scrollbarWidth, gutter: cs.scrollbarGutter };
  });
  // 桌面保留滚动条与稳定 gutter（滚动位置指示 + 不因内容长短抖动）。
  expect(wide).toEqual({ width: 'auto', gutter: 'stable' });
});

test('v86: a frozen minute self-heals on the next touch', async ({ page }) => {
  // 真机：应用一直在前台，界面却停在一两分钟前（定时器被系统冻住，且没有
  // visibilitychange/focus 把我们叫醒）。判据是「碰一下就该是当前时间」。
  await bootLocale(page, {
    locale: 'zh',
    now: '2026-06-29T12:34:30',
    entries: [{ id: 'a', ts: '2026-06-29T09:00', what: '写代码', tags: ['求职推进'] }]
  });
  await expect(page.locator('.hero-aux')).toContainText('截至 12:34');

  // 把时钟往前推两分钟，并**不**触发任何定时器/可见性事件——模拟被冻住的进程。
  await page.evaluate(() => {
    const RealDate = window.Date;
    const shifted = new RealDate('2026-06-29T12:36:30').getTime();
    class Shifted extends RealDate {
      constructor(...args) { super(...(args.length ? args : [shifted])); }
      static now() { return shifted; }
      static parse(v) { return RealDate.parse(v); }
      static UTC(...a) { return RealDate.UTC(...a); }
    }
    window.Date = Shifted;
  });
  await expect(page.locator('.hero-aux')).toContainText('截至 12:34');  // 还没碰，仍然过期

  await page.locator('.tl-head').click();
  await expect(page.locator('.hero-aux')).toContainText('截至 12:36');
});

test('v86: the self-heal must not swallow the tap that triggered it', async ({ page }) => {
  // 第一版挂在 pointerdown 上：重渲染把正在被点的元素换掉，随后的 click 落在脱离
  // 文档的节点上，永远到不了事件委托——一次点击被自己吞掉。判据就是「点 FAB 要
  // 真的打开新增 sheet」，即使这一下同时触发了自愈。
  await bootLocale(page, {
    locale: 'zh',
    now: '2026-06-29T12:34:30',
    entries: [{ id: 'a', ts: '2026-06-29T09:00', what: '写代码', tags: ['求职推进'] }]
  });
  await page.evaluate(() => {
    const RealDate = window.Date;
    const shifted = new RealDate('2026-06-29T12:36:30').getTime();
    class Shifted extends RealDate {
      constructor(...args) { super(...(args.length ? args : [shifted])); }
      static now() { return shifted; }
      static parse(v) { return RealDate.parse(v); }
      static UTC(...a) { return RealDate.UTC(...a); }
    }
    window.Date = Shifted;
  });
  await page.locator('#add-btn').click();
  await expect(page.locator('#form-sheet-title')).toBeVisible();
  await expect(page.locator('#form-sheet')).not.toBeHidden();
});

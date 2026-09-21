// v1.1.0 · D30（修订 D28）：「更多」里的自愿支持入口。
//
// 这个文件锁的不是「有没有一条链接」——那是一行 HTML，坏了一眼就能看见。它锁的是
// 三条**容易在将来被顺手改坏、而且改坏了不报错**的边界：
//
// ① URL 逐字。`?from=time-logger` 是 D30 登记的来源 allowlist 取值，归因按它逐字
//    聚合；漏掉参数或写成 `timelogger` 之类的变体，页面照常打开、CTA 照常能点，
//    只有归因数据静默分叉——没有任何用户可见症状。
// ② URL **不按 locale 分流**。旁边的 PRIVACY_URL 就是分流的，照抄它是最自然的
//    「顺手改进」，代价同样是静默的：两种语言落进两个来源桶。
// ③ 应用内**零支付界面**（D28 第 2 条）。把 SUPPORT_URL 直接指向收款平台会让
//    中转页的解耦失效（换平台就要发一版 PWA），也越过 D28；同样零报错。
//
// 另外把 D28 第 4 条的「应用内诚实声明」从文字承诺变成可执行判据：那一条明写
// 「删除或弱化这三处任一处，等于推翻本条」，所以它该有判据守着，而不是靠记性。
import { expect, test } from '@playwright/test';
import { boot, openBackupMenu } from './ui_fixture.js';
import { bootLocale } from './i18n_fixture.js';

const SUPPORT_URL = 'https://eigentime.org/support?from=time-logger';
const supportLink = page => page.locator(`#form-sheet a[href="${SUPPORT_URL}"]`);

// ① zh：入口在「更多」里，URL 逐字，外链属性齐全，且排在版本号一带（不抢常用
// 路径的前几组）。位置判据用 DOM 顺序而不是像素：它只需要「在高级之后」，不需要
// 固定到某个坐标。
test('「更多」里有支持作者外链，URL 逐字且不抢常用路径的位置', async ({ page }) => {
  await boot(page, 390, 'one-record');
  await openBackupMenu(page);

  const link = supportLink(page);
  await expect(link).toBeVisible();
  await expect(link).toHaveText(/支持作者/);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);

  // 逐字：不是 toContain，而是整串相等——`from` 参数丢了照样能打开页面，只有
  // 归因静默分叉，所以判据必须严到一个字符。
  expect(await link.getAttribute('href')).toBe(SUPPORT_URL);

  // 位置：排在「高级」之后。support 不是设置项，不得挤进摘要/备份/设置那几组。
  const order = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#form-sheet .cell-btn')];
    return cells.map(el => el.getAttribute('data-action') || el.getAttribute('href') || '');
  });
  const advanced = order.indexOf('open-advanced');
  const support = order.findIndex(v => v.includes('eigentime.org/support'));
  expect(advanced).toBeGreaterThan(-1);
  expect(support).toBeGreaterThan(advanced);
});

// ② en：同一个 URL，**逐字相同**。这是反向哨兵——PRIVACY_URL 就在它上面几行且
// 按 locale 分流，照抄那个模式是最容易发生的改动，而后果（来源桶被拆成两份）
// 在界面上完全看不出来。
test('英文界面用同一个支持 URL——来源参数不按 locale 分流', async ({ page }) => {
  await bootLocale(page, { entries: [] });
  await page.getByRole('button', { name: 'Open the more menu' }).click();
  await expect(page.locator('#form-sheet-title')).toHaveText('More');

  const link = supportLink(page);
  await expect(link).toBeVisible();
  await expect(link).toHaveText(/Support the author/);
  expect(await link.getAttribute('href')).toBe(SUPPORT_URL);

  // 同一处顺带断英文那份诚实声明（D28 第 4 条对两种语言同等有效）；sheet 已经
  // 开着，不值得为它再启一次页面。
  const hint = page.locator('#form-sheet .form-hint').filter({ hasText: 'voluntary' });
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('Entirely voluntary');
  await expect(hint).toContainText('stays free');
  await expect(hint).toContainText('buys no features');
});

// ③ D28 第 4 条：应用内诚实声明。三要素各断一句，不整句逐字比对——要锁的是
// 「这层意思不得被删或弱化」，不是某一种措辞。
test('支持入口旁给出三条事实：自愿、功能始终免费、不购买任何东西', async ({ page }) => {
  await boot(page, 390, 'one-record');
  await openBackupMenu(page);
  const hint = page.locator('#form-sheet .form-hint').filter({ hasText: '自愿' });
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('完全自愿');
  await expect(hint).toContainText('始终免费');
  await expect(hint).toContainText('不购买任何功能');
});

// ④ 规格「明确禁止」→ 判据：核心记录流程里不得出现支持入口。日视图主界面
// （hero / 时间轴 / FAB）零链接，新建表单里零链接。
test('核心记录流程零打扰：主界面与新建表单里都没有支持入口', async ({ page }) => {
  await boot(page, 390, 'one-record');

  // 主界面（更多 sheet 未打开时）。
  await expect(page.locator('a[href*="eigentime.org/support"]')).toHaveCount(0);

  // 新建表单——记录流程的入口，规格点名不得在此弹赞助。
  await page.locator('#add-btn').click();
  await expect(page.locator('#form-sheet')).toBeVisible();
  await expect(page.locator('#form-what')).toBeVisible();
  await expect(page.locator('a[href*="eigentime.org/support"]')).toHaveCount(0);
});

// ⑤ D28 第 2 条「应用内不放任何支付界面」：收款平台只存在于站外中转页，应用
// 内连它的名字都不该出现。这同时锁死「把 SUPPORT_URL 改成直连平台」这种会让
// 中转页解耦失效的改动（规格 §13 也明文禁止直指 Afdian）。
// 顺带覆盖 P34 的矮视口：375×600 + 打开「更多」，入口仍可达、未被裁掉。
test('应用内不直连收款平台，矮视口下入口仍可达', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 600 });
  await boot(page, 375, 'one-record');
  await openBackupMenu(page);

  const link = supportLink(page);
  await expect(link).toBeVisible();
  await link.scrollIntoViewIfNeeded();
  const box = await link.boundingBox();
  expect(box.height).toBeGreaterThan(0);

  // 全 DOM 无收款平台痕迹：既没有直连链接，文案里也不出现平台名。
  await expect(page.locator('a[href*="afdian"]')).toHaveCount(0);
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/afdian|爱发电/i);
});

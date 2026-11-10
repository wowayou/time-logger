// D30 → D35: static product support page, with locale-specific paths and the
// same source parameter. Core flows remain free of payment UI and support prompts.
import { expect, test } from '@playwright/test';
import { boot, openBackupMenu } from './ui_fixture.js';
import { bootLocale } from './i18n_fixture.js';

const SUPPORT_URL = 'https://time.eigentime.org/support/?from=time-logger';
const SUPPORT_URL_EN = 'https://time.eigentime.org/en/support/?from=time-logger';
const supportLink = (page, url = SUPPORT_URL) => page.locator(`#form-sheet a[href="${url}"]`);

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

  // 本站入口与固定来源参数保持一致；支付平台不能进入应用。
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

// Both locales keep the same from parameter; the static page has no redirect or analytics.
test('英文界面打开英文支持页，来源参数保持一致', async ({ page }) => {
  await bootLocale(page, { entries: [] });
  await page.getByRole('button', { name: 'Open the more menu' }).click();
  await expect(page.locator('#form-sheet-title')).toHaveText('More');

  const link = supportLink(page, SUPPORT_URL_EN);
  await expect(link).toBeVisible();
  await expect(link).toHaveText(/Support the author/);
  expect(await link.getAttribute('href')).toBe(SUPPORT_URL_EN);

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
  await expect(page.locator('a[href*="/support"]')).toHaveCount(0);

  // 新建表单——记录流程的入口，规格点名不得在此弹赞助。
  await page.locator('#add-btn').click();
  await expect(page.locator('#form-sheet')).toBeVisible();
  await expect(page.locator('#form-what')).toBeVisible();
  await expect(page.locator('a[href*="/support"]')).toHaveCount(0);
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

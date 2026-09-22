// v1.3.0 · 时间拨号盘分析页（「更多」下的只读可视化）。
//
// 锁的是「纯逻辑接进了 UI 且真能用」这条链，而不是像素：
// ① 入口在「更多」里，点开渲出拨号盘（四桶 + 标签键）；
// ② 顶部结论区把 comparePeriods/periodTrend 的产物摆出来——主线时长、对比上期
//    delta、上升趋势文案（本夹具主线逐周 +30min，已完成周应判「走高」）；
// ③ 区间切换（周/月/年）就地重渲，不整层关；
// ④ 点某个拨号键切换结论区，再点一次回主线；
// ⑤「接通」把本期摘要复制到剪贴板（含期标题与桶占比）；
// ⑥ 全程零 pageerror——运行时崩溃（缺 import、坏引用）在这里现形，node --check 抓不到。
import { expect, test } from '@playwright/test';
import { boot, openBackupMenu } from './ui_fixture.js';

// 周三 14:00：本周进行中（Mon–Wed 已历），上期同步进度对比与「已历天数」覆盖率都成立。
const WED_NOW = '2026-06-24T14:00:00';

function trackPageErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return errors;
}

async function openAnalytics(page) {
  await openBackupMenu(page);
  await page.locator('[data-action="open-analytics"]').click();
  await expect(page.locator('#form-sheet-title')).toHaveText('时间拨号盘');
}

// ① + ⑥：入口打开、拨号盘渲染、无运行时崩溃。
test('「更多」里打开时间拨号盘，渲出四桶键与标签键，零 pageerror', async ({ page }) => {
  const errors = trackPageErrors(page);
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  await openAnalytics(page);

  // 四桶键恒在（前 4 格）。
  const tiles = page.locator('#form-sheet .an-tile');
  expect(await tiles.count()).toBeGreaterThanOrEqual(4);
  // 主线桶键：按 data-key 精确定位（文字 hasText 会被标签名互相包含误伤）。
  await expect(page.locator('#form-sheet .an-tile[data-key="b:job"]')).toHaveCount(1);
  // 标签键：求职推进（主线标签）与睡觉（维持）都被记过，应出现在拨号盘里。
  // 注意 what=写代码 只是内容文字，tag 才是「求职推进」——tagMinutes 按 tag 聚合。
  await expect(page.locator('#form-sheet .an-tile[data-key="t:求职推进"]')).toHaveCount(1);
  await expect(page.locator('#form-sheet .an-tile[data-key="t:睡觉"]')).toHaveCount(1);

  expect(errors).toEqual([]);
});

// ②：顶部结论区把 periodTrend 的「走高」摆出来（主线逐周上升）。
test('结论区默认显示主线，且已完成周上升时给出走高趋势', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  await openAnalytics(page);

  // headline 非空（主线时长）。
  const headline = page.locator('#form-sheet .an-headline');
  await expect(headline).toBeVisible();
  expect((await headline.innerText()).trim().length).toBeGreaterThan(0);

  // 趋势：主线逐周 +30min，已完成周（不含进行中的本周）应判走高。
  await expect(page.locator('#form-sheet .an-trend')).toContainText('走高');
  // 覆盖率行摆出来。
  await expect(page.locator('#form-sheet .an-coverage')).toContainText('记录覆盖');
});

// ③：区间切换就地重渲，不关 sheet。
test('切到「年」就地重渲，sheet 不关、标题不变', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  await openAnalytics(page);

  await page.locator('#form-sheet [data-action="analytics-period"][data-period="year"]').click();
  // 还在拨号盘 sheet 里。
  await expect(page.locator('#form-sheet-title')).toHaveText('时间拨号盘');
  // 年按钮进入选中态。
  await expect(page.locator('#form-sheet [data-action="analytics-period"][data-period="year"]'))
    .toHaveAttribute('aria-pressed', 'true');
  // 四桶键仍在。
  expect(await page.locator('#form-sheet .an-tile').count()).toBeGreaterThanOrEqual(4);
});

// ④：点标签键切换结论区，再点一次回主线。
test('点某个键切换结论区，再点一次返回主线', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  await openAnalytics(page);

  const codeTile = page.locator('#form-sheet .an-tile[data-key="t:求职推进"]');
  await codeTile.click();
  // subline 出现「再点一次返回」提示（非默认键）。
  await expect(page.locator('#form-sheet .an-subline')).toContainText('再点一次返回');
  await expect(codeTile).toHaveAttribute('aria-pressed', 'true');

  // 再点回主线：提示消失。
  await codeTile.click();
  await expect(page.locator('#form-sheet .an-subline')).not.toContainText('再点一次返回');
});

// ⑤：「接通」复制本期摘要到剪贴板。
test('接通把本期摘要复制到剪贴板，含期标题与桶占比', async ({ page }) => {
  await page.addInitScript(() => {
    window.__copiedAnalytics = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: text => { window.__copiedAnalytics = text; return Promise.resolve(); } }
    });
  });
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  await openAnalytics(page);

  await page.locator('#form-sheet [data-action="analytics-summary"]').click();
  await page.waitForFunction(() => window.__copiedAnalytics && window.__copiedAnalytics.length > 0);
  const text = await page.evaluate(() => window.__copiedAnalytics);
  expect(text).toContain('# 时间尺 · ');
  expect(text).toContain('## 桶占比');
  expect(text).toContain('主线');
  expect(text).toContain('## Top 标签');
  expect(text).toContain('#求职推进');
});

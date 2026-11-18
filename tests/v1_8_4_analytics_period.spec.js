// v1.8.4 · 时间分析跟随所看周期。
//
// 此前分析页固定用今天的日期：主视图翻到上周/上个月再打开，看到的仍是本周。
// 现在锚定主视图所看的日期——周/月/年视图沿用当前粒度，天视图从所在的周开始；
// 所看日期在未来时退回今天（未来周期没有已发生记录可分析）。
//
// 夹具 analytics-weeks（见 ui_fixture.js）：从 5 周前的周一起连续 6 周、每个工作日
// 09:00 起「写代码」（主线），第 w 周每天 60+30w 分钟。配周三 14:00 的冻结时钟：
//   本周（w=5，已历周一到周三）主线 210×3 = 630min → 10h30min
//   上周（w=4）主线 180×5 = 900min → 15h
//   五月（w=0、w=1 两周都在 5 月）60×5 + 90×5 = 750min → 12h30min
import { expect, test } from '@playwright/test';
import { boot, openBackupMenu } from './ui_fixture.js';

const WED_NOW = '2026-06-24T14:00:00';

async function openAnalytics(page) {
  await openBackupMenu(page);
  await page.locator('[data-action="open-analytics"]').click();
  await expect(page.locator('#form-sheet-title')).toHaveText('时间分析');
}

// 期标签用应用自己的 periodLabel 现算，不在用例里手写日期格式。
async function expectedLabel(page, view, dateKey) {
  return page.evaluate(async ([v, d]) => {
    const { periodLabel } = await import('/src/time.js');
    return periodLabel(v, d);
  }, [view, dateKey]);
}

async function expectPeriodTab(page, view) {
  for (const v of ['week', 'month', 'year']) {
    await expect(page.locator(`#form-sheet [data-action="analytics-period"][data-period="${v}"]`))
      .toHaveAttribute('aria-pressed', String(v === view));
  }
}

test('天视图翻到上周的某天再打开，分析的是上周整周', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await boot(page, 390, 'analytics-weeks', false, WED_NOW, -7);
  await openAnalytics(page);

  await expectPeriodTab(page, 'week');
  await expect(page.locator('#form-sheet .an-period-label')).toHaveText(await expectedLabel(page, 'week', '2026-06-17'));
  await expect(page.locator('#form-sheet .an-headline')).toHaveText('15h');
  // 已结束的整周，覆盖率分母是整周 7 天。
  await expect(page.locator('#form-sheet .an-coverage')).toContainText('5/7 天');
  expect(errors).toEqual([]);
});

// 哨兵：停在今天时行为不变（改动前后都应通过）。
test('停在今天时仍分析本周（同步进度）', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  await openAnalytics(page);

  await expectPeriodTab(page, 'week');
  await expect(page.locator('#form-sheet .an-period-label')).toHaveText(await expectedLabel(page, 'week', '2026-06-24'));
  await expect(page.locator('#form-sheet .an-headline')).toHaveText('10h30min');
  await expect(page.locator('#form-sheet .an-coverage')).toContainText('3/3 天');
});

test('月视图停在上个月时，打开即是那个月；在分析页切到年仍锚定同一日期', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW, -30);
  await page.locator('[data-action="view"][data-view="month"]').click();
  await openAnalytics(page);

  await expectPeriodTab(page, 'month');
  await expect(page.locator('#form-sheet .an-period-label')).toHaveText(await expectedLabel(page, 'month', '2026-05-25'));
  await expect(page.locator('#form-sheet .an-headline')).toHaveText('12h30min');

  await page.locator('#form-sheet [data-action="analytics-period"][data-period="week"]').click();
  await expect(page.locator('#form-sheet .an-period-label')).toHaveText(await expectedLabel(page, 'week', '2026-05-25'));
  // 05-25 所在周就是夹具的 w=1：90×5。
  await expect(page.locator('#form-sheet .an-headline')).toHaveText('7h30min');

  await page.locator('#form-sheet [data-action="analytics-period"][data-period="year"]').click();
  await expectPeriodTab(page, 'year');
  await expect(page.locator('#form-sheet .an-period-label')).toHaveText(await expectedLabel(page, 'year', '2026-05-25'));
});

test('年视图打开即选中「年」', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  await page.locator('[data-action="view"][data-view="year"]').click();
  await openAnalytics(page);
  await expectPeriodTab(page, 'year');
});

test('所看日期在未来时退回今天所在的周', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW, 7);
  await openAnalytics(page);

  await expectPeriodTab(page, 'week');
  await expect(page.locator('#form-sheet .an-period-label')).toHaveText(await expectedLabel(page, 'week', '2026-06-24'));
  await expect(page.locator('#form-sheet .an-headline')).toHaveText('10h30min');
});

test('复制的摘要标题是所看的那一期', async ({ page }) => {
  await page.addInitScript(() => {
    window.__copiedAnalytics = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: text => { window.__copiedAnalytics = text; return Promise.resolve(); } }
    });
  });
  await boot(page, 390, 'analytics-weeks', false, WED_NOW, -7);
  await openAnalytics(page);

  await page.locator('#form-sheet [data-action="analytics-summary"]').click();
  await page.waitForFunction(() => window.__copiedAnalytics && window.__copiedAnalytics.length > 0);
  const text = await page.evaluate(() => window.__copiedAnalytics);
  expect(text.split('\n')[0]).toBe(`# 时间尺 · ${await expectedLabel(page, 'week', '2026-06-17')}`);
  expect(text).toContain('15h');
});

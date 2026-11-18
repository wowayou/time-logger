// v1.9.0 · 时间分析的事项排行与关键词汇总。
//
// 锁的是：同一标签下正文相同（规整后）的记录归成一件事、按时长排行；跟随选中的键；
// 未记录桶没有事项；关键词跨桶汇总且输入时不丢焦点；只出现一次的事项整行跳到那天，
// 多次的展开日期再跳；超过 8 项可展开全部；复制的摘要附排行；窄屏不横向溢出。
//
// 夹具 analytics-weeks + 周三 14:00：本周一到周三每天 09:00「写代码」#求职推进 210min，
// 随后「睡觉」#睡觉 跨夜到次日 09:00。
import { expect, test } from '@playwright/test';
import { boot, expectNoHorizontalOverflow, openBackupMenu } from './ui_fixture.js';

const WED_NOW = '2026-06-24T14:00:00';

async function openAnalytics(page) {
  await openBackupMenu(page);
  await page.locator('[data-action="open-analytics"]').click();
  await expect(page.locator('#form-sheet-title')).toHaveText('时间分析');
}

// boot() 每次加载都清空存储，自定义数据要在它之后追加 init script 再刷新。
async function seed(page, entries) {
  await page.addInitScript(list => localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries: list })), entries);
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
}

const rows = page => page.locator('#form-sheet .an-items-ol > .an-item');

test('默认按主线列出事项：同一正文归成一件、标出次数，展开日期后能跳到那天', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  await openAnalytics(page);

  await expect(page.locator('#form-sheet .an-items-head')).toHaveText('事项排行');
  await expect(page.locator('#form-sheet .an-items-cap')).toHaveText('主线 · 共 1 项');
  await expect(rows(page)).toHaveCount(1);
  const row = rows(page).first().locator('.an-item-row');
  await expect(row.locator('.an-item-text')).toHaveText('写代码');
  await expect(row.locator('.an-item-dur')).toHaveText('10h30min');
  await expect(row.locator('.an-item-meta')).toContainText('#求职推进 · ×3');
  await expect(row).toHaveAttribute('aria-expanded', 'false');

  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(row).toBeFocused();
  const dates = page.locator('#form-sheet .an-occ-row');
  await expect(dates).toHaveCount(3);
  // 日期倒序：最近的在上。
  await expect(dates.first()).toHaveAttribute('data-date', '2026-06-24');
  await expect(dates.last()).toHaveAttribute('data-date', '2026-06-22');

  await dates.last().click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  await expect(page.locator('[data-action="view"][data-view="day"]')).toHaveClass(/active/);
  await expect(page.locator('#period-label')).toContainText('06/22');
  expect(errors).toEqual([]);
});

test('排行跟随选中的键；未记录桶没有事项', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  await openAnalytics(page);

  await page.locator('#form-sheet .an-tile[data-key="t:睡觉"]').click();
  await expect(page.locator('#form-sheet .an-items-cap')).toHaveText('#睡觉 · 共 1 项');
  // 选中标签时不再重复标签名，只显示次数。
  await expect(rows(page).first().locator('.an-item-meta')).toHaveText('×3');

  await page.locator('#form-sheet .an-tile[data-key="b:unrecorded"]').click();
  await expect(page.locator('#form-sheet .an-items-cap')).toContainText('未记录的时间没有事项');
  await expect(rows(page)).toHaveCount(0);
});

test('关键词跨桶汇总，输入时焦点留在输入框；无匹配时说清楚', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  await openAnalytics(page);

  const input = page.locator('#form-sheet [data-role="an-query"]');
  await input.click();
  await page.keyboard.type('代码');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('代码');
  await expect(page.locator('#form-sheet .an-items-cap')).toHaveText('含「代码」：共 10h30min · 3 条');

  await input.fill('睡');
  await expect(page.locator('#form-sheet .an-items-cap')).toContainText('含「睡」');
  await expect(rows(page).first().locator('.an-item-meta')).toContainText('#睡觉');

  await input.fill('不存在的词');
  await expect(page.locator('#form-sheet .an-items-cap')).toHaveText('本期没有含「不存在的词」的事项');
  await expect(rows(page)).toHaveCount(0);

  // 切换期时关键词保留（它属于整页，不属于某个键）。
  await input.fill('代码');
  await page.locator('#form-sheet [data-action="analytics-period"][data-period="month"]').click();
  await expect(page.locator('#form-sheet [data-role="an-query"]')).toHaveValue('代码');
  await expect(page.locator('#form-sheet .an-items-cap')).toContainText('含「代码」');
});

test('只出现一次的事项整行跳到那天；超过 8 项可展开全部', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  const entries = [];
  for (let i = 0; i < 10; i += 1) {
    const h = String(8 + i).padStart(2, '0');
    entries.push({ id: `u${i}`, ts: `2026-06-23T${h}:00`, what: `事项 ${String.fromCharCode(65 + i)} 写得很长很长的描述用来检查省略号不会撑宽窄屏布局`, tags: ['求职推进'] });
  }
  entries.push({ id: 'end', ts: '2026-06-23T18:00', what: '睡觉', tags: ['睡觉'] });
  await seed(page, entries);
  await openAnalytics(page);

  await expect(page.locator('#form-sheet .an-items-cap')).toHaveText('主线 · 共 10 项');
  await expect(rows(page)).toHaveCount(8);
  const more = page.locator('#form-sheet [data-action="analytics-items-toggle"]');
  await expect(more).toHaveText('展开全部 10 项');
  await more.click();
  await expect(rows(page)).toHaveCount(10);
  await expect(more).toHaveText('收起');

  const single = rows(page).first().locator('.an-item-row');
  await expect(single).toHaveAttribute('data-action', 'drill');
  await expect(single).toHaveAttribute('data-date', '2026-06-23');
  await expect(single.locator('.an-item-meta')).toContainText('#求职推进 · 6/23');
  // 长正文单行省略，不撑宽。
  const clipped = await single.locator('.an-item-text').evaluate(el => el.scrollWidth > el.clientWidth);
  expect(clipped).toBe(true);
  await single.click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  await expect(page.locator('#period-label')).toContainText('06/23');
});

test('复制的本期摘要附上当前范围的事项排行', async ({ page }) => {
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
  await page.waitForFunction(() => window.__copiedAnalytics.length > 0);
  const text = await page.evaluate(() => window.__copiedAnalytics);
  expect(text).toContain('## 事项排行 · 主线');
  expect(text).toContain('- 写代码（#求职推进）：10h30min ×3');
});

test('320px 下展开日期后整页不横向溢出', async ({ page }) => {
  await boot(page, 320, 'analytics-weeks', false, WED_NOW);
  await openAnalytics(page);
  await rows(page).first().locator('.an-item-row').click();
  await expect(page.locator('#form-sheet .an-occ-row')).toHaveCount(3);
  await expectNoHorizontalOverflow(page);
  const box = await page.locator('#form-sheet .an-occ-row').first().boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
});

// ── 常态（个人基线）与标签趋势 ──
// 本周到周三主线 630；此前 5 周同段 540/450/360/270/180 → 中位 360 → 多 4h30min。
test('结论区给出常态：与此前同期中位数比', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  await openAnalytics(page);
  await expect(page.locator('#form-sheet .an-baseline')).toHaveText('比常态多 4h30min（此前 5 期同期中位 6h）');
});

// 上周已结束：900 对此前四整周 750/600/450/300 → 中位 525 → 多 6h15min，用整期口径。
test('已结束的周按整期比常态', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW, -7);
  await openAnalytics(page);
  await expect(page.locator('#form-sheet .an-baseline')).toHaveText('比常态多 6h15min（此前 4 期中位 8h45min）');
});

test('可比周期不足三期时不显示常态', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW, -21);
  await openAnalytics(page);
  // 三周前那周之前只有两周有记录。
  await expect(page.locator('#form-sheet .an-headline')).toBeVisible();
  await expect(page.locator('#form-sheet .an-baseline')).toHaveCount(0);
});

test('选中标签也给出趋势、迷你柱图和常态', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  await openAnalytics(page);
  await page.locator('#form-sheet .an-tile[data-key="t:求职推进"]').click();
  await expect(page.locator('#form-sheet .an-trend')).toContainText('求职推进');
  await expect(page.locator('#form-sheet .an-trend')).toContainText('走高');
  await expect(page.locator('#form-sheet .an-spark svg')).toHaveCount(1);
  await expect(page.locator('#form-sheet .an-baseline')).toHaveText('比常态多 4h30min（此前 5 期同期中位 6h）');
});

// ── 「全部」：累计与历史检索 ──
// 夹具从 5 周前的周一（05/18）起：5 个整周 (60+90+120+150+180)×5 = 3000，加本周到周三 630。
test('「全部」显示自第一条记录以来的累计，不做对比与常态', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  await openAnalytics(page);
  await page.locator('#form-sheet [data-action="analytics-period"][data-period="all"]').click();
  await expect(page.locator('#form-sheet [data-action="analytics-period"][data-period="all"]')).toHaveAttribute('aria-pressed', 'true');
  const firstDay = await page.evaluate(async () => (await import('/src/time.js')).periodLabel('day', '2026-05-18'));
  await expect(page.locator('#form-sheet .an-period-label')).toHaveText(`全部记录 · 自 ${firstDay} 起`);
  await expect(page.locator('#form-sheet .an-headline')).toHaveText('60h30min');
  await expect(page.locator('#form-sheet .an-subline')).toContainText('占全部');
  await expect(page.locator('#form-sheet .an-activity')).toHaveText('记过 28 天 · 首次 5/18 周一 · 最近 6/24 周三');
  await expect(page.locator('#form-sheet .an-delta')).toHaveCount(0);
  await expect(page.locator('#form-sheet .an-baseline')).toHaveCount(0);
  await expect(page.locator('#form-sheet .an-trend')).toHaveCount(0);
});

test('「全部」里按关键词检索全部历史，日期最近的在最上面', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  await openAnalytics(page);
  await page.locator('#form-sheet [data-action="analytics-period"][data-period="all"]').click();
  await page.locator('#form-sheet [data-role="an-query"]').fill('代码');
  await expect(page.locator('#form-sheet .an-items-cap')).toHaveText('含「代码」：共 60h30min · 28 条');
  await rows(page).first().locator('.an-item-row').click();
  const dates = page.locator('#form-sheet .an-occ-row');
  await expect(dates).toHaveCount(28);
  await expect(dates.first()).toHaveAttribute('data-date', '2026-06-24');
  await expect(dates.last()).toHaveAttribute('data-date', '2026-05-18');
});

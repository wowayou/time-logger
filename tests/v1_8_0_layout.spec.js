import { expect, test } from './startup_fixture.js';
import { boot, FIXED_NOW } from './ui_fixture.js';
import { bootLocale, TODAY_KEY } from './i18n_fixture.js';

// v1.8.0 ①：窄屏记录表单是定高面板（满视口），正文 grid 不得把余量摊进每一行。
// 判据量的是实际几何：相邻字段之间只剩 gap + 自身外边距，分段控件按内容宽度靠左。
for (const width of [375, 390]) {
  test(`v1.8.0: record form rows hug their content at ${width}px`, async ({ page }) => {
    await boot(page, width, 'tail-placeholder', false, FIXED_NOW);
    await page.locator('#add-btn').click();
    const body = page.locator('.form-sheet:not([hidden]) .form-sheet-body');
    await expect(body.locator('[data-role="record-mode-seg"]')).toBeVisible();
    const m = await body.evaluate(el => {
      const box = node => node.getBoundingClientRect();
      const seg = el.querySelector('[data-role="record-mode-seg"]');
      const time = el.querySelector('.form-time-row');
      const kids = [...el.children].filter(c => getComputedStyle(c).display !== 'none');
      // 每个直接子项：轨道高度（下一个子项顶边 - 本项顶边 - gap）与自身外框高度之差。
      const gap = parseFloat(getComputedStyle(el).rowGap);
      const slack = kids.slice(0, -1).map((c, i) => {
        const mb = parseFloat(getComputedStyle(c).marginBottom);
        return Math.round(box(kids[i + 1]).top - box(c).top - gap - box(c).height - mb);
      });
      return {
        slack,
        segWidth: box(seg).width,
        bodyWidth: el.clientWidth,
        segToTime: Math.round(box(time).top - box(seg).bottom),
        modeButton: box(seg.querySelector('button')).height,
        bucketButton: box(el.querySelector('[data-role="form-bucket-seg"] button')).height
      };
    });
    expect(Math.max(...m.slack.map(Math.abs)), `stretched rows: ${m.slack}`).toBeLessThanOrEqual(1);
    expect(m.segToTime).toBeLessThanOrEqual(28);
    expect(m.segWidth).toBeLessThan(m.bodyWidth / 2);
    // 进场过渡里面板带小数 translateY，变换后的盒高有 1e-5 级浮点误差：v1.15.5 去掉说明行后
    // 位置一变，Chromium 量到 35.99999。容差 0.01px，任何真实的按钮变矮（≥1px）照样红。
    expect(m.modeButton).toBeGreaterThanOrEqual(36 - 0.01);
    expect(m.bucketButton).toBeGreaterThanOrEqual(36 - 0.01);
  });
}

// v1.8.0 ②：周/月/年总览与日视图同一张结论卡；明细里没有可统计时长的行只占一行。
test('v1.8.0: week overview uses the hero card and empty days collapse to one line', async ({ page }) => {
  await boot(page, 390, 'two-records', false, FIXED_NOW);
  await page.locator('[data-action="view"][data-view="week"]').click();
  const ruler = page.locator('#ruler');
  // 两条主线记录：09:00 起到冻结的 12:34:30，主线即全部已记录时长。
  await expect(ruler.locator('.hero-big')).toHaveText('3h35min');
  await expect(ruler.locator('.hero-leak')).toHaveText('0min');
  await expect(ruler.locator('.hero-aux')).toContainText('共 ');
  await expect(ruler.locator('.hero-aux')).toContainText('未记录');

  const rows = page.locator('.summary-list .sum-row');
  await expect(rows).toHaveCount(7);
  const empty = page.locator('.sum-row.is-empty');
  const filled = page.locator('.sum-row:not(.is-empty)');
  await expect(filled).toHaveCount(1);
  await expect(empty).toHaveCount(6);
  await expect(empty.locator('.ruler-bar, .sum-meta')).toHaveCount(0);
  await expect(empty.first()).toContainText('无记录');
  await expect(filled.locator('.ruler-bar')).toHaveCount(1);

  const heights = await page.evaluate(() => ({
    empty: document.querySelector('.sum-row.is-empty').getBoundingClientRect().height,
    filled: document.querySelector('.sum-row:not(.is-empty)').getBoundingClientRect().height
  }));
  expect(heights.empty).toBeLessThan(heights.filled * 0.6);

  // 空行仍是可下钻按钮。
  await empty.first().click();
  await expect(page.locator('[data-action="view"][data-view="day"]')).toHaveClass(/active/);
});

test('v1.8.0: English week overview shows the total in the hero aux line', async ({ page }) => {
  await bootLocale(page, {
    entries: [{ id: 'today-1', ts: `${TODAY_KEY}T09:00`, what: 'writing code', tags: ['求职推进'] }]
  });
  await page.locator('[data-action="view"][data-view="week"]').click();
  await expect(page.locator('#ruler .hero-aux')).toContainText('Total ');
  await expect(page.locator('.sum-row.is-empty').first()).toContainText('No entries');
});

// v1.8.0 ③（时间轴单行/两行混排）已被 v1.8.1 的单行等高取代，见 tests/v1_8_1_ui.spec.js。

// v1.8.0 ④：容器圆角不再把首行计划的虚线竖脊裁出半截——首行虚线从 12px 起画；
// 后面的计划行与实色脊仍从行顶起画，竖脊行行相接。
test('v1.8.0: the first planned rail starts below the log corner', async ({ page }) => {
  // 今天有已发生记录、未来 20:00 有一条计划：计划排倒序最前。
  await boot(page, 390, 'overnight-boundaries', false, FIXED_NOW);
  const tops = await page.evaluate(() => [...document.querySelectorAll('.log .entry')]
    .map(el => ({ planned: el.classList.contains('planned'), top: getComputedStyle(el, '::before').top })));
  expect(tops[0]).toEqual({ planned: true, top: '12px' });
  const rest = tops.filter(t => !t.planned);
  expect(rest.length, 'needs a non-planned row to compare against').toBeGreaterThan(0);
  expect(rest.every(t => t.top === '0px')).toBe(true);
});

// v1.8.1 · 时间轴单行等高（维护者裁定）+「更多」二级页修正（时间分析分段与趋势柱、备份页说明）。
import { expect, test } from './startup_fixture.js';
import { boot, openBackupMenu, FIXED_NOW, expectNoHorizontalOverflow } from './ui_fixture.js';
import { bootLocale, TODAY_KEY } from './i18n_fixture.js';

// 周三 14:00：夹具主线逐周 +30min，已完成的前几周可比，趋势柱会渲染。
const WED_NOW = '2026-06-24T14:00:00';

async function openAnalytics(page) {
  await openBackupMenu(page);
  await page.locator('[data-action="open-analytics"]').click();
  await expect(page.locator('#form-sheet-title')).toHaveText('时间分析');
}

test('v1.8.1: analytics period segment shows the selected period and is centred', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  await openAnalytics(page);
  const seg = page.locator('#form-sheet .an-period');
  const read = () => seg.evaluate(el => {
    const sheet = el.closest('.form-sheet-body').getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return {
      bg: [...el.querySelectorAll('button')].map(b => getComputedStyle(b).backgroundColor),
      pressed: [...el.querySelectorAll('button')].map(b => b.getAttribute('aria-pressed')),
      centreOffset: Math.abs((box.left + box.right) / 2 - (sheet.left + sheet.right) / 2),
      buttonHeight: el.querySelector('button').getBoundingClientRect().height
    };
  });
  const week = await read();
  expect(week.pressed).toEqual(['true', 'false', 'false']);
  // 选中项的底色必须与未选中项不同——旧版三个按钮完全一样。
  expect(week.bg[0]).not.toBe(week.bg[1]);
  expect(week.bg[1]).toBe(week.bg[2]);
  expect(week.centreOffset).toBeLessThanOrEqual(2);
  expect(week.buttonHeight).toBeGreaterThanOrEqual(36);

  await page.locator('#form-sheet [data-action="analytics-period"][data-period="year"]').click();
  const year = await read();
  expect(year.pressed).toEqual(['false', 'false', 'true']);
  expect(year.bg[2]).not.toBe(year.bg[0]);
  expect(year.bg[0]).toBe(year.bg[1]);
});

test('v1.8.1: the trend bars are capped in width and explained by a caption', async ({ page }) => {
  await boot(page, 390, 'analytics-weeks', false, WED_NOW);
  await openAnalytics(page);
  const spark = page.locator('#form-sheet .an-spark');
  await expect(spark).toBeVisible();
  await expect(spark.locator('.an-spark-cap')).toContainText('右为最近');
  const g = await spark.evaluate(el => {
    const svg = el.querySelector('svg').getBoundingClientRect();
    const rects = [...el.querySelectorAll('rect')].map(r => ({ box: r.getBoundingClientRect(), past: r.classList.contains('past') }));
    const left = Math.min(...rects.map(r => r.box.left)), right = Math.max(...rects.map(r => r.box.right));
    return {
      n: rects.length,
      maxBar: Math.max(...rects.map(r => r.box.width)),
      svgWidth: svg.width,
      centreOffset: Math.abs((left + right) / 2 - (svg.left + svg.right) / 2),
      past: rects.map(r => r.past),
      aria: el.querySelector('svg').getAttribute('aria-label')
    };
  });
  expect(g.n).toBeGreaterThanOrEqual(2);
  expect(g.maxBar).toBeLessThanOrEqual(g.svgWidth * 0.1);
  expect(g.centreOffset).toBeLessThanOrEqual(2);
  // 只有最右（最近一期）是实色。
  expect(g.past).toEqual([...Array(g.n - 1).fill(true), false]);
  expect(g.aria).toContain('右为最近');
});

test('v1.8.1: the backup sheet hint describes only what the sheet offers', async ({ page }) => {
  await boot(page, 390, 'two-records', false, WED_NOW);
  await openBackupMenu(page);
  await page.locator('[data-action="open-backup"]').click();
  const hint = page.locator('#form-sheet .more-body > .form-hint').first();
  await expect(hint).toContainText('完整 JSON 备份');
  await expect(hint).not.toContainText('可贴给 AI');
  // 提到的入口必须真实存在于「更多」。
  await expect(hint).toContainText('复制当前视图摘要');
});

// ── 时间轴行布局：单行 / 两行（默认）/ 按时长 ─────────────────────────────────────
// 竖脊通高、行行相接，长度会被读成时长。单行与两行：同一列表内每行严格等高，与文字量、
// 标签长短、行内链接个数无关；按时长：行高＝分钟数 px，下限 52px。判据量真实几何。
const ROW_PX = { single: 52, double: 72 };
const STATES = ['two-records', 'long-note', 'planned-only', 'pending-confirm-lunch', 'mid-placeholder', 'overnight-boundaries'];

// 夹具每次加载都会 localStorage.clear()：偏好必须在夹具之后注册、再刷新一次才生效。
async function applyDensity(page, density) {
  if (!density) return;
  await page.addInitScript(d => localStorage.setItem('timelog.timelineDensity', d), density);
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
}
async function rows(page) {
  return page.evaluate(() => [...document.querySelectorAll('.log .entry')].map(r => {
    const box = r.getBoundingClientRect();
    const links = [...r.querySelectorAll('.e-meta > .mini-btn')].map(b => b.getBoundingClientRect());
    const body = r.querySelector('.e-body').getBoundingClientRect();
    return { id: r.dataset.id || r.dataset.gapTs, h: Math.round(box.height * 10) / 10,
      mins: Number(getComputedStyle(r).getPropertyValue('--mins')),
      linksInside: links.every(l => l.top >= box.top - 0.5 && l.bottom <= box.bottom + 0.5 && l.right <= box.right + 0.5),
      linksClearOfText: links.every(l => l.left >= body.right - 0.5),
      linksBig: links.every(l => l.width >= 44 && l.height >= 44) };
  }));
}

for (const density of ['single', 'double']) {
  for (const width of [320, 390, 768]) {
    for (const state of STATES) {
      test(`v1.8.1: ${density} rows are all ${ROW_PX[density]}px (${state}, ${width}px)`, async ({ page }) => {
        await boot(page, width, state, false, FIXED_NOW);
        await applyDensity(page, density === 'double' ? null : density);
        await expect(page.locator('.log')).toHaveAttribute('data-density', density);
        const list = await rows(page);
        expect(list.length).toBeGreaterThan(0);
        for (const row of list) {
          expect(row.h, JSON.stringify(row)).toBe(ROW_PX[density]);
          expect(row.linksInside && row.linksClearOfText && row.linksBig, JSON.stringify(row)).toBe(true);
        }
        await expectNoHorizontalOverflow(page);
      });
    }
  }
}

for (const width of [320, 390]) {
  test(`v1.8.1: to-scale rows are minutes in px with a 52px floor (${width}px)`, async ({ page }) => {
    await boot(page, width, 'empty', false, FIXED_NOW);
    await applyDensity(page, 'scaled');
    // 冻结在 12:34:30：30min（低于下限）、70min、174.5min（进行中尾段）、一条未来计划。
    await page.evaluate(day => {
      localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries: [
        { id: 'a', ts: `${day}T08:00`, what: '短', tags: ['吃饭'] },
        { id: 'b', ts: `${day}T08:30`, what: '中', tags: ['求职推进'] },
        { id: 'c', ts: `${day}T09:40`, what: '长', tags: ['求职推进'] },
        { id: 'p', ts: `${day}T20:00`, what: '计划', tags: ['求职推进'], planned: true }
      ] }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'timelog.v1', storageArea: localStorage }));
    }, FIXED_NOW.slice(0, 10));
    await expect(page.locator('.entry[data-id="c"]')).toBeVisible();
    await expect(page.locator('.log')).toHaveAttribute('data-density', 'scaled');
    const list = await rows(page);
    expect(list.some(r => r.mins > 52), 'fixture needs a segment longer than the floor').toBe(true);
    expect(list.some(r => r.mins < 52), 'fixture needs a segment shorter than the floor').toBe(true);
    for (const row of list) {
      // --mins 由渲染取整写入；行高恰为 max(52, 分钟数) px。
      expect(row.h, JSON.stringify(row)).toBe(Math.max(52, row.mins));
      expect(row.linksInside && row.linksClearOfText && row.linksBig, JSON.stringify(row)).toBe(true);
    }
    await expectNoHorizontalOverflow(page);
  });
}

test('v1.8.1: the More sheet switches the layout, persists it and keeps the default at two lines', async ({ page }) => {
  await boot(page, 390, 'two-records', false, FIXED_NOW);
  await expect(page.locator('.log')).toHaveAttribute('data-density', 'double');
  expect(await page.evaluate(() => localStorage.getItem('timelog.timelineDensity'))).toBeNull();
  await openBackupMenu(page);
  const seg = page.locator('#density-seg');
  await expect(seg.locator('[data-density="double"]')).toHaveAttribute('aria-pressed', 'true');
  await seg.locator('[data-density="single"]').click();
  await expect(seg.locator('[data-density="single"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(seg.locator('[data-density="double"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.log')).toHaveAttribute('data-density', 'single');
  expect(await page.evaluate(() => localStorage.getItem('timelog.timelineDensity'))).toBe('single');
  // 夹具会在本页每次加载时清存储；另开一页（同源、无夹具脚本）验证偏好真的落盘并被读取。
  const other = await page.context().newPage();
  await other.goto('/');
  await other.waitForFunction(() => document.body.classList.contains('app-ready'));
  await expect(other.locator('.log')).toHaveAttribute('data-density', 'single');
  await other.close();
});

test('v1.8.1: a refresh never restores a snapshot drawn with another layout', async ({ page }) => {
  await boot(page, 390, 'two-records', false, FIXED_NOW);
  await expect(page.locator('.log')).toHaveAttribute('data-density', 'double');
  // 快照按「两行」画好后，存储改成「按时长」（例如另一标签页改了偏好）再刷新。
  await page.addInitScript(() => localStorage.setItem('timelog.timelineDensity', 'scaled'));
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  await expect(page.locator('.log')).toHaveAttribute('data-density', 'scaled');
  // 若旧快照被接回，init 不会首轮重绘（v53），这里会停在 double——上面的断言就是这道门的牙。
});

test('v1.8.1: an invalid stored layout falls back to two lines', async ({ page }) => {
  await boot(page, 390, 'two-records', false, FIXED_NOW);
  await applyDensity(page, 'tiny');
  await expect(page.locator('.log')).toHaveAttribute('data-density', 'double');
});

test('v1.8.1: single line shows a tag whole or not at all and ellipsises long text', async ({ page }) => {
  await boot(page, 320, 'empty', false, FIXED_NOW);
  await applyDensity(page, 'single');
  await page.evaluate(day => {
    localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries: [
      { id: 'short', ts: `${day}T08:00`, what: '午饭', tags: ['吃饭'] },
      { id: 'long', ts: `${day}T09:00`, what: '写接口与单测：把导入冲突的三种处理拆成独立函数，再补边界用例和中英文文案', tags: ['睡觉'] }
    ] }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'timelog.v1', storageArea: localStorage }));
  }, FIXED_NOW.slice(0, 10));
  await expect(page.locator('.entry[data-id="long"]')).toBeVisible();
  const read = id => page.locator(`.entry[data-id="${id}"]`).evaluate(el => {
    const body = el.querySelector('.e-body').getBoundingClientRect();
    const what = el.querySelector('.e-what'), tag = el.querySelector('.e-tag').getBoundingClientRect();
    return { tagVisible: tag.top >= body.top - 0.5 && tag.bottom <= body.bottom + 0.5 && tag.right <= body.right + 0.5,
      tagOnLine: tag.top < body.bottom, ellipsised: what.scrollWidth > what.clientWidth };
  });
  expect(await read('short')).toMatchObject({ tagVisible: true, ellipsised: false });
  expect(await read('long')).toMatchObject({ tagOnLine: false, ellipsised: true });
});

test('v1.8.1: confirm keeps a short visible label and the full range for screen readers', async ({ page }) => {
  await boot(page, 320, 'pending-confirm-lunch', false, FIXED_NOW);
  const confirm = page.locator('.entry[data-id="lunch-start"] [data-action="confirm-segment"]');
  await expect(confirm).toHaveText('确认');
  await expect(confirm).toHaveAttribute('aria-label', /08:00/);
});

for (const density of ['single', 'double']) {
  test(`v1.8.1: English ${density} rows keep the layout height and short link labels`, async ({ page }) => {
    await bootLocale(page, { width: 320, entries: [
      { id: 'lunch-start', ts: `${TODAY_KEY}T08:00`, what: 'Lunch', tags: ['Meals'] },
      { id: 'lunch-end', ts: `${TODAY_KEY}T12:00`, what: 'Afternoon work', tags: ['Work'] },
      { id: 'plan', ts: `${TODAY_KEY}T20:00`, what: 'Run', tags: ['Exercise'], planned: true }
    ], config: { version: 1, longReview: true, mainline: ['Work'], chips: [{ name: 'Meals', bucket: 'maintain', longOk: false }, { name: 'Exercise', bucket: 'maintain', longOk: false }] } });
    await applyDensity(page, density === 'double' ? null : density);
    await expect(page.locator('.log')).toHaveAttribute('data-density', density);
    await expect(page.locator('.entry[data-id="lunch-start"] [data-action="confirm-segment"]')).toHaveText('Confirm');
    await expect(page.locator('.entry.planned [data-action="confirm-planned"]')).toHaveText('Mark as done');
    for (const row of await rows(page)) {
      expect(row.h, JSON.stringify(row)).toBe(ROW_PX[density]);
      expect(row.linksInside && row.linksClearOfText && row.linksBig, JSON.stringify(row)).toBe(true);
    }
    await expectNoHorizontalOverflow(page);
  });
}

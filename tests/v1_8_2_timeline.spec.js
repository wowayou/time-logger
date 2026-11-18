// v1.8.2 · 时间轴「全文」布局（取代「两行」并成为默认）+ 固定刻度时长条（维护者 2026-11-18 选定 P1）。
// 全文：正文完整换行、#标签在正文下、不省略；行高随内容，竖脊仍通高——长短不代表时长，
// 时长由右列数字和时长条表达（满格＝4h，超过 4h 满格并留缺口）。判据量真实几何。
import { expect, test } from './startup_fixture.js';
import { boot, openBackupMenu, FIXED_NOW, expectNoHorizontalOverflow } from './ui_fixture.js';
import { bootLocale, TODAY_KEY } from './i18n_fixture.js';

const STATES = ['two-records', 'long-note', 'planned-only', 'pending-confirm-lunch', 'mid-placeholder', 'overnight-boundaries'];
const BAR_FULL_MINS = 240;

// 夹具每次加载都会 localStorage.clear()：偏好必须在夹具之后注册、再刷新一次才生效。
async function applyDensity(page, density) {
  await page.addInitScript(d => localStorage.setItem('timelog.timelineDensity', d), density);
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
}

async function fullRows(page) {
  return page.evaluate(() => [...document.querySelectorAll('.log .entry')].map(r => {
    const box = r.getBoundingClientRect();
    const body = r.querySelector('.e-body').getBoundingClientRect();
    const what = r.querySelector('.e-what');
    const tag = r.querySelector('.e-tag');
    const tagBox = tag && tag.getBoundingClientRect();
    const links = [...r.querySelectorAll('.e-meta > .mini-btn')].map(b => b.getBoundingClientRect());
    return {
      id: r.dataset.id || r.dataset.gapTs,
      h: box.height,
      // 正文不被裁、不省略：内容尺寸不超过盒子（允许 1px 取整）。
      whatWhole: what.scrollHeight <= what.clientHeight + 1 && what.scrollWidth <= what.clientWidth + 1,
      tagInside: !tagBox || (tagBox.top >= box.top - 0.5 && tagBox.bottom <= box.bottom + 0.5 && tagBox.right <= body.right + 0.5),
      tagBelowText: !tagBox || tagBox.top >= what.getBoundingClientRect().bottom - 0.5,
      linksInside: links.every(l => l.top >= box.top - 0.5 && l.bottom <= box.bottom + 0.5 && l.right <= box.right + 0.5),
      linksClearOfText: links.every(l => l.left >= body.right - 0.5),
      linksBig: links.every(l => l.width >= 44 && l.height >= 44)
    };
  }));
}

for (const width of [320, 390, 768]) {
  for (const state of STATES) {
    test(`v1.8.2: full-text rows show the whole note and keep links inside (${state}, ${width}px)`, async ({ page }) => {
      await boot(page, width, state, false, FIXED_NOW);
      await expect(page.locator('.log')).toHaveAttribute('data-density', 'full');
      const list = await fullRows(page);
      expect(list.length).toBeGreaterThan(0);
      for (const row of list) {
        expect(row.h, JSON.stringify(row)).toBeGreaterThanOrEqual(52);
        expect(row.whatWhole && row.tagInside && row.tagBelowText, JSON.stringify(row)).toBe(true);
        expect(row.linksInside && row.linksClearOfText && row.linksBig, JSON.stringify(row)).toBe(true);
      }
      await expectNoHorizontalOverflow(page);
    });
  }
}

test('v1.8.2: a multi-line note keeps its line breaks in the list', async ({ page }) => {
  await boot(page, 390, 'long-note', false, FIXED_NOW);
  // 夹具正文 40 行、行间用换行分隔；全文布局逐行显示，正文盒高至少 40 行 × 22px。
  const h = await page.locator('.entry[data-id="today-long"] .e-what').evaluate(el => el.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(40 * 22 - 1);
});

async function seedBars(page) {
  // 冻结在 12:34:30：00:00–02:00 缺口、02:00 起 6h（超满格）、30min、70min、09:40 起进行中
  // 174.5min、一条未来计划。
  await page.evaluate(day => {
    localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries: [
      { id: 'x', ts: `${day}T02:00`, what: '睡觉', tags: ['睡觉'] },
      { id: 'a', ts: `${day}T08:00`, what: '短', tags: ['吃饭'] },
      { id: 'b', ts: `${day}T08:30`, what: '中', tags: ['求职推进'] },
      { id: 'c', ts: `${day}T09:40`, what: '长', tags: ['求职推进'] },
      { id: 'p', ts: `${day}T20:00`, what: '计划', tags: ['求职推进'], planned: true }
    ] }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'timelog.v1', storageArea: localStorage }));
  }, FIXED_NOW.slice(0, 10));
  await expect(page.locator('.entry[data-id="x"]')).toBeVisible();
}

test('v1.8.2: duration bars use a fixed 4h scale and mark segments past it', async ({ page }) => {
  await boot(page, 390, 'empty', false, FIXED_NOW);
  await seedBars(page);
  const bars = await page.evaluate(() => [...document.querySelectorAll('.log .entry')].map(r => {
    const bar = r.querySelector('.e-bar');
    return { id: r.dataset.id || r.dataset.gapTs, planned: r.classList.contains('planned'),
      mins: Number(getComputedStyle(r).getPropertyValue('--mins')),
      has: !!bar, hidden: bar?.getAttribute('aria-hidden'), over: bar?.classList.contains('over'),
      ratio: bar ? bar.firstElementChild.getBoundingClientRect().width / bar.getBoundingClientRect().width : null };
  }));
  expect(bars.some(b => b.mins > BAR_FULL_MINS), 'fixture needs a segment past the full scale').toBe(true);
  expect(bars.some(b => b.mins < BAR_FULL_MINS / 4), 'fixture needs a short segment').toBe(true);
  expect(bars.some(b => b.id && b.id.includes('T00:00')), 'fixture needs an unlogged gap row').toBe(true);
  for (const b of bars) {
    if (b.planned) { expect(b.has, JSON.stringify(b)).toBe(false); continue; }
    expect(b.has && b.hidden === 'true', JSON.stringify(b)).toBe(true);
    expect(b.over, JSON.stringify(b)).toBe(b.mins > BAR_FULL_MINS);
    expect(Math.abs(b.ratio - Math.min(1, b.mins / BAR_FULL_MINS)), JSON.stringify(b)).toBeLessThan(0.015);
  }
});

for (const density of ['single', 'scaled']) {
  test(`v1.8.2: ${density} layout draws no duration bars`, async ({ page }) => {
    await boot(page, 390, 'empty', false, FIXED_NOW);
    await applyDensity(page, density);
    await seedBars(page);
    await expect(page.locator('.log')).toHaveAttribute('data-density', density);
    await expect(page.locator('.log .e-bar')).toHaveCount(0);
  });
}

test('v1.8.2: a stored two-line layout reads as full text without rewriting the preference', async ({ page }) => {
  await boot(page, 390, 'two-records', false, FIXED_NOW);
  await applyDensity(page, 'double');
  await expect(page.locator('.log')).toHaveAttribute('data-density', 'full');
  expect(await page.evaluate(() => localStorage.getItem('timelog.timelineDensity'))).toBe('double');
  await openBackupMenu(page);
  const seg = page.locator('#density-seg');
  await expect(seg.locator('button')).toHaveText(['全文', '单行', '按时长']);
  await expect(seg.locator('[data-density="full"]')).toHaveAttribute('aria-pressed', 'true');
});

test('v1.8.2: English full-text rows at 320px keep two links inside and clear of the note', async ({ page }) => {
  await bootLocale(page, { width: 320, entries: [
    { id: 'lunch-start', ts: `${TODAY_KEY}T08:00`, what: 'Lunch with a long note that wraps over several lines at this width', tags: ['Meals'] },
    { id: 'lunch-end', ts: `${TODAY_KEY}T12:00`, what: 'Afternoon work', tags: ['Work'] },
    { id: 'plan', ts: `${TODAY_KEY}T20:00`, what: 'Run', tags: ['Exercise'], planned: true }
  ], config: { version: 1, longReview: true, mainline: ['Work'], chips: [{ name: 'Meals', bucket: 'maintain', longOk: false }, { name: 'Exercise', bucket: 'maintain', longOk: false }] } });
  await expect(page.locator('.log')).toHaveAttribute('data-density', 'full');
  await expect(page.locator('.entry[data-id="lunch-start"] [data-action="confirm-segment"]')).toHaveText('Confirm');
  await expect(page.locator('.entry[data-id="lunch-start"] .e-meta > .mini-btn')).toHaveCount(2);
  for (const row of await fullRows(page)) {
    expect(row.whatWhole && row.tagInside, JSON.stringify(row)).toBe(true);
    expect(row.linksInside && row.linksClearOfText && row.linksBig, JSON.stringify(row)).toBe(true);
  }
  await expectNoHorizontalOverflow(page);
});

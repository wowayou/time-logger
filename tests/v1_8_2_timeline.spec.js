// v1.8.2 · 时间轴「全文」布局（取代「两行」并成为默认，维护者 2026-11-18 选定 P1）。
// 全文：正文完整换行、#标签在正文下、不省略；行高随内容，竖脊仍通高——长短不代表时长，
// 时长由右列数字和尺子刻度表达（v1.8.3 取代 4h 满格时长条：长刻线＝1 小时、短刻线＝
// 15 分钟，无上限）。判据量真实几何。
import { expect, test } from './startup_fixture.js';
import { boot, openBackupMenu, FIXED_NOW, expectNoHorizontalOverflow } from './ui_fixture.js';
import { bootLocale, TODAY_KEY } from './i18n_fixture.js';

const STATES = ['two-records', 'long-note', 'planned-only', 'pending-confirm-lunch', 'mid-placeholder', 'overnight-boundaries'];

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

async function seedTicks(page) {
  // 冻结在 12:34:30：00:00–02:00 缺口、02:00 起 5h55（短刻线四舍五入凑满 4 道进位成 6h）、
  // 5min（不画）、30min、70min、09:40 起进行中 174.5min（同样进位成 3h）、一条未来计划。
  await page.evaluate(day => {
    localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries: [
      { id: 'x', ts: `${day}T02:00`, what: '睡觉', tags: ['睡觉'] },
      { id: 's', ts: `${day}T07:55`, what: '极短', tags: ['吃饭'] },
      { id: 'a', ts: `${day}T08:00`, what: '短', tags: ['吃饭'] },
      { id: 'b', ts: `${day}T08:30`, what: '中', tags: ['求职推进'] },
      { id: 'c', ts: `${day}T09:40`, what: '长', tags: ['求职推进'] },
      { id: 'p', ts: `${day}T20:00`, what: '计划', tags: ['求职推进'], planned: true }
    ] }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'timelog.v1', storageArea: localStorage }));
  }, FIXED_NOW.slice(0, 10));
  await expect(page.locator('.entry[data-id="x"]')).toBeVisible();
}

async function tickRows(page) {
  return page.evaluate(() => [...document.querySelectorAll('.log .entry')].map(r => {
    const t = r.querySelector('.e-ticks');
    const box = r.getBoundingClientRect();
    const tb = t && t.getBoundingClientRect();
    return { id: r.dataset.id || r.dataset.gapTs, planned: r.classList.contains('planned'),
      mins: Number(getComputedStyle(r).getPropertyValue('--mins')),
      has: !!t, hidden: t?.getAttribute('aria-hidden'),
      h: t ? t.querySelectorAll('i.h').length : 0, q: t ? t.querySelectorAll('i.q').length : 0,
      tall: t ? [...t.querySelectorAll('i.h')].every(i => i.getBoundingClientRect().height === 8) : true,
      short: t ? [...t.querySelectorAll('i.q')].every(i => i.getBoundingClientRect().height === 4) : true,
      w: tb ? tb.width : 0, inside: !tb || (tb.right <= box.right + 0.5 && tb.bottom <= box.bottom + 0.5) };
  }));
}

// 期望值独立于实现写死，不从渲染值推回去。
const EXPECT = { x: [6, 0], a: [0, 2], b: [1, 1], s: [0, 0], c: [3, 0] };

test('v1.8.3: ruler ticks mark whole hours long and quarters short, with no upper limit', async ({ page }) => {
  await boot(page, 390, 'empty', false, FIXED_NOW);
  await seedTicks(page);
  const rows = await tickRows(page);
  const gap = rows.find(r => r.id && r.id.includes('T00:00'));
  expect(gap, 'fixture needs the 00:00–02:00 unlogged gap row').toBeTruthy();
  expect([gap.h, gap.q]).toEqual([2, 0]);
  for (const [id, [h, q]] of Object.entries(EXPECT)) {
    const r = rows.find(x => x.id === id);
    expect([r.h, r.q], JSON.stringify(r)).toEqual([h, q]);
    expect(r.has, JSON.stringify(r)).toBe(h + q > 0);
  }
  for (const r of rows) {
    if (r.planned) { expect(r.has, JSON.stringify(r)).toBe(false); continue; }
    if (r.has) expect(r.hidden === 'true' && r.tall && r.short && r.inside, JSON.stringify(r)).toBe(true);
  }
  await expect(page.locator('.log .e-bar')).toHaveCount(0);
});

test('v1.8.3: a near-full-day segment wraps its ticks instead of widening the right column', async ({ page }) => {
  await boot(page, 320, 'empty', false, FIXED_NOW, -1);
  await page.evaluate(() => {
    const day = '2026-06-28'; // FIXED_NOW 的前一天
    localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries: [
      { id: 'all', ts: `${day}T00:00`, what: '很长的一段', tags: ['求职推进'] },
      { id: 'end', ts: `${day}T23:45`, what: '收尾', tags: ['求职推进'] }
    ] }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'timelog.v1', storageArea: localStorage }));
  });
  await expect(page.locator('.entry[data-id="all"]')).toBeVisible();
  const r = (await tickRows(page)).find(x => x.id === 'all');
  expect([r.h, r.q], JSON.stringify(r)).toEqual([23, 3]);
  expect(r.w, JSON.stringify(r)).toBeLessThanOrEqual(56);
  expect(r.inside, JSON.stringify(r)).toBe(true);
  for (const row of await fullRows(page)) expect(row.whatWhole && row.linksInside, JSON.stringify(row)).toBe(true);
  await expectNoHorizontalOverflow(page);
});

for (const density of ['single', 'scaled']) {
  test(`v1.8.2: ${density} layout draws no ruler ticks`, async ({ page }) => {
    await boot(page, 390, 'empty', false, FIXED_NOW);
    await applyDensity(page, density);
    await seedTicks(page);
    await expect(page.locator('.log')).toHaveAttribute('data-density', density);
    await expect(page.locator('.log .e-ticks')).toHaveCount(0);
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

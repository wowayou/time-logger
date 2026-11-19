// v1.11.0 · 时间轴底部的全天热力条（维护者看过对比图选定 B1：一列 1 小时、列内 4 个刻钟、
// 6 小时一组；放在时间轴底部；将来的日子不显示）。v1.11.0 只在按时长布局显示，v1.12.0 起
// 三种布局都显示、由「更多」开关控制（见 v1_12_0_heat_toggle.spec.js）。
import { expect, test } from './startup_fixture.js';
import { boot, FIXED_NOW, expectNoHorizontalOverflow } from './ui_fixture.js';

const DAY = FIXED_NOW.slice(0, 10); // 冻结在 2026-06-29 12:34:30
const q = hm => { const [h, m] = hm.split(':').map(Number); return h * 4 + m / 15; };

async function applyDensity(page, density) {
  await page.addInitScript(d => localStorage.setItem('timelog.timelineDensity', d), density);
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
}

async function seed(page, entries) {
  await page.evaluate(list => {
    localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries: list }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'timelog.v1', storageArea: localStorage }));
  }, entries);
}

// 08:00 吃饭 → 08:30 求职推进 → 09:40 求职推进（进行中，到 12:34）。09:30 那一格两段同桶，合计占满。
const TODAY_ENTRIES = [
  { id: 'a', ts: `${DAY}T08:00`, what: '短', tags: ['吃饭'] },
  { id: 'b', ts: `${DAY}T08:30`, what: '中', tags: ['求职推进'] },
  { id: 'c', ts: `${DAY}T09:40`, what: '长', tags: ['求职推进'] }
];

async function cells(page) {
  return page.evaluate(() => [...document.querySelectorAll('.log .day-heat .dh-grid i')].map(i => ({
    b: i.dataset.b || '', l: i.dataset.l || '', fut: i.classList.contains('fut'), now: i.classList.contains('now'),
    bg: getComputedStyle(i).backgroundColor
  })));
}

test('v1.11.0: the to-scale layout ends with a 96-cell heat strip that follows the day', async ({ page }) => {
  await boot(page, 390, 'empty', false, FIXED_NOW);
  await applyDensity(page, 'scaled');
  await seed(page, TODAY_ENTRIES);
  await expect(page.locator('.entry[data-id="c"]')).toBeVisible();
  const strip = page.locator('.log > .day-heat');
  await expect(strip).toHaveCount(1);
  await expect(strip).toHaveAttribute('aria-hidden', 'true');
  expect(await page.evaluate(() => document.querySelector('.log').lastElementChild.classList.contains('day-heat')), 'the strip sits after the last row').toBe(true);
  await expect(strip.locator('.dh-title')).toHaveText('今天 24 小时');

  const list = await cells(page);
  expect(list).toHaveLength(96);
  const rail = id => page.locator(`.entry[data-id="${id}"]`).evaluate(r => ({ b: r.dataset.b, bg: getComputedStyle(r, '::before').backgroundColor }));
  const a = await rail('a');
  const c = await rail('c');
  // 00:00–07:45 没有记录：灰格。
  expect(list.slice(0, q('08:00')).every(x => x.b === 'unrecorded' && !x.fut)).toBe(true);
  // 满格的颜色与该行竖脊同一桶色（CSS 接线，而不只是 data 属性）。
  expect(list[q('08:00')]).toMatchObject({ b: a.b, l: '3', bg: a.bg });
  expect(list[q('09:30')]).toMatchObject({ b: c.b, l: '3', bg: c.bg });
  // 现在 12:34:30 落在 12:30 这一格：只算已过去的 4.5 分钟 → 1 档，并且是唯一的「现在」格。
  expect(list[q('12:30')]).toMatchObject({ b: c.b, l: '1', now: true, fut: false });
  expect(list.filter(x => x.now)).toHaveLength(1);
  expect(list.slice(q('12:45')).every(x => x.fut)).toBe(true);
  expect(list.filter(x => x.fut)).toHaveLength(96 - q('12:45'));
});

// v1.12.0 起热力条与布局无关（维护者要求三种布局都可显示，默认开启）：本用例由
// 「全文/单行没有热力条」改判为「默认也在最后一行之后」。
for (const density of ['full', 'single']) {
  test(`v1.11.0: the ${density} layout also ends with the heat strip by default (v1.12.0)`, async ({ page }) => {
    await boot(page, 390, 'empty', false, FIXED_NOW);
    await applyDensity(page, density);
    await seed(page, TODAY_ENTRIES);
    await expect(page.locator('.entry[data-id="c"]')).toBeVisible();
    await expect(page.locator('.log')).toHaveAttribute('data-density', density);
    await expect(page.locator('.log > .day-heat')).toHaveCount(1);
    expect(await page.evaluate(() => document.querySelector('.log').lastElementChild.classList.contains('day-heat'))).toBe(true);
    expect(await cells(page)).toHaveLength(96);
  });
}

test('v1.11.0: a past day shows a complete strip with no future or now cells', async ({ page }) => {
  await boot(page, 390, 'empty', false, FIXED_NOW, -1);
  await applyDensity(page, 'scaled');
  await seed(page, [
    { id: 'y1', ts: '2026-06-28T09:00', what: '昨天', tags: ['求职推进'] },
    { id: 'y2', ts: '2026-06-28T20:00', what: '晚上', tags: ['吃饭'] }
  ]);
  await expect(page.locator('.entry[data-id="y2"]')).toBeVisible();
  await expect(page.locator('.day-heat .dh-title')).toHaveText('全天 24 小时');
  const list = await cells(page);
  expect(list).toHaveLength(96);
  expect(list.some(x => x.fut || x.now)).toBe(false);
  // 尾段一直延续到 24:00。
  const y2 = await page.locator('.entry[data-id="y2"]').getAttribute('data-b');
  expect(list[95]).toMatchObject({ b: y2, l: '3' });
});

test('v1.11.0: a future day shows no heat strip', async ({ page }) => {
  await boot(page, 390, 'empty', false, FIXED_NOW, 1);
  await applyDensity(page, 'scaled');
  await seed(page, [{ id: 'p1', ts: '2026-06-30T10:00', what: '计划', tags: ['求职推进'], planned: true }]);
  await expect(page.locator('.entry[data-id="p1"]')).toBeVisible();
  await expect(page.locator('.day-heat')).toHaveCount(0);
});

for (const width of [320, 390]) {
  test(`v1.11.0: heat cells stay square and inside the strip at ${width}px`, async ({ page }) => {
    await boot(page, width, 'empty', false, FIXED_NOW);
    await applyDensity(page, 'scaled');
    await seed(page, TODAY_ENTRIES);
    await expect(page.locator('.day-heat')).toHaveCount(1);
    const box = await page.locator('.day-heat').evaluate(strip => {
      const s = strip.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(strip).paddingRight);
      const list = [...strip.querySelectorAll('.dh-grid i')].map(i => i.getBoundingClientRect());
      const head = strip.querySelector('.dh-head').getBoundingClientRect();
      const axis = strip.querySelector('.dh-axis').getBoundingClientRect();
      return {
        inside: list.every(r => r.left >= s.left && r.right <= s.right - pad + 0.5),
        square: list.every(r => Math.abs(r.width - r.height) <= 0.5),
        minSide: Math.min(...list.map(r => r.width)),
        headInside: head.right <= s.right + 0.5,
        axisInside: axis.right <= s.right + 0.5
      };
    });
    expect(box.inside && box.square && box.headInside && box.axisInside, JSON.stringify(box)).toBe(true);
    expect(box.minSide).toBeGreaterThanOrEqual(8);
    await expectNoHorizontalOverflow(page);
  });
}

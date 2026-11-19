// v1.13.0 · 首屏统计卡片「比例 ⇄ 分布」（维护者看过对比图选定）：右上角状态标签写当前显示的是什么，
// 点标签或图形区切换，日周月年共用一个选择（timelog.heroVisual，默认比例）。日 / 周为热力格
// （15 分钟格 / 1 小时格），月 / 年为按标签分的环形图。取代 v1.11.0–v1.12.0 的时间轴底部热力条
// 与「更多」开关；那两版用例里仍成立的格子断言搬到这里，改为检查卡片。
import { expect, test } from './startup_fixture.js';
import { boot, openBackupMenu, FIXED_NOW, expectNoHorizontalOverflow } from './ui_fixture.js';

const DAY = FIXED_NOW.slice(0, 10); // 冻结在 2026-06-29（周一）12:34:30
const q = hm => { const [h, m] = hm.split(':').map(Number); return h * 4 + m / 15; };

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
  return page.evaluate(() => [...document.querySelectorAll('#ruler .hero-heat i')].map(i => ({
    b: i.dataset.b || '', l: i.dataset.l || '', fut: i.classList.contains('fut'), now: i.classList.contains('now'),
    bg: getComputedStyle(i).backgroundColor
  })));
}

async function bootDay(page, width = 390, offset = null) {
  await boot(page, width, 'empty', false, FIXED_NOW, offset);
}

test('v1.13.0: the card shows the ratio bar by default and the bottom strip and More switch are gone', async ({ page }) => {
  await bootDay(page);
  await seed(page, TODAY_ENTRIES);
  await expect(page.locator('.entry[data-id="c"]')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('timelog.heroVisual'))).toBeNull();
  await expect(page.locator('#ruler .hero-bar')).toHaveCount(1);
  await expect(page.locator('#ruler .hero-heat')).toHaveCount(0);
  const sw = page.locator('#ruler .hero-switch');
  await expect(sw).toHaveText('比例 ⇄');
  await expect(sw).toHaveAccessibleName('卡片图形：比例，点按切换为分布');
  await expect(page.locator('.day-heat')).toHaveCount(0);
  await openBackupMenu(page);
  await expect(page.locator('#day-heat-seg')).toHaveCount(0);
});

test('v1.13.0: switching the day card shows 96 quarter-hour cells that follow the day', async ({ page }) => {
  await bootDay(page);
  await seed(page, TODAY_ENTRIES);
  await expect(page.locator('.entry[data-id="c"]')).toBeVisible();
  await page.locator('#ruler .hero-switch').click();
  await expect(page.locator('#ruler .hero-switch')).toHaveText('分布 ⇄');
  await expect(page.locator('#ruler .hero-switch')).toHaveAccessibleName('卡片图形：分布，点按切换为比例');
  await expect(page.locator('#ruler .hero-heat')).toHaveAttribute('aria-hidden', 'true');
  expect(await page.evaluate(() => localStorage.getItem('timelog.heroVisual'))).toBe('detail');

  const list = await cells(page);
  expect(list).toHaveLength(96);
  const rail = id => page.locator(`.entry[data-id="${id}"]`).evaluate(r => ({ b: r.dataset.b, bg: getComputedStyle(r, '::before').backgroundColor }));
  const a = await rail('a');
  const c = await rail('c');
  expect(list.slice(0, q('08:00')).every(x => x.b === 'unrecorded' && !x.fut)).toBe(true);
  // 满格的颜色与该行竖脊同一桶色（CSS 接线，而不只是 data 属性）。
  expect(list[q('08:00')]).toMatchObject({ b: a.b, l: '3', bg: a.bg });
  expect(list[q('09:30')]).toMatchObject({ b: c.b, l: '3', bg: c.bg });
  // 现在 12:34:30 落在 12:30 这一格：只算已过去的 4.5 分钟 → 1 档，并且是唯一的「现在」格。
  expect(list[q('12:30')]).toMatchObject({ b: c.b, l: '1', now: true, fut: false });
  expect(list.filter(x => x.now)).toHaveLength(1);
  expect(list.slice(q('12:45')).every(x => x.fut)).toBe(true);

  // 点图形区切回比例。
  await page.locator('#ruler .hero-visual').click();
  await expect(page.locator('#ruler .hero-bar')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('timelog.heroVisual'))).toBe('ratio');
});

test('v1.13.0: a past day card has no future or now cells', async ({ page }) => {
  await bootDay(page, 390, -1);
  await page.addInitScript(() => localStorage.setItem('timelog.heroVisual', 'detail'));
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  await seed(page, [
    { id: 'y1', ts: '2026-06-28T09:00', what: '昨天', tags: ['求职推进'] },
    { id: 'y2', ts: '2026-06-28T20:00', what: '晚上', tags: ['吃饭'] }
  ]);
  await expect(page.locator('.entry[data-id="y2"]')).toBeVisible();
  const list = await cells(page);
  expect(list).toHaveLength(96);
  expect(list.some(x => x.fut || x.now)).toBe(false);
  const y2 = await page.locator('.entry[data-id="y2"]').getAttribute('data-b');
  expect(list[95]).toMatchObject({ b: y2, l: '3' });
});

test('v1.13.0: one choice covers every view — the week card shows 7 days × 24 hours', async ({ page }) => {
  await bootDay(page);
  await seed(page, TODAY_ENTRIES);
  await expect(page.locator('.entry[data-id="c"]')).toBeVisible();
  const job = await page.locator('.entry[data-id="c"]').getAttribute('data-b');
  await page.locator('#ruler .hero-switch').click();
  await page.locator('[data-action="view"][data-view="week"]').click();
  await expect(page.locator('#ruler .hero-switch')).toHaveText('分布 ⇄');
  const list = await cells(page);
  expect(list).toHaveLength(168);
  expect(await page.locator('#ruler .hh-lab').allTextContents()).toEqual(['一', '二', '三', '四', '五', '六', '日']);
  // 周一（今天）：08 点那一小时 30 分钟吃饭 + 30 分钟求职推进，并列取 job；09 点满格主线；12 点含现在。
  expect(job).toBe('job');
  expect(list[8].b).toBe(job);
  expect(list[9]).toMatchObject({ l: '3' });
  expect(list[12]).toMatchObject({ now: true, l: '2' });
  expect(list.slice(13).every(x => x.fut)).toBe(true);
});

test('v1.13.0: month and year cards show a ring split by tag with the six largest in the legend', async ({ page }) => {
  await bootDay(page);
  // 选择是日周月年共用的一个偏好：先设成「分布」（今天没有记录、日视图卡片是空状态，没有按钮可点）。
  await page.addInitScript(() => localStorage.setItem('timelog.heroVisual', 'detail'));
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  // 6/10 一整天：睡觉 8h、未记录 6.5h、求职推进 4h、娱乐 2h、吃饭 1h、刷手机 1h、洗漱/通勤/发呆各 30min。
  await seed(page, [
    ['00:00', '睡', '睡觉'], ['08:00', '写', '求职推进'], ['12:00', '饭', '吃饭'], ['13:00', '玩', '娱乐'],
    ['15:00', '洗', '洗漱'], ['15:30', '路', '通勤'], ['16:00', '刷', '刷手机'], ['17:00', '呆', '发呆'], ['17:30', '', '']
  ].map(([t, what, tag], i) => ({ id: `m${i}`, ts: `2026-06-10T${t}`, what, tags: tag ? [tag] : [] })));
  await page.locator('[data-action="view"][data-view="month"]').click();
  await expect(page.locator('#ruler .hero-switch')).toHaveText('标签 ⇄');
  await expect(page.locator('#ruler .hero-switch')).toHaveAccessibleName('卡片图形：标签，点按切换为比例');
  const names = await page.locator('#ruler .tr-item:not(.tr-rest) .tr-name').allTextContents();
  expect(names).toEqual(['睡觉', '未记录', '求职推进', '娱乐', '吃饭', '刷手机']);
  await expect(page.locator('#ruler .tr-rest .tr-name')).toHaveText('其余 3 个标签');
  await expect(page.locator('#ruler .tr-item').first().locator('.tr-val')).toHaveText('8h · 33.3%');
  // 环的最后一个色标落在 360°：各块之和等于总时长。
  const bg = await page.locator('#ruler .tr-ring').evaluate(el => el.style.background);
  expect(bg).toMatch(/360\.00deg\)$/);
  await page.locator('[data-action="view"][data-view="year"]').click();
  await expect(page.locator('#ruler .hero-switch')).toHaveText('标签 ⇄');
  expect(await page.locator('#ruler .tr-item:not(.tr-rest) .tr-name').allTextContents()).toEqual(names);
});

test('v1.13.0: switching from the keyboard keeps focus on the switch', async ({ page }) => {
  await bootDay(page);
  await seed(page, TODAY_ENTRIES);
  await expect(page.locator('.entry[data-id="c"]')).toBeVisible();
  await page.locator('#ruler .hero-switch').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#ruler .hero-heat')).toHaveCount(1);
  expect(await page.evaluate(() => document.activeElement?.classList.contains('hero-switch'))).toBe(true);
  await page.keyboard.press('Space');
  await expect(page.locator('#ruler .hero-bar')).toHaveCount(1);
  expect(await page.evaluate(() => document.activeElement?.classList.contains('hero-switch'))).toBe(true);
});

test('v1.13.0: a refresh never restores a snapshot drawn with the other card chart', async ({ page }) => {
  await boot(page, 390, 'two-records', false, FIXED_NOW);
  await expect(page.locator('#ruler .hero-bar')).toHaveCount(1);
  await page.addInitScript(() => localStorage.setItem('timelog.heroVisual', 'detail'));
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  // 若旧快照被接回，init 不会首轮重绘（v53），卡片会停在比例条——这条断言就是这道门的牙。
  await expect(page.locator('#ruler .hero-heat')).toHaveCount(1);
});

test('v1.13.0: the retired v1.12.0 heat-strip preference is deleted on start', async ({ page }) => {
  await bootDay(page);
  await page.addInitScript(() => localStorage.setItem('timelog.dayHeat', 'off'));
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  expect(await page.evaluate(() => localStorage.getItem('timelog.dayHeat'))).toBeNull();
});

for (const width of [320, 390]) {
  for (const view of ['day', 'week']) {
    test(`v1.13.0: ${view} heat cells stay square and inside the card, and the switch clears the numbers, at ${width}px`, async ({ page }) => {
      await bootDay(page, width);
      await seed(page, TODAY_ENTRIES);
      await expect(page.locator('.entry[data-id="c"]')).toBeVisible();
      if (view === 'week') await page.locator('[data-action="view"][data-view="week"]').click();
      const ratioH = await page.locator('#ruler .day-hero').evaluate(h => h.getBoundingClientRect().height);
      await page.locator('#ruler .hero-switch').click();
      await expect(page.locator('#ruler .hero-heat')).toHaveCount(1);
      const box = await page.locator('#ruler .day-hero').evaluate(hero => {
        const h = hero.getBoundingClientRect();
        const list = [...hero.querySelectorAll('.hero-heat i')].map(i => i.getBoundingClientRect());
        const sw = hero.querySelector('.hero-switch');
        const range = document.createRange();
        range.selectNodeContents(sw);
        const text = range.getBoundingClientRect();
        const hit = sw.getBoundingClientRect();
        const ov = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
        const nums = [hero.querySelector('.hero-big'), hero.querySelector('.hero-leak'), ...hero.querySelectorAll('.hero-label')].map(n => n.getBoundingClientRect());
        return {
          inside: list.every(r => r.left >= h.left && r.right <= h.right + 0.5),
          square: list.every(r => Math.abs(r.width - r.height) <= 0.5),
          minSide: Math.min(...list.map(r => r.width)),
          switchClear: nums.every(n => !ov(text, n)),
          hit: [hit.width, hit.height]
        };
      });
      expect(box.inside && box.square && box.switchClear, JSON.stringify(box)).toBe(true);
      expect(box.minSide).toBeGreaterThanOrEqual(7.5);
      expect(box.hit[0]).toBeGreaterThanOrEqual(44);
      expect(box.hit[1]).toBeGreaterThanOrEqual(44);
      // 切换按钮不占排版位置：比例态卡片高度与没有它时一致（v1.12.0 及以前为 102px）。
      if (width === 390) expect(Math.round(ratioH)).toBe(102);
      await expectNoHorizontalOverflow(page);
    });
  }
}

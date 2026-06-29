import { expect, test } from '@playwright/test';

const VIEWPORTS = [320, 375, 430, 768];
const STATES = ['empty', 'one-record', 'yesterday-residual'];
const FIXED_NOW = '2026-06-29T12:34:30';

async function boot(page, width, state, share = false, now = '', selectedDateOffset = null) {
  await page.setViewportSize({ width, height: 820 });
  await page.addInitScript(({ state, share, now, selectedDateOffset }) => {
    if (now) {
      const RealDate = Date;
      const fixedNow = new RealDate(now).getTime();
      class FixedDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [fixedNow]));
        }
        static now() { return fixedNow; }
        static parse(value) { return RealDate.parse(value); }
        static UTC(...args) { return RealDate.UTC(...args); }
      }
      window.Date = FixedDate;
    }
    function p2(n) { return String(n).padStart(2, '0'); }
    function dateKey(d) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
    function minuteKey(d) { return `${dateKey(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}`; }
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const entries = [];
    if (state === 'one-record') {
      entries.push({ id: 'today-1', ts: `${dateKey(today)}T00:05`, what: '响应式测试记录', tags: ['求职推进'] });
    }
    if (state === 'two-records') {
      entries.push(
        { id: 'today-1', ts: `${dateKey(today)}T09:00`, what: '写代码', tags: ['求职推进'] },
        { id: 'today-2', ts: `${dateKey(today)}T10:00`, what: '改 bug', tags: ['求职推进'] }
      );
    }
    if (state === 'tail-placeholder') {
      entries.push(
        { id: 'today-1', ts: `${dateKey(today)}T09:00`, what: '写代码', tags: ['求职推进'] },
        { id: 'today-open', ts: `${dateKey(today)}T10:00`, what: '', tags: [] }
      );
    }
    if (state === 'now-placeholder') {
      entries.push({ id: 'open-now', ts: minuteKey(today), what: '', tags: [] });
    }
    if (state === 'yesterday-residual') {
      entries.push({ id: 'yesterday-1', ts: `${dateKey(yesterday)}T23:00`, what: '昨日残留记录', tags: ['杂'] });
    }
    if (state === 'yesterday-placeholder') {
      entries.push({ id: 'yesterday-open', ts: `${dateKey(yesterday)}T23:00`, what: '', tags: [] });
    }
    localStorage.clear();
    localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries }));
    if (selectedDateOffset !== null) {
      const selected = new Date(today);
      selected.setDate(selected.getDate() + selectedDateOffset);
      const selectedKey = dateKey(selected);
      localStorage.setItem('timelog.selectedDate', selectedKey);
      localStorage.setItem('timelog.openDate', selectedKey);
    }

    if (share) {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: () => Promise.resolve()
      });
      Object.defineProperty(navigator, 'canShare', {
        configurable: true,
        value: () => false
      });
    }
  }, { state, share, now, selectedDateOffset });
  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('#timeline')?.children.length > 0);
}

async function expectNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const nav = document.querySelector('.date-nav').getBoundingClientRect();
    const period = document.querySelector('#period-label').getBoundingClientRect();
    const footer = document.querySelector('.footer').getBoundingClientRect();
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      navLeft: nav.left,
      navRight: nav.right,
      periodLeft: period.left,
      periodRight: period.right,
      footerLeft: footer.left,
      footerRight: footer.right,
      viewport: window.innerWidth
    };
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.navLeft).toBeGreaterThanOrEqual(-1);
  expect(metrics.navRight).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.periodLeft).toBeGreaterThanOrEqual(-1);
  expect(metrics.periodRight).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.footerLeft).toBeGreaterThanOrEqual(-1);
  expect(metrics.footerRight).toBeLessThanOrEqual(metrics.viewport + 1);
}

for (const width of VIEWPORTS) {
  for (const state of STATES) {
    test(`no horizontal overflow at ${width}px with ${state}`, async ({ page }) => {
      await boot(page, width, state);
      await expectNoHorizontalOverflow(page);
      await page.getByRole('button', { name: '周视图' }).click();
      await expect(page.locator('#period-label')).toHaveAttribute('aria-label', /周/);
      await expectNoHorizontalOverflow(page);
      if (state === 'yesterday-residual') {
        await page.getByRole('button', { name: '天视图' }).click();
        await expect(page.locator('#ruler')).toContainText('这一天还没有记录');
      }
    });
  }
}

for (const share of [false, true]) {
  test(`footer does not overflow when share is ${share ? 'available' : 'hidden'}`, async ({ page }) => {
    await boot(page, 320, 'one-record', share);
    if (share) await expect(page.locator('#share-btn')).toBeVisible();
    else await expect(page.locator('#share-btn')).toBeHidden();
    await expectNoHorizontalOverflow(page);
  });
}

test('375px header hides title without overflowing', async ({ page }) => {
  await boot(page, 375, 'one-record');
  await expect(page.locator('.hdr-title')).toBeHidden();
  await expectNoHorizontalOverflow(page);
});

test('new entry shows continuation context and recomputes start', async ({ page }) => {
  await boot(page, 768, 'tail-placeholder', false, FIXED_NOW);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  const panel = page.locator('.form-sheet-panel');
  await expect(panel).toBeFocused();
  await expect(page.locator('[data-role="start-time-label"]')).toHaveText('10:00');
  await expect(page.locator('[data-role="duration-label"]')).not.toBeEmpty();
  const tooltipVisibility = await page.locator('.form-sheet-actions .icon-btn').first()
    .evaluate(btn => getComputedStyle(btn, '::after').visibility);
  expect(tooltipVisibility).toBe('hidden');

  await page.locator('[data-action="toggle-start-time"]').click();
  await expect(page.locator('#form-wheel-mount')).toBeVisible();
  await expect.poll(async () => page.locator('#form-wheel-mount')
    .evaluate(mount => mount.contains(document.activeElement))).toBe(true);

  await page.locator('[data-role="text"]').fill('2026-06-29 09:30');
  await page.locator('[data-role="text"]').blur();
  await expect(page.locator('[data-role="start-time-label"]')).toHaveText('09:30');
});

test('past-day continuation settles at day end and restores selected date', async ({ page }) => {
  await boot(page, 768, 'yesterday-residual', false, FIXED_NOW, -1);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();

  await expect(page.locator('#form-sheet-title')).toHaveText('补记 · 6月28日');
  await expect(page.locator('.form-sheet-what')).toHaveText('写下这一段做了什么');
  await expect(page.locator('[data-role="start-time-label"]')).toHaveText('23:00');
  await expect(page.locator('[data-role="end-label"]')).toHaveText('24:00');
  await expect(page.locator('[data-role="duration-label"]')).toHaveText('~1h');
});

test('continuation save fills tail placeholder and opens unrecorded segment', async ({ page }) => {
  await boot(page, 768, 'tail-placeholder', false, FIXED_NOW);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.locator('#form-what').fill('写方案');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  await page.getByRole('button', { name: '保存时间记录' }).click();

  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  const completed = entries.find(entry => entry.id === 'today-open');
  const opened = entries.find(entry => entry.ts === '2026-06-29T12:34' && entry.what === '');
  expect(completed).toMatchObject({ ts: '2026-06-29T10:00', what: '写方案', tags: ['求职推进'] });
  expect(opened).toMatchObject({ what: '', tags: [] });
  await expect(page.locator('#timeline')).toContainText('进行中·还没记');
  await expect(page.locator('#timeline')).toContainText('未记录·进行中');
});

test('past-day save does not create today placeholder', async ({ page }) => {
  await boot(page, 768, 'yesterday-placeholder', false, FIXED_NOW, -1);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.locator('#form-what').fill('补完昨天');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  await page.getByRole('button', { name: '保存时间记录' }).click();

  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ id: 'yesterday-open', ts: '2026-06-28T23:00', what: '补完昨天', tags: ['求职推进'] });
  await expect(page.locator('#period-label')).toContainText('2026/06/28');
});

test('first record with earlier start creates real segment and open placeholder', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.locator('[data-action="toggle-start-time"]').click();
  await page.locator('[data-role="text"]').fill('2026-06-29 06:30');
  await page.locator('[data-role="text"]').blur();
  await page.locator('#form-what').fill('准备面试');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  await page.getByRole('button', { name: '保存时间记录' }).click();

  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries).toHaveLength(2);
  expect(entries.find(entry => entry.ts === '2026-06-29T06:30')).toMatchObject({ what: '准备面试', tags: ['求职推进'] });
  expect(entries.find(entry => entry.ts === '2026-06-29T12:34')).toMatchObject({ what: '', tags: [] });
});

test('same-minute placeholder save reuses timestamp without duplicate', async ({ page }) => {
  await boot(page, 768, 'now-placeholder', false, FIXED_NOW);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.locator('#form-what').fill('刚开始');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  await page.getByRole('button', { name: '保存时间记录' }).click();

  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ id: 'open-now', ts: '2026-06-29T12:34', what: '刚开始', tags: ['求职推进'] });
});

test('new entry still shows inline same-time conflict', async ({ page }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.locator('[data-action="toggle-start-time"]').click();
  await page.locator('[data-role="text"]').fill('2026-06-29 09:00');
  await page.locator('[data-role="text"]').blur();
  await page.locator('#form-what').fill('重复时间');
  await page.getByRole('button', { name: '保存时间记录' }).click();

  await expect(page.locator('[data-role="conflict-error"]')).toContainText('同一时刻已有');
  await expect(page.locator('[data-role="conflict-error"]')).toContainText('编辑那条');
  await expect(page.locator('[data-role="conflict-error"]')).toContainText('用+1min');
});

test('help close icon and import shift dialog stay custom', async ({ page }) => {
  await boot(page, 375, 'empty');
  await page.getByRole('button', { name: '打开说明' }).click();
  await expect(page.locator('.help-body')).toBeVisible();
  await expect(page.locator('.form-sheet-panel')).toBeFocused();
  await expect(page.locator('.form-sheet-actions [data-action="close-form"] svg path')).toHaveCount(2);
  const helpTooltipVisibility = await page.locator('.form-sheet-actions [data-action="close-form"]')
    .evaluate(btn => getComputedStyle(btn, '::after').visibility);
  expect(helpTooltipVisibility).toBe('hidden');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '导入 JSON 备份' }).click();
  await expect(page.locator('#form-sheet-title')).toContainText('导入时区平移');
  await expect(page.locator('#import-shift-hours')).toBeVisible();
  await page.getByRole('button', { name: '取消导入' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
});

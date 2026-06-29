import { expect, test } from '@playwright/test';

const VIEWPORTS = [320, 375, 430, 768];
const STATES = ['empty', 'one-record', 'yesterday-residual'];

async function boot(page, width, state, share = false) {
  await page.setViewportSize({ width, height: 820 });
  await page.addInitScript(({ state, share }) => {
    function p2(n) { return String(n).padStart(2, '0'); }
    function dateKey(d) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
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
    if (state === 'yesterday-residual') {
      entries.push({ id: 'yesterday-1', ts: `${dateKey(yesterday)}T23:00`, what: '昨日残留记录', tags: ['杂'] });
    }
    localStorage.clear();
    localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries }));

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
  }, { state, share });
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

test('new entry shows and recomputes previous segment block', async ({ page }) => {
  await boot(page, 768, 'two-records');
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  const panel = page.locator('.form-sheet-panel');
  await expect(panel).toBeFocused();
  await expect(page.locator('[data-role="prev-segment"]')).toContainText('改 bug');
  const tooltipVisibility = await page.locator('.form-sheet-actions .icon-btn').first()
    .evaluate(btn => getComputedStyle(btn, '::after').visibility);
  expect(tooltipVisibility).toBe('hidden');

  await page.locator('[data-action="focus-end-time"]').click();
  await expect.poll(async () => page.locator('#form-wheel-mount')
    .evaluate(mount => mount.contains(document.activeElement))).toBe(true);

  const selectedDate = (await page.locator('#form-ts').inputValue()).slice(0, 10);
  await page.locator('[data-role="text"]').fill(`${selectedDate} 09:30`);
  await page.locator('[data-role="text"]').blur();
  await expect(page.locator('[data-role="prev-segment"]')).toContainText('写代码');
  await expect(page.locator('[data-role="prev-segment"]')).not.toContainText('改 bug');
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

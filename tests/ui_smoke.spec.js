import { expect, test } from '@playwright/test';

const VIEWPORTS = [320, 375, 430, 768];
const STATES = ['empty', 'one-record', 'yesterday-residual'];

async function boot(page, width, state, share = false) {
  await page.setViewportSize({ width, height: 820 });
  await page.addInitScript(({ state, share }) => {
    function p2(n) {
      return String(n).padStart(2, '0');
    }
    function dateKey(d) {
      return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    }
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const entries = [];
    if (state === 'one-record') {
      entries.push({ id: 'today-1', ts: `${dateKey(today)}T00:05`, what: '响应式测试记录', tags: ['求职推进'] });
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

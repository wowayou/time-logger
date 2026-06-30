import { expect } from '@playwright/test';

export const VIEWPORTS = [320, 375, 430, 768];
export const STATES = ['empty', 'one-record', 'yesterday-residual'];
export const FIXED_NOW = '2026-06-29T12:34:30';

export async function boot(page, width, state, share = false, now = '', selectedDateOffset = null, timezoneOffsetMinutes = null) {
  await page.setViewportSize({ width, height: 820 });
  await page.addInitScript(({ state, share, now, selectedDateOffset, timezoneOffsetMinutes }) => {
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
    if (timezoneOffsetMinutes !== null) {
      Object.defineProperty(Date.prototype, 'getTimezoneOffset', {
        configurable: true,
        value: () => timezoneOffsetMinutes
      });
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
    if (state === 'cross-day-shifted') {
      entries.push(
        { id: 'cross-start', ts: `${dateKey(yesterday)}T23:00`, what: '跨日切片记录', tags: ['睡觉'] },
        { id: 'cross-open', ts: `${dateKey(today)}T02:35`, what: '', tags: [] }
      );
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
  }, { state, share, now, selectedDateOffset, timezoneOffsetMinutes });
  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('#timeline')?.children.length > 0);
}

export async function openBackupMenu(page) {
  await page.getByRole('button', { name: '打开备份菜单' }).click();
  await expect(page.locator('#form-sheet-title')).toHaveText('备份');
}

export async function expectNoHorizontalOverflow(page) {
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

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
    if (state === 'mid-placeholder') {
      // An empty placeholder stranded in the MIDDLE of the day (not the tail),
      // so openPlaceholderForDate won't find it — exercises ③ backfill merge.
      entries.push(
        { id: 'mid-a', ts: `${dateKey(today)}T08:00`, what: '早间', tags: ['求职推进'] },
        { id: 'mid-open', ts: `${dateKey(today)}T09:00`, what: '', tags: [] },
        { id: 'mid-c', ts: `${dateKey(today)}T11:00`, what: '上午', tags: ['求职推进'] }
      );
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
    if (state === 'planned-only') {
      entries.push({ id: 'plan-1', ts: `${dateKey(today)}T09:30`, what: '准备面试', tags: ['求职推进'], planned: true });
    }
    if (state === 'plan-collides-now') {
      // A future plan plus a real entry already sitting on the frozen "now"
      // minute, so confirming the plan must dodge the same-ts collision (⑥).
      entries.push(
        { id: 'now-entry', ts: minuteKey(today), what: '正在做的事', tags: ['求职推进'] },
        { id: 'plan-future', ts: `${dateKey(today)}T23:30`, what: '准备面试', tags: ['求职推进'], planned: true }
      );
    }
    if (state === 'custom-chip') {
      entries.push({ id: 'stretch-1', ts: `${dateKey(today)}T08:00`, what: '拉伸', tags: ['拉伸'] });
    }
    localStorage.clear();
    localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries }));
    if (state === 'custom-chip') {
      localStorage.setItem('timelog.config', JSON.stringify({
        version: 1,
        mainline: ['求职推进'],
        chips: [{ name: '拉伸', bucket: 'maintain', longOk: false }]
      }));
    }
    if (selectedDateOffset !== null) {
      const selected = new Date(today);
      selected.setDate(selected.getDate() + selectedDateOffset);
      const selectedKey = dateKey(selected);
      localStorage.setItem('timelog.selectedDate', selectedKey);
      localStorage.setItem('timelog.openDate', selectedKey);
    }

    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: share ? () => Promise.resolve() : undefined
    });
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: share ? () => false : undefined
    });
  }, { state, share, now, selectedDateOffset, timezoneOffsetMinutes });
  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('#timeline')?.children.length > 0);
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
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

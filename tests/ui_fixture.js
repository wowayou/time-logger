import { expect } from '@playwright/test';

export const VIEWPORTS = [320, 375, 430, 768];
export const STATES = ['empty', 'one-record', 'yesterday-residual'];
export const FIXED_NOW = '2026-06-29T12:34:30';

export async function boot(page, width, state, share = false, now = '', selectedDateOffset = null, timezoneOffsetMinutes = null, recordMode = null, path = '/') {
  await page.setViewportSize({ width, height: 820 });
  await page.addInitScript(({ state, share, now, selectedDateOffset, timezoneOffsetMinutes, recordMode }) => {
    if (now) {
      const RealDate = Date;
      let fixedNow = new RealDate(now).getTime();
      class FixedDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [fixedNow]));
        }
        static now() { return fixedNow; }
        static parse(value) { return RealDate.parse(value); }
        static UTC(...args) { return RealDate.UTC(...args); }
      }
      window.Date = FixedDate;
      window.__setFixedNow = value => { fixedNow = new RealDate(value).getTime(); };
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
    const plusEight = new Date(today);
    plusEight.setDate(plusEight.getDate() + 8);
    const entries = [];
    if (state === 'one-record') {
      entries.push({ id: 'today-1', ts: `${dateKey(today)}T00:05`, what: '响应式测试记录', tags: ['求职推进'] });
    }
    if (state === 'long-note') {
      // A record whose note is long enough that an uncapped autosized textarea
      // would grow taller than the SE2 viewport and push the save ✓ off-screen.
      entries.push({
        id: 'today-long',
        ts: `${dateKey(today)}T09:00`,
        what: Array.from({ length: 40 }, (_, i) => `第${i + 1}行超长内容需要换行占满整个屏幕宽度测试`).join('\n'),
        tags: ['求职推进']
      });
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
    if (state === 'three-labels') {
      // Three back-to-back records with DISTINCT tags, for smart-delete: deleting
      // the middle must turn its span 未记录, never relabel it as the previous one.
      entries.push(
        { id: 'tl-a', ts: `${dateKey(today)}T08:00`, what: '睡一会', tags: ['睡觉'] },
        { id: 'tl-b', ts: `${dateKey(today)}T09:00`, what: '写代码', tags: ['求职推进'] },
        { id: 'tl-c', ts: `${dateKey(today)}T10:00`, what: '吃早饭', tags: ['吃饭'] }
      );
    }
    if (state === 'interval-three') {
      entries.push(
        { id: 'before', ts: `${dateKey(today)}T14:30`, what: '前一段', tags: ['睡觉'] },
        { id: 'various', ts: `${dateKey(today)}T15:39`, what: '各种', tags: ['吃饭'] },
        { id: 'focus', ts: `${dateKey(today)}T16:14`, what: '专注', tags: ['求职推进'] },
        { id: 'after', ts: `${dateKey(today)}T19:11`, what: '后一段', tags: ['吃饭'] }
      );
    }
    if (state === 'same-neighbors') {
      entries.push(
        { id: 'same-left', ts: `${dateKey(today)}T08:00`, what: '同一内容', tags: ['求职推进'] },
        { id: 'same-middle', ts: `${dateKey(today)}T09:00`, what: '插入段', tags: ['吃饭'] },
        { id: 'same-right', ts: `${dateKey(today)}T10:00`, what: '同一内容', tags: ['求职推进'] },
        { id: 'same-after', ts: `${dateKey(today)}T11:00`, what: '后续', tags: ['吃饭'] }
      );
    }
    if (state === 'ongoing-tail') {
      entries.push({ id: 'ongoing', ts: `${dateKey(today)}T10:00`, what: '进行中的事', tags: ['求职推进'], ongoing: true });
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
    if (state === 'planned-expired') {
      entries.push({ id: 'plan-expired', ts: `${dateKey(today)}T09:00`, what: '过期计划', tags: ['求职推进'], planned: true });
    }
    if (state === 'planned-near') {
      entries.push({ id: 'plan-near', ts: `${dateKey(today)}T12:37`, what: '临近计划', tags: ['求职推进'], planned: true });
    }
    if (state === 'planned-far') {
      entries.push({ id: 'plan-far', ts: `${dateKey(plusEight)}T09:00`, what: '远期计划', tags: ['求职推进'], planned: true });
    }
    if (state === 'overnight-with-today-real') {
      entries.push(
        { id: 'yesterday-open', ts: `${dateKey(yesterday)}T23:00`, what: '', tags: [] },
        { id: 'today-real', ts: `${dateKey(today)}T07:30`, what: '洗漱', tags: ['洗漱'] }
      );
    }
    if (state === 'overnight-boundaries') {
      entries.push(
        { id: 'yesterday-open', ts: `${dateKey(yesterday)}T23:00`, what: '', tags: [] },
        { id: 'midnight-open', ts: `${dateKey(today)}T00:00`, what: '', tags: [] },
        { id: 'inside-open', ts: `${dateKey(today)}T04:00`, what: '', tags: [] },
        { id: 'now-open', ts: minuteKey(today), what: '', tags: [] },
        { id: 'future-real', ts: `${dateKey(today)}T18:00`, what: '晚间安排', tags: ['求职推进'] },
        { id: 'future-plan', ts: `${dateKey(today)}T20:00`, what: '未来计划', tags: ['求职推进'], planned: true }
      );
    }
    if (state === 'overnight-midnight-plan') {
      entries.push(
        { id: 'yesterday-open', ts: `${dateKey(yesterday)}T23:00`, what: '', tags: [] },
        { id: 'midnight-plan', ts: `${dateKey(today)}T00:00`, what: '午夜计划', tags: ['求职推进'], planned: true }
      );
    }
    if (state === 'overnight-hardend-plan') {
      entries.push(
        { id: 'yesterday-open', ts: `${dateKey(yesterday)}T23:00`, what: '', tags: [] },
        { id: 'now-plan', ts: minuteKey(today), what: '当前计划', tags: ['求职推进'], planned: true }
      );
    }
    if (state === 'overnight-hardend-midnight') {
      entries.push(
        { id: 'yesterday-open', ts: `${dateKey(yesterday)}T23:00`, what: '', tags: [] },
        { id: 'today-midnight-real', ts: `${dateKey(today)}T00:00`, what: '午夜开始', tags: ['求职推进'] }
      );
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
    if (state === 'renamed-default') {
      localStorage.setItem('timelog.config', JSON.stringify({
        version: 1,
        mainline: ['求职推进'],
        chips: [{ name: '休息', bucket: 'maintain', longOk: true }]
      }));
    }
    const selected = new Date(today);
    if (selectedDateOffset !== null) selected.setDate(selected.getDate() + selectedDateOffset);
    const selectedKey = dateKey(selected);
    localStorage.setItem('timelog.view', 'day');
    localStorage.setItem('timelog.selectedDate', selectedKey);
    localStorage.setItem('timelog.openDate', selectedKey);
    if (recordMode) localStorage.setItem('timelog.recordMode', recordMode);

    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: share ? () => Promise.resolve() : undefined
    });
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: share ? () => false : undefined
    });
  }, { state, share, now, selectedDateOffset, timezoneOffsetMinutes, recordMode });
  await page.goto(path);
  await page.waitForFunction(() => document.querySelector('#timeline')?.children.length > 0);
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
}

// v34: 摘要/备份/配置/主题/说明收进 header「···」更多 sheet；名字保留少改调用点。
export async function openBackupMenu(page) {
  await page.getByRole('button', { name: '打开更多菜单' }).click();
  await expect(page.locator('#form-sheet-title')).toHaveText('更多');
}

export async function expectNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const nav = document.querySelector('.date-nav').getBoundingClientRect();
    const period = document.querySelector('#period-label').getBoundingClientRect();
    const timeline = document.querySelector('#timeline');
    const timelineRect = timeline ? timeline.getBoundingClientRect() : null;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      navLeft: nav.left,
      navRight: nav.right,
      periodLeft: period.left,
      periodRight: period.right,
      timelineLeft: timelineRect ? timelineRect.left : 0,
      timelineRight: timelineRect ? timelineRect.right : 0,
      viewport: window.innerWidth
    };
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.navLeft).toBeGreaterThanOrEqual(-1);
  expect(metrics.navRight).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.periodLeft).toBeGreaterThanOrEqual(-1);
  expect(metrics.periodRight).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.timelineLeft).toBeGreaterThanOrEqual(-1);
  // WebKit can retain a 0.2px fractional edge after its device-pixel rounding
  // even when document.scrollWidth still equals clientWidth. Keep the guard
  // strict enough to catch real overflow while allowing that subpixel residue.
  expect(metrics.timelineRight).toBeLessThanOrEqual(metrics.viewport + 2);
}

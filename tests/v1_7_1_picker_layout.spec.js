// v1.7.1: keep the custom wheels/calendar; only compact and reflow their layout.
// Geometry is checked in the real sheet, not just with toBeVisible(): a calendar
// must push later fields down instead of covering them, including short windows.
import { expect, test } from '@playwright/test';
import { boot, FIXED_NOW, expectNoHorizontalOverflow } from './ui_fixture.js';

const newMount = '[data-role="start-time-section"] [data-role="form-wheel-mount"]';

async function openNewPicker(page, width, theme = 'light', height = 820, locale = 'zh') {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await boot(page, width, 'empty', false, FIXED_NOW);
  if (locale === 'en') {
    // Register after boot's storage reset, so the selected language survives it.
    await page.addInitScript(() => localStorage.setItem('timelog.locale', 'en'));
    await page.reload();
    await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  }
  await page.setViewportSize({ width, height });
  await page.locator('#add-btn').click();
  await page.locator('[data-action="toggle-start-time"]').click();
  const mount = page.locator(newMount);
  if (width < 720) await expectCenteredSelection(mount);
  return mount;
}

async function spin(page, colIndex, index) {
  await page.evaluate(({ colIndex, index }) => {
    const col = document.querySelectorAll('.wheel-picker:not(.range-wheel) .wheel-col')[colIndex];
    col.scrollTop = index * 40;
    col.dispatchEvent(new Event('scroll'));
    col.dispatchEvent(new Event('scrollend'));
  }, { colIndex, index });
}

async function expectCenteredSelection(mount) {
  // The existing picker positions its columns in requestAnimationFrame. Wait for
  // that observable layout, not a fixed sleep or a read before the first frame.
  await expect.poll(() => mount.evaluate(el => {
    const picker = el.querySelector('.wheel-picker');
    const band = picker.querySelector('.wheel-highlight').getBoundingClientRect();
    return Math.max(...Array.from(picker.querySelectorAll('.wheel-col')).map(col => {
      const rect = col.querySelector('.wheel-item.is-selected').getBoundingClientRect();
      return Math.abs(rect.y + rect.height / 2 - (band.y + band.height / 2));
    }));
  })).toBeLessThanOrEqual(2);
  const geometry = await mount.evaluate(el => {
    const picker = el.querySelector('.wheel-picker');
    const band = picker.querySelector('.wheel-highlight').getBoundingClientRect();
    return Array.from(picker.querySelectorAll('.wheel-col')).map(col => {
      const selected = col.querySelector('.wheel-item.is-selected');
      const rect = selected.getBoundingClientRect();
      return {
        delta: Math.abs(rect.y + rect.height / 2 - (band.y + band.height / 2)),
        text: selected.textContent,
        selected: selected.getAttribute('aria-selected'),
        aboveBand: Number(getComputedStyle(col).zIndex) > Number(getComputedStyle(picker.querySelector('.wheel-highlight')).zIndex)
      };
    });
  });
  for (const item of geometry) {
    expect(item.delta).toBeLessThanOrEqual(2);
    expect(item.text).not.toBe('');
    expect(item.selected).toBe('true');
    expect(item.aboveBand).toBe(true);
  }
}

for (const width of [320, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`v1.7.1: compact picker at ${width}px (${theme}) keeps three wheels and a reachable Now action`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      const mount = await openNewPicker(page, width, theme);
      await expect(mount).toHaveAttribute('data-picker-compact', '1');
      await expect(mount.locator('.wheel-col')).toHaveCount(3);
      await expect(mount.locator('.dt-picker')).toHaveCount(0);
      await expect(mount.locator('.wheel-caption')).toContainText('日期');
      await expect(mount.locator('.wheel-time-divider')).toHaveText(':');
      const layout = await mount.evaluate(el => {
        const wheel = el.querySelector('.wheel-picker').getBoundingClientRect();
        const now = el.querySelector('.wheel-now-btn').getBoundingClientRect();
        return { height: wheel.height, total: el.getBoundingClientRect().height, nowWidth: now.width, nowHeight: now.height, nowBottom: now.bottom, wheelTop: wheel.top };
      });
      expect(layout.height).toBe(160);
      expect(layout.total).toBeLessThanOrEqual(210);
      expect(layout.nowWidth).toBeGreaterThanOrEqual(44);
      expect(layout.nowHeight).toBeGreaterThanOrEqual(44);
      expect(layout.nowBottom).toBeLessThanOrEqual(layout.wheelTop);
      await expectCenteredSelection(mount);
      await expectNoHorizontalOverflow(page);
      // Arrow selection and the old Now callback are still the same interaction.
      await mount.getByRole('listbox', { name: '小时', exact: true }).focus();
      await page.keyboard.press('ArrowDown');
      await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T01:00');
      await mount.getByRole('button', { name: '重置为当前时间' }).click();
      await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T12:34');
      expect(errors).toEqual([]);
    });
  }
}

for (const width of [720, 1280]) {
  for (const theme of ['light', 'dark']) {
    test(`v1.7.1: calendar at ${width}px (${theme}) stays in document flow without covering precise entry`, async ({ page }) => {
      const mount = await openNewPicker(page, width, theme);
      await expect(mount).toHaveAttribute('data-picker-compact', '0');
      const pop = mount.locator('.dt-pop');
      await expect(pop).toBeHidden();
      await mount.locator('.dt-trigger').click();
      await expect(pop).toBeVisible();
      const layout = await mount.evaluate(el => {
        const pop = el.querySelector('.dt-pop');
        const bounds = pop.getBoundingClientRect();
        const precise = el.querySelector('.dt-precise').getBoundingClientRect();
        const what = document.querySelector('#form-what').getBoundingClientRect();
        const root = el.getBoundingClientRect();
        return {
          position: getComputedStyle(pop).position,
          left: bounds.left, right: bounds.right, rootLeft: root.left, rootRight: root.right,
          popBottom: bounds.bottom, preciseTop: precise.top, preciseBottom: precise.bottom, whatTop: what.top,
          controls: Array.from(pop.querySelectorAll('.dt-nav, .dt-day:not(.dt-blank), .dt-step-btn, .dt-step-inp, .dt-now')).map(control => {
            const rect = control.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          })
        };
      });
      expect(layout.position).toBe('static');
      expect(layout.left).toBeGreaterThanOrEqual(layout.rootLeft - 1);
      expect(layout.right).toBeLessThanOrEqual(layout.rootRight + 1);
      expect(layout.popBottom).toBeLessThanOrEqual(layout.preciseTop);
      expect(layout.preciseBottom).toBeLessThanOrEqual(layout.whatTop);
      for (const control of layout.controls) {
        expect(control.width).toBeGreaterThanOrEqual(44);
        expect(control.height).toBeGreaterThanOrEqual(44);
      }
      await expectNoHorizontalOverflow(page);
      // Calendar month/day selection and number stepping are not replaced.
      await pop.locator('[data-act="prev-month"]').click();
      await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T00:00');
      await pop.locator('[data-act="next-month"]').click();
      await pop.locator('[data-act="pick-day"][data-day="28"]').click();
      await expect(page.locator('#form-ts')).toHaveValue('2026-06-28T00:00');
      await pop.locator('[data-act="hour-up"]').click();
      await expect(page.locator('#form-ts')).toHaveValue('2026-06-28T01:00');
      await page.keyboard.press('Escape');
      await expect(pop).toBeHidden();
      await expect(page.locator('#form-sheet')).toBeVisible();
      await expect(mount.locator('.dt-trigger')).toBeFocused();
      await mount.locator('.dt-trigger').click();
      await page.locator('#form-what').click();
      await expect(pop).toBeHidden();
      await expect(page.locator('#form-what')).toBeFocused();
    });
  }
}

test('v1.7.1: a narrower calendar container stacks its time controls without changing the desktop picker', async ({ page }) => {
  const mount = await openNewPicker(page, 768);
  await mount.evaluate(el => { el.style.width = '400px'; });
  await mount.locator('.dt-trigger').click();
  const boxes = await mount.evaluate(el => {
    const grid = el.querySelector('.dt-cal-grid').getBoundingClientRect();
    const time = el.querySelector('.dt-time').getBoundingClientRect();
    const pop = el.querySelector('.dt-pop').getBoundingClientRect();
    const day = el.querySelector('.dt-day:not(.dt-blank)').getBoundingClientRect();
    return { gridBottom: grid.bottom, timeTop: time.top, timeRight: time.right, popRight: pop.right, dayWidth: day.width, dayHeight: day.height, scrollWidth: el.scrollWidth, width: el.clientWidth };
  });
  expect(boxes.timeTop).toBeGreaterThanOrEqual(boxes.gridBottom);
  expect(boxes.timeRight).toBeLessThanOrEqual(boxes.popRight);
  expect(boxes.dayWidth).toBeGreaterThanOrEqual(44);
  expect(boxes.dayHeight).toBeGreaterThanOrEqual(44);
  expect(boxes.scrollWidth).toBeLessThanOrEqual(boxes.width);
  await expect(mount).toHaveAttribute('data-picker-compact', '0');
});

test('v1.7.1: a short desktop sheet scrolls the calendar and preserves reachable save/cancel and precise input', async ({ page }) => {
  const mount = await openNewPicker(page, 768, 'light', 540);
  await mount.locator('.dt-trigger').click();
  const precise = mount.locator('[data-role="text"]');
  await precise.fill('2026-06-29 06:30');
  await precise.blur();
  await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T06:30');
  await page.locator('#form-what').fill('布局验收合成记录');
  const tag = page.getByRole('button', { name: '选择标签：求职推进' });
  // Do not pre-close the calendar: this first real click must select the tag,
  // even though collapsing the inline panel changes the form's scroll geometry.
  await tag.click();
  await expect(tag).toHaveAttribute('aria-pressed', 'true');
  const save = page.getByRole('button', { name: '保存时间记录' });
  const hit = await save.evaluate(el => {
    const r = el.getBoundingClientRect();
    const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { top: r.top, bottom: r.bottom, viewport: innerHeight, hit: el === target || el.contains(target) };
  });
  expect(hit.top).toBeGreaterThanOrEqual(0);
  expect(hit.bottom).toBeLessThanOrEqual(hit.viewport);
  expect(hit.hit).toBe(true);
  await save.click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(e => e.what === '布局验收合成记录'));
  expect(saved).toMatchObject({ ts: '2026-06-29T06:30', tags: ['求职推进'] });
});

test('v1.7.1: resizing across 720px keeps the timestamp and the selected wheel row centered', async ({ page }) => {
  await openNewPicker(page, 390);
  await spin(page, 1, 8);
  await spin(page, 2, 15);
  await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T08:15');
  await page.setViewportSize({ width: 820, height: 820 });
  const desktop = page.locator(`${newMount} [data-role="text"]`);
  await expect(desktop).toHaveValue('2026-06-29 08:15');
  await desktop.fill('2026-06-29 09:20');
  await desktop.blur();
  await page.setViewportSize({ width: 390, height: 820 });
  const mount = page.locator(newMount);
  await expect(mount.locator('.wheel-col')).toHaveCount(3);
  await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T09:20');
  await expectCenteredSelection(mount);
});

for (const initial of ['2010-01-02T23:45', '2030-12-31T06:20']) {
  test(`v1.7.1: compact wheel padding preserves the out-of-window date ${initial}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page, 390, 'empty', false, FIXED_NOW);
    await page.evaluate(async initial => {
      const mount = document.createElement('div');
      mount.id = 'picker-layout-probe';
      document.body.appendChild(mount);
      window.__pickerLayoutValues = [];
      const { mountTimePicker } = await import('/src/pickers.js');
      mountTimePicker(mount, initial, value => window.__pickerLayoutValues.push(value));
    }, initial);
    const mount = page.locator('#picker-layout-probe');
    await expectCenteredSelection(mount);
    await expect.poll(() => page.evaluate(() => window.__pickerLayoutValues.at(-1))).toBe(initial);
    const emitted = await page.evaluate(() => [...new Set(window.__pickerLayoutValues)]);
    expect(emitted).toEqual([initial]);
  });
}

for (const action of ['cancel', 'resize']) {
  test(`v1.7.1: detached calendar listeners are released after ${action}`, async ({ page }) => {
    const mount = await openNewPicker(page, 768);
    await page.evaluate(() => {
      window.__pickerLifecycleSignals = [];
      const add = document.addEventListener.bind(document);
      document.addEventListener = (type, listener, options) => {
        if (['keydown', 'click'].includes(type) && options?.signal) {
          window.__pickerLifecycleSignals.push(options.signal);
        }
        return add(type, listener, options);
      };
    });
    await mount.locator('.dt-trigger').click();
    await expect.poll(() => page.evaluate(() => window.__pickerLifecycleSignals.length)).toBe(2);
    if (action === 'cancel') {
      // Reduced motion closes and clears the sheet before the outside click
      // reaches the document listener. It must clean up rather than just return.
      await page.locator('#form-sheet .sh-cancel').click();
      await expect(page.locator('#form-sheet')).toBeHidden();
    } else {
      await page.setViewportSize({ width: 390, height: 820 });
      await expect(mount.locator('.wheel-col')).toHaveCount(3);
      // A detached calendar's capture listener must release its scope and let
      // the still-open sheet continue handling the keyboard normally.
      await page.keyboard.press('Tab');
      await expect(page.locator('#form-sheet')).toBeVisible();
      await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T00:00');
    }
    await expect.poll(() => page.evaluate(() => window.__pickerLifecycleSignals.every(signal => signal.aborted))).toBe(true);
  });
}

for (const width of [390, 768]) {
  test(`v1.7.1: English picker labels and precise entry remain readable at ${width}px`, async ({ page }) => {
    const mount = await openNewPicker(page, width, 'dark', 820, 'en');
    if (width < 720) {
      await expect(mount.locator('.wheel-caption')).toContainText('Date');
      await expect(mount.getByRole('button', { name: 'Reset to current time' })).toBeVisible();
    } else {
      await expect(mount.locator('.dt-precise-label')).toHaveText('Precise entry');
      await mount.locator('.dt-trigger').click();
      await expect(mount.locator('.dt-pop')).toBeVisible();
    }
    await expectNoHorizontalOverflow(page);
  });
}

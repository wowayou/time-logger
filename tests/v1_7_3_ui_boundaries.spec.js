import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { boot, FIXED_NOW, expectNoHorizontalOverflow } from './ui_fixture.js';
import { bootLocale } from './i18n_fixture.js';
import { targetHits } from './accessibility_helpers.js';

const SOURCE_RANGE = '08:00–12:00';
const lunchRow = page => page.locator('.entry[data-id="lunch-start"]');
const rawEntries = page => page.evaluate(() => localStorage.getItem('timelog.v1'));

async function evidence(testInfo, name, report) {
  const path = testInfo.outputPath(`${name}.json`);
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

async function screenshot(page, testInfo, name) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
}

async function hitAt(page, point) {
  return page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y)?.closest('[data-action]');
    return { action: target?.dataset.action, start: target?.dataset.ts,
      end: target?.dataset.end, sourceId: target?.dataset.sourceId };
  }, point);
}

async function sheetState(page, before) {
  return page.evaluate(raw => {
    const sheet = document.getElementById('form-sheet');
    const after = localStorage.getItem('timelog.v1');
    return { open: !sheet.hidden, mode: sheet.querySelector('.form-sheet-panel').dataset.mode || '',
      source: sheet.querySelector('[data-role="cut-source"]')?.textContent || '',
      unchanged: after === raw,
      longConfirm: JSON.parse(after).entries.find(e => e.id === 'lunch-start')?.longConfirm || null };
  }, before);
}

async function linkGeometry(row) {
  const report = await row.evaluate(el => {
    function box(node) {
      const r = node.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    }
    const text = el.querySelector('.e-what'), r = text.getBoundingClientRect();
    const bodyHits = [0.1, 0.5, 0.9].flatMap(px => [0.1, 0.5, 0.9].map(py => {
      const x = r.left + r.width * px, y = r.top + r.height * py;
      return { x, y, action: document.elementFromPoint(x, y)?.closest('[data-action]')?.dataset.action };
    }));
    return { row: box(el), body: box(text), meta: box(el.querySelector('.e-meta')), bodyHits };
  });
  report.controls = [];
  // Scope to visible log actions, never the same-named hidden swipe buttons.
  for (const button of await row.locator('.e-meta > .mini-btn').all()) {
    const control = await button.evaluate(el => {
      const r = el.getBoundingClientRect(), range = document.createRange();
      range.selectNodeContents(el);
      const fullBoxHits = [r.left + 0.5, r.left + r.width / 2, r.right - 0.5]
        .flatMap(x => [r.top + 0.5, r.top + r.height / 2, r.bottom - 0.5].map(y => {
          const hit = document.elementFromPoint(x, y);
          return { x, y, hit: hit === el || el.contains(hit), action: hit?.closest('[data-action]')?.dataset.action };
        }));
      return { label: el.textContent, action: el.dataset.action,
        box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height },
        lines: new Set([...range.getClientRects()].map(rect => rect.top)).size,
        background: getComputedStyle(el).backgroundColor, fullBoxHits };
    });
    control.hits44 = await targetHits(button, 44);
    report.controls.push(control);
  }
  return report;
}

function expectIndependentLinks(report) {
  expect.soft(report.controls).toHaveLength(2);
  expect.soft(report.bodyHits.every(p => p.action === 'start-edit'), JSON.stringify(report.bodyHits)).toBe(true);
  for (const control of report.controls) {
    const context = JSON.stringify(control);
    expect.soft(control.box.width, context).toBeGreaterThanOrEqual(44);
    expect.soft(control.box.height, context).toBeGreaterThanOrEqual(44);
    expect.soft(control.box.top, context).toBeGreaterThanOrEqual(report.body.bottom);
    expect.soft(control.box.bottom, context).toBeLessThanOrEqual(report.row.bottom);
    expect.soft(control.box.left, context).toBeGreaterThanOrEqual(report.meta.left);
    expect.soft(control.box.right, context).toBeLessThanOrEqual(report.meta.right);
    expect.soft(control.hits44.every(p => p.hit), context).toBe(true);
    expect.soft(control.fullBoxHits.every(p => p.hit), context).toBe(true);
    expect.soft(control.background).toBe('rgba(0, 0, 0, 0)');
  }
  const [a, b] = report.controls.map(control => control.box);
  if (a && b) expect.soft(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(true);
}

async function clickBodyBottom(page, testInfo, before) {
  const text = lunchRow(page).locator('.e-what');
  await text.scrollIntoViewIfNeeded();
  const r = await text.boundingBox();
  // Preserve the independent counterexample: real mouse, bottom 90% of text.
  const point = { x: r.x + r.width / 2, y: r.y + r.height * 0.9 };
  const hit = await hitAt(page, point);
  await page.mouse.click(point.x, point.y);
  const result = await sheetState(page, before);
  await evidence(testInfo, 'body-click', { point, hit, ...result });
  await screenshot(page, testInfo, 'body-click-result');
  expect.soft(hit.action).toBe('start-edit');
  expect.soft(await rawEntries(page)).toBe(before);
  expect.soft(result.longConfirm).toBeNull();
  expect.soft(result.mode).toBe('edit');
  expect(result.open).toBe(true);
  await page.locator('#form-sheet .sh-cancel').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  expect(await rawEntries(page)).toBe(before);
}

async function clickFillEdges(page, testInfo, before, centerInViewport = false) {
  for (const dy of [-21, 21]) {
    const fill = lunchRow(page).locator('.e-meta > .mini-btn[data-action="backfill-seg"]');
    await expect(fill).toHaveCount(1);
    if (centerInViewport) await fill.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    else await fill.scrollIntoViewIfNeeded();
    const r = await fill.boundingBox();
    // Do not move these actions inward to accommodate an overlapping hot area.
    const point = { x: r.x + r.width / 2, y: r.y + r.height / 2 + dy };
    const hit = await hitAt(page, point);
    await page.mouse.click(point.x, point.y);
    const result = await sheetState(page, before);
    const name = dy < 0 ? 'upper-edge' : 'lower-edge';
    await evidence(testInfo, name, { point, hit, ...result });
    await screenshot(page, testInfo, `${name}-result`);
    expect.soft(hit).toEqual({ action: 'backfill-seg', start: '2026-06-29T08:00', end: '2026-06-29T12:00', sourceId: 'lunch-start' });
    expect.soft(result.mode).toBe('new');
    expect.soft(result.source).toContain(SOURCE_RANGE);
    expect.soft(await rawEntries(page)).toBe(before);
    expect(result.open).toBe(true);
    await page.locator('#form-sheet .sh-cancel').click();
    await expect(page.locator('#form-sheet')).toBeHidden();
  }
}

for (const theme of ['light', 'dark']) {
  for (const width of [320, 390]) {
    test(`F1: ${width}px 正文底部真实点击只编辑、不写入 (${theme})`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await boot(page, width, 'pending-confirm-lunch', false, FIXED_NOW);
      await clickBodyBottom(page, testInfo, await rawEntries(page));
    });

    test(`F1: ${width}px 独立44px热区、上下边缘与相邻区间 (${theme})`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await boot(page, width, 'pending-confirm-lunch', false, FIXED_NOW);
      const row = lunchRow(page), before = await rawEntries(page);
      await row.scrollIntoViewIfNeeded();
      const geometry = await linkGeometry(row);
      await evidence(testInfo, 'controls', geometry);
      await screenshot(page, testInfo, 'pending-controls');
      expectIndependentLinks(geometry);
      if (width === 320) expect.soft(geometry.controls[1].box.top).toBeGreaterThanOrEqual(geometry.controls[0].box.bottom);
      await expectNoHorizontalOverflow(page);
      expect(await page.evaluate(() => getComputedStyle(document.body).overflowX)).not.toBe('hidden');
      await clickFillEdges(page, testInfo, before);
      // The adjacent gap must also keep its own action, not the lunch action.
      const gapText = page.locator('.entry.gap[data-gap-ts="2026-06-29T00:00"] .e-what');
      await expect(gapText).toHaveCount(1);
      await gapText.scrollIntoViewIfNeeded();
      const r = await gapText.boundingBox();
      await page.mouse.click(r.x + r.width / 2, r.y + r.height * 0.1);
      await expect(page.locator('#form-sheet [data-role="cut-source"]')).toContainText('00:00–08:00');
      expect(await rawEntries(page)).toBe(before);
    });
  }
}

for (const width of [320, 390]) {
  for (const variant of ['English', '长标签/多行按钮 zh', '长标签/多行按钮 en']) {
    test(`F1: ${width}px ${variant} 保留文字链、完整命中和正文边界`, async ({ page }, testInfo) => {
      const pressure = variant !== 'English', locale = variant.endsWith('zh') ? 'zh' : 'en';
      const tag = pressure ? 'SyntheticLongTag_' + 'x'.repeat(100) : 'Meal';
      await page.emulateMedia({ colorScheme: pressure ? 'dark' : 'light', reducedMotion: 'reduce' });
      await bootLocale(page, { width, locale, entries: [
        { id: 'lunch-start', ts: '2026-06-29T08:00', what: 'Synthetic meal\nA second line of record text', tags: [tag] },
        { id: 'lunch-end', ts: '2026-06-29T12:00', what: 'Synthetic afternoon work', tags: ['Work'] }
      ], config: { version: 1, longReview: true, mainline: ['Work'], chips: [{ name: tag, bucket: 'maintain', longOk: false }] } });
      const row = lunchRow(page), before = await rawEntries(page);
      if (pressure) {
        // Content-only pressure fixture; keep the real buttons and all data-actions.
        await row.locator('[data-action="confirm-segment"]').evaluate((el, locale) => {
          el.textContent = locale === 'zh' ? '确认这一段合成的长时段记录，保留完整起止时间 08:00–12:00'
            : 'Confirm this synthetic long interval and retain the complete boundaries 08:00–12:00';
        }, locale);
        await row.locator('.mini-btn[data-action="backfill-seg"]').evaluate((el, locale) => {
          el.textContent = locale === 'zh' ? '补一下这段合成的记录，预览后再保存，不改动相邻区间'
            : 'Fill this synthetic interval after previewing it without changing either neighbour';
        }, locale);
      }
      // Pressure rows can be taller than the space above the fixed FAB. Scroll
      // them into the middle before sampling; do not hide the FAB, skip points,
      // or change the original text/target-relative click positions.
      await row.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const geometry = await linkGeometry(row);
      await evidence(testInfo, 'label-pressure', geometry);
      await screenshot(page, testInfo, 'label-pressure');
      expectIndependentLinks(geometry);
      if (pressure) for (const control of geometry.controls) expect.soft(control.lines).toBeGreaterThan(1);
      await expectNoHorizontalOverflow(page);
      expect(await row.locator('.e-tag').textContent()).toBe('#' + tag);
      await clickBodyBottom(page, testInfo, before);
      // Editing redraws the log; reapply the label fixture, not the CSS or hit positions.
      if (pressure) {
        const labels = geometry.controls.map(control => control.label);
        await row.locator('.e-meta > .mini-btn').evaluateAll((buttons, labels) => buttons.forEach((button, i) => { button.textContent = labels[i]; }), labels);
      }
      await clickFillEdges(page, testInfo, before, true);
    });
  }
}

for (const width of [320, 390]) {
  for (const reducedMotion of ['reduce', 'no-preference']) {
    for (const firstKey of ['Tab', 'Shift+Tab']) {
      test(`F3: ${width}px 初始 ${firstKey} 留在编辑面板、首末环绕、关闭回原行 (${reducedMotion})`, async ({ page }, testInfo) => {
        await page.emulateMedia({ reducedMotion });
        await boot(page, width, 'two-records', false, FIXED_NOW);
        const row = page.locator('.entry[data-id="today-1"]'), before = await rawEntries(page);
        await row.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#form-sheet .form-sheet-panel')).toBeFocused();
        // The first navigation key is the counterexample, with no preliminary Tab.
        await page.keyboard.press(firstKey);
        const focus = await page.evaluate(() => ({
          inside: document.getElementById('form-sheet').contains(document.activeElement),
          activeId: document.activeElement.id, action: document.activeElement.dataset.action || '',
          text: document.activeElement.textContent?.slice(0, 80)
        }));
        await evidence(testInfo, 'initial-focus', focus);
        await screenshot(page, testInfo, 'initial-focus');
        expect(focus.inside).toBe(true);
        const cancel = page.locator('#form-sheet .sh-cancel');
        const last = page.locator('#form-sheet [data-action="request-delete"]');
        await expect(last).toHaveCount(1); // Exclude the hidden same-named swipe button.
        await expect(firstKey === 'Tab' ? cancel : last).toBeFocused();
        if (firstKey === 'Shift+Tab') {
          await page.keyboard.press('Tab');
          await expect(cancel).toBeFocused();
        }
        await page.keyboard.press('Shift+Tab');
        await expect(last).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(cancel).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.locator('#form-sheet .sh-done')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.locator('#form-sheet')).toBeHidden();
        await expect(row).toBeFocused();
        expect(await rawEntries(page)).toBe(before);
      });
    }
  }
}

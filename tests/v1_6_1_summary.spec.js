import { test, expect } from '@playwright/test';
import { boot } from './ui_fixture.js';
import { bootLocale } from './i18n_fixture.js';

async function instrumentSegments(page) {
  await page.route('**/src/stats.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const anchor = 'export function buildRangeSegmentsFromEntries(inputEntries, start, end, opts = {}) {';
    expect(source.split(anchor)).toHaveLength(2);
    await route.fulfill({ response, body: source.replace(anchor, `${anchor}
      globalThis.__segmentBuilds = (globalThis.__segmentBuilds || 0) + 1;
    `) });
  });
}

for (const [view, rowCount] of [['day', 0], ['week', 7], ['month', 30], ['year', 12]]) {
  test(`v1.6.1: ${view} renders 5000 entries with one segment build and one data snapshot`, async ({ page }) => {
    await instrumentSegments(page);
    await boot(page, 768, 'empty', false, '2025-12-15T12:34:30', -30);
    const metrics = await page.evaluate(view => {
      const pad = n => String(n).padStart(2, '0');
      const entries = Array.from({ length: 5000 }, (_, i) => {
        const date = new Date(2025, 0, 1 + Math.floor(i / 15));
        const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
        return {
          id: `synthetic-${i}`, ts: `${key}T${pad(6 + i % 15)}:00`,
          what: `合成测试记录 ${i}`, tags: [i % 2 ? '睡觉' : '求职推进']
        };
      });
      const raw = JSON.stringify({ version: 1, entries });
      localStorage.setItem('timelog.v1', raw);
      const original = Storage.prototype.getItem;
      let dataReads = 0;
      Storage.prototype.getItem = function(key) {
        if (this === localStorage && key === 'timelog.v1') dataReads++;
        return original.call(this, key);
      };
      globalThis.__segmentBuilds = 0;
      const started = performance.now();
      // Time the real synchronous click handler and layout, not Playwright's polling.
      document.querySelector(`[data-action="view"][data-view="${view}"]`).click();
      document.getElementById('timeline').getBoundingClientRect();
      const elapsedMs = performance.now() - started;
      Storage.prototype.getItem = original;
      return { builds: globalThis.__segmentBuilds, dataReads, elapsedMs, unchanged: localStorage.getItem('timelog.v1') === raw };
    }, view);
    console.log(`[summary-${view}] builds=${metrics.builds}, dataReads=${metrics.dataReads}, sync+layout=${metrics.elapsedMs.toFixed(1)}ms`);
    await expect(page.locator('.sum-row')).toHaveCount(rowCount);
    if (view === 'day') await expect(page.locator('.entry[data-id]')).not.toHaveCount(0);
    expect(metrics.unchanged, 'rendering must never rewrite user records').toBe(true);
    expect(metrics.builds, 'hero/ruler and rows share one set of day-bounded segments').toBe(1);
    // One data snapshot + the raw read used to validate the boot snapshot. No per-row parse.
    expect(metrics.dataReads).toBe(2);
  });
}

test('v1.6.1: shared summaries refresh after a config change and a minute tick', async ({ page }) => {
  await boot(page, 390, 'two-records', false, '2026-06-29T12:34:00');
  await page.locator('[data-action="view"][data-view="month"]').click();
  const ruler = page.locator('#ruler');
  const before = await ruler.innerText();
  await page.evaluate(() => {
    const config = JSON.parse(localStorage.getItem('timelog.config'));
    config.mainline = [];
    config.chips.push({ name: '求职推进', bucket: 'maintain', longOk: false });
    localStorage.setItem('timelog.config', JSON.stringify(config));
    window.dispatchEvent(new StorageEvent('storage', { key: 'timelog.config', storageArea: localStorage }));
  });
  expect(await ruler.innerText()).not.toBe(before);
  const recolored = await ruler.innerText();
  await page.evaluate(() => {
    window.__setFixedNow('2026-06-29T12:35:00');
    window.dispatchEvent(new Event('focus'));
  });
  expect(await ruler.innerText()).not.toBe(recolored);
  await expect(page.locator('.sum-row')).toHaveCount(30);
});

test('v1.6.1: quote changes and clearing data in another tab refresh the idle page', async ({ page, context }) => {
  await boot(page, 390, 'two-records', false, '2026-06-29T12:34:00');
  const other = await context.newPage();
  await other.goto('/');
  await other.waitForFunction(() => document.body.classList.contains('app-ready'));
  await other.evaluate(() => {
    localStorage.setItem('timelog.quotes', JSON.stringify({ version: 1, enabled: true, items: ['另一页的新句子'], anchor: '2026-06-29' }));
  });
  await expect(page.locator('#motto-line')).toHaveText('另一页的新句子');
  await other.evaluate(() => localStorage.clear());
  await expect(page.locator('.entry[data-id]')).toHaveCount(0);
  await expect(page.locator('#usage-day')).toBeHidden();
  await other.close();
});

test('v1.6.1: config and quote synchronization never redraw an open draft', async ({ page, context }) => {
  await boot(page, 390, 'two-records', false, '2026-06-29T12:34:00');
  const other = await context.newPage();
  await other.goto('/');
  await other.waitForFunction(() => document.body.classList.contains('app-ready'));
  await page.locator('.entry[data-id="today-1"]').click();
  await page.locator('[data-role="edit-what"]').fill('保留本页输入');
  await other.evaluate(() => {
    const config = JSON.parse(localStorage.getItem('timelog.config'));
    config.mainline = [];
    config.chips.push({ name: '求职推进', bucket: 'maintain', longOk: false });
    localStorage.setItem('timelog.config', JSON.stringify(config));
    localStorage.setItem('timelog.quotes', JSON.stringify({ version: 1, enabled: true, items: ['同步后的句子'], anchor: '2026-06-29' }));
  });
  await expect(page.locator('#cross-tab-banner')).toBeVisible();
  await expect(page.locator('[data-role="edit-what"]')).toHaveValue('保留本页输入');
  // The notice must not cover Cancel: do not acknowledge or force-click through it.
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  await expect(page.locator('#motto-line')).toHaveText('同步后的句子');
  await expect(page.locator('.entry[data-id="today-1"]')).toHaveAttribute('data-b', 'maintain');
  await other.close();
});

test('v1.6.1: session storage and unrelated preferences cannot trigger data synchronization', async ({ page }) => {
  await instrumentSegments(page);
  await boot(page, 390, 'two-records', false, '2026-06-29T12:34:00');
  for (const editing of [false, true]) {
    if (editing) {
      await page.locator('.entry[data-id="today-1"]').click();
      await page.locator('[data-role="edit-what"]').fill('保留本页输入');
    }
    const builds = await page.evaluate(() => {
      globalThis.__segmentBuilds = 0;
      for (const key of ['timelog.v1', 'timelog.config', 'timelog.quotes', null]) {
        window.dispatchEvent(new StorageEvent('storage', { key, storageArea: sessionStorage }));
      }
      window.dispatchEvent(new StorageEvent('storage', { key: 'timelog.theme', storageArea: localStorage }));
      return globalThis.__segmentBuilds;
    });
    expect(builds, 'irrelevant events must not rebuild the timeline').toBe(0);
    expect(await page.locator('#cross-tab-banner').isVisible()).toBe(false);
    if (editing) await expect(page.locator('[data-role="edit-what"]')).toHaveValue('保留本页输入');
  }
});

for (const locale of ['zh', 'en']) {
  test(`v1.6.1: ${locale} sync notice never covers form controls across width changes`, async ({ page }) => {
    await bootLocale(page, {
      locale, width: 390, height: 600,
      config: { version: 1, mainline: ['Focus'], chips: [] },
      entries: [
        { id: 'one', ts: '2026-06-29T09:00', what: 'Original', tags: ['Focus'] },
        { id: 'two', ts: '2026-06-29T10:00', what: 'Next', tags: ['Focus'] }
      ]
    });
    await page.locator('.entry[data-id="one"]').click();
    await page.locator('[data-role="edit-what"]').fill('Kept draft');
    await page.evaluate(() => {
      localStorage.setItem('timelog.quotes', JSON.stringify({ version: 1, enabled: true, items: ['New line'], anchor: '2026-06-29' }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'timelog.quotes', storageArea: localStorage }));
    });
    await expect(page.locator('#cross-tab-banner')).toBeVisible();
    for (const width of [390, 320, 768, 375]) {
      await page.setViewportSize({ width, height: 600 });
      await expect.poll(() => page.evaluate(() => {
        const bottom = document.getElementById('cross-tab-banner').getBoundingClientRect().bottom;
        return ['cancel-edit', 'commit-edit'].every(action => {
          const button = document.querySelector(`button[data-action="${action}"]`);
          const rect = button.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return rect.top >= bottom && rect.bottom <= innerHeight && (hit === button || button.contains(hit));
        });
      }), `both controls must be visible and receive clicks at ${width}px`).toBe(true);
      await expect(page.locator('[data-role="edit-what"]')).toHaveValue('Kept draft');
    }
    await page.locator('[data-action="commit-edit"]').click();
    await expect(page.locator('#form-sheet')).toBeHidden();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(e => e.id === 'one').what)).toBe('Kept draft');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cross-tab-height'))).toBe('0px');
  });
}

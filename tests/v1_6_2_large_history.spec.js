import { expect, test } from '@playwright/test';
import { boot, FIXED_NOW } from './ui_fixture.js';

async function seedHistory(page) {
  return page.evaluate(() => {
    const entries = Array.from({ length: 20000 }, (_, i) => {
      const d = new Date(2026, 5, 28 - Math.floor(i / 15), 6 + i % 15);
      const pad = n => String(n).padStart(2, '0');
      return { id: `history-${i}`, ts: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`, what: `合成记录 ${i}`, tags: ['求职推进'] };
    });
    // Reverse order exercises the ordering path used by backfilled/imported data.
    const raw = JSON.stringify({ version: 1, entries });
    localStorage.setItem('timelog.v1', raw);
    return raw;
  });
}

test('20000 entries: daily rendering only computes nearby bounds and keeps records intact', async ({ page }) => {
  await page.route('**/src/stats.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const anchor = 'function segmentBoundsForEntry(entries, index, now) {';
    expect(source.split(anchor)).toHaveLength(2);
    await route.fulfill({ response, body: source.replace(anchor, `${anchor}\n globalThis.__computedBounds = (globalThis.__computedBounds || 0) + 1;`) });
  });
  await boot(page, 390, 'empty', false, FIXED_NOW, -1);
  const raw = await seedHistory(page);
  const result = await page.evaluate(() => {
    window.__computedBounds = 0;
    const start = performance.now();
    window.dispatchEvent(new StorageEvent('storage', { key: 'timelog.v1', storageArea: localStorage }));
    void document.body.offsetHeight;
    return { bounds: window.__computedBounds, ms: performance.now() - start };
  });
  console.log(`20000-entry day: ${result.ms.toFixed(1)}ms, ${result.bounds} boundary calculations`);
  expect(result.bounds).toBeGreaterThanOrEqual(15);
  expect(result.bounds, 'a one-day view must not compute bounds for the whole archive').toBeLessThanOrEqual(17);
  await expect(page.locator('.entry[data-id]')).toHaveCount(16); // 15 starts plus prior day's tail across midnight
  await expect(page.locator('#ruler')).toContainText('24h');
  expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(raw);

  // Saving and snapshot recovery must still use the latest data, not a cached graph.
  await page.locator('.entry[data-id="history-0"]').click();
  await page.locator('[data-role="edit-what"]').fill('大历史中的修改');
  await page.locator('[data-action="commit-edit"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries.find(e => e.id === 'history-0').what).toBe('大历史中的修改');
  const before = JSON.parse(raw).entries;
  expect(entries.length).toBeGreaterThanOrEqual(before.length);
  const byId = new Map(entries.map(e => [e.id, e]));
  expect(before.filter(e => e.id !== 'history-0').every(e => JSON.stringify(byId.get(e.id)) === JSON.stringify(e))).toBe(true);
});

test('quota refusal with 20000 existing entries preserves both data and editing draft', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW, -1);
  const raw = await seedHistory(page);
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'timelog.v1', storageArea: localStorage })));
  await page.locator('.entry[data-id="history-0"]').click();
  await page.locator('[data-role="edit-what"]').fill('容量不足时不能丢的草稿');
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === 'timelog.v1') throw new DOMException('quota', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  await page.locator('[data-action="commit-edit"]').click();
  await expect(page.locator('#form-sheet')).toBeVisible();
  await expect(page.locator('[data-role="edit-what"]')).toHaveValue('容量不足时不能丢的草稿');
  expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(raw);
});

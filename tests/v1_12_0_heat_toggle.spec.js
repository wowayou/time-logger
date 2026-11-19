// v1.12.0 · 全天热力条成为「更多」里的可选功能（维护者要求：默认启用，全文 / 单行 / 按时长都可显示）。
// 偏好键 timelog.dayHeat：只有 'off' 是关闭，缺失或非法＝开启；不进备份；快照门按同一归一化比对。
import { expect, test } from './startup_fixture.js';
import { boot, openBackupMenu, FIXED_NOW } from './ui_fixture.js';

const DAY = FIXED_NOW.slice(0, 10);
const ENTRIES = [
  { id: 'a', ts: `${DAY}T08:00`, what: '短', tags: ['吃饭'] },
  { id: 'b', ts: `${DAY}T09:40`, what: '长', tags: ['求职推进'] }
];

async function seed(page) {
  await page.evaluate(list => {
    localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries: list }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'timelog.v1', storageArea: localStorage }));
  }, ENTRIES);
  await expect(page.locator('.entry[data-id="b"]')).toBeVisible();
}

async function withPrefs(page, prefs) {
  await page.addInitScript(p => { for (const [k, v] of Object.entries(p)) localStorage.setItem(k, v); }, prefs);
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
}

test('v1.12.0: the heat strip is on by default and the More sheet says so', async ({ page }) => {
  await boot(page, 390, 'empty', false, FIXED_NOW);
  await seed(page);
  expect(await page.evaluate(() => localStorage.getItem('timelog.dayHeat'))).toBeNull();
  await expect(page.locator('.log')).toHaveAttribute('data-density', 'full');
  await expect(page.locator('.log > .day-heat')).toHaveCount(1);
  await openBackupMenu(page);
  const seg = page.locator('#day-heat-seg');
  await expect(seg.locator('[data-day-heat="on"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(seg.locator('[data-day-heat="off"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(seg.locator('[data-day-heat="on"]')).toHaveAccessibleName('全天热力条：显示');
});

test('v1.12.0: hiding the strip from More removes it, persists, and showing it brings it back', async ({ page }) => {
  await boot(page, 390, 'empty', false, FIXED_NOW);
  await seed(page);
  await openBackupMenu(page);
  const seg = page.locator('#day-heat-seg');
  await seg.locator('[data-day-heat="off"]').click();
  await expect(seg.locator('[data-day-heat="off"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(seg.locator('[data-day-heat="on"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.day-heat')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('timelog.dayHeat'))).toBe('off');
  // 夹具每次加载都清存储；另开同源页面验证偏好真的落盘并被读取。
  const other = await page.context().newPage();
  await other.goto('/');
  await other.waitForFunction(() => document.body.classList.contains('app-ready'));
  await expect(other.locator('.log')).toBeVisible();
  await expect(other.locator('.day-heat')).toHaveCount(0);
  await other.close();
  await seg.locator('[data-day-heat="on"]').click();
  await expect(page.locator('.log > .day-heat')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('timelog.dayHeat'))).toBe('on');
});

for (const density of ['full', 'single', 'scaled']) {
  test(`v1.12.0: turning the strip off hides it in the ${density} layout`, async ({ page }) => {
    await boot(page, 390, 'empty', false, FIXED_NOW);
    await withPrefs(page, { 'timelog.timelineDensity': density, 'timelog.dayHeat': 'off' });
    await seed(page);
    await expect(page.locator('.log')).toHaveAttribute('data-density', density);
    await expect(page.locator('.day-heat')).toHaveCount(0);
  });
}

test('v1.12.0: an invalid stored value falls back to showing the strip', async ({ page }) => {
  await boot(page, 390, 'empty', false, FIXED_NOW);
  await withPrefs(page, { 'timelog.dayHeat': 'maybe' });
  await seed(page);
  await expect(page.locator('.log > .day-heat')).toHaveCount(1);
});

// 夹具每次加载都会清存储并按状态重新写入记录，所以这里用自带记录的 'two-records'（与 v1.8.1 同类用例一致）。
test('v1.12.0: a refresh never restores a snapshot drawn with the other heat setting', async ({ page }) => {
  await boot(page, 390, 'two-records', false, FIXED_NOW);
  await expect(page.locator('.log > .day-heat')).toHaveCount(1);
  // 快照按「显示」画好后，存储改成「隐藏」（例如另一标签页改了偏好）再刷新。
  await page.addInitScript(() => localStorage.setItem('timelog.dayHeat', 'off'));
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  await expect(page.locator('.log .entry').first()).toBeVisible();
  // 若旧快照被接回，init 不会首轮重绘（v53），热力条会留在页面上——这条断言就是这道门的牙。
  await expect(page.locator('.day-heat')).toHaveCount(0);
});

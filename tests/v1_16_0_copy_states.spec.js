// v1.16.0 · SPEC-016 D 期：仍存在的文案与空状态（维护者 2026-11-27「P3 也按你的建议做」）。
//
// 锁的是：
// ① 日视图时间轴空状态的指引跟着 FAB 走：空状态里「」中点名的按钮文字必须等于 FAB 主文案
//    （今天记录 / 今天偏好计划 / 历史日 / +1…+7 日计划）；FAB 隐藏（+8 日起）时不得再叫人点
//    右下角。此前空状态一律写「点右下角「＋ 记一条」」，计划日与远期日都对不上。
// ② 按钮内的成功反馈统一「✓ 已…」：iPhone 文件面板存储成功写「✓ 已存储备份」（此前「已完成
//    存储」）；分享见 ui_smoke 的改判。桌面下载无法确认落盘，仍写「请在下载项确认」（哨兵）。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot, openBackupSheet } from './ui_fixture.js';

async function emptyTipAndFab(page) {
  const tip = (await page.locator('#timeline .empty-tip').textContent()) || '';
  const fabVisible = await page.locator('#add-btn').isVisible();
  const fab = fabVisible ? ((await page.locator('#add-btn .fab-main').textContent()) || '').trim() : '';
  const named = (tip.match(/「([^」]+)」/) || [])[1] || '';
  return { tip, fabVisible, fab, named };
}

for (const [name, offset, recordMode, expectFab] of [
  ['今天、记录模式', null, null, '＋ 记一条'],
  ['今天、偏好计划', null, 'plan', '＋ 计划一条'],
  ['昨天（补记）', -1, null, '＋ 记一条'],
  ['+3 日（只能计划）', 3, null, '＋ 计划一条']
]) {
  test(`① ${name}：空状态点名的按钮就是 FAB 上的字`, async ({ page }) => {
    await boot(page, 390, 'empty', false, FIXED_NOW, offset, null, recordMode);
    await expect(page.locator('#timeline .empty-tip')).toBeVisible();
    const s = await emptyTipAndFab(page);
    expect(s.fabVisible).toBe(true);
    expect(s.fab).toBe(expectFab);
    expect(s.named).toBe(s.fab);
  });
}

test('① +10 日：FAB 隐藏，空状态不再叫人点右下角', async ({ page }) => {
  await boot(page, 390, 'empty', false, FIXED_NOW, 10);
  await expect(page.locator('#timeline .empty-tip')).toBeVisible();
  const s = await emptyTipAndFab(page);
  expect(s.fabVisible).toBe(false);
  expect(s.tip).not.toContain('右下角');
  // 首屏卡片已写「这一天还没有记录」，时间轴只给下一步，不再重复一遍。
  expect(s.tip).toBe('切换日期可查看其它日子。');
});

test('② iPhone 文件面板存储成功：按钮写「✓ 已存储备份」', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
  });
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  // boot 夹具的初始化脚本在后、会覆盖 share/canShare，所以启动后再装上文件分享能力。
  await page.evaluate(() => {
    window.__shared = 0;
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: () => { window.__shared += 1; return Promise.resolve(); } });
  });
  await openBackupSheet(page);
  await page.locator('#backup-download-btn').click();
  await expect(page.locator('#backup-download-btn [data-role="cell-label"]')).toHaveText('✓ 已存储备份');
  expect(await page.evaluate(() => window.__shared)).toBe(1);
});

test('② 哨兵（前后都绿）：桌面直接下载无法确认落盘，仍写「请在下载项确认」、不带 ✓', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  await openBackupSheet(page);
  const download = page.waitForEvent('download');
  await page.locator('#backup-download-btn').click();
  await download;
  await expect(page.locator('#backup-download-btn [data-role="cell-label"]')).toHaveText('请在下载项确认');
});

// v84：2026-08-04 真机验收反馈批次（`docs/v82-v83-device-acceptance.md` 文末四条 +
// 一处 v83 缺陷）。每条都对应维护者的一句原话，用例名保留那句话的意思。
import { expect, test } from '@playwright/test';
import { bootLocale, TODAY_KEY } from './i18n_fixture.js';
import { FIXED_NOW, boot, openBackupMenu } from './ui_fixture.js';

const MANY_CHIPS = {
  version: 1,
  mainline: ['求职推进'],
  chips: Array.from({ length: 10 }, (_, i) => ({
    name: `标签${i + 1}`, bucket: i % 2 ? 'leak' : 'maintain', longOk: false
  }))
};

// ---- 「这个更多面板有点太长了 做好约束」----

test('v84: the more sheet keeps 9 rows; backup and ops move one level down', async ({ page }) => {
  await bootLocale(page, { locale: 'zh' });
  await page.locator('[data-action="open-more"]').click();
  await expect(page.locator('.more-body .cell-btn, .more-body .cell-row')).toHaveCount(9);
  // 主面板里不再有备份四项与运维两项。
  for (const gone of ['#copy-btn', '#backup-download-btn', '#backup-send-btn',
    '[data-action="import-json"]', '#repair-update-btn', '[data-action="toggle-boot-diag"]']) {
    await expect(page.locator(gone)).toHaveCount(0);
  }
  await page.locator('[data-action="open-backup"]').click();
  await expect(page.locator('#form-sheet-title')).toHaveText('备份与导入');
  for (const there of ['#copy-btn', '#backup-download-btn', '[data-action="import-json"]', '#backup-send-btn']) {
    await expect(page.locator(there)).toBeVisible();
  }
  await page.getByRole('button', { name: '关闭备份与导入' }).click();
  await expect(page.locator('#form-sheet-title')).toHaveText('更多');

  await page.locator('[data-action="open-advanced"]').click();
  await expect(page.locator('#form-sheet-title')).toHaveText('高级');
  await expect(page.locator('#repair-update-btn')).toBeVisible();
  await expect(page.locator('[data-action="toggle-boot-diag"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#form-sheet-title')).toHaveText('更多');
});

test('v84: the return stack is two levels deep (更多 → 备份与导入 → 导入检查)', async ({ page }) => {
  // v41 的返回栈原本是个布尔，只记得住一层；多一层二级页就会一路关到底。
  await bootLocale(page, { locale: 'zh' });
  await page.locator('[data-action="open-more"]').click();
  await page.locator('[data-action="open-backup"]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入 JSON 备份' }).click();
  await (await chooser).setFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{oops') });
  await expect(page.locator('.import-conflicts')).toBeVisible();
  await page.getByRole('button', { name: '关闭导入检查' }).click();
  await expect(page.locator('#form-sheet-title')).toHaveText('备份与导入');
  await page.getByRole('button', { name: '关闭备份与导入' }).click();
  await expect(page.locator('#form-sheet-title')).toHaveText('更多');
  await page.getByRole('button', { name: '关闭更多菜单' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
});

// ---- 「删除确认的反馈横幅停留时间太长了」（维护者选方案 b）----

test('v84: the undo banner clears as soon as you do something else', async ({ page }) => {
  await boot(page, 768, 'three-labels', false, FIXED_NOW);
  await page.locator('.entry[data-id="tl-b"] .e-what').click();
  await page.getByRole('button', { name: '删除这条记录' }).click();
  await page.getByRole('button', { name: '确认删除记录' }).click();
  await expect(page.locator('#undo-toast')).toBeVisible();
  // 8 秒上限不动，但「你已经在做别的事」是更准的失效信号。等过关闭动画的宽限期
  // （删除 sheet 收起时的滚动/布局余波不算「你在做别的事」）。
  await page.waitForTimeout(400);
  await page.locator('.tl-head').click();
  await expect(page.locator('#undo-toast')).toBeHidden();
  // 撤销与横幅同生共死：横幅走了，删除就是最终的（这条段落转未记录——三个标签
  // 互不相同，按删除事务不接回，保留同区间的未记录段）。
  const gone = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(e => e.id === 'tl-b'));
  expect(gone.what).toBe('');
  expect(gone.tags || []).toEqual([]);
});

test('v84: clicking 撤销 itself still undoes (the dismissal must not eat its own button)', async ({ page }) => {
  await boot(page, 768, 'three-labels', false, FIXED_NOW);
  await page.locator('.entry[data-id="tl-b"] .e-what').click();
  await page.getByRole('button', { name: '删除这条记录' }).click();
  await page.getByRole('button', { name: '确认删除记录' }).click();
  await page.getByRole('button', { name: '撤销' }).click();
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(e => e.id === 'tl-b'));
  expect(restored).toMatchObject({ what: '写代码' });
});

// ---- 「标签名不能为空的提示 有倒是有 但是为啥会自动滑到最底部展示呢？」----

test('v84: a blocked save scrolls to the offending row, not to the bottom of the sheet', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: MANY_CHIPS, width: 390, height: 700 });
  await page.locator('[data-action="open-more"]').click();
  await page.getByRole('button', { name: '配置标签' }).click();
  const row = page.locator('.cfg-row[data-original-name="标签1"]');
  await row.locator('.cfg-name').fill('');
  await page.getByRole('button', { name: '保存标签配置' }).click();
  await expect(page.locator('[data-role="config-error"]')).toBeVisible();
  // 判据不是「错误条可见」——它挂在正文末尾，滚到底同样能让它可见，而那正是缺陷。
  // 判据是**出问题的那一行**回到视野并拿到焦点。
  await expect(row.locator('.cfg-name')).toBeFocused();
  const visible = await row.evaluate(el => {
    const box = el.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= window.innerHeight;
  });
  expect(visible).toBe(true);
});

// ---- 「Hero 大数字那里，~ 这类的，看着不够优雅」----

test('v84: durations drop the ~ prefix in Chinese, matching the English side', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    entries: [
      { id: 'a', ts: `${TODAY_KEY}T08:00`, what: '写代码', tags: ['求职推进'] },
      { id: 'b', ts: `${TODAY_KEY}T09:30`, what: '午睡', tags: ['睡觉'] }
    ]
  });
  await expect(page.locator('.hero-big').first()).toHaveText('1h30min');
  await expect(page.locator('.hero-nums')).not.toContainText('~');
  await expect(page.locator('#timeline')).not.toContainText('~');
});

// ---- 「安卓设备上（s23）退出的动效 感觉有白边」的候选修复 ----

test('v84: color-scheme follows the theme so UA surfaces stop defaulting to light', async ({ page }) => {
  // 缺 color-scheme 时 UA 按 light 画它自己的表面——包括合成器在窗口缩放期间用来
  // 填充未绘制区域的基础背景色，那正是暗色应用退出动效里那道白边的可疑来源。
  // 「跟随系统」是默认，也是大多数用户的状态——那时 html 上**没有** data-theme，
  // 所以只挂在 html[data-theme] 上的声明对他们等于不存在。两条路径都要测。
  await page.emulateMedia({ colorScheme: 'dark' });
  await bootLocale(page, { locale: 'zh' });
  expect(await page.evaluate(() => document.documentElement.dataset.theme || '(auto)')).toBe('(auto)');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');

  await page.emulateMedia({ colorScheme: 'light' });
  await bootLocale(page, { locale: 'zh' });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');

  // 显式选暗色（系统仍是亮色）：走 html[data-theme="dark"] 那条。
  await page.locator('[data-action="open-more"]').click();
  await page.locator('[data-action="theme"][data-theme="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
});

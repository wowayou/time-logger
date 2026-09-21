// v1.2.0 · 导入预览逐条化。
//
// 这个文件锁的是 D13 ③「AI/自动化不得悄悄修改原始时间线」的**透明度**那一面：
// 导入是唯一一条会往权威时间线里批量塞记录的路径，用户必须能在写入**前**看清
// 到底会加什么、跳过什么、和什么撞了。此前预览只有一行计数（「可导入 N 条 ·
// 已存在跳过 M 条」），逐条内容藏在数字后面——本版把新增与已跳过升级成可展开
// 的逐条清单。
//
// 判据要守三条容易回退的边界：
// ① 新增组逐条列出**将写入的记录内容**（不是只报个数）。
// ② 已跳过组把「完全相同、不会重复写入」的记录也摊开——这是「导入不制造重复」
//    这条承诺的可见证据。
// ③ 有冲突时，新增/已跳过清单**照样显示**（它们不依赖冲突如何解决），且在冲突
//    全部处理完之前「导入」按钮保持禁用。
import { expect, test } from '@playwright/test';
import { boot, openBackupMenu } from './ui_fixture.js';

// FIXED_NOW = 2026-06-29；one-record 夹具的种子记录就落在这天。
const TODAY = '2026-06-29';

async function openImportWith(page, payload) {
  await openBackupMenu(page);
  await page.locator('[data-action="open-backup"]').click();
  await expect(page.locator('#form-sheet-title')).toHaveText('备份与导入');
  await page.locator('[data-action="import-json"]').click();
  await page.setInputFiles('#import-file', {
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload), 'utf-8')
  });
  await expect(page.locator('#form-sheet-title')).toHaveText('导入检查');
}

// ① + ②：一条与本机完全相同（跳过）、一条全新（新增）。两组都摊成逐条清单。
test('导入预览把新增与已跳过逐条摊开，不只报计数', async ({ page }) => {
  await boot(page, 390, 'one-record', false, '2026-06-29T12:34:30');

  await openImportWith(page, {
    version: 1,
    entries: [
      // 与 one-record 种子逐字相同 → 跳过。
      { id: 'today-1', ts: `${TODAY}T00:05`, what: '响应式测试记录', tags: ['求职推进'] },
      // 全新 → 新增。
      { id: 'imported-new', ts: `${TODAY}T14:00`, what: '从备份导入的新记录', tags: ['吃饭'] }
    ]
  });

  const addGroup = page.locator('.import-group-add');
  await expect(addGroup).toBeVisible();
  await expect(addGroup.locator('.import-group-head')).toContainText('将新增 1');
  await addGroup.locator('summary').click();
  await expect(addGroup.locator('.import-item-what')).toHaveText('从备份导入的新记录');
  await expect(addGroup.locator('.import-item-meta')).toContainText('吃饭');

  const skipGroup = page.locator('.import-group-skip');
  await expect(skipGroup).toBeVisible();
  await expect(skipGroup.locator('.import-group-head')).toContainText('已存在 1');
  await skipGroup.locator('summary').click();
  await expect(skipGroup.locator('.import-item-what')).toHaveText('响应式测试记录');

  // 逐条清单不替代那行汇总——汇总仍在，且导入按钮可用（无冲突）。
  await expect(page.locator('[data-role="import-summary"]')).toContainText('可导入 1');
  await expect(page.locator('#import-confirm-btn')).toBeEnabled();
});

// ③：同 ID 内容不同 = 冲突。冲突卡出现的同时，新增清单照样在；冲突未处理时
// 「导入」禁用，处理后放开。
test('有冲突时新增清单照样显示，且冲突未处理前导入按钮禁用', async ({ page }) => {
  await boot(page, 390, 'one-record', false, '2026-06-29T12:34:30');

  await openImportWith(page, {
    version: 1,
    entries: [
      // 同 ID、内容不同 → 冲突。
      { id: 'today-1', ts: `${TODAY}T00:05`, what: '备份里改过的内容', tags: ['求职推进'] },
      // 无关的全新记录 → 新增，且不该被冲突挡住展示。
      { id: 'imported-new', ts: `${TODAY}T15:00`, what: '另一条新记录', tags: ['娱乐'] }
    ]
  });

  // 新增清单在冲突存在时仍然渲染。
  const addGroup = page.locator('.import-group-add');
  await expect(addGroup).toBeVisible();
  await expect(addGroup.locator('.import-group-head')).toContainText('将新增 1');

  // 冲突卡在下方冲突区，导入按钮此刻禁用。
  await expect(page.locator('.import-conflict-card')).toHaveCount(1);
  await expect(page.locator('#import-confirm-btn')).toBeDisabled();

  // 处理冲突（保留本机）后放开。
  await page.locator('.import-conflict-card [data-resolution="local"]').click();
  await expect(page.locator('#import-confirm-btn')).toBeEnabled();
});

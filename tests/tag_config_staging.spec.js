// 标签高级设置的「扎实」补强：① 局部动作（设为当前 / 添加默认标签预览）不得静默抹掉
// 长表单里别处还没保存的改名/改桶/勾选/待删除/草稿行（v83 原则：全部一起在「保存」落库，
// 中途不重渲染丢改动——但「设为当前」等走 openFormSheet 重渲染，需先暂存再回填）；
// ② 合并是破坏性动作，提示必须给显式「先不合并」出口 + danger 色「合并」，防单一裸按钮误触。
import { expect, test } from '@playwright/test';
import { bootLocale, TODAY_KEY } from './i18n_fixture.js';

const CONFIG = {
  version: 1,
  mainline: ['求职推进', '杂'],
  chips: [
    { name: '睡觉', bucket: 'maintain', longOk: true },
    { name: '刷手机', bucket: 'leak', longOk: false }
  ]
};

const readConfig = page => page.evaluate(() => JSON.parse(localStorage.getItem('timelog.config')));

async function openConfig(page) {
  await page.locator('[data-action="open-more"]').click();
  await page.getByRole('button', { name: '配置标签' }).click();
  await expect(page.locator('#form-sheet-title')).toHaveText('标签高级设置');
}

test('设为当前 preserves unsaved renames, bucket flips and draft rows across the re-render', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: CONFIG });
  await openConfig(page);

  // 别处的三种未保存改动：改名一个 chip、把它的桶从维持翻到偏航、再加一行草稿。
  const sleepRow = page.locator('.cfg-row[data-original-name="睡觉"]');
  await sleepRow.locator('.cfg-name').fill('午睡');
  await sleepRow.locator('[data-action="cfg-pick-bucket"][data-bucket="leak"]').click();
  await page.locator('.cfg-section').filter({ hasText: '维持标签' }).locator('[data-action="cfg-add-row"]').click();
  await page.locator('.cfg-row[data-new="1"] .cfg-name').fill('冥想');
  // 再把另一个零记录 chip 点成待删除（CONFIG 无 entries，刷手机 是零记录行）。
  const phoneRow = page.locator('.cfg-row[data-original-name="刷手机"]');
  await phoneRow.locator('[data-action="cfg-toggle-delete"]').click();
  await expect(phoneRow.locator('[data-action="cfg-toggle-delete"]')).toHaveText('撤销');

  // 触发局部重渲染：把历史主线设为当前。
  await page.locator('.cfg-row[data-original-name="杂"] [data-action="set-current-mainline"]').click();

  // 立即落库的只有主线顺序……
  expect((await readConfig(page)).mainline).toEqual(['杂', '求职推进']);
  // ……而别处未保存的改动全都还在（没被重渲染抹掉）。
  await expect(sleepRow.locator('.cfg-name')).toHaveValue('午睡');
  await expect(sleepRow).toHaveAttribute('data-b', 'leak');
  await expect(page.locator('.cfg-row[data-new="1"] .cfg-name')).toHaveValue('冥想');
  // 待删除态也熬过了重渲染：行仍待删除，按钮文字仍是「撤销」。
  await expect(phoneRow).toHaveAttribute('data-pending-delete', '1');
  await expect(phoneRow.locator('[data-action="cfg-toggle-delete"]')).toHaveText('撤销');

  // 保存后三种改动全部落库。
  await page.getByRole('button', { name: '保存标签配置' }).click();
  const config = await readConfig(page);
  expect(config.chips.find(c => c.name === '午睡')).toMatchObject({ bucket: 'leak' });
  expect(config.chips.some(c => c.name === '睡觉')).toBe(false);
  expect(config.chips.map(c => c.name)).toContain('冥想');
});

test('previewing default tags does not wipe an in-progress rename', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: CONFIG });
  await openConfig(page);
  await page.locator('.cfg-row[data-original-name="刷手机"] .cfg-name').fill('短视频');
  await page.locator('[data-action="preview-locale-defaults"]').click();
  // 预览框出现，且未保存的改名还在。
  await expect(page.locator('[data-role="defaults-preview"]')).toBeVisible();
  await expect(page.locator('.cfg-row[data-original-name="刷手机"] .cfg-name')).toHaveValue('短视频');
});

test('the merge prompt offers an explicit 先不合并 exit and a danger-styled 合并', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    config: CONFIG,
    entries: [
      { id: 'a', ts: `${TODAY_KEY}T08:00`, what: '午睡', tags: ['刷手机'] },
      { id: 'b', ts: `${TODAY_KEY}T09:00`, what: '睡了', tags: ['睡觉'] }
    ]
  });
  await openConfig(page);
  await page.locator('.cfg-row[data-original-name="刷手机"] .cfg-name').fill('睡觉');
  await page.getByRole('button', { name: '保存标签配置' }).click();

  const box = page.locator('[data-role="config-error"]');
  await expect(box).toContainText('会归到「睡觉」');
  // 破坏性动作不是单一裸按钮：中性「先不合并」+ danger 色「合并」两键并存。
  const cancel = page.locator('[data-action="dismiss-tag-merge"]');
  const confirm = page.locator('[data-action="confirm-tag-merge"]');
  await expect(cancel).toBeVisible();
  await expect(confirm).toBeVisible();
  await expect(confirm).toHaveClass(/cell-danger/);

  // 两键等高、顶边对齐（.cell-action 自带的底部外边距不得把取消键拉矮）。
  const cancelBox = await cancel.boundingBox();
  const confirmBox = await confirm.boundingBox();
  expect(cancelBox).not.toBeNull();
  expect(confirmBox).not.toBeNull();
  expect(Math.abs(cancelBox.height - confirmBox.height)).toBeLessThan(1);
  expect(Math.abs(cancelBox.y - confirmBox.y)).toBeLessThan(1);

  // 「先不合并」只收起提示，不动数据；改名仍在，可继续编辑或改回。
  await cancel.click();
  await expect(box).toBeHidden();
  expect((await readConfig(page)).chips.map(c => c.name)).toEqual(['睡觉', '刷手机']);
  await expect(page.locator('.cfg-row[data-original-name="刷手机"] .cfg-name')).toHaveValue('睡觉');
  // 焦点归还：收起提示后焦点回到出问题那一行的输入框，不掉到 body。
  await expect(page.locator('.cfg-row[data-original-name="刷手机"] .cfg-name')).toBeFocused();

  // 再保存 → 再问一次 → 这次确认合并，落库。
  await page.getByRole('button', { name: '保存标签配置' }).click();
  await expect(confirm).toBeVisible();
  await confirm.click();
  const config = await readConfig(page);
  expect(config.chips.map(c => c.name)).toEqual(['睡觉']);
});

// 双页同 context（照 v93_cas_snapshot.spec.js:50）：pageA 用 bootLocale 播种，pageB
// 共享同一 origin 的 localStorage，只 goto('/')。两页先各自打开配置（各自捕下
// CAS 基线），再让 B 先写入。
async function openTwoConfigPages(context) {
  const pageA = await context.newPage();
  await bootLocale(pageA, { locale: 'zh', config: CONFIG });
  const pageB = await context.newPage();
  await pageB.goto('/');
  await pageB.waitForFunction(() => document.body.classList.contains('app-ready'));
  await openConfig(pageA);
  await openConfig(pageB);
  return { pageA, pageB };
}

test('④ set-current is blocked by CAS when another tab wrote, and staged edits survive', async ({ context }) => {
  const { pageA, pageB } = await openTwoConfigPages(context);

  // B 把「睡觉」从维持改成偏航（leak）并保存：现在 config raw 变了，A 的基线变陈。
  await pageB.locator('.cfg-row[data-original-name="睡觉"] [data-action="cfg-pick-bucket"][data-bucket="leak"]').click();
  await pageB.getByRole('button', { name: '保存标签配置' }).click();
  await expect(pageB.locator('#form-sheet-title')).toHaveText('更多');

  // A 先暂存一个改名，再点「杂」的「设为当前」。
  await pageA.locator('.cfg-row[data-original-name="刷手机"] .cfg-name').fill('短视频');
  await pageA.locator('.cfg-row[data-original-name="杂"] [data-action="set-current-mainline"]').click();

  // 报「另一个标签页」；暂存的改名仍在；timelog.config 未被写入（一次性读取）。
  await expect(pageA.locator('[data-role="config-error"]')).toContainText('另一个标签页');
  await expect(pageA.locator('.cfg-row[data-original-name="刷手机"] .cfg-name')).toHaveValue('短视频');
  expect((await readConfig(pageA)).mainline).toEqual(['求职推进', '杂']);

  // A 再点保存，仍被拦下；B 写的 leak 不得被静默改回维持。
  await pageA.getByRole('button', { name: '保存标签配置' }).click();
  await expect(pageA.locator('[data-role="config-error"]')).toContainText('另一个标签页');
  const stored = await readConfig(pageA);
  expect(stored.chips.find(c => c.name === '睡觉').bucket).toBe('leak');
});

test('⑤ preview-then-save is blocked by CAS when another tab wrote', async ({ context }) => {
  const { pageA, pageB } = await openTwoConfigPages(context);

  await pageB.locator('.cfg-row[data-original-name="睡觉"] [data-action="cfg-pick-bucket"][data-bucket="leak"]').click();
  await pageB.getByRole('button', { name: '保存标签配置' }).click();
  await expect(pageB.locator('#form-sheet-title')).toHaveText('更多');

  // A 点「添加本语言的默认标签」预览 → 再保存。
  await pageA.locator('[data-action="preview-locale-defaults"]').click();
  await expect(pageA.locator('[data-role="defaults-preview"]')).toBeVisible();
  await pageA.getByRole('button', { name: '保存标签配置' }).click();

  // 保存被拦；「睡觉」仍是 leak（B 的写入未被覆盖）。
  await expect(pageA.locator('[data-role="config-error"]')).toContainText('另一个标签页');
  expect((await readConfig(pageA)).chips.find(c => c.name === '睡觉').bucket).toBe('leak');
});

test('⑥ single page: staged rename survives preview+apply and both land on save', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: CONFIG });
  await openConfig(page);

  // 暂存一个改名 → 预览默认标签 → 应用。zh 默认标签里除了 睡觉/刷手机（CONFIG 已有）
  // 还有吃饭等 CONFIG 之外的项，会真正新增。
  await page.locator('.cfg-row[data-original-name="刷手机"] .cfg-name').fill('短视频');
  await page.locator('[data-action="preview-locale-defaults"]').click();
  await expect(page.locator('.cfg-row[data-original-name="刷手机"] .cfg-name')).toHaveValue('短视频');
  await page.locator('[data-action="apply-locale-defaults"]').click();

  // 应用后重开，改名仍在；默认标签已落库。
  await expect(page.locator('.cfg-row[data-original-name="刷手机"] .cfg-name')).toHaveValue('短视频');

  await page.getByRole('button', { name: '保存标签配置' }).click();
  const config = await readConfig(page);
  const names = config.chips.map(c => c.name);
  expect(names).toContain('短视频');
  expect(names).not.toContain('刷手机');
  expect(names).toContain('吃饭'); // 新增的默认标签
});

test('⑦ apply-locale-defaults is blocked by CAS when another tab wrote (应用路径)', async ({ context }) => {
  const { pageA, pageB } = await openTwoConfigPages(context);

  // B 把「睡觉」从维持改成偏航（leak）并保存：A 的 CAS 基线变陈。
  await pageB.locator('.cfg-row[data-original-name="睡觉"] [data-action="cfg-pick-bucket"][data-bucket="leak"]').click();
  await pageB.getByRole('button', { name: '保存标签配置' }).click();
  await expect(pageB.locator('#form-sheet-title')).toHaveText('更多');

  // A 点「添加本语言的默认标签」预览 → 再点「应用」（走 applyLocaleDefaults，不是保存按钮）。
  await pageA.locator('[data-action="preview-locale-defaults"]').click();
  await expect(pageA.locator('[data-role="defaults-preview"]')).toBeVisible();
  await pageA.locator('[data-action="apply-locale-defaults"]').click();

  // 应用被拦；报「另一个标签页」。
  await expect(pageA.locator('[data-role="config-error"]')).toContainText('另一个标签页');
  // 一次性读取判断：「睡觉」仍是 leak（B 的写入未被覆盖），且默认标签「吃饭」未被追加。
  const stored = await readConfig(pageA);
  expect(stored.chips.find(c => c.name === '睡觉').bucket).toBe('leak');
  expect(stored.chips.some(c => c.name === '吃饭')).toBe(false);
});

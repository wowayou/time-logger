// SPEC-017：标签高级设置改成标签云后，每个标签的编辑控件收在 chip 后面，要先点开
// 才能交互（与真人操作一致）。这里集中「找到行 → 必要时展开历史折叠 → 点开」，
// 各用例只在交互前多调一次 openCfgRow，断言照旧写在行内控件上。

/**
 * @param {import('@playwright/test').Page | import('@playwright/test').Locator} root
 * @param {string} name 打开 sheet 时的原名（data-original-name）
 */
export function cfgRow(root, name) {
  return root.locator(`.cfg-row[data-original-name="${name}"]`);
}

/**
 * 点开一个已有标签的编辑卡（已展开则不动）。历史主线被折叠时先展开折叠。
 * @param {import('@playwright/test').Page | import('@playwright/test').Locator} root
 * @param {string} name
 */
export async function openCfgRow(root, name) {
  const row = cfgRow(root, name);
  if (await row.evaluate(el => el.classList.contains('is-open'))) return row;
  const face = row.locator(':scope > .cfg-chip');
  if (!(await face.isVisible())) {
    const fold = row.locator('xpath=ancestor::div[contains(@class,"cfg-list")]').locator('.cfg-fold');
    if (await fold.count()) await fold.click();
  }
  await face.click();
  return row;
}

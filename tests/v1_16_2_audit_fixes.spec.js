// v1.16.2 · 全项目审查修复的回归用例。
//
// ① 标签设置里主线「超长段免确认」的勾选按 tagKey 判定，与统计（longOkForTag）同一判据。
//    此前按逐字比较：config 里主线是 `coding`、mainlineLongOk 存的是 `Coding`（导入合并时
//    取并集即可得到）时，统计照常豁免，设置页却显示未勾选；随便保存一次标签设置，就按
//    「未勾选」重建 mainlineLongOk，静默关掉这条豁免。
// ② 计划行与「正在做」条的桶色按**数据**里的标签查，不按显示名查：英文界面下没有标签的
//    条目显示为 #Unknown，若把显示名拿去查桶，恰好叫 Unknown 的登记标签会把它染成别的桶。
// ④ 备份页按钮的成功反馈与时间分析同一纪律（v1.15.6）：连点只留最后一次复位定时器，
//    否则第一次的复位会提前撤掉第二次的反馈。
import { expect, test } from '@playwright/test';
import { bootLocale, TODAY_KEY } from './i18n_fixture.js';
import { openCfgRow } from './cfg_fixture.js';
import { FIXED_NOW, boot, openBackupSheet } from './ui_fixture.js';

const readConfig = page => page.evaluate(() => JSON.parse(localStorage.getItem('timelog.config')));

test('① 主线免确认只差大小写：设置页显示已勾选，保存别的改动后豁免仍在', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    config: {
      version: 1,
      longReview: true,
      mainline: ['coding'],
      mainlineLongOk: ['Coding'],
      chips: [{ name: '刷手机', bucket: 'leak', longOk: false }]
    },
    entries: [
      { id: 'long', ts: `${TODAY_KEY}T06:00`, what: '写代码', tags: ['coding'] },
      { id: 'after', ts: `${TODAY_KEY}T11:00`, what: '刷了会儿', tags: ['刷手机'] }
    ]
  });
  // 前提：统计侧按 tagKey 豁免，5h 主线段不要求确认。
  await expect(page.locator('#timeline')).toContainText('写代码');
  await expect(page.locator('[data-action="confirm-segment"]')).toHaveCount(0);

  await page.locator('[data-action="open-more"]').click();
  await page.getByRole('button', { name: '配置标签' }).click();
  await expect(page.locator('#form-sheet-title')).toHaveText('标签高级设置');
  const mainline = await openCfgRow(page, 'coding');
  await expect(mainline).toHaveAttribute('data-original-long-ok', '1');
  await expect(mainline.locator('.cfg-long-ok')).toBeChecked();

  // 改一个无关标签的名字后保存。
  await openCfgRow(page, '刷手机');
  await page.locator('.cfg-row[data-original-name="刷手机"] .cfg-name').fill('手机');
  await page.getByRole('button', { name: '保存标签配置' }).click();
  // 从「更多」下钻进来，保存后回到「更多」（返回栈）。
  await expect(page.locator('#form-sheet-title')).toHaveText('更多');

  const config = await readConfig(page);
  expect(config.chips.map(chip => chip.name)).toEqual(['手机']);
  expect((config.mainlineLongOk || []).map(name => name.toLowerCase())).toEqual(['coding']);
  await expect(page.locator('[data-action="confirm-segment"]')).toHaveCount(0);
});

test('② 英文界面：无标签的计划行与正在做条不因叫 Unknown 的登记标签换色', async ({ page }) => {
  await bootLocale(page, {
    locale: 'en',
    config: {
      version: 1,
      mainline: ['Current focus'],
      chips: [{ name: 'Unknown', bucket: 'maintain', longOk: false }]
    },
    entries: [
      { id: 'doing', ts: `${TODAY_KEY}T11:00`, what: 'Untagged import', tags: [] },
      { id: 'plan', ts: `${TODAY_KEY}T18:00`, what: 'Untagged plan', tags: [], planned: true }
    ]
  });
  // 显示名照旧是 #Unknown；桶色按数据（没有标签＝未记录）。
  const planned = page.locator('.entry.planned[data-id="plan"]');
  await expect(planned.locator('.e-tag')).toHaveText('#Unknown');
  await expect(planned).toHaveAttribute('data-b', 'unrecorded');
  const strip = page.locator('#now-strip');
  await expect(strip).toBeVisible();
  await expect(strip).toHaveAttribute('data-b', 'unrecorded');
});

// ③ SPEC-013：保留标签 `未知` 是数据 id，显示名走 tag.unknown。没选标签就保存的记录存的
//    正是它；此前时间轴、编辑页标题、删除确认与当前视图摘要都原样显示「#未知」，英文界面
//    因此夹一个中文词，而同一界面的提示写的是「Unknown」。中文下 tag.unknown 就是「未知」。
test('③ 英文界面：保留标签显示为 #Unknown，存储里仍是 未知', async ({ page }) => {
  await bootLocale(page, {
    locale: 'en',
    entries: [
      { id: 'u', ts: `${TODAY_KEY}T09:00`, what: 'Something', tags: ['未知'] },
      { id: 'next', ts: `${TODAY_KEY}T10:00`, what: '', tags: [] }
    ]
  });
  const row = page.locator('.entry[data-id="u"]');
  await expect(row.locator('.e-tag')).toHaveText('#Unknown');
  await expect(row).toHaveAttribute('data-b', 'unrecorded');
  await row.click();
  await expect(page.locator('#form-sheet-title')).toContainText('#Unknown');
  await expect(page.locator('#form-sheet-title')).not.toContainText('未知');
  await page.locator('#form-sheet [data-action="request-delete"]').click();
  await expect(page.locator('.delete-tag')).toHaveText('#Unknown');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(e => e.id === 'u').tags);
  expect(stored).toEqual(['未知']);
});

test('③ 中文界面：保留标签仍显示 #未知（逐字不变）', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    entries: [
      { id: 'u', ts: `${TODAY_KEY}T09:00`, what: '某事', tags: ['未知'] },
      { id: 'next', ts: `${TODAY_KEY}T10:00`, what: '', tags: [] }
    ]
  });
  await expect(page.locator('.entry[data-id="u"] .e-tag')).toHaveText('#未知');
});

test('④ 备份页「复制 JSON 备份」连点两次：第二次的反馈不被第一次的复位提前撤掉', async ({ page }) => {
  await page.addInitScript(() => {
    window.__copied = 0;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => { window.__copied += 1; return Promise.resolve(); } }
    });
  });
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  await openBackupSheet(page);
  const label = page.locator('#copy-btn [data-role="cell-label"]');
  await expect(label).toHaveText('复制 JSON 备份');
  await page.locator('#copy-btn').click();
  await expect(label).toHaveText('✓ 已复制');
  await page.waitForTimeout(1500);
  await page.locator('#copy-btn').click();
  // 此时距第一次约 2.8s，已过它的 2.5s 复位点、未到第二次的（约 4s）：一次性读取，不重试。
  await page.waitForTimeout(1300);
  expect(await label.textContent()).toBe('✓ 已复制');
  await expect(label).toHaveText('复制 JSON 备份', { timeout: 3000 });
  expect(await page.evaluate(() => window.__copied)).toBe(2);
});

// ⑤ timelog.openDate 自 v21 起只写不读：v1.16.2 停写，存量键与 v1.12.0 的 dayHeat 一样在启动时删除。
//    夹具照旧预置它，正好代表升级前的存量设备。
test('⑤ 启动后不再留下 timelog.openDate（存量键被删，也不再写入）', async ({ page }) => {
  await bootLocale(page, { locale: 'zh' });
  const keys = await page.evaluate(() => ({
    openDate: localStorage.getItem('timelog.openDate'),
    selectedDate: localStorage.getItem('timelog.selectedDate')
  }));
  expect(keys.openDate).toBeNull();
  // 「上次所看日期」仍由 selectedDate 记住，不受影响。
  expect(keys.selectedDate).toBe(TODAY_KEY);
});

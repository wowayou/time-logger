// v1.5.0：切一刀 / 补一下的「先看结果、再选时刻」。
//
// 真机反馈：两整块带日期列的滚轮（各附一个对段内切分毫无意义的「现在」）占掉大半屏，
// 切完长什么样只剩一段文字。本组用例锁：
// ① 结构——原段一行 + 比例切分条 + 逐段行在上，一行四列段内区间选择器在下；没有日期
//    列、没有「现在」；小时列只列原段覆盖的小时。
// ② 手感——滚到段外的值回弹到最近的合法时刻；贴边捷径一键到段首/段尾；开始不早于结束
//    时预览报错且保存被拦。
// ③ 默认——真实原段默认切出中间三分之一（贴整 5 分钟）；缺口 / 未记录原段仍整段补满。
// ④ 形态——跨 720px 断点重挂载为对应形态并保留当前两端。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot } from './ui_fixture.js';

const EVENING = '2026-06-29T20:00:30';

async function openSplit(page, width, id = 'focus') {
  await boot(page, width, 'interval-three', false, EVENING);
  await page.locator(`.entry[data-id="${id}"] .e-what`).click();
  await page.getByRole('button', { name: '在这条记录内部切一刀' }).click();
  await expect(page.locator('#form-sheet-title')).toContainText('切一刀');
}

// 把第 colIndex 列（0 开始时、1 开始分、2 结束时、3 结束分）滚到第 index 行并触发吸附。
async function spin(page, colIndex, index) {
  await page.evaluate(({ colIndex, index }) => {
    const col = document.querySelectorAll('#form-sheet .range-wheel .wheel-col')[colIndex];
    col.scrollTop = index * 40;
    col.dispatchEvent(new Event('scroll'));
    col.dispatchEvent(new Event('scrollend'));
  }, { colIndex, index });
}

test('v1.5.0: split sheet shows the result first — source line, proportional bar, rows — above one compact range wheel', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await openSplit(page, 390);
  const sheet = page.locator('#form-sheet');
  await expect(sheet.locator('[data-role="cut-source"]')).toContainText('专注');
  await expect(sheet.locator('[data-role="cut-source"]')).toContainText('#求职推进');
  await expect(sheet.locator('[data-role="cut-source"]')).toContainText('16:14–19:11 · 2h57min');
  // 默认切出中间三分之一：16:14 + 59min → 17:13 → 贴整 17:15；+118min → 18:12 → 18:10。
  await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T17:15');
  await expect(page.locator('#form-end-ts')).toHaveValue('2026-06-29T18:10');
  await expect(sheet.locator('.preview-head')).toHaveText('切分后为三段');
  const parts = sheet.locator('[data-role="cut-bar"] .cut-part');
  await expect(parts).toHaveCount(3);
  await expect(parts.nth(0)).toHaveAttribute('data-b', 'job');
  // 还没填内容也没选标签：新段是「待填写」，不再显示保留名「未知」。
  await expect(parts.nth(1)).toHaveAttribute('data-b', 'pending');
  await expect(sheet.locator('.preview-new .preview-label')).toHaveText('待填写');
  await expect(sheet.locator('[data-role="backfill-duration"]')).toHaveText('新段 55min');
  // 一行四列、没有日期列、没有「现在」。
  await expect(sheet.locator('.range-wheel .wheel-col')).toHaveCount(4);
  await expect(sheet.locator('.wheel-col-date')).toHaveCount(0);
  await expect(sheet.locator('.wheel-now-btn')).toHaveCount(0);
  // 小时列只列原段覆盖的小时（开始 16:14–19:10，结束 16:15–19:11）。
  const hours = await sheet.locator('.range-wheel .wheel-col').evaluateAll(cols =>
    [cols[0], cols[2]].map(col => Array.from(col.querySelectorAll('.wheel-item')).map(item => item.textContent)));
  expect(hours).toEqual([['16', '17', '18', '19'], ['16', '17', '18', '19']]);
  expect(errors).toEqual([]);
});

test('v1.5.0: out-of-segment wheel values spring back to the nearest legal time', async ({ page }) => {
  await openSplit(page, 390);
  await spin(page, 0, 0); // 开始时 → 16（开始分仍是 15 → 16:15，合法）
  await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T16:15');
  await spin(page, 1, 5); // 开始分 → 05：16:05 早于段首 16:14，回弹
  await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T16:14');
  await expect(page.locator('.preview-head')).toHaveText('贴边后为两段');
  await spin(page, 2, 3); // 结束时 → 19（结束分仍是 10 → 19:10，合法）
  await expect(page.locator('#form-end-ts')).toHaveValue('2026-06-29T19:10');
  await spin(page, 3, 45); // 结束分 → 45：19:45 晚于段尾 19:11，回弹
  await expect(page.locator('#form-end-ts')).toHaveValue('2026-06-29T19:11');
  await expect(page.locator('.preview-head')).toHaveText('整段改为');
});

test('v1.5.0: snap shortcuts replace the meaningless 现在 and reach either edge in one tap', async ({ page }) => {
  await openSplit(page, 390);
  await page.getByRole('button', { name: '结束时刻贴到原段终点 19:11' }).click();
  await expect(page.locator('#form-end-ts')).toHaveValue('2026-06-29T19:11');
  await expect(page.locator('.preview-head')).toHaveText('贴边后为两段');
  await expect(page.locator('[data-role="cut-bar"] .cut-part')).toHaveCount(2);
  await page.getByRole('button', { name: '开始时刻贴到原段起点 16:14' }).click();
  await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T16:14');
  await expect(page.locator('.preview-head')).toHaveText('整段改为');
  await expect(page.locator('[data-role="cut-bar"] .cut-part')).toHaveCount(1);
});

test('v1.5.0: picking a tag colors the new part and names it in the rows; a full save lands the three parts', async ({ page }) => {
  await openSplit(page, 390);
  await page.locator('#form-what').fill('吃晚饭');
  await page.locator('[data-action="pick-form-bucket"][data-bucket="maintain"]').click();
  await page.getByRole('button', { name: '选择标签：吃饭' }).click();
  await expect(page.locator('[data-role="cut-bar"] .cut-new')).toHaveAttribute('data-b', 'maintain');
  await expect(page.locator('.preview-new .preview-label')).toHaveText('吃晚饭 #吃饭');
  await page.getByRole('button', { name: '保存时间记录' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  const slices = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries
    .filter(e => !e.planned && e.ts >= '2026-06-29T16:00' && e.ts < '2026-06-29T19:30')
    .sort((a, b) => (a.ts < b.ts ? -1 : 1))
    .map(e => `${e.ts.slice(11)}|${e.what}|${e.tags[0] || ''}`));
  expect(slices).toEqual(['16:14|专注|求职推进', '17:15|吃晚饭|吃饭', '18:10|专注|求职推进', '19:11|后一段|吃饭']);
});

test('v1.5.0: start at or after end is reported in the overview and the save is blocked', async ({ page }) => {
  await openSplit(page, 390);
  await spin(page, 0, 2); // 开始时 → 18：18:15，晚于结束 18:10
  await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T18:15');
  await expect(page.locator('.preview-head')).toHaveClass(/is-error/);
  await expect(page.locator('[data-role="cut-bar"] .cut-part')).toHaveCount(1);
  await expect(page.locator('[data-role="backfill-duration"]')).toHaveClass(/is-error/);
  await page.locator('#form-what').fill('不会被保存');
  await page.getByRole('button', { name: '保存时间记录' }).click();
  await expect(page.locator('#form-sheet')).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.some(e => e.what === '不会被保存'));
  expect(saved).toBe(false);
});

test('v1.5.0: a gap (补一下) keeps the whole-range default and reads as 未记录', async ({ page }) => {
  await boot(page, 390, 'two-records', false, FIXED_NOW);
  await page.locator('.entry.gap[data-action="backfill-seg"]').click();
  await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T00:00');
  await expect(page.locator('#form-end-ts')).toHaveValue('2026-06-29T09:00');
  await expect(page.locator('[data-role="cut-source"]')).toContainText('未记录');
  await expect(page.locator('[data-role="cut-source"]')).toHaveAttribute('data-b', 'unrecorded');
  await expect(page.locator('[data-role="cut-bar"] .cut-part')).toHaveCount(1);
});

test('v1.5.0: desktop fields step with arrow keys and clamp typed values to the segment', async ({ page }) => {
  await openSplit(page, 768);
  const start = page.locator('[data-role="range-start-text"]');
  const end = page.locator('[data-role="range-end-text"]');
  await expect(start).toHaveValue('17:15');
  await expect(end).toHaveValue('18:10');
  await start.focus();
  await page.keyboard.press('ArrowUp');
  await expect(start).toHaveValue('17:16');
  await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T17:16');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(start).toHaveValue('17:06');
  await end.fill('23:00');
  await end.blur();
  await expect(end).toHaveValue('19:11');
  // 打不成时刻的输入不改值、退回原样。
  await start.fill('abc');
  await start.blur();
  await expect(start).toHaveValue('17:06');
});

test('v1.5.0: crossing the 720px breakpoint remounts the range picker and keeps both ends', async ({ page }) => {
  await openSplit(page, 390);
  await page.getByRole('button', { name: '结束时刻贴到原段终点 19:11' }).click();
  await page.setViewportSize({ width: 820, height: 820 });
  await expect(page.locator('[data-role="range-start-text"]')).toHaveValue('17:15');
  await expect(page.locator('[data-role="range-end-text"]')).toHaveValue('19:11');
  await page.setViewportSize({ width: 390, height: 820 });
  await expect(page.locator('#form-sheet .range-wheel .wheel-col')).toHaveCount(4);
  await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T17:15');
  await expect(page.locator('#form-end-ts')).toHaveValue('2026-06-29T19:11');
});

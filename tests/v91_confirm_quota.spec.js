// v91：确认长段 / 标记已发生 是 v90 那一批漏网的两条写入路径——它们吞掉 save()
// 的失败返回值，存储写满时点下去只表现为「什么都没发生」。
//
// 判据刻意分三层，缺一层这条用例就可能是假的：
//   ① 拦截器真的被调用过（P38 教训：只看用例通过，分不出「保护住了」和「故障压根
//      没注入」）；
//   ② 数据确实没落库（证明我们测的是失败路径，不是成功路径）；
//   ③ 用户看得见反馈——这一层才是本条要守的行为。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot } from './ui_fixture.js';

async function rejectDataWrites(page) {
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.__blockedWrites = 0;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'timelog.v1') {
        window.__blockedWrites += 1;
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };
  });
}

test('v91: 标记已发生 reports the failure when local storage is full', async ({ page }) => {
  await boot(page, 768, 'planned-expired', false, FIXED_NOW);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await expect(page.locator('[data-action="confirm-planned"]')).toHaveCount(1);
  await rejectDataWrites(page);

  await page.locator('[data-action="confirm-planned"]').click();

  expect(await page.evaluate(() => window.__blockedWrites),
    '拦截器必须真的被调用过，否则这条用例在空转').toBeGreaterThan(0);
  const still = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1'))
    .entries.find(e => e.id === 'plan-expired'));
  expect(still.planned, '写入失败后记录必须仍是计划').toBe(true);
  await expect(page.locator('#info-toast'),
    '写入失败必须有可见反馈，不能静默什么都不发生').toBeVisible();
  await expect(page.locator('#info-toast')).toContainText('存储空间不足');
  expect(pageErrors).toHaveLength(0);
});

test('v91: 长段确认 reports the failure when local storage is full', async ({ page }) => {
  await boot(page, 768, 'pending-confirm-lunch', false, FIXED_NOW);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await expect(page.locator('[data-action="confirm-segment"]')).toHaveCount(1);
  const before = await page.evaluate(() => localStorage.getItem('timelog.v1'));
  await rejectDataWrites(page);

  await page.locator('[data-action="confirm-segment"]').click();

  expect(await page.evaluate(() => window.__blockedWrites),
    '拦截器必须真的被调用过').toBeGreaterThan(0);
  expect(await page.evaluate(() => localStorage.getItem('timelog.v1')),
    '写入失败后数据必须逐字不变').toBe(before);
  await expect(page.locator('#info-toast'),
    '写入失败必须有可见反馈').toBeVisible();
  await expect(page.locator('#info-toast')).toContainText('存储空间不足');
  expect(pageErrors).toHaveLength(0);
});

// 反向哨兵：存储正常时这两个动作照旧成功，且**不得**弹出配额提示。
// 少了它，「让 showInfoToast 无条件弹」也能让上面两条变绿。
//
// 「没弹提示」必须用**一次性**读取（isVisible），不能用 toBeHidden()：后者会自动
// 重试到超时（默认 5s），而 toast 自己 3s 后就消失——于是它等到 toast 自然过期再
// 判过，无条件弹提示照样全绿。第一版正是这么写的，红灯③点不亮才逮到。
// showInfoToast 在 click 处理器内同步执行，且前面两条断言已经证明处理器跑完了，
// 所以这里不存在「还没来得及出现」的竞态。
async function expectNoToast(page) {
  expect(await page.locator('#info-toast').isVisible(),
    '正常路径不得弹出配额提示').toBe(false);
}

test('v91: both confirmations still succeed silently when storage is healthy', async ({ page }) => {
  await boot(page, 768, 'planned-expired', false, FIXED_NOW);
  await page.locator('[data-action="confirm-planned"]').click();
  const confirmed = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1'))
    .entries.find(e => e.id === 'plan-expired'));
  expect(confirmed.planned, '正常路径必须真的落库').toBeUndefined();
  await expectNoToast(page);

  await boot(page, 768, 'pending-confirm-lunch', false, FIXED_NOW);
  await page.locator('[data-action="confirm-segment"]').click();
  await expect(page.locator('[data-action="confirm-segment"]')).toHaveCount(0);
  await expectNoToast(page);
});

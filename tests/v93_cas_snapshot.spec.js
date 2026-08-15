// v93：CAS 的 expectedRaw 必须和被修改的数据对象来自同一次 localStorage 读取。
// 旧路径 `load()` → `readRaw()` 有两次 getItem：若另一标签页恰在中间写入，旧对象会
// 配上新 raw，saveChecked 反而放行，静默覆盖对方数据。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot } from './ui_fixture.js';

test('v93: CAS snapshot cannot pair stale data with another tab\'s newer raw value', async ({ page }) => {
  await boot(page, 768, 'planned-expired', false, FIXED_NOW);
  await expect(page.locator('[data-action="confirm-planned"]')).toHaveCount(1);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.evaluate(() => {
    const key = 'timelog.v1';
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    let armed = true;
    window.__snapshotRaceReads = 0;
    Storage.prototype.getItem = function (name) {
      if (name !== key || !armed) return originalGet.call(this, name);
      armed = false;
      window.__snapshotRaceReads += 1;
      const staleRaw = originalGet.call(this, name);
      const concurrent = JSON.parse(staleRaw);
      concurrent.entries.push({
        id: 'other-tab-write',
        ts: '2026-06-29T11:30',
        what: '另一标签页刚写入',
        tags: ['求职推进']
      });
      // 在第一次读取已取得旧值、但返回调用方之前模拟另一标签页写入。
      originalSet.call(this, name, JSON.stringify(concurrent));
      return staleRaw;
    };
  });

  await page.locator('[data-action="confirm-planned"]').click();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')));
  expect(await page.evaluate(() => window.__snapshotRaceReads),
    '竞态注入必须真的命中过第一次数据读取').toBe(1);
  expect(stored.entries.some(entry => entry.id === 'other-tab-write'),
    '另一标签页的新记录不得被旧对象覆盖').toBe(true);
  expect(stored.entries.find(entry => entry.id === 'plan-expired')?.planned,
    '检测到并发后当前动作必须中止').toBe(true);
  await expect(page.locator('#info-toast')).toContainText('另一个标签页');
  expect(pageErrors).toHaveLength(0);
});

test('v93: a stale tag-config sheet cannot overwrite another tab\'s saved rename', async ({ context }) => {
  const pageA = await context.newPage();
  await boot(pageA, 768, 'one-record', false, FIXED_NOW);
  const pageB = await context.newPage();
  await pageB.goto('/');
  await pageB.waitForFunction(() => document.body.classList.contains('app-ready'));

  for (const page of [pageA, pageB]) {
    await page.locator('[data-action="open-more"]').click();
    await page.getByRole('button', { name: '配置标签' }).click();
    await expect(page.locator('#form-sheet')).toBeVisible();
  }

  const row = page => page.locator('.cfg-row[data-original-name="求职推进"] .cfg-name');
  await row(pageA).fill('先保存的主线');
  await pageA.getByRole('button', { name: '保存标签配置' }).click();
  // 配置页从「更多」下钻，保存成功后按导航栈返回「更多」，而不是直接退出整张 sheet。
  await expect(pageA.locator('#form-sheet-title')).toHaveText('更多');

  await row(pageB).fill('后保存的旧草稿');
  await pageB.getByRole('button', { name: '保存标签配置' }).click();

  await expect(pageB.locator('#form-sheet')).toBeVisible();
  await expect(pageB.locator('[data-role="config-error"]')).toContainText('另一个标签页');
  const stored = await pageB.evaluate(() => JSON.parse(localStorage.getItem('timelog.config')));
  expect(stored.mainline).toContain('先保存的主线');
  expect(stored.mainline).not.toContain('后保存的旧草稿');
});

test('v93: a failed config rollback cannot erase a newer data write', async ({ page }) => {
  await boot(page, 768, 'one-record', false, FIXED_NOW);
  await page.locator('[data-action="open-more"]').click();
  await page.getByRole('button', { name: '配置标签' }).click();
  await page.locator('.cfg-row[data-original-name="求职推进"] .cfg-name').fill('本次改名');

  await page.evaluate(() => {
    const dataKey = 'timelog.v1';
    const configKey = 'timelog.config';
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    let armed = true;
    window.__rollbackRaceInjected = false;
    Storage.prototype.setItem = function (name, value) {
      if (name !== dataKey || !armed) return originalSet.call(this, name, value);
      armed = false;
      originalSet.call(this, name, value);

      // 当前页写完记录、尚未写配置时，模拟另一标签页同时更新两个 key。
      const concurrentData = JSON.parse(originalGet.call(this, dataKey));
      concurrentData.entries.push({
        id: 'newer-data-write',
        ts: '2026-06-29T11:30',
        what: '并发页新增记录',
        tags: ['睡觉']
      });
      originalSet.call(this, dataKey, JSON.stringify(concurrentData));
      const concurrentConfig = JSON.parse(originalGet.call(this, configKey));
      concurrentConfig.motto = '并发页配置';
      originalSet.call(this, configKey, JSON.stringify(concurrentConfig));
      window.__rollbackRaceInjected = true;
    };
  });

  await page.getByRole('button', { name: '保存标签配置' }).click();

  await expect(page.locator('[data-role="config-error"]')).toContainText('记录回滚也未完成');
  const stored = await page.evaluate(() => ({
    injected: window.__rollbackRaceInjected,
    data: JSON.parse(localStorage.getItem('timelog.v1')),
    config: JSON.parse(localStorage.getItem('timelog.config'))
  }));
  expect(stored.injected).toBe(true);
  expect(stored.data.entries.some(entry => entry.id === 'newer-data-write'),
    '回滚不得抹掉并发页追加的记录').toBe(true);
  expect(stored.config.motto).toBe('并发页配置');
  expect(stored.config.mainline).toContain('求职推进');
  expect(stored.config.mainline).not.toContain('本次改名');
});

test('v93: custom-tag rollback also refuses to overwrite a newer data write', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.getByRole('button', { name: '维持' }).click();
  await page.locator('#form-what').fill('并发回滚测试');
  await page.locator('#form-ctag').fill('临时标签');

  await page.evaluate(() => {
    const dataKey = 'timelog.v1';
    const configKey = 'timelog.config';
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    let armed = true;
    let rejectConfig = false;
    window.__customRollbackRaceInjected = false;
    Storage.prototype.setItem = function (name, value) {
      if (name === configKey && rejectConfig) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      if (name !== dataKey || !armed) return originalSet.call(this, name, value);
      armed = false;
      originalSet.call(this, name, value);
      const concurrentData = JSON.parse(originalGet.call(this, dataKey));
      concurrentData.entries.push({
        id: 'newer-custom-data-write',
        ts: '2026-06-29T11:30',
        what: '并发页新增记录',
        tags: ['睡觉']
      });
      originalSet.call(this, dataKey, JSON.stringify(concurrentData));
      const concurrentConfig = JSON.parse(originalGet.call(this, configKey));
      concurrentConfig.motto = '并发页配置';
      originalSet.call(this, configKey, JSON.stringify(concurrentConfig));
      rejectConfig = true;
      window.__customRollbackRaceInjected = true;
    };
  });

  await page.getByRole('button', { name: '保存时间记录' }).click();

  await expect(page.locator('[data-role="conflict-error"]')).toContainText('记录回滚也未完成');
  const stored = await page.evaluate(() => ({
    injected: window.__customRollbackRaceInjected,
    data: JSON.parse(localStorage.getItem('timelog.v1')),
    config: JSON.parse(localStorage.getItem('timelog.config'))
  }));
  expect(stored.injected).toBe(true);
  expect(stored.data.entries.some(entry => entry.id === 'newer-custom-data-write'),
    '自定义标签失败后的回滚不得抹掉并发页追加的记录').toBe(true);
  expect(stored.config.motto).toBe('并发页配置');
  expect(stored.config.chips).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ name: '临时标签' })
  ]));
});

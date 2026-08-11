// SPEC-007：标签高级设置重设计 + 主线可编辑。
// 主线一直可以「隐式新增」（录入时选主线桶 + 输入自定义标签就 unshift 进
// config.mainline），缺的是改名 / 设为当前 / longOk / 清理——这组用例锁住那些。
import { expect, test } from '@playwright/test';
import { bootLocale, TODAY_KEY } from './i18n_fixture.js';

const CONFIG = {
  version: 1,
  longReview: true,
  mainline: ['求职推进', '杂'],
  chips: [
    { name: '睡觉', bucket: 'maintain', longOk: true },
    { name: '刷手机', bucket: 'leak', longOk: false }
  ]
};

async function openConfig(page) {
  await page.locator('[data-action="open-more"]').click();
  await page.getByRole('button', { name: '配置标签' }).click();
  await expect(page.locator('#form-sheet-title')).toHaveText('标签高级设置');
}

const readConfig = page => page.evaluate(() => JSON.parse(localStorage.getItem('timelog.config')));

test('mainline rows render with the job spine and the current one is badged, history rows offer 设为当前', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: CONFIG });
  await openConfig(page);
  const rows = page.locator('.cfg-row[data-kind="mainline"]');
  await expect(rows).toHaveCount(2);
  // 竖脊颜色由 data-b 驱动，与时间轴同源；主线是整张 sheet 里唯一的 job 紫。
  await expect(rows.first()).toHaveAttribute('data-b', 'job');
  await expect(rows.first().locator('.cfg-badge')).toBeVisible();
  await expect(rows.first().locator('[data-action="set-current-mainline"]')).toHaveCount(0);
  await expect(rows.nth(1)).toHaveClass(/is-history/);
  await expect(rows.nth(1).locator('[data-action="set-current-mainline"]')).toBeVisible();
  // v82：这份 fixture 一条记录都没有，所以两行都提供删除入口（SPEC-007 当初
  // 「主线无删除」的理由是孤儿标签，零记录时该理由不成立）。
  await expect(page.locator('.cfg-row[data-kind="mainline"] [data-action="cfg-toggle-delete"]')).toHaveCount(2);
});

test('renaming a mainline tag migrates its history in the same save', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    config: CONFIG,
    entries: [
      { id: 'a', ts: `${TODAY_KEY}T09:00`, what: '投简历', tags: ['求职推进'] },
      { id: 'b', ts: `${TODAY_KEY}T11:00`, what: '杂事', tags: ['杂'] }
    ]
  });
  await openConfig(page);
  await page.locator('.cfg-row[data-original-name="求职推进"] .cfg-name').fill('Job search');
  await page.getByRole('button', { name: '保存标签配置' }).click();

  const stored = await page.evaluate(() => ({
    data: JSON.parse(localStorage.getItem('timelog.v1')),
    config: JSON.parse(localStorage.getItem('timelog.config'))
  }));
  expect(stored.config.mainline).toEqual(['Job search', '杂']);
  // 历史迁移与 config 写入必须落在同一次 load() 的对象图上。
  expect(stored.data.entries.find(e => e.id === 'a').tags).toEqual(['Job search']);
  // 未改名的那条一个字都不能动。
  expect(stored.data.entries.find(e => e.id === 'b').tags).toEqual(['杂']);
});

test('设为当前 moves a history name to the head of mainline without touching entries', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    config: CONFIG,
    entries: [{ id: 'a', ts: `${TODAY_KEY}T09:00`, what: '投简历', tags: ['求职推进'] }]
  });
  await openConfig(page);
  await page.locator('.cfg-row[data-original-name="杂"] [data-action="set-current-mainline"]').click();
  const config = await readConfig(page);
  expect(config.mainline).toEqual(['杂', '求职推进']);
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')));
  expect(data.entries.find(e => e.id === 'a').tags).toEqual(['求职推进']);
});

test('mainline longOk persists and exempts a >3h mainline span from reminders', async ({ page }) => {
  // 6h 主线段：未豁免时标为待核但仍按主线统计；豁免后不再提醒。
  await bootLocale(page, {
    locale: 'zh',
    config: CONFIG,
    entries: [
      { id: 'long', ts: `${TODAY_KEY}T08:00`, what: '写代码', tags: ['求职推进'] },
      { id: 'after', ts: `${TODAY_KEY}T14:00`, what: '吃饭', tags: ['睡觉'] }
    ]
  });
  await expect(page.locator('#timeline')).toContainText('确认');

  await openConfig(page);
  await page.locator('.cfg-row[data-original-name="求职推进"] .cfg-long-ok').check();
  await page.getByRole('button', { name: '保存标签配置' }).click();

  const config = await readConfig(page);
  expect(config.mainlineLongOk).toContain('求职推进');
  // 豁免后那一段不再要求确认。
  await expect(page.locator('.cfg-row')).toHaveCount(0);
  await expect(page.locator('[data-action="confirm-segment"]')).toHaveCount(0);
});

test('the bucket segmented control replaces the native select and repaints the spine immediately', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: CONFIG });
  await openConfig(page);
  // 原生 <select> 不跟随应用语言（英文界面会弹中文选项），规格要求换掉。
  await expect(page.locator('.cfg-bucket')).toHaveCount(0);
  const row = page.locator('.cfg-row[data-original-name="睡觉"]');
  await expect(row).toHaveAttribute('data-b', 'maintain');
  await row.locator('[data-action="cfg-pick-bucket"][data-bucket="leak"]').click();
  // 结构与控件说同一件事：切桶后竖脊即时跟随，不等保存。
  await expect(row).toHaveAttribute('data-b', 'leak');
  await page.getByRole('button', { name: '保存标签配置' }).click();
  const config = await readConfig(page);
  expect(config.chips.find(c => c.name === '睡觉').bucket).toBe('leak');
});

test('a name that collides across groups is blocked inline instead of saved', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: CONFIG });
  await openConfig(page);
  await page.locator('.cfg-row[data-original-name="睡觉"] .cfg-name').fill('求职推进');
  await page.getByRole('button', { name: '保存标签配置' }).click();
  await expect(page.locator('[data-role="config-error"]')).toBeVisible();
  // 拦下就必须真的没写入。
  const config = await readConfig(page);
  expect(config.chips.find(c => c.name === '睡觉')).toBeTruthy();
});

test('D18: adding this locale\'s default tags previews first, then appends only what is missing', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: CONFIG });
  await openConfig(page);
  await page.locator('[data-action="preview-locale-defaults"]').click();
  const preview = page.locator('[data-role="defaults-preview"]');
  await expect(preview).toBeVisible();
  // 同名的必须出现在**「将跳过」**那一行、且**不得**出现在「将新增」那一行。
  // 只断言 preview 整体包含「睡觉」是假测试：把「只追加」改成「全部追加」后它
  // 照样绿——normalizeConfig 会按名去重并保留原有那条，把缺陷盖住。
  await expect(preview.locator('[data-role="defaults-skipped"]')).toContainText('睡觉');
  await expect(preview.locator('[data-role="defaults-additions"]')).not.toContainText('睡觉');
  await page.locator('[data-action="apply-locale-defaults"]').click();

  const config = await readConfig(page);
  const names = config.chips.map(c => c.name);
  expect(names).toContain('吃饭');       // 新增
  expect(names).toContain('刷手机');     // 原有，保留
  // 只追加：同名的桶不被覆盖（睡觉本来在 maintain，且 longOk 为 true）
  const sleep = config.chips.find(c => c.name === '睡觉');
  expect(sleep.bucket).toBe('maintain');
  expect(sleep.longOk).toBe(true);
  // 主线不受影响
  expect(config.mainline).toEqual(['求职推进', '杂']);
});

test('P34: the redesigned sheet does not clip its last row at 375x600 with maximum content', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    width: 375,
    height: 600,
    config: {
      version: 1,
      mainline: ['求职推进', '杂', '开发', 'app推进', '阅读'],
      chips: Array.from({ length: 10 }, (_, i) => ({
        name: `标签${i + 1}`, bucket: i % 2 ? 'leak' : 'maintain', longOk: false
      }))
    }
  });
  await openConfig(page);
  const body = page.locator('.config-body');
  const last = page.locator('.cfg-row').last();
  // 判据必须与 P34 既有判例一致：**逐个分组**比 scrollHeight/clientHeight。
  // 我最初只测了「最后一行高度」和「正文是否溢出」，那太弱——SPEC-007 把分组
  // 从 2 个加到 4 个后 P34 确实复发了，而那版断言全绿。
  const clipped = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.config-body .cell-group').forEach(group => {
      if (group.scrollHeight > group.clientHeight + 1) out.push(group.textContent.trim().slice(0, 10));
    });
    return out;
  });
  expect(clipped).toEqual([]);
  await expect(last).toBeVisible();
});

// ---- v82：标签生命周期对称（建得出来就删得掉）----
// 真机反馈：为了试一下而建的「測試主線」一条记录都没有，却永远删不掉。
// SPEC-007 当初「主线不做删除」的理由写得很清楚——「历史记录引用主线历史名，
// 删除会产生孤儿标签」——这条理由只在**有记录**时成立，所以删除按零记录开放。

const CONFIG_WITH_TEST_TAG = {
  version: 1,
  mainline: ['測試主線', '求职推进'],
  chips: [
    { name: '睡觉', bucket: 'maintain', longOk: true },
    { name: '刷手机', bucket: 'leak', longOk: false }
  ]
};

test('v82: a zero-entry mainline tag can be deleted, and the entry-bearing one still cannot', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    config: CONFIG_WITH_TEST_TAG,
    entries: [{ id: 'a', ts: `${TODAY_KEY}T09:00`, what: '投简历', tags: ['求职推进'] }]
  });
  await openConfig(page);
  const testRow = page.locator('.cfg-row[data-original-name="測試主線"]');
  const usedRow = page.locator('.cfg-row[data-original-name="求职推进"]');
  // 右槽二选一：有记录→条数（不可删）；零记录→删除。
  await expect(usedRow.locator('.cfg-count')).toBeVisible();
  await expect(usedRow.locator('[data-action="cfg-toggle-delete"]')).toHaveCount(0);
  await expect(testRow.locator('.cfg-count')).toHaveCount(0);

  await testRow.locator('[data-action="cfg-toggle-delete"]').click();
  // 待删除是可见的中间态，不是当场消失。
  await expect(testRow).toHaveAttribute('data-pending-delete', '1');
  await expect(testRow.locator('.cfg-name')).toBeDisabled();
  await page.getByRole('button', { name: '保存标签配置' }).click();

  const stored = await page.evaluate(() => ({
    data: JSON.parse(localStorage.getItem('timelog.v1')),
    config: JSON.parse(localStorage.getItem('timelog.config'))
  }));
  expect(stored.config.mainline).toEqual(['求职推进']);
  // 删标签不动记录。
  expect(stored.data.entries.find(e => e.id === 'a').tags).toEqual(['求职推进']);
});

test('v82: pending delete is reversible by 撤销 and by 取消', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: CONFIG_WITH_TEST_TAG });
  await openConfig(page);
  const row = page.locator('.cfg-row[data-original-name="測試主線"]');
  await row.locator('[data-action="cfg-toggle-delete"]').click();
  await row.locator('[data-action="cfg-toggle-delete"]').click();
  await expect(row).not.toHaveAttribute('data-pending-delete', '1');
  await expect(row.locator('.cfg-name')).toBeEnabled();
  await page.getByRole('button', { name: '保存标签配置' }).click();
  expect((await readConfig(page)).mainline).toEqual(['測試主線', '求职推进']);

  // 标记删除后走「取消」：整单作废，配置一个字不变。
  // （保存后 sheet 按 v41 导航栈退回「更多」，这里直接下钻，不重开「更多」。）
  await page.getByRole('button', { name: '配置标签' }).click();
  await page.locator('.cfg-row[data-original-name="測試主線"] [data-action="cfg-toggle-delete"]').click();
  await page.getByRole('button', { name: '取消配置' }).click();
  expect((await readConfig(page)).mainline).toEqual(['測試主線', '求职推进']);
});

test('v82: clearing a name is an inline error instead of silently deleting the chip', async ({ page }) => {
  // 旧行为：清空名称＝悄悄删掉这一行。不可发现，且 chip 有记录时会把历史打成
  // 孤儿标签、统计当场变化。删除现在只有显式入口，空名一律当输入错误拦下。
  await bootLocale(page, {
    locale: 'zh',
    config: CONFIG_WITH_TEST_TAG,
    entries: [{ id: 'a', ts: `${TODAY_KEY}T09:00`, what: '午睡', tags: ['睡觉'] }]
  });
  await openConfig(page);
  await page.locator('.cfg-row[data-original-name="睡觉"] .cfg-name').fill('');
  await page.getByRole('button', { name: '保存标签配置' }).click();
  await expect(page.locator('[data-role="config-error"]')).toBeVisible();
  const config = await readConfig(page);
  expect(config.chips.map(c => c.name)).toContain('睡觉');
});

test('v82: a tag that gained entries in another tab is refused at save time', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: CONFIG_WITH_TEST_TAG });
  await openConfig(page);
  await page.locator('.cfg-row[data-original-name="測試主線"] [data-action="cfg-toggle-delete"]').click();
  // 渲染时的「零记录」判据在 sheet 打开期间可能过期——保存必须按最新 load() 复算。
  await page.evaluate(todayKey => {
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    data.entries.push({ id: 'other', ts: `${todayKey}T10:00`, what: '别的标签页记的', tags: ['測試主線'] });
    localStorage.setItem('timelog.v1', JSON.stringify(data));
  }, TODAY_KEY);
  await page.getByRole('button', { name: '保存标签配置' }).click();
  await expect(page.locator('[data-role="config-error"]')).toContainText('已经有记录');
  expect((await readConfig(page)).mainline).toContain('測試主線');
});

test('v82: emptying a whole group is allowed and renders an empty-state line', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: CONFIG_WITH_TEST_TAG });
  await openConfig(page);
  await page.locator('.cfg-row[data-original-name="刷手机"] [data-action="cfg-toggle-delete"]').click();
  await page.getByRole('button', { name: '保存标签配置' }).click();
  expect((await readConfig(page)).chips.map(c => c.name)).toEqual(['睡觉']);

  await page.getByRole('button', { name: '配置标签' }).click();
  const leakSection = page.locator('.cfg-section').filter({ hasText: '偏航标签' });
  await expect(leakSection.locator('.cfg-empty')).toBeVisible();
  // v83：组里还剩「＋ 新建标签」一行，所以不再是空盒；判据改成「没有标签行」。
  await expect(leakSection.locator('.cfg-row')).toHaveCount(0);
  await expect(leakSection.locator('[data-action="cfg-add-row"]')).toBeVisible();
});

test('v84: opening the more sheet already ends the undo window (v82 guard is now defense in depth)', async ({ page }) => {
  // v82 给「删标签」加了「让还挂着的撤销失效」的守卫，防的是撤销把引用该标签的
  // 记录放回来、当场造出孤儿标签。v84 的横幅方案 b（下一次交互即收起）让这条路径
  // **在 UI 上不再可达**：要进标签设置就得先点「···」，那一下点击已经结束了撤销窗口。
  // 守卫代码保留（成本近零、语义正确），但用例如实断言现在的事实，不假装它还能被触发。
  await bootLocale(page, {
    locale: 'zh',
    config: CONFIG_WITH_TEST_TAG,
    entries: [{ id: 'a', ts: `${TODAY_KEY}T09:00`, what: '试记一条', tags: ['測試主線'] }]
  });
  await page.locator('.entry[data-id="a"] .e-what').click();
  await page.getByRole('button', { name: '删除这条记录' }).click();
  await page.getByRole('button', { name: '确认删除记录' }).click();
  await expect(page.locator('#undo-toast')).toBeVisible();

  await page.waitForTimeout(400);
  await openConfig(page);
  await expect(page.locator('#undo-toast')).toBeHidden();
  await page.locator('.cfg-row[data-original-name="測試主線"] [data-action="cfg-toggle-delete"]').click();
  await page.getByRole('button', { name: '保存标签配置' }).click();
  expect((await readConfig(page)).mainline).toEqual(['求职推进']);
  // 记录没有被放回来，所以不存在孤儿标签。
  const entry = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(e => e.id === 'a'));
  expect(entry.tags || []).toEqual([]);
});

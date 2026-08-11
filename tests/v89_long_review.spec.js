// v89：长段确认从默认统计闸门降为默认关闭的可选提醒。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot, openAdvancedSheet, openBackupMenu } from './ui_fixture.js';

async function seedLongSegment(page) {
  await page.evaluate(() => {
    localStorage.setItem('timelog.v1', JSON.stringify({
      version: 1,
      entries: [
        { id: 'long-meal', ts: '2026-06-29T08:00', what: '吃饭', tags: ['吃饭'] },
        { id: 'work', ts: '2026-06-29T12:00', what: '下午工作', tags: ['求职推进'] }
      ]
    }));
  });
  await page.locator('#view-tabs button[data-view="week"]').click();
  await page.locator('#view-tabs button[data-view="day"]').click();
}

async function stubClipboard(page) {
  await page.addInitScript(() => {
    window.__copiedSummary = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: text => { window.__copiedSummary = text; return Promise.resolve(); } }
    });
  });
}

// copyText 走 navigator.clipboard.writeText().then(...)，写入落在微任务里——点完立刻
// evaluate 会读到上一次的值（空串）。清零后轮询到非空再返回。
async function copySummary(page) {
  await page.evaluate(() => { window.__copiedSummary = ''; });
  await openBackupMenu(page);
  await page.getByRole('button', { name: '复制当前视图摘要' }).click();
  await expect.poll(() => page.evaluate(() => window.__copiedSummary)).not.toBe('');
  await page.keyboard.press('Escape');
  return page.evaluate(() => window.__copiedSummary);
}

test('v89: long review is off by default and enabling it adds a tag-preserving reminder', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);
  await seedLongSegment(page);

  const meal = page.locator('.entry[data-id="long-meal"]');
  await expect(meal).toHaveAttribute('data-b', 'maintain');
  await expect(page.locator('[data-action="confirm-segment"]')).toHaveCount(0);
  await expect(page.locator('#ruler')).not.toContainText('待核');

  await openAdvancedSheet(page);
  const toggle = page.locator('[data-action="toggle-long-review"]');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toContainText('长段提醒：关');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toContainText('长段提醒：开');

  // 提醒是正交状态：仍保留维持桶色与维持统计，不再冒充未记录。
  await expect(meal).toHaveAttribute('data-b', 'maintain');
  await expect(page.locator('#ruler')).toContainText('维持 4h');
  await expect(page.locator('#ruler')).toContainText('其中待核 4h');
  await expect(page.locator('[data-action="confirm-segment"]')).toHaveCount(1);
  const storedConfig = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.config')));
  expect(storedConfig.longReview).toBe(true);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('[data-action="confirm-segment"]').click();
  await expect(page.locator('#ruler')).not.toContainText('待核');
  const mark = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries
    .find(entry => entry.id === 'long-meal').longConfirm);
  expect(mark).toEqual({ startTs: '2026-06-29T08:00', endTs: '2026-06-29T12:00' });
});

test('v89: per-tag reminder exemptions stay hidden while the global option is off', async ({ page }) => {
  await boot(page, 768, 'one-record', false, FIXED_NOW);
  await page.locator('[data-action="open-more"]').click();
  await page.getByRole('button', { name: '配置标签' }).click();
  await expect(page.locator('.cfg-long:visible')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.locator('[data-action="open-advanced"]').click();
  await expect(page.locator('#form-sheet-title')).toHaveText('高级');
  await page.locator('[data-action="toggle-long-review"]').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('[data-action="open-more"]').click();
  await page.getByRole('button', { name: '配置标签' }).click();
  await expect(page.locator('.cfg-long:visible').first()).toBeVisible();
});

test('v89: imports validate the option but never enable this local preference', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);
  const result = await page.evaluate(async () => {
    const storage = await import(new URL('./src/storage.js', location.href).href);
    const base = { version: 1, mainline: ['求职推进'], chips: [] };
    return {
      importedOn: storage.mergeImportedConfig(base, { ...base, longReview: true }).longReview,
      localOn: storage.mergeImportedConfig({ ...base, longReview: true }, base).longReview,
      normalizedFalseHasKey: Object.hasOwn(storage.normalizeConfig({ ...base, longReview: false }), 'longReview'),
      validBoolean: storage.validateImportData({ entries: [], config: { ...base, longReview: true } }).ok,
      validString: storage.validateImportData({ entries: [], config: { ...base, longReview: 'true' } }).ok
    };
  });
  expect(result).toEqual({
    importedOn: undefined,
    localOn: true,
    normalizedFalseHasKey: false,
    validBoolean: true,
    validString: false
  });
});

// v89 nit：摘要里的「其中时长待核」曾是无条件输出。功能改成默认关闭之后，那行会让
// 每个从没开过它的用户，每份摘要都带一句「其中时长待核：0分钟」——讲一个不存在的状态。
// 判据是「关闭时整行不出现、开启且确有待核时出现」，与既有 io.rowPending 同一写法。
test('v89: the summary omits the pending line entirely while long review is off', async ({ page }) => {
  await stubClipboard(page);
  await boot(page, 768, 'empty', false, FIXED_NOW);
  // 刻意从 00:00 起就有记录：本用例的判据是「待核那一行在不在」，不该混进缺口行的
  // 渲染问题（那条由下面的用例单独锁）。睡觉是 longOk，不会自己变成第二个待核段。
  await page.evaluate(() => {
    localStorage.setItem('timelog.v1', JSON.stringify({
      version: 1,
      entries: [
        { id: 'night', ts: '2026-06-29T00:00', what: '睡觉', tags: ['睡觉'] },
        { id: 'long-meal', ts: '2026-06-29T08:00', what: '吃饭', tags: ['吃饭'] },
        { id: 'work', ts: '2026-06-29T12:00', what: '下午工作', tags: ['求职推进'] }
      ]
    }));
  });
  await page.locator('#view-tabs button[data-view="week"]').click();
  await page.locator('#view-tabs button[data-view="day"]').click();

  const off = await copySummary(page);
  expect(off).toContain('- 未记录：');
  expect(off).not.toContain('时长待核');

  await openAdvancedSheet(page);
  await page.locator('[data-action="toggle-long-review"]').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  const on = await copySummary(page);
  expect(on).toContain('- 其中时长待核：4h');
});

// v89（同批修的既有缺陷，非本次功能引入）：无主未记录段没有条目，`segment.e` 是 null，
// 而 io_actions 的日视图明细直接读 `e.what`——于是任何有前导/中段空白的日子，点「复制
// 当前视图摘要」都会抛 TypeError，剪贴板一个字不写、界面也不报错。v88/main 同样复现。
// 判据刻意包含 pageerror 为空：只断言文本会漏掉「异常抛了但恰好没影响这几个字」的情况。
test('v89: the day summary survives an unrecorded gap instead of throwing', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await stubClipboard(page);
  await boot(page, 768, 'empty', false, FIXED_NOW);
  // 首条记录落在 08:00 → 00:00-08:00 是一段无主未记录缺口（e === null）。
  await seedLongSegment(page);

  const text = await copySummary(page);
  expect(pageErrors).toEqual([]);
  expect(text).toContain('- 00:00 |');
  expect(text).toContain('这一段还没记');
  expect(text).toContain('#未记录');
  // 缺口行之后的真实记录行必须照常输出，别为了不崩把整段吞掉。
  expect(text).toContain('吃饭');
});

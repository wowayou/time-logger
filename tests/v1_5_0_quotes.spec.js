// v1.5.0（D31 显式修订 D11）：格言位置的「文字轮播」。
//
// 用户导入喜欢的书摘或文字，日视图格言位置每天按顺序显示其中一句；单句格言保留，
// 二者在格言设置里二选一。本组用例锁：
// ① 二选一——切到文字轮播并保存才生效；切回单句格言时句库保留、只关轮播；清空保存
//    ＝删除句库、回落单句格言。
// ② 每天一句——只由日期决定（同一天稳定，跨日往下一句，读完回到开头）；日视图以外不显示。
// ③ 拆句规则幂等、导入是追加、GBK 老电子书能读；用户文案只经 textContent（惰性）。
// ④ 完整备份——导出带句库；导入本机优先；形状不对整批拦下。
// ⑤ 启动快照——换了句库的快照不得接回旧句子。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot, openBackupSheet } from './ui_fixture.js';

const DEFAULT_MOTTO = '记录是手段，推进主线才是目的。';

async function openQuotes(page) {
  await page.locator('#motto-line').click();
  await expect(page.locator('#form-sheet-title')).toHaveText('阶段格言');
  await page.locator('[data-action="pick-motto-mode"][data-mode="quote"]').click();
  await expect(page.locator('[data-role="quotes-input"]')).toBeVisible();
}

test('v1.5.0: saving rotating lines puts the first line in the motto spot, keyed by date', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  await expect(page.locator('#motto-line')).toHaveText(DEFAULT_MOTTO);
  await openQuotes(page);
  await page.locator('[data-role="quotes-input"]').fill('第一句。\n第二句。\n第三句。');
  await expect(page.locator('[data-role="quotes-count"]')).toHaveText('共 3 句 · 今天：「第一句。」');
  await page.getByRole('button', { name: '保存阶段格言' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  const line = page.locator('#motto-line');
  await expect(line).toHaveText('第一句。');
  await expect(line).toHaveClass(/is-quote/);
  await expect(line).toHaveAttribute('aria-label', '今日一句（点击设置）：第一句。');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.quotes')));
  expect(stored).toEqual({ version: 1, enabled: true, items: ['第一句。', '第二句。', '第三句。'], anchor: '2026-06-29' });
  // config 一字不动：单句格言留着，随时切回。
  expect(await page.evaluate(() => 'motto' in JSON.parse(localStorage.getItem('timelog.config')))).toBe(false);

  // 跨日往下一句，读完回到开头；日视图以外不显示。
  await page.evaluate(() => window.__setFixedNow('2026-06-30T09:00:00'));
  await page.locator('[data-action="view"][data-view="week"]').click();
  await expect(line).toBeHidden();
  await page.locator('[data-action="view"][data-view="day"]').click();
  await expect(line).toHaveText('第二句。');
  await page.evaluate(() => window.__setFixedNow('2026-07-02T09:00:00'));
  await page.locator('[data-action="view"][data-view="week"]').click();
  await page.locator('[data-action="view"][data-view="day"]').click();
  await expect(line).toHaveText('第一句。');
  expect(errors).toEqual([]);
});

test('v1.5.0: the rotation is a pure function of the date (same day stable, wraps around)', async ({ page }) => {
  await boot(page, 390, 'empty', false, FIXED_NOW);
  const picks = await page.evaluate(async () => {
    const s = await import('/src/storage.js');
    const lib = s.normalizeQuotes({ enabled: true, items: ['a', 'b', 'c'], anchor: '2026-06-29' });
    return ['2026-06-28', '2026-06-29', '2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2027-06-29']
      .map(day => s.quoteForDay(lib, day));
  });
  // 2027-06-29 距起始日 365 天，365 % 3 = 2。
  expect(picks).toEqual(['c', 'a', 'a', 'b', 'c', 'a', 'c']);
});

test('v1.5.0: switching back to the single motto keeps the library but turns rotation off', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  await openQuotes(page);
  await page.locator('[data-role="quotes-input"]').fill('留着的句子。');
  await page.getByRole('button', { name: '保存阶段格言' }).click();
  await expect(page.locator('#motto-line')).toHaveText('留着的句子。');

  await page.locator('#motto-line').click();
  await expect(page.locator('[data-action="pick-motto-mode"][data-mode="quote"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-action="pick-motto-mode"][data-mode="motto"]').click();
  await expect(page.locator('[data-role="quotes-input"]')).toBeHidden();
  await page.getByRole('button', { name: '保存阶段格言' }).click();
  await expect(page.locator('#motto-line')).toHaveText(DEFAULT_MOTTO);
  await expect(page.locator('#motto-line')).not.toHaveClass(/is-quote/);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.quotes')));
  expect(stored.enabled).toBe(false);
  expect(stored.items).toEqual(['留着的句子。']);

  // 再切回来，句子还在框里，不用重新导入。
  await page.locator('#motto-line').click();
  await page.locator('[data-action="pick-motto-mode"][data-mode="quote"]').click();
  await expect(page.locator('[data-role="quotes-input"]')).toHaveValue('留着的句子。');
});

test('v1.5.0: clearing the lines and saving deletes the library and falls back to the motto', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  await openQuotes(page);
  await page.locator('[data-role="quotes-input"]').fill('一句。');
  await page.getByRole('button', { name: '保存阶段格言' }).click();
  await openQuotes(page);
  await page.locator('[data-role="quotes-input"]').fill('');
  await expect(page.locator('[data-role="quotes-count"]')).toHaveText('还没有句子。');
  await page.getByRole('button', { name: '保存阶段格言' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  await expect(page.locator('#motto-line')).toHaveText(DEFAULT_MOTTO);
  expect(await page.evaluate(() => localStorage.getItem('timelog.quotes'))).toBeNull();
});

test('v1.5.0: file import appends split lines, strips Markdown structure and reads GBK text', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  await openQuotes(page);
  await page.locator('[data-role="quotes-input"]').fill('原来就有的一句。');
  // 21 × 5 + 12 = 117 字 > 100：按句末标点切开；收尾引号归入它前面那一句。
  const paragraph = '这一段超过一百个字，所以会按句末标点切开。'.repeat(5) + '最后一句带着引号收尾。」';
  await page.locator('[data-role="quotes-file"]').setInputFiles({
    name: 'book.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(`# 第一章\n\n> 引用里的一句。\n- 列表里的一句\n\n---\n${paragraph}\n\`\`\`\n代码块不算\n\`\`\`\n`, 'utf-8')
  });
  const input = page.locator('[data-role="quotes-input"]');
  await expect(input).toHaveValue([
    '原来就有的一句。',
    '引用里的一句。',
    '列表里的一句',
    ...Array(5).fill('这一段超过一百个字，所以会按句末标点切开。'),
    '最后一句带着引号收尾。」'
  ].join('\n'));
  // GBK 编码的老 .txt：先按 UTF-8 严格解码失败，再按 GB18030 读。
  const gbk = await page.evaluate(() => {
    // 「第二本书。」的 GBK 字节（避免测试依赖 Node 侧的 GBK 编码器）。
    return [181, 218, 182, 254, 177, 190, 202, 233, 161, 163];
  });
  await page.locator('[data-role="quotes-file"]').setInputFiles({ name: 'old.txt', mimeType: 'text/plain', buffer: Buffer.from(gbk) });
  await expect(input).toHaveValue(/\n第二本书。$/);
  // 拆句规则幂等：把框里的结果再拆一次，逐句不变。
  const stable = await page.evaluate(async value => {
    const s = await import('/src/storage.js');
    const once = s.splitQuoteText(value).items;
    return JSON.stringify(once) === JSON.stringify(s.splitQuoteText(once.join('\n')).items);
  }, await input.inputValue());
  expect(stable).toBe(true);
});

test('v1.5.0: quote text renders inert', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  const payload = '<img src=x onerror=window.__pwned=1>';
  await openQuotes(page);
  await page.locator('[data-role="quotes-input"]').fill(payload);
  await page.getByRole('button', { name: '保存阶段格言' }).click();
  await expect(page.locator('#motto-line')).toHaveText(payload);
  expect(await page.locator('#motto-line img').count()).toBe(0);
  await page.locator('#motto-line').click();
  await expect(page.locator('[data-role="quotes-input"]')).toHaveValue(payload);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
});

test('v1.5.0: full backups carry the library; import keeps a local library and rejects a malformed one', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  const result = await page.evaluate(async () => {
    const s = await import('/src/storage.js');
    localStorage.removeItem('timelog.quotes');
    const incoming = { enabled: true, items: ['备份里的一句。'], anchor: '2026-06-01' };
    const adoptIntoEmpty = s.adoptImportedQuotes(incoming);
    const afterAdopt = s.loadQuotes();
    s.saveQuotes({ enabled: false, items: ['本机的一句。'], anchor: '2026-06-20' });
    const keepLocal = s.adoptImportedQuotes(incoming);
    const afterKeep = s.loadQuotes();
    return {
      adoptIntoEmpty, afterAdopt, keepLocal, afterKeep,
      absent: s.adoptImportedQuotes(undefined),
      good: s.validateImportData({ entries: [], quotes: incoming }).ok,
      badItems: s.validateImportData({ entries: [], quotes: { items: [1] } }).ok,
      badShape: s.validateImportData({ entries: [], quotes: ['x'] }).ok,
      badAnchor: s.validateImportData({ entries: [], quotes: { items: ['x'], anchor: 'yesterday' } }).ok
    };
  });
  expect(result.adoptIntoEmpty).toEqual({ ok: true, adopted: true });
  expect(result.afterAdopt).toEqual({ version: 1, enabled: true, items: ['备份里的一句。'], anchor: '2026-06-01' });
  expect(result.keepLocal).toEqual({ ok: true, adopted: false });
  expect(result.afterKeep.items).toEqual(['本机的一句。']);
  expect(result.absent).toEqual({ ok: true, adopted: false });
  expect(result.good).toBe(true);
  expect(result.badItems).toBe(false);
  expect(result.badShape).toBe(false);
  expect(result.badAnchor).toBe(false);

});

test('v1.5.0: the real export path (copy full backup) carries the library', async ({ page }) => {
  await page.addInitScript(() => {
    window.__copiedBackup = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: text => { window.__copiedBackup = text; return Promise.resolve(); } }
    });
  });
  await boot(page, 768, 'one-record', false, FIXED_NOW);
  await openQuotes(page);
  await page.locator('[data-role="quotes-input"]').fill('要带走的一句。');
  await page.getByRole('button', { name: '保存阶段格言' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  await openBackupSheet(page);
  await page.locator('[data-action="copy-json"]').click();
  await expect.poll(() => page.evaluate(() => window.__copiedBackup)).not.toBe('');
  const payload = JSON.parse(await page.evaluate(() => window.__copiedBackup));
  expect(payload.quotes).toEqual({ version: 1, enabled: true, items: ['要带走的一句。'], anchor: '2026-06-29' });
});

test('v1.5.0: a boot snapshot taken with a different quote library is not restored', async ({ page }) => {
  await boot(page, 768, 'one-record', false, FIXED_NOW, null, null, null, '/#boottrace=1');
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  await expect(page.locator('#boottrace-hud')).toContainText('dom-restored → adopted');
  await page.evaluate(() => {
    const snapshot = JSON.parse(sessionStorage.getItem('timelog.bootSnapshot.v1'));
    snapshot.quotesRaw = JSON.stringify({ version: 1, enabled: true, items: ['旧句子'], anchor: '2026-06-29' });
    sessionStorage.setItem('timelog.bootSnapshot.v1', JSON.stringify(snapshot));
  });
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  await expect(page.locator('#boottrace-hud')).toContainText('rejected:data');
  await expect(page.locator('#motto-line')).toHaveText(DEFAULT_MOTTO);
});

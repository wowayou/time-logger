// v1.5.1：v1.5.0 验收（另一台机器）发现的问题 + 真机反馈的文案/入口修正。
//
// ① 句库会被静默清空（中高）：拆句规则号称幂等，实际只剥一层行首记号、且先判断代码块
//    再剥记号——`> ```` 第一次保存回填成 ```，第二次保存就被当成代码块开头吞掉后文，句库
//    为空时整键删除。锁：嵌套记号一次剥净、落单的 ``` 不吞后文、v1.5.0 存下的坏句加载时
//    逐句清掉、「什么都不改点完成」句库一字不变、有字但拆不出句子时拦下而不是删除。
// ② 句库保存加 CAS：另一标签页改过就拦下，不让后保存的静默覆盖。
// ③ 轮播进度（维护者裁定「接着今天这一句」）：追加/改错字不打回第一句，整本替换才从头。
// ④ 区间滚轮：「–」比「:」宽（v1.5.0 的 nth-of-type 命中了错误的分隔符）。
// ⑤ 「时间拨号盘」→「时间分析」、「接通」→「复制本期摘要」；默认标签入口缺了才出现；
//    说明补上时间分析与格言/文字轮播。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot } from './ui_fixture.js';

const TODAY = '2026-06-29';

async function seedQuotes(page, lib) {
  await page.evaluate(value => localStorage.setItem('timelog.quotes', JSON.stringify(value)), lib);
  // 句库在独立键里，改完切一次视图让日视图重渲格言位置。
  await page.locator('[data-action="view"][data-view="week"]').click();
  await page.locator('[data-action="view"][data-view="day"]').click();
}

async function openQuotesSheet(page) {
  await page.locator('#motto-line').click();
  await expect(page.locator('#form-sheet-title')).toHaveText('阶段格言');
  const quoteMode = page.locator('[data-action="pick-motto-mode"][data-mode="quote"]');
  if (await quoteMode.getAttribute('aria-pressed') !== 'true') await quoteMode.click();
  await expect(page.locator('[data-role="quotes-input"]')).toBeVisible();
}

const saveMotto = page => page.getByRole('button', { name: '保存阶段格言' }).click();
const storedQuotes = page => page.evaluate(() => JSON.parse(localStorage.getItem('timelog.quotes')));

test('v1.5.1 ①: a library stored by v1.5.0 with a bare ``` line survives "open settings, change nothing, Done"', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  // 验收方的复现：预置 4 句、第一句是 ```（v1.5.0 把 `> ```` 回填成的样子）。
  await seedQuotes(page, { version: 1, enabled: true, items: ['```', '第二句。', '第三句。', '第四句。'], anchor: TODAY });
  await openQuotesSheet(page);
  // 坏句在加载时就逐句清掉了，文本框里不会再出现一个会吞掉后文的 ```。
  await expect(page.locator('[data-role="quotes-input"]')).toHaveValue('第二句。\n第三句。\n第四句。');
  await saveMotto(page);
  await expect(page.locator('#form-sheet')).toBeHidden();
  const stored = await storedQuotes(page);
  expect(stored).not.toBeNull();
  expect(stored.items).toEqual(['第二句。', '第三句。', '第四句。']);
  expect(stored.enabled).toBe(true);
  expect(errors).toEqual([]);
});

test('v1.5.1 ①: nested quote/list markers and a stray fence round-trip unchanged across repeated saves', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  await openQuotesSheet(page);
  await page.locator('[data-role="quotes-input"]').fill('> ```\n一句。\n> # 标题\n> ---\n- - 双层\n1. - 混合\n> - 1. 深嵌套');
  await expect(page.locator('[data-role="quotes-count"]')).toContainText('共 4 句');
  await saveMotto(page);
  const first = await storedQuotes(page);
  expect(first.items).toEqual(['一句。', '双层', '混合', '深嵌套']);
  for (let round = 0; round < 3; round++) {
    await openQuotesSheet(page);
    await expect(page.locator('[data-role="quotes-input"]')).toHaveValue(first.items.join('\n'));
    await saveMotto(page);
    expect(await storedQuotes(page)).toEqual(first);
  }
});

test('v1.5.1 ①: text that yields no usable line is refused, never treated as "delete the library"', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  await seedQuotes(page, { version: 1, enabled: true, items: ['留着的一句。'], anchor: TODAY });
  await openQuotesSheet(page);
  await page.locator('[data-role="quotes-input"]').fill('# 只有标题\n---\n```\n代码\n```');
  await expect(page.locator('[data-role="quotes-count"]')).toContainText('没有可用的句子');
  await saveMotto(page);
  await expect(page.locator('[data-role="motto-error"]')).toBeVisible();
  await expect(page.locator('[data-role="motto-error"]')).toContainText('没有可用的句子');
  await expect(page.locator('#form-sheet')).toBeVisible();
  expect((await storedQuotes(page)).items).toEqual(['留着的一句。']);
});

test('v1.5.1 ②: saving is refused when another tab changed the library while the sheet was open', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  await seedQuotes(page, { version: 1, enabled: true, items: ['本页看到的一句。'], anchor: TODAY });
  await openQuotesSheet(page);
  // 模拟另一个标签页在 sheet 打开期间写入句库。
  await page.evaluate(() => localStorage.setItem('timelog.quotes', JSON.stringify({ version: 1, enabled: true, items: ['另一个标签页的一句。'], anchor: '2026-06-29' })));
  await page.locator('[data-role="quotes-input"]').fill('本页想存的一句。');
  await saveMotto(page);
  await expect(page.locator('[data-role="motto-error"]')).toContainText('另一个标签页');
  expect((await storedQuotes(page)).items).toEqual(['另一个标签页的一句。']);
});

test('v1.5.1 ③: editing the library keeps reading from today\'s line; only a full replacement starts over', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  // 起始日在前天 → 今天轮到第 3 句 c。
  await seedQuotes(page, { version: 1, enabled: true, items: ['a 句', 'b 句', 'c 句', 'd 句'], anchor: '2026-06-27' });
  const line = page.locator('#motto-line');
  await expect(line).toHaveText('c 句');

  // 追加第二本书：接着 c。
  await openQuotesSheet(page);
  await page.locator('[data-role="quotes-input"]').fill('a 句\nb 句\nc 句\nd 句\ne 句\nf 句');
  await expect(page.locator('[data-role="quotes-count"]')).toHaveText('共 6 句 · 今天：「c 句」');
  await saveMotto(page);
  await expect(line).toHaveText('c 句');

  // 删掉前面几句：今天这句还在，仍是 c。
  await openQuotesSheet(page);
  await page.locator('[data-role="quotes-input"]').fill('c 句\nd 句\ne 句\nf 句');
  await saveMotto(page);
  await expect(line).toHaveText('c 句');

  // 改今天这句的错字：停在同一个序号上，显示改好的那句。
  await openQuotesSheet(page);
  await page.locator('[data-role="quotes-input"]').fill('C 句（改过）\nd 句\ne 句\nf 句');
  await saveMotto(page);
  await expect(line).toHaveText('C 句（改过）');

  // 整本换掉（新旧毫无交集）：从第一句开始。
  await openQuotesSheet(page);
  await page.locator('[data-role="quotes-input"]').fill('新书第一句\n新书第二句');
  await saveMotto(page);
  await expect(line).toHaveText('新书第一句');
});

test('v1.5.1 ④: the start–end dash is wider than the hour:minute colons', async ({ page }) => {
  await boot(page, 390, 'interval-three', false, '2026-06-29T20:00:30');
  await page.locator('.entry[data-id="focus"] .e-what').click();
  await page.getByRole('button', { name: '在这条记录内部切一刀' }).click();
  const pads = await page.locator('#form-sheet .range-wheel .wheel-sep').evaluateAll(seps =>
    seps.map(sep => ({ text: sep.textContent, left: getComputedStyle(sep).paddingLeft })));
  expect(pads).toEqual([
    { text: ':', left: '1px' },
    { text: '–', left: '6px' },
    { text: ':', left: '1px' }
  ]);
});

test('v1.5.1 ⑤: the analytics page is called 时间分析 and its copy key says what it does', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  await page.locator('[data-action="open-more"]').click();
  await expect(page.locator('[data-action="open-analytics"] [data-role="cell-label"]')).toHaveText('时间分析');
  await page.locator('[data-action="open-analytics"]').click();
  await expect(page.locator('#form-sheet-title')).toHaveText('时间分析');
  await expect(page.locator('[data-role="an-call-label"]')).toHaveText('复制本期摘要');
  await expect(page.locator('#form-sheet')).not.toContainText('拨号盘');
  await expect(page.locator('#form-sheet')).not.toContainText('接通');
});

test('v1.5.1 ⑤: the default-tag entry only appears when defaults are missing, and names them', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  const zhDefaults = [
    ['睡觉', 'maintain', true], ['吃饭', 'maintain', false], ['洗漱', 'maintain', false], ['通勤', 'maintain', false],
    ['家务', 'maintain', false], ['运动健康', 'maintain', false], ['娱乐', 'leak', false], ['刷手机', 'leak', false], ['发呆', 'leak', false]
  ].map(([name, bucket, longOk]) => ({ name, bucket, longOk }));
  // 从「更多」下钻进标签设置；取消会回到「更多」（下钻返回栈），所以只开一次「更多」。
  await page.locator('[data-action="open-more"]').click();
  const openConfig = async () => {
    await page.getByRole('button', { name: '配置标签' }).click();
    await expect(page.locator('#form-sheet-title')).toHaveText('标签高级设置');
  };
  const closeConfig = async () => {
    await page.getByRole('button', { name: '取消配置' }).click();
    await expect(page.locator('#form-sheet-title')).toHaveText('更多');
  };

  await page.evaluate(chips => localStorage.setItem('timelog.config', JSON.stringify({ version: 1, mainline: ['求职推进'], chips })), zhDefaults);
  await openConfig();
  await expect(page.locator('[data-action="preview-locale-defaults"]')).toHaveCount(0);
  await closeConfig();

  await page.evaluate(chips => localStorage.setItem('timelog.config', JSON.stringify({ version: 1, mainline: ['求职推进'], chips })),
    zhDefaults.filter(chip => !['吃饭', '洗漱'].includes(chip.name)));
  await openConfig();
  await expect(page.locator('[data-action="preview-locale-defaults"] [data-role="cell-label"]')).toHaveText('补回默认标签（2 个：吃饭、洗漱）');
  await closeConfig();

  await page.evaluate(chips => localStorage.setItem('timelog.config', JSON.stringify({ version: 1, mainline: ['求职推进'], chips })),
    zhDefaults.filter(chip => chip.bucket === 'leak'));
  await openConfig();
  await expect(page.locator('[data-action="preview-locale-defaults"] [data-role="cell-label"]')).toHaveText('补回默认标签（6 个：睡觉、吃饭、洗漱…）');
  await page.locator('[data-action="preview-locale-defaults"]').click();
  await expect(page.locator('[data-role="defaults-additions"]')).toContainText('将新增 6 个');
});

test('v1.5.1 ⑤: help explains time analysis and the motto / rotating lines', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  await page.locator('[data-action="open-more"]').click();
  await page.locator('[data-action="open-help"]').click();
  const help = page.locator('.help-body');
  await expect(help.locator('h2', { hasText: '时间分析' })).toBeVisible();
  await expect(help.locator('h2', { hasText: '格言与文字轮播' })).toBeVisible();
  await expect(help).toContainText('接着今天这一句往下读');
  await expect(help).toContainText('一键改选');
});

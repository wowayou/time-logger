// v87：2026-08-10 全量审计（起因是维护者的「0808-0809 这么大段的一个记录为啥没让我
// 确认呢？」）查出的四条数据可信度缺陷。四条都先在真实备份 / 真实页面上复现过，
// 再落成用例；每条都配了 P35 红灯（把修复摘掉必须变红），见 CLAUDE.md 的 CHANGELOG。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot } from './ui_fixture.js';

function entryRows(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries
    .map(e => `${e.ts} ${e.what || '∅'}`)
    .sort());
}

// 把数据直接种进 localStorage 之后，用**真实导航**触发重渲染。不能用 page.reload()：
// boot 的 addInitScript 会在每次导航时重跑，把刚种的数据清掉再按 state 重播种。
async function seedAndRerender(page, entries, backDays) {
  await page.evaluate(seed => {
    localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries: seed }));
  }, entries);
  for (let i = 0; i < backDays; i += 1) {
    await page.locator('[data-action="shift-period"][data-delta="-1"]').click();
  }
}

// ── ① 起点晚于尾占位点：那段「确实没记」不得被吞进前一条记录 ──────────────────
// 种子 tail-placeholder：09:00「写代码」#求职推进 + 10:00 空占位条，FIXED_NOW 12:34。
// 修复前：占位条被挪到 11:00，09:00-11:00 整段变成「写代码·主线」——两小时未记录
// 凭空成了主线时长（D13 硬约束③：不得悄悄修改原始时间线）。
test('v87: a start later than the tail placeholder keeps the gap unrecorded', async ({ page }) => {
  await boot(page, 768, 'tail-placeholder', false, FIXED_NOW);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.locator('[data-action="toggle-start-time"]').click();
  const startSection = page.locator('[data-role="start-time-section"]');
  await startSection.locator('[data-role="text"]').fill('2026-06-29 11:00');
  await startSection.locator('[data-role="text"]').blur();
  await page.locator('#form-what').fill('吃饭');
  await page.locator('#form-ctag').fill('吃饭');
  await page.locator('[data-action="save-entry"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();

  const rows = await entryRows(page);
  // 10:00 的占位条必须还在：它代表 10:00-11:00 这一小时确实没记。
  expect(rows).toContain('2026-06-29T10:00 ∅');
  expect(rows).toContain('2026-06-29T11:00 吃饭');
  // 前一条记录不得被拉长：写代码仍止于 10:00，主线时长不被夸大。
  const hero = await page.locator('#ruler').textContent();
  expect(hero.replace(/\s+/g, ' ')).toContain('主线 1h');
});

// 反向哨兵（修复前后都必须绿）：起点**早于**占位点时，占位条仍然被复用——那是
// 「续记」的正常语义（新记录把它整个盖住，前一条相应截短），不能连这个一起改坏。
test('v87: a start earlier than the tail placeholder still consumes it', async ({ page }) => {
  await boot(page, 768, 'tail-placeholder', false, FIXED_NOW);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.locator('[data-action="toggle-start-time"]').click();
  const startSection = page.locator('[data-role="start-time-section"]');
  await startSection.locator('[data-role="text"]').fill('2026-06-29 09:30');
  await startSection.locator('[data-role="text"]').blur();
  await page.locator('#form-what').fill('吃饭');
  await page.locator('#form-ctag').fill('吃饭');
  await page.locator('[data-action="save-entry"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();

  const rows = await entryRows(page);
  expect(rows).not.toContain('2026-06-29T10:00 ∅');
  expect(rows).toContain('2026-06-29T09:30 吃饭');
});

// ── ② 过夜续记不再「写入即确认」 ─────────────────────────────────────────────
// v67/C7A 的前提「两端都是用户显式断言」是假的：表单里能改的只有起点。修复前，
// 00:00-12:34（12h34m）这一段带着自动写上的 longConfirm 落库，界面从不问一句。
test('v87: an overnight continuation leaves the long part pending, with a working 确认', async ({ page }) => {
  await boot(page, 768, 'yesterday-placeholder', false, FIXED_NOW, -1);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.locator('#form-what').fill('回家整理');
  await page.locator('#form-ctag').fill('洗漱');
  await page.locator('[data-action="save-entry"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();

  const marks = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries
    .filter(e => e.longConfirm).map(e => e.ts));
  expect(marks).toEqual([]);

  const confirmBtn = page.locator('[data-action="confirm-segment"]');
  await expect(confirmBtn).toHaveCount(1);
  await expect(page.locator('#ruler')).toContainText('待确认');
  // 按钮必须真的确认得掉（不是摆设）。
  await confirmBtn.click();
  await expect(page.locator('[data-action="confirm-segment"]')).toHaveCount(0);
  await expect(page.locator('#ruler')).not.toContainText('待确认');
});

// ── ③ 空日不继承前一天最后一个标签 ───────────────────────────────────────────
// 连着几天没打开 app（中间一条占位条都没有）时，旧代码把上一条记录一路铺到几天后的
// 右邻：那些空日各被填满 24h，还各挂一颗「确认 22:00-09:00」（起止来自相隔数日的
// 两天）。CLAUDE.md 明文写着「空日不继承前一天最后标签」。
test('v87: days with no records of their own inherit nothing', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);
  await seedAndRerender(page, [
    { id: 'a', ts: '2026-06-25T22:00', what: '刷B站', tags: ['刷手机'] },
    { id: 'b', ts: '2026-06-28T09:00', what: '回来了', tags: ['求职推进'] }
  ], 3);
  await expect(page.locator('#period-label')).toContainText('2026/06/26');

  await expect(page.locator('#timeline .entry')).toHaveCount(0);
  await expect(page.locator('[data-action="confirm-segment"]')).toHaveCount(0);
  await expect(page.locator('#ruler')).toContainText('这一天还没有记录');

  // 起点那天照常显示自己的段，且止于 24:00。
  await page.locator('[data-action="shift-period"][data-delta="-1"]').click();
  await expect(page.locator('#period-label')).toContainText('2026/06/25');
  await expect(page.locator('#timeline .entry').filter({ hasText: '刷B站' })).toHaveCount(1);
  // 真正跨一次午夜的过夜段不受影响：06-28 的 09:00 之前没有更早的右邻可继承，
  // 但 06-25 22:00 起的这一段自己只算到 24:00（2h，未过 3h 阈值，不待确认）。
  await expect(page.locator('#ruler')).not.toContainText('待确认');
});

// ── ⑤ 年视图不再对每个片段重新解析一遍 config ────────────────────────────────
// 判据刻意选**结构性**的「读了几次 timelog.config」而不是耗时——耗时判据在并行跑的
// CI 里天生抖（stress.spec 的 boot ratio 就常年 flaky）。修复前 stats.js 每个片段问
// 三次桶（classifySegment 两次 + addBucket 一次），每次都重新 getItem + JSON.parse +
// normalizeConfig：633 条真实数据的一次年视图 summarize 实测 1994 次。
test('v87: a year-view render reads the tag config a handful of times, not per segment', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);
  const seed = [];
  for (let day = 0; day < 120; day += 1) {
    for (let i = 0; i < 5; i += 1) {
      const d = new Date(2026, 0, 1 + day, 6 + i * 3, 0);
      const ts = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        + `T${String(d.getHours()).padStart(2, '0')}:00`;
      seed.push({ id: `s${day}-${i}`, ts, what: '压测', tags: [i % 2 ? '睡觉' : '求职推进'] });
    }
  }
  await page.evaluate(entries => {
    localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries }));
    window.__cfgReads = 0;
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'timelog.config') window.__cfgReads += 1;
      return orig.call(this, key);
    };
  }, seed);

  await page.locator('#view-tabs button[data-view="year"]').click();
  await expect(page.locator('.summary-list')).toBeVisible();
  const reads = await page.evaluate(() => window.__cfgReads);
  expect(reads, `year-view render re-parsed timelog.config ${reads} times`).toBeLessThan(50);
});

// ── ④ 段内坐着一条计划时，「确认」必须点得动 ──────────────────────────────────
// 渲染侧用 loggedEntriesFrom（不含计划），确认侧原本用 sortedEntriesFrom（含计划）：
// 两边算出的右邻不同 → endTs 对不上 → 永远 stale，按钮怎么点都只弹「这一段已经变了」。
test('v87: a plan sitting inside a long segment does not break its 确认', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);
  await seedAndRerender(page, [
    { id: 'a', ts: '2026-06-28T08:00', what: '吃了很久', tags: ['吃饭'] },
    { id: 'p', ts: '2026-06-28T10:00', what: '面试', tags: ['求职推进'], planned: true },
    { id: 'b', ts: '2026-06-28T13:00', what: '干活', tags: ['求职推进'] },
    // 收尾用 longOk 的睡觉，免得当天的**尾段**自己也变成待确认，把判据搅浑。
    { id: 'c', ts: '2026-06-28T14:00', what: '睡了', tags: ['睡觉'] }
  ], 1);
  await expect(page.locator('#period-label')).toContainText('2026/06/28');
  await expect(page.locator('#ruler')).toContainText('待确认');

  const confirmBtn = page.locator('[data-action="confirm-segment"]');
  await expect(confirmBtn).toHaveCount(1);
  await confirmBtn.click();
  await expect(page.locator('[data-action="confirm-segment"]')).toHaveCount(0);
  await expect(page.locator('#ruler')).not.toContainText('待确认');
  const marks = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries
    .filter(e => e.longConfirm).map(e => `${e.ts}..${e.longConfirm.endTs}`));
  expect(marks).toEqual(['2026-06-28T08:00..2026-06-28T13:00']);
});

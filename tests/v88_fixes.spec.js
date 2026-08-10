// v88：v87 审计里登记但当时没修的四条（都不是阻断级，攒成一批）。
// 每条都先在 node / 真实页面上复现过，再落用例；红灯清单见 CLAUDE.md 的 CHANGELOG。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot, openAdvancedSheet } from './ui_fixture.js';

async function seedAndRerender(page, entries) {
  await page.evaluate(seed => {
    localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries: seed }));
  }, entries);
  // 用真实导航触发重渲染（reload 会让 addInitScript 重新清空并按 state 重播种）。
  await page.locator('[data-action="shift-period"][data-delta="-1"]').click();
  await page.locator('[data-action="shift-period"][data-delta="1"]').click();
}

// ── ① 「标记已发生」不得把记录挪进第二天 ────────────────────────────────────
// 旧代码无条件 `+1min` 躲同刻冲突：now 落在 23:59 且那一分钟已被占用时，记录静默
// 落到次日 00:00——改变的是「这件事发生在哪一天」。
test('v88: confirming a plan never pushes the entry across midnight', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);
  await page.evaluate(() => window.__setFixedNow('2026-06-29T23:59:00'));
  await seedAndRerender(page, [
    { id: 'taken', ts: '2026-06-29T23:59', what: '已经占着这一分钟', tags: ['求职推进'] },
    { id: 'free-58', ts: '2026-06-29T23:57', what: '更早的一条', tags: ['求职推进'] },
    { id: 'plan', ts: '2026-06-29T23:59', what: '要标记已发生的计划', tags: ['求职推进'], planned: true }
  ]);

  await page.locator('[data-action="confirm-planned"]').click();
  const confirmed = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1'))
    .entries.find(e => e.id === 'plan'));
  expect(confirmed.planned).toBeUndefined();
  expect(confirmed.ts.slice(0, 10), '标记已发生不得改变它发生在哪一天').toBe('2026-06-29');
  expect(confirmed.ts).toBe('2026-06-29T23:58');
  // 同刻唯一仍然成立
  const stamps = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.map(e => e.ts));
  expect(new Set(stamps).size).toBe(stamps.length);
});

// ── ② 计划保存也要走 normalizeEntries（今天恒有尾占位） ──────────────────────
// 计划保存此前是唯一不过 normalizeEntries 的表单写入路径，于是「今天最后一条是真实
// 记录」时占位条补不回来，FAB 从「续 12:34 起」退化成「补记 00:06 起」。
test('v88: saving a plan still restores today’s tail placeholder', async ({ page }) => {
  await boot(page, 768, 'one-record', false, FIXED_NOW);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.locator('[data-action="pick-record-mode"][data-mode="plan"]').click();
  await page.locator('#form-what').fill('准备面试');
  await page.locator('[data-action="save-entry"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();

  const tail = await page.evaluate(() => {
    const logged = JSON.parse(localStorage.getItem('timelog.v1')).entries
      .filter(e => !e.planned && e.ts.slice(0, 10) === '2026-06-29')
      .sort((a, b) => (a.ts < b.ts ? -1 : 1));
    const last = logged[logged.length - 1];
    return { ts: last.ts, isPlaceholder: last.what.trim() === '' };
  });
  expect(tail).toEqual({ ts: '2026-06-29T12:34', isPlaceholder: true });
  await expect(page.locator('#add-btn .fab-sub')).toContainText('12:34');
});

// ── ③ 计划不得与占位条并存在同一时刻 ────────────────────────────────────────
// 计划分支是 push 一条新记录、从不复用占位条，所以也不能把占位条从冲突检测里排除。
// 「同刻唯一」是 findTimeConflict / 导入的 byTime 映射 / duplicateTimestamp 共同的前提。
test('v88: a plan landing on the tail placeholder minute is blocked, not duplicated', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);
  await seedAndRerender(page, [
    { id: 'morning', ts: '2026-06-29T00:05', what: '早间', tags: ['求职推进'] },
    { id: 'open', ts: '2026-06-29T12:45', what: '', tags: [] }
  ]);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.locator('[data-action="pick-record-mode"][data-mode="plan"]').click();
  await page.locator('#form-ts').evaluate(el => {
    el.value = '2026-06-29T12:45';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#form-what').fill('撞上占位条的计划');
  await page.locator('[data-action="save-entry"]').click();

  await expect(page.locator('[data-role="conflict-error"]')).toBeVisible();
  await expect(page.locator('#form-sheet')).toBeVisible();
  const stamps = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.map(e => e.ts));
  expect(new Set(stamps).size, '同一时刻不得并存两条').toBe(stamps.length);
  expect(stamps).not.toContain(undefined);
});

// ── ④ 「修复更新通道」的探活必须绕开自己的 SW 缓存 ──────────────────────────
// `sw.js` 在 FILES 里，fetch 处理器是 cache-first，所以 `fetch('sw.js')` 断网时照样
// 返回 200（实测离线下 ok=true）。守卫失效的后果不是没提示：它会让离线用户在这里
// unregister 掉 SW 再 reload，而那次 reload 已经没有离线兜底了。
test('v88: the update-channel probe bypasses the app’s own cache', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);
  const probes = [];
  await page.route('**/sw.js*', async route => {
    probes.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '// probe' });
  });
  await openAdvancedSheet(page);
  const repair = page.locator('[data-action="repair-update-channel"]');
  await repair.click();                       // 第一次点击只是武装
  await expect(repair).toContainText('再次点击确认修复');
  await repair.click();                       // 第二次才真的探活
  await expect.poll(() => probes.length).toBeGreaterThan(0);
  expect(probes[0], 'cache-first 的 SW 会命中 ./sw.js，必须带查询串才落到真实网络').toContain('sw.js?probe=');
});

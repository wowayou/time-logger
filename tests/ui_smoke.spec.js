import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { FIXED_NOW, STATES, VIEWPORTS, boot, expectNoHorizontalOverflow, openBackupMenu } from './ui_fixture.js';

async function setFormTimestamp(page, selector, value) {
  await page.locator(selector).evaluate((input, next) => {
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function setPlannedEditTimestamp(page, value) {
  const input = page.locator('[data-role="edit-wheel"] [data-role="text"]');
  await input.fill(value.replace('T', ' '));
  await input.evaluate(element => element.dispatchEvent(new Event('change', { bubbles: true })));
}

async function selectSleepTag(page) {
  await page.locator('[data-action="pick-form-bucket"][data-bucket="maintain"]').click();
  await page.getByRole('button', { name: '选择标签：睡觉' }).click();
}

for (const width of VIEWPORTS) {
  for (const state of STATES) {
    test(`no horizontal overflow at ${width}px with ${state}`, async ({ page }) => {
      await boot(page, width, state);
      await expectNoHorizontalOverflow(page);
      await page.getByRole('button', { name: '周视图' }).click();
      await expect(page.locator('#period-label')).toHaveAttribute('aria-label', /周/);
      await expectNoHorizontalOverflow(page);
      if (state === 'yesterday-residual') {
        await page.getByRole('button', { name: '天视图' }).click();
        await expect(page.locator('#ruler')).toContainText('这一天还没有记录');
      }
    });
  }
}

for (const share of [false, true]) {
  test(`more sheet keeps layout and always shows the send button (share ${share ? 'present' : 'absent'})`, async ({ page }) => {
    await boot(page, 320, 'one-record', share);
    await openBackupMenu(page);
    // v43: 分享按钮常显——不再随 Web Share 能力显隐（旧 reveal 时序在 footer→更多
    // 迁移后丢失，iOS 卡隐藏态，P24）；无能力时点击回退下载。两种能力状态下都在。
    await expect(page.locator('#backup-send-btn')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    // P21: every visible cell row must sit fully inside its own cell-group —
    // the group must never clip a trailing row (更多菜单「分享备份」被拦腰裁半).
    const clipped = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.more-body .cell-group').forEach(group => {
        const g = group.getBoundingClientRect();
        group.querySelectorAll(':scope > *').forEach(row => {
          if (row.hidden) return;
          const r = row.getBoundingClientRect();
          if (r.bottom > g.bottom + 1 || r.top < g.top - 1) out.push(row.textContent.trim().slice(0, 12));
        });
      });
      return out;
    });
    expect(clipped).toEqual([]);
  });
}

test('mobile more sheet follows the grabber: short pulls rebound and long pulls dismiss', async ({ page }) => {
  await boot(page, 375, 'one-record', false, FIXED_NOW);
  await openBackupMenu(page);
  const grabberBox = await page.locator('.sh-grab').boundingBox();
  expect(grabberBox.height).toBeGreaterThanOrEqual(44);
  const dragGrabber = async distance => {
    await page.evaluate(({ box, dy }) => {
      const grabber = document.elementFromPoint(box.x + box.width / 2, box.y + box.height - 6);
      if (!grabber) throw new Error('expanded grabber hit target is missing');
      const fire = (type, y) => grabber.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 17,
        pointerType: 'touch',
        clientX: 180,
        clientY: y
      }));
      const startY = box.y + box.height - 6;
      fire('pointerdown', startY);
      fire('pointermove', startY + dy);
      fire('pointerup', startY + dy);
    }, { box: grabberBox, dy: distance });
  };

  await dragGrabber(30);
  await expect(page.locator('#form-sheet')).toBeVisible();
  await expect(page.locator('.form-sheet-panel')).toHaveAttribute('data-mode', 'more');
  await dragGrabber(100);
  await expect(page.locator('#form-sheet')).toBeHidden();
});

test('375px header hides title without overflowing', async ({ page }) => {
  await boot(page, 375, 'one-record');
  await expect(page.locator('.hdr-title')).toBeHidden();
  await expect(page.locator('#usage-day')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

// v61：里程碑改从数据派生。安装日只做诊断，不再上 header——所以导入更早的历史
// 现在**应该**把「记录历程」拉长，这与 v60 之前「不倒拨」的旧语义正好相反。
test('milestones derive from records, not from the local install date', async ({ page }) => {
  await boot(page, 375, 'yesterday-residual', false, FIXED_NOW);
  // 只有 06-28T23:00 一条真实记录（今天的尾占位不算）：历程 06-28→06-29 = 2 天。
  await expect(page.locator('#usage-day')).toHaveText('记录历程第 2 天 · 已记录 1 天');
  // 安装日仍写入备查，但不再驱动任何用户可见文案。
  expect(await page.evaluate(() => localStorage.getItem('timelog.firstUsedDate'))).toBe('2026-06-28');

  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    data.entries.push({ id: 'imported-old', ts: '2026-05-01T08:00', what: '更早历史', tags: ['求职推进'] });
    localStorage.setItem('timelog.v1', JSON.stringify(data));
  });
  await page.getByRole('button', { name: '周视图' }).click();
  // 最早真实记录退到 05-01：历程按数据拉长到 60 天，已记录 +1（多了 05-01 这天）。
  await expect(page.locator('#usage-day')).toHaveText('记录历程第 60 天 · 已记录 2 天');
  expect(await page.evaluate(() => localStorage.getItem('timelog.firstUsedDate'))).toBe('2026-06-28');
});

test('milestones ignore planned entries and empty placeholders', async ({ page }) => {
  await boot(page, 375, 'empty', false, FIXED_NOW);
  // 空数据：不编造里程碑。
  await expect(page.locator('#usage-day')).toBeHidden();

  await page.evaluate(() => {
    localStorage.setItem('timelog.v1', JSON.stringify({
      entries: [
        // 空占位＝「这段没记」，不算记过。
        { id: 'ph', ts: '2026-06-20T08:00', what: '', tags: [] },
        // 计划＝未来意图，不算记过。
        { id: 'plan', ts: '2026-06-21T08:00', what: '未来计划', tags: ['求职推进'], planned: true },
        { id: 'real', ts: '2026-06-27T08:00', what: '真实记录', tags: ['求职推进'] }
      ]
    }));
  });
  // 不能 reload：fixture 走 addInitScript，每次导航都会把数据重写回 empty。
  await page.getByRole('button', { name: '周视图' }).click();
  // 只有 06-27 那条算数：历程 06-27→06-29 = 3 天，已记录 1 天。
  await expect(page.locator('#usage-day')).toHaveText('记录历程第 3 天 · 已记录 1 天');
});

test('回到今天 only appears after leaving today, with a persistent 今天 badge while on it (R5)', async ({ page }) => {
  await boot(page, 500, 'one-record', false, FIXED_NOW);
  // FIXED_NOW = 2026-06-29T12:34:30 → boots on today; button hidden, badge shown.
  await expect(page.locator('#today-btn')).toBeHidden();
  await expect(page.locator('.period-today-badge')).toHaveText('今天');
  await expectNoHorizontalOverflow(page);

  // While on today, the button is hidden — the date-nav grid must collapse to 3
  // explicit columns, not leave its 4th (76px+) track reserved as dead space
  // (explicit grid tracks otherwise stay reserved even when their item is
  // display:none — R5's .date-nav:has(#today-btn[hidden]) fix).
  const colsWhileHidden = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.date-nav')).gridTemplateColumns.split(' ').length);
  expect(colsWhileHidden).toBe(3);

  // Leaving today (shift to yesterday) reveals the button, drops the badge, and
  // the grid regains its 4th column now that there's a real item for it.
  await page.locator('[data-action="shift-period"][data-delta="-1"]').click();
  await expect(page.locator('#today-btn')).toBeVisible();
  await expect(page.locator('.period-today-badge')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  const colsWhileVisible = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.date-nav')).gridTemplateColumns.split(' ').length);
  expect(colsWhileVisible).toBe(4);

  // 回到今天 returns to today and restores the collapsed/badge state.
  await page.locator('#today-btn').click();
  await expect(page.locator('#today-btn')).toBeHidden();
  await expect(page.locator('.period-today-badge')).toHaveText('今天');
});

test('回到本周/本月/本年 stay hidden while the current period still contains today', async ({ page }) => {
  await boot(page, 500, 'empty', false, FIXED_NOW);
  for (const tab of ['周视图', '月视图', '年视图']) {
    await page.getByRole('button', { name: tab }).click();
    await expect(page.locator('#today-btn')).toBeHidden();
    await page.locator('[data-action="shift-period"][data-delta="-1"]').click();
    await expect(page.locator('#today-btn')).toBeVisible();
    await page.locator('#today-btn').click();
    await expect(page.locator('#today-btn')).toBeHidden();
  }
});

test('new entry shows continuation context and recomputes start', async ({ page }) => {
  await boot(page, 768, 'tail-placeholder', false, FIXED_NOW);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  const panel = page.locator('.form-sheet-panel');
  await expect(panel).toBeFocused();
  await expect(page.locator('[data-role="start-time-label"]')).toHaveText('10:00');
  await expect(page.locator('[data-role="duration-label"]')).not.toBeEmpty();
  // v47 R6：记录卡不再有常驻图标按钮；tooltip 不自动显示的不变量改测一个仍带
  // data-tip 的按钮（header「···」）——无 hover 时自定义 tooltip 的 ::after 应隐藏。
  const tooltipVisibility = await page.locator('[data-action="open-more"]').first()
    .evaluate(btn => getComputedStyle(btn, '::after').visibility);
  expect(tooltipVisibility).toBe('hidden');

  await page.locator('[data-action="toggle-start-time"]').click();
  await expect(page.locator('[data-role="form-wheel-mount"]').first()).toBeVisible();
  await expect(page.locator('[data-role="text"]').first()).toBeVisible();

  await page.locator('[data-role="text"]').fill('2026-06-29 09:30');
  await page.locator('[data-role="text"]').blur();
  await expect(page.locator('[data-role="start-time-label"]')).toHaveText('09:30');
});

test('past-day continuation settles at day end and restores selected date', async ({ page }) => {
  await boot(page, 768, 'yesterday-residual', false, FIXED_NOW, -1);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();

  await expect(page.locator('#form-sheet-title')).toHaveText('补记 · 6月28日');
  await expect(page.locator('.form-sheet-what')).toHaveText('写下这一段做了什么');
  await expect(page.locator('[data-role="start-time-label"]')).toHaveText('23:00');
  await expect(page.locator('[data-role="end-label"]')).toHaveText('24:00');
  await expect(page.locator('[data-role="duration-label"]')).toHaveText('~1h');
});

test('continuation save fills tail placeholder and opens unrecorded segment', async ({ page }) => {
  await boot(page, 768, 'tail-placeholder', false, FIXED_NOW);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.locator('#form-what').fill('写方案');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  await page.getByRole('button', { name: '保存时间记录' }).click();

  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  const completed = entries.find(entry => entry.id === 'today-open');
  const opened = entries.find(entry => entry.ts === '2026-06-29T12:34' && entry.what === '');
  expect(completed).toMatchObject({ ts: '2026-06-29T10:00', what: '写方案', tags: ['求职推进'] });
  expect(opened).toMatchObject({ what: '', tags: [] });
  // v56 文案单职责：占位行标题「还没记」，时长列「已 X」——不再有「未记录·进行中」复读。
  await expect(page.locator('.entry.placeholder .e-what')).toHaveText('还没记');
  await expect(page.locator('.entry.placeholder .e-dur')).toContainText('已 ');
});

test('yesterday tail explicitly saved only to 24:00 does not create today placeholder', async ({ page }) => {
  await boot(page, 768, 'yesterday-placeholder', false, FIXED_NOW, -1);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.getByRole('button', { name: '只记到 24:00' }).click();
  await page.locator('#form-what').fill('补完昨天');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  await page.getByRole('button', { name: '保存时间记录' }).click();

  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ id: 'yesterday-open', ts: '2026-06-28T23:00', what: '补完昨天', tags: ['求职推进'] });
  await expect(page.locator('#period-label')).toContainText('2026/06/28');
});

test('first record with earlier start creates real segment and open placeholder', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.locator('[data-action="toggle-start-time"]').click();
  await page.locator('[data-role="text"]').fill('2026-06-29 06:30');
  await page.locator('[data-role="text"]').blur();
  await page.locator('#form-what').fill('准备面试');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  await page.getByRole('button', { name: '保存时间记录' }).click();

  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries).toHaveLength(2);
  expect(entries.find(entry => entry.ts === '2026-06-29T06:30')).toMatchObject({ what: '准备面试', tags: ['求职推进'] });
  expect(entries.find(entry => entry.ts === '2026-06-29T12:34')).toMatchObject({ what: '', tags: [] });
});

test('reverse backfill settles at the right neighbor entry', async ({ page }) => {
  await boot(page, 768, 'empty', false, '2026-06-29T20:30:00');
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.locator('[data-action="toggle-start-time"]').click();
  await page.locator('[data-role="text"]').fill('2026-06-29 18:00');
  await page.locator('[data-role="text"]').blur();
  await page.locator('#form-what').fill('晚间推进');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  await page.getByRole('button', { name: '保存时间记录' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();

  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.locator('[data-action="toggle-start-time"]').click();
  await page.locator('[data-role="text"]').fill('2026-06-29 14:00');
  await page.locator('[data-role="text"]').blur();

  await expect(page.locator('[data-role="start-time-label"]')).toHaveText('14:00');
  await expect(page.locator('[data-role="end-label"]')).toHaveText('18:00');
  await expect(page.locator('[data-role="duration-label"]')).toHaveText('~4h');

  await page.locator('#form-what').fill('午后补录');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  await page.getByRole('button', { name: '保存时间记录' }).click();

  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries.find(entry => entry.ts === '2026-06-29T14:00')).toMatchObject({ what: '午后补录', tags: ['求职推进'] });
  expect(entries.find(entry => entry.ts === '2026-06-29T18:00')).toMatchObject({ what: '晚间推进', tags: ['求职推进'] });
  expect(entries.find(entry => entry.ts === '2026-06-29T20:30')).toMatchObject({ what: '', tags: [] });
});

test('cross-day reload restores the previously selected date', async ({ page }) => {
  await boot(page, 768, 'yesterday-residual', false, '2026-06-30T00:05:00', -1);
  await expect(page.locator('#period-label')).toContainText('2026/06/29');
  await expect(page.locator('#timeline')).toContainText('昨日残留记录');

  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));

  await expect(page.locator('#period-label')).toContainText('2026/06/29');
  await expect(page.locator('#timeline')).toContainText('昨日残留记录');
});

test('closed cross-day segment is sliced into the selected day timeline', async ({ page }) => {
  await boot(page, 768, 'cross-day-shifted', false, '2026-06-30T12:34:30');

  await expect(page.locator('#period-label')).toContainText('2026/06/30');
  await expect(page.locator('#timeline')).toContainText('跨日切片记录');
  await expect(page.locator('.entry.placeholder .e-what')).toHaveText('还没记');
  // v47 R4：日视图尺子改 hero 结论卡——不再有百分比文字。切片生效＝维持有非零净时长
  // （2h35m 的睡觉从昨日切进今天），而非整天未记录（那样维持会是 0）。
  await expect(page.locator('#ruler')).toContainText(/维持 ~2h/);

  const visibleTimes = await page.locator('.entry .e-time').allTextContents();
  expect(visibleTimes).toEqual(['02:35', '00:00']);
});

test('same-minute placeholder save reuses timestamp without duplicate', async ({ page }) => {
  await boot(page, 768, 'now-placeholder', false, FIXED_NOW);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.locator('#form-what').fill('刚开始');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  await page.getByRole('button', { name: '保存时间记录' }).click();

  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ id: 'open-now', ts: '2026-06-29T12:34', what: '刚开始', tags: ['求职推进'] });
});

test('new entry still shows inline same-time conflict', async ({ page }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.locator('[data-action="toggle-start-time"]').click();
  await page.locator('[data-role="text"]').fill('2026-06-29 09:00');
  await page.locator('[data-role="text"]').blur();
  await page.locator('#form-what').fill('重复时间');
  await page.getByRole('button', { name: '保存时间记录' }).click();

  await expect(page.locator('[data-role="conflict-error"]')).toContainText('同一时刻已有');
  await expect(page.locator('[data-role="conflict-error"]')).toContainText('编辑那条');
  await expect(page.locator('[data-role="conflict-error"]')).toContainText('用+1min');
});

test('clicking 编辑那条 on a conflict closes-and-reopens cleanly (R1 close-animation reentrancy)', async ({ page }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.locator('[data-action="toggle-start-time"]').click();
  await page.locator('[data-role="text"]').fill('2026-06-29 09:00');
  await page.locator('[data-role="text"]').blur();
  await page.locator('#form-what').fill('重复时间');
  await page.getByRole('button', { name: '保存时间记录' }).click();
  await expect(page.locator('[data-role="conflict-error"]')).toContainText('编辑那条');

  // editConflictEntry closes the new-sheet and immediately reopens an edit-sheet
  // for the conflicting entry in the same tick — R1's close animation must not
  // leave the sheet hidden or wipe the freshly-opened edit content.
  await page.locator('[data-role="conflict-error"] button', { hasText: '编辑那条' }).click();
  await expect(page.locator('#form-sheet')).toBeVisible();
  await expect(page.locator('.form-sheet-panel')).toHaveAttribute('data-mode', 'edit');
  await expect(page.locator('.form-sheet-panel')).toHaveAttribute('data-id', 'today-1');
  await expect(page.locator('#form-sheet')).not.toHaveClass(/sheet-closing/);
});

test('help close is a text button and import shift dialog stays custom', async ({ page }) => {
  await boot(page, 375, 'empty');
  // v38：header「?」已删，说明入口在「···」更多菜单里。
  await openBackupMenu(page);
  await page.getByRole('button', { name: '打开说明' }).click();
  await expect(page.locator('.help-body')).toBeVisible();
  await expect(page.locator('.form-sheet-panel')).toBeFocused();
  // v34 C 语法：sheet 头部是「关闭」文字按钮，不再是 icon。
  await expect(page.getByRole('button', { name: '关闭说明' })).toHaveText('关闭');

  // v41 导航栈：说明从「更多」下钻进入，Esc 返回「更多」而非整层关闭；
  // 因此无需再次点 header，直接在「更多」里点导入即可。
  await page.keyboard.press('Escape');
  await expect(page.locator('#form-sheet-title')).toHaveText('更多');

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入 JSON 备份' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'timelog-empty.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, entries: [] }))
  });
  await expect(page.locator('#form-sheet-title')).toContainText('导入检查');
  await expect(page.locator('#import-shift-hours')).toBeVisible();
  // 导入弹框同样从「更多」下钻，取消返回「更多」。
  await page.getByRole('button', { name: '取消导入' }).click();
  await expect(page.locator('#form-sheet-title')).toHaveText('更多');
});

// 首用日自 v61 起是**纯诊断值**（不再驱动 header 里程碑），但仍必须随完整备份
// 往返——删掉主屏 PWA 换图标会清掉 localStorage，诊断线索不该就此断掉。
// 导入只准把它往更早挪，不得倒拨。
test('full backup carries the diagnostic firstUsedDate and import never rolls it back', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW, null, -480);
  page.on('dialog', dialog => dialog.accept());

  await openBackupMenu(page);
  const restore = async payload => {
    // 导入从「更多」下钻进入，成功后按 v41 导航栈回到「更多」而不是整层关闭，
    // 所以第二轮直接复用同一张「更多」，不需要重开 header 菜单。
    await expect(page.locator('#form-sheet-title')).toHaveText('更多');
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '导入 JSON 备份' }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: 'timelog-restore.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(payload))
    });
    await expect(page.locator('#form-sheet-title')).toContainText('导入检查');
    await page.getByRole('button', { name: '确认导入' }).click();
  };

  await restore({
    version: 1,
    firstUsedDate: '2026-06-28',
    entries: [{ id: 'restored', ts: '2026-06-29T09:00', what: '恢复的记录', tags: ['求职推进'] }]
  });
  await expect.poll(async () => page.evaluate(() => localStorage.getItem('timelog.firstUsedDate'))).toBe('2026-06-28');

  // 再导入一份起始日更晚的备份：诊断值不得倒拨回去。
  await restore({
    version: 1,
    firstUsedDate: '2026-06-29',
    entries: [{ id: 'restored-2', ts: '2026-06-29T11:00', what: '第二份备份', tags: ['求职推进'] }]
  });
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.length)).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem('timelog.firstUsedDate'))).toBe('2026-06-28');

  // 导出侧必须真的把起始日写进备份，否则上面的恢复路径永远拿不到它。
  await page.evaluate(() => {
    window.__exported = null;
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: payload => Boolean(payload.files) });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async payload => { window.__exported = await payload.files[0].text(); }
    });
  });
  await expect(page.locator('#form-sheet-title')).toHaveText('更多');
  await page.locator('#backup-send-btn').click();
  await expect.poll(() => page.evaluate(() => window.__exported && JSON.parse(window.__exported).firstUsedDate)).toBe('2026-06-28');
});

test('JSON import shifts time, merges config, and export stays sorted', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW, null, -480);
  const imported = {
    version: 1,
    entries: [
      { id: 'later', ts: '2026-06-28T20:00', what: '晚间导入', tags: ['导入主线'] },
      { id: 'earlier', ts: '2026-06-28T08:00', what: '清晨导入', tags: ['拉伸'] }
    ],
    config: {
      mainline: ['导入主线'],
      chips: [{ name: '拉伸', bucket: 'maintain', longOk: true }]
    }
  };
  let alertText = '';
  page.on('dialog', async dialog => {
    alertText = dialog.message();
    await dialog.accept();
  });

  const chooserPromise = page.waitForEvent('filechooser');
  await openBackupMenu(page);
  await page.getByRole('button', { name: '导入 JSON 备份' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'timelog-import.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported))
  });
  await expect(page.locator('#form-sheet-title')).toContainText('导入检查');
  await expect(page.locator('#import-shift-hours')).toHaveValue('0');
  await page.locator('#import-shift-hours').fill('1');
  await page.getByRole('button', { name: '确认导入' }).click();

  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.length)).toBe(2);
  expect(alertText).toContain('导入完成');
  const stored = await page.evaluate(() => ({
    data: JSON.parse(localStorage.getItem('timelog.v1')),
    config: JSON.parse(localStorage.getItem('timelog.config'))
  }));
  expect(stored.data.entries.map(entry => entry.ts)).toEqual(['2026-06-28T09:00', '2026-06-28T21:00']);
  expect(stored.config.mainline).toContain('导入主线');
  expect(stored.config.chips).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: '拉伸', bucket: 'maintain', longOk: true })
  ]));

  const downloadPromise = page.waitForEvent('download');
  // v41：确认导入后导航栈返回「更多」，无需再点 header，直接在此点下载。
  await expect(page.locator('#form-sheet-title')).toHaveText('更多');
  await page.getByRole('button', { name: '存储 JSON 备份' }).click();
  const download = await downloadPromise;
  const exportPath = await download.path();
  const exported = JSON.parse(await readFile(exportPath, 'utf8'));
  expect(exported.entries.map(entry => entry.ts)).toEqual(['2026-06-28T09:00', '2026-06-28T21:00']);
  expect(exported.config.mainline).toContain('导入主线');
  expect(exported.meta.sourceTimezoneOffsetMinutes).toBe(-480);
  expect(exported.meta.sourceTimeZone).toBeTruthy();
});

test('JSON import uses timezone metadata to suggest default shift', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW, null, -480);
  const imported = {
    version: 1,
    meta: {
      exportedAt: '2026-06-29T15:00:00.000Z',
      sourceTimezoneOffsetMinutes: -540,
      sourceTimeZone: 'Asia/Tokyo'
    },
    entries: [
      { id: 'tokyo-entry', ts: '2026-06-29T09:00', what: '东京设备记录', tags: ['求职推进'] }
    ]
  };
  page.on('dialog', async dialog => {
    await dialog.accept();
  });

  const chooserPromise = page.waitForEvent('filechooser');
  await openBackupMenu(page);
  await page.getByRole('button', { name: '导入 JSON 备份' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'timelog-tokyo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported))
  });

  await expect(page.locator('#form-sheet-title')).toContainText('导入检查');
  await expect(page.locator('#import-shift-hours')).toHaveValue('-1');
  await expect(page.locator('.import-shift-body')).toContainText('Asia/Tokyo');
  await page.getByRole('button', { name: '确认导入' }).click();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ id: 'tokyo-entry', ts: '2026-06-29T08:00' });
});

test('plan mode uses plan copy and is hidden on historical days', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.getByRole('button', { name: '记录计划中' }).click();
  await expect(page.locator('#form-sheet-title')).toContainText('计划 · 6月29日');
  await expect(page.locator('.form-sheet-what')).toHaveText('写下计划要做什么');
  await expect(page.locator('[data-role="what-label"]')).toHaveText('计划做什么');
  await expect(page.locator('#form-what')).toHaveAttribute('placeholder', '准备面试 / 写方案…');
  await page.locator('#form-what').fill('准备面试');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  await page.getByRole('button', { name: '保存时间记录' }).click();

  // v47 R2+FAB：入口是悬浮 FAB；计划模式下主文案切「＋ 计划一条」（fab-main）。
  await expect(page.locator('#add-btn .fab-main')).toHaveText('＋ 计划一条');
  // v56：tag 是素色 #标签，桶色走竖脊（data-b）；「计划」状态词在时长列，脊为虚线。
  await expect(page.locator('#timeline')).toContainText('#求职推进');
  await expect(page.locator('.entry.planned')).toHaveAttribute('data-b', 'job');
  await expect(page.locator('.entry.planned .e-dur')).toHaveText('计划');
  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ what: '准备面试', tags: ['求职推进'], planned: true });

  await boot(page, 768, 'empty', false, FIXED_NOW, -1);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await expect(page.locator('[data-role="record-mode-seg"]')).toHaveCount(0);
  await expect(page.locator('#form-sheet-title')).toHaveText('补记 · 6月28日');
});

test('planned-only day has honest ruler copy and confirm opens placeholder', async ({ page }) => {
  await boot(page, 768, 'planned-only', false, FIXED_NOW);
  await expect(page.locator('#ruler')).toContainText('今日有计划，不计入统计');
  await expect(page.locator('#timeline')).toContainText('准备面试');

  await page.getByRole('button', { name: '标记计划为已发生' }).click();
  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries.find(entry => entry.id === 'plan-1')).toMatchObject({ ts: '2026-06-29T09:30', what: '准备面试', tags: ['求职推进'] });
  expect(entries.find(entry => entry.ts === '2026-06-29T12:34' && entry.what === '')).toMatchObject({ tags: [] });
  await expect(page.locator('.entry.placeholder .e-what')).toHaveText('还没记');
});

test('summary includes a plan section for day view', async ({ page }) => {
  await page.addInitScript(() => {
    window.__copiedSummary = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: text => { window.__copiedSummary = text; return Promise.resolve(); } }
    });
  });
  await boot(page, 768, 'planned-only', false, FIXED_NOW);
  await openBackupMenu(page);
  await page.getByRole('button', { name: '复制当前视图摘要' }).click();
  const text = await page.evaluate(() => window.__copiedSummary);
  expect(text).toContain('## 计划');
  expect(text).toContain('- 09:30 | 计划 | 准备面试 | #求职推进');
});

test('config rename migrates existing tags and removes replacement UI', async ({ page }) => {
  await boot(page, 768, 'custom-chip', false, FIXED_NOW);
  await openBackupMenu(page);
  await page.getByRole('button', { name: '配置标签' }).click();
  await expect(page.locator('#form-sheet-title')).toHaveText('标签高级设置');
  await expect(page.locator('.config-body')).not.toContainText('替换');
  await expect(page.locator('.cfg-migrate')).toHaveCount(0);
  await page.locator('.cfg-name').filter({ hasText: /^$/ }).first().fill('活动拉伸');
  await page.getByRole('button', { name: '保存标签配置' }).click();

  const stored = await page.evaluate(() => ({
    data: JSON.parse(localStorage.getItem('timelog.v1')),
    config: JSON.parse(localStorage.getItem('timelog.config'))
  }));
  expect(stored.data.entries.find(entry => entry.id === 'stretch-1')).toMatchObject({ tags: ['活动拉伸'] });
  expect(stored.config.chips).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: '活动拉伸', bucket: 'maintain', longOk: false })
  ]));
});

test('secondary sheets opened from 更多 return to 更多 on close (v41 nav stack)', async ({ page }) => {
  await boot(page, 375, 'empty', false, FIXED_NOW);
  await openBackupMenu(page);

  // 标签设置：取消回「更多」，不整层退回主界面。
  await page.getByRole('button', { name: '配置标签' }).click();
  await expect(page.locator('#form-sheet-title')).toHaveText('标签高级设置');
  await page.getByRole('button', { name: '取消配置' }).click();
  await expect(page.locator('#form-sheet-title')).toHaveText('更多');

  // 说明：关闭回「更多」。
  await page.getByRole('button', { name: '打开说明' }).click();
  await expect(page.locator('.help-body')).toBeVisible();
  await page.getByRole('button', { name: '关闭说明' }).click();
  await expect(page.locator('#form-sheet-title')).toHaveText('更多');

  // 只有在「更多」这一层关闭才整层退出。
  await page.getByRole('button', { name: '关闭更多菜单' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
});

test('custom tags pin immediately on first use in the same bucket', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);

  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.getByRole('button', { name: '维持' }).click();
  await page.locator('#form-what').fill('第一次拉伸');
  await page.locator('#form-ctag').fill('临时拉伸');
  await page.getByRole('button', { name: '保存时间记录' }).click();
  let config = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.config') || '{"chips":[]}'));
  expect(config.chips).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: '临时拉伸', bucket: 'maintain' })
  ]));

  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.getByRole('button', { name: '维持' }).click();
  await page.locator('#form-what').fill('第二次拉伸');
  await page.locator('#form-ctag').fill('临时拉伸');
  await page.getByRole('button', { name: '保存时间记录' }).click();
  config = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.config')));
  expect(config.chips.filter(chip => chip.name === '临时拉伸').length).toBe(1);
});

test('typing a custom tag selects it as a draft chip (unified current tag)', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);

  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.getByRole('button', { name: '维持' }).click();

  // A new custom value shows as a selected draft chip in the chosen bucket.
  await page.locator('#form-ctag').fill('整理桌面');
  const draft = page.locator('#form-chips .chip.chip-draft');
  await expect(draft).toHaveText('整理桌面');
  await expect(draft).toHaveClass(/sel/);
  await expect(draft).toHaveClass(/chip-maintain/);

  // Typing an existing chip name highlights that chip instead of duplicating it.
  await page.locator('#form-ctag').fill('睡觉');
  await expect(page.locator('#form-chips .chip-draft')).toHaveCount(0);
  await expect(page.locator('#form-chips .chip.sel')).toHaveText('睡觉');

  // Clearing the input restores the normal picker with nothing selected.
  await page.locator('#form-ctag').fill('');
  await expect(page.locator('#form-chips .chip.sel')).toHaveCount(0);
});

test('sheet controls stay inside rounded panel bounds', async ({ page }) => {
  await boot(page, 375, 'one-record', false, FIXED_NOW);
  await openBackupMenu(page);
  const bounds = await page.evaluate(() => {
    const panel = document.querySelector('.form-sheet-panel').getBoundingClientRect();
    const head = document.querySelector('.form-sheet-head');
    const headRect = head.getBoundingClientRect();
    const close = document.querySelector('.sh-cancel').getBoundingClientRect();
    const first = document.querySelector('.more-body .cell-btn').getBoundingClientRect();
    return {
      closeTop: close.top,
      closeRight: close.right,
      firstLeft: first.left,
      firstTop: first.top,
      firstBottom: first.bottom,
      headBottom: headRect.bottom,
      headShadow: getComputedStyle(head).boxShadow,
      panelTop: panel.top,
      panelRight: panel.right,
      panelLeft: panel.left,
      panelBottom: panel.bottom
    };
  });
  expect(bounds.closeTop).toBeGreaterThanOrEqual(bounds.panelTop);
  expect(bounds.closeRight).toBeLessThanOrEqual(bounds.panelRight);
  expect(bounds.firstLeft).toBeGreaterThanOrEqual(bounds.panelLeft);
  expect(bounds.firstBottom).toBeLessThanOrEqual(bounds.panelBottom);
  // ① the sticky head must not bleed a box-shadow over the first body item, and the
  // first item must sit below the head (no clipped top edge).
  expect(bounds.headShadow).toBe('none');
  expect(bounds.firstTop).toBeGreaterThanOrEqual(bounds.headBottom - 1);
});

test('reload starts with has-entries boot state and reaches app-ready', async ({ page }) => {
  await boot(page, 768, 'one-record', false, FIXED_NOW);
  await expect(page.locator('html')).toHaveAttribute('data-boot', 'has-entries');
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  await expect(page.locator('html')).toHaveAttribute('data-boot', 'has-entries');
  await expect(page.locator('#timeline')).toContainText('响应式测试记录');
});

test('Safari-style reload restores the last rendered frame before app.js arrives', async ({ page }) => {
  await boot(page, 375, 'one-record', false, FIXED_NOW);
  await expect(page.locator('#timeline')).toContainText('响应式测试记录');
  await expect(page.locator('.swipe-actions')).toBeHidden();
  await page.evaluate(() => {
    document.querySelector('.entry').dataset.bootSentinel = 'kept';
    const snapshot = JSON.parse(sessionStorage.getItem('timelog.bootSnapshot.v1'));
    snapshot.appHtml = document.querySelector('.app').innerHTML;
    sessionStorage.setItem('timelog.bootSnapshot.v1', JSON.stringify(snapshot));
  });

  // v58 modulepreload lets WebKit reuse app.js without passing the reload request
  // through page.route. Cache-bust only this test navigation's module script so
  // the hold remains deterministic; production index.html stays untouched.
  const reloadToken = '__snapshot_reload';
  await page.route(url => url.pathname === '/' && url.searchParams.get(reloadToken) === '1', async route => {
    const response = await route.fetch();
    const html = await response.text();
    const moduleScript = '<script type="module" src="src/app.js"></script>';
    if (!html.includes(moduleScript)) throw new Error('snapshot reload could not find the app module script');
    await route.fulfill({
      response,
      body: html.replace(moduleScript, `<script type="module" src="src/app.js?${reloadToken}=1"></script>`)
    });
  });

  let releaseApp;
  let markAppRequested;
  const appRequested = new Promise(resolve => { markAppRequested = resolve; });
  await page.route(url => url.pathname.endsWith('/src/app.js') && url.searchParams.get(reloadToken) === '1', async route => {
    markAppRequested();
    await new Promise(resolve => { releaseApp = resolve; });
    await route.continue();
  });

  await page.evaluate(token => history.replaceState(null, '', `/?${token}=1`), reloadToken);
  const reload = page.reload({ waitUntil: 'load' });
  await appRequested;
  await expect(page.locator('body')).toHaveClass(/boot-restored/);
  await expect(page.locator('#timeline')).toContainText('响应式测试记录');
  await expect(page.locator('#today-btn')).toBeHidden();
  // 里程碑必须由快照带回来：静态壳里是空的 hidden span，露出即证明恢复失败。
  await expect(page.locator('#usage-day')).toHaveText('记录历程第 1 天 · 已记录 1 天');
  await expect(page.locator('.swipe-actions')).toBeHidden();
  releaseApp();
  await reload;
  await expect(page.locator('body')).toHaveClass(/app-ready/);
  await expect(page.locator('.entry[data-boot-sentinel="kept"]')).toHaveCount(1);
  await expect(page.locator('body')).not.toHaveClass(/boot-restored/);
});

test('editing an existing record persists content and tag (① commitEdit single load)', async ({ page }) => {
  await boot(page, 768, 'one-record', false, FIXED_NOW);

  // Open the existing record's edit sheet — v47 R6：点整卡即编辑。
  await page.locator('.entry[data-id="today-1"] .e-what').click();
  const what = page.locator('[data-role="edit-what"]');
  await expect(what).toBeVisible();
  await expect(what).toHaveValue('响应式测试记录');

  // Change both content and tag, then save with the ✓ (commit-edit).
  await what.fill('改后的内容');
  await page.locator('[data-role="edit-custom-tag"]').fill('改后标签');
  await page.getByRole('button', { name: '保存修改' }).click();

  // Regression guard for the double-load bug: the mutation must land in the same
  // graph that deps.save() writes to localStorage, not a throwaway second load().
  // (No reload assertion here: the fixture's addInitScript re-seeds localStorage
  // on every navigation, so a reload would restore the original seed.)
  const afterSave = await page.evaluate(
    () => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(e => e.id === 'today-1')
  );
  expect(afterSave).toMatchObject({ what: '改后的内容', tags: ['改后标签'] });
  await expect(page.locator('#timeline')).toContainText('改后的内容');
});

test('editing a long-note record keeps the save button on screen (SE2 textarea cap)', async ({ page }) => {
  // iPhone SE2-ish width; the edit sheet renders the wheel picker inline, so a
  // long note growing an uncapped textarea used to push the save ✓ off-screen.
  await boot(page, 375, 'long-note', false, FIXED_NOW);

  // v47 R6：点整卡即编辑（.e-what 是卡内非交互区，点它冒泡到卡片的 start-edit）。
  await page.locator('.entry[data-id="today-long"] .e-what').click();
  const what = page.locator('[data-role="edit-what"]');
  await expect(what).toBeVisible();

  const metrics = await page.evaluate(() => {
    const ta = document.querySelector('[data-role="edit-what"]');
    const save = document.querySelector('.sh-done');
    const panel = document.querySelector('.form-sheet-panel');
    const s = save.getBoundingClientRect();
    return {
      taHeight: ta.getBoundingClientRect().height,
      taScrollHeight: ta.scrollHeight,
      capped: ta.classList.contains('ta-capped'),
      saveLeft: s.left,
      saveRight: s.right,
      saveTop: s.top,
      saveBottom: s.bottom,
      panelRight: panel.getBoundingClientRect().right,
      viewW: window.innerWidth,
      viewH: window.innerHeight
    };
  });
  // The textarea is capped well below its full content height and marked scrollable.
  expect(metrics.taScrollHeight).toBeGreaterThan(metrics.taHeight + 20);
  expect(metrics.capped).toBe(true);
  // The panel must not blow out past the viewport width (grid/flex min-content
  // guard) — this is what shoved the save ✓ off the right edge on SE2.
  expect(metrics.panelRight).toBeLessThanOrEqual(metrics.viewW + 1);
  // The save ✓ stays fully within the viewport on all sides — reachable.
  expect(metrics.saveTop).toBeGreaterThanOrEqual(0);
  expect(metrics.saveBottom).toBeLessThanOrEqual(metrics.viewH + 1);
  expect(metrics.saveLeft).toBeGreaterThanOrEqual(0);
  expect(metrics.saveRight).toBeLessThanOrEqual(metrics.viewW + 1);

  // And editing still persists through the ✓.
  await what.fill('短内容');
  await page.getByRole('button', { name: '保存修改' }).click();
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(e => e.id === 'today-long')
  );
  expect(saved.what).toBe('短内容');
});

test('② backfill on today forces log mode even when plan pref leaked', async ({ page }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW, null, null, 'plan');

  // Backfill the gap before the first record on *today*. Previously the leaked
  // plan pref opened the form in 计划 mode with a past ts, so ✓ silently failed.
  // v47 R6：点整张 gap 卡即补录。
  await page.locator('.entry.gap[data-action="backfill-seg"]').first().click();
  // The record-mode toggle must be hidden, and the form is in log mode.
  await expect(page.locator('[data-role="record-mode-seg"]')).toHaveCount(0);
  await page.locator('#form-what').fill('补一下');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  await page.getByRole('button', { name: '保存时间记录' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();

  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  const saved = entries.find(e => e.what === '补一下');
  expect(saved).toBeTruthy();
  expect(saved.planned).toBeFalsy();
  expect(saved.tags).toEqual(['求职推进']);
});

test('③ backfilling a middle placeholder fills it in place via its 补录 entry point', async ({ page }) => {
  await boot(page, 768, 'mid-placeholder', false, FIXED_NOW);

  // The stranded mid-day placeholder (09:00→11:00) now carries its own 补录
  // entry point, prefilled with the segment bounds. planSegmentSplit reuses the
  // placeholder (start == its ts) so it fills in place and keeps id 'mid-open'.
  await page.locator('[data-action="backfill-seg"][data-ts="2026-06-29T09:00"]').click();
  await expect(page.locator('#form-sheet-title')).toContainText('补录');
  await page.locator('#form-what').fill('补中段');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  await page.getByRole('button', { name: '保存时间记录' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();

  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  const atNine = entries.filter(e => e.ts === '2026-06-29T09:00');
  expect(atNine).toHaveLength(1);
  expect(atNine[0]).toMatchObject({ id: 'mid-open', what: '补中段', tags: ['求职推进'] });
});

test('splitting a labeled segment makes three parts and leaves neighbors intact', async ({ page }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);

  // 写代码 spans 09:00→10:00. Carve 09:20→09:40 as a different activity; the
  // original 写代码 must resume at 09:40 and 改bug (10:00) must be untouched.
  // v56：切一刀入口在编辑 sheet 里（行内不再逐行常显）。
  await page.locator('.entry[data-id="today-1"] .e-what').click();
  await page.getByRole('button', { name: '在这条记录内部切一刀' }).click();
  await page.locator('[data-role="backfill-start-mount"] [data-role="text"]').fill('2026-06-29 09:20');
  await page.locator('[data-role="backfill-start-mount"] [data-role="text"]').blur();
  await page.locator('[data-role="backfill-end-mount"] [data-role="text"]').fill('2026-06-29 09:40');
  await page.locator('[data-role="backfill-end-mount"] [data-role="text"]').blur();
  await page.locator('#form-what').fill('刷会手机');
  await page.locator('#form-ctag').fill('刷手机');
  await page.getByRole('button', { name: '保存时间记录' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();

  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries
    .filter(e => !e.planned).sort((a, b) => (a.ts < b.ts ? -1 : 1)));
  const slices = entries.map(e => `${e.ts.slice(11)}|${(e.tags[0] || '')}`);
  expect(slices).toContain('09:00|求职推进');
  expect(slices).toContain('09:20|刷手机');
  expect(slices).toContain('09:40|求职推进');
  // The split never touched the next real record.
  expect(entries.find(e => e.ts === '2026-06-29T10:00')).toMatchObject({ what: '改 bug', tags: ['求职推进'] });
});

test('deleting a standalone middle record turns its span 未记录, never the previous label', async ({ page }) => {
  await boot(page, 768, 'three-labels', false, FIXED_NOW);

  // 睡一会 | 写代码 | 吃早饭. Deleting 写代码 (distinct neighbors) must not stretch
  // 睡觉 over 09:00→10:00 — that span becomes an honest 未记录 placeholder.
  // v47 R6：删除移进编辑 sheet——点整卡进编辑，再点「删除这条记录」。
  await page.locator('.entry[data-id="tl-b"] .e-what').click();
  await page.getByRole('button', { name: '删除这条记录' }).click();
  await expect(page.locator('#form-sheet-title')).toHaveText('删除记录');
  await expect(page.locator('.delete-result')).toContainText('未记录');
  await page.getByRole('button', { name: '确认删除记录' }).click();

  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.filter(e => !e.planned));
  expect(entries.find(e => e.id === 'tl-b')).toMatchObject({ what: '', tags: [] });
  expect(entries.find(e => e.id === 'tl-a')).toMatchObject({ tags: ['睡觉'] });
  expect(entries.find(e => e.id === 'tl-c')).toMatchObject({ tags: ['吃饭'] });
});

test('⑥ confirming a plan onto a taken now-minute nudges forward', async ({ page }) => {
  await boot(page, 768, 'plan-collides-now', false, FIXED_NOW);

  // Confirm the future plan: it collapses to "now", which is already occupied by
  // now-entry. It must shift forward to a free minute, never overwrite/duplicate.
  await page.getByRole('button', { name: '标记计划为已发生' }).click();

  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  const original = entries.find(e => e.id === 'now-entry');
  const confirmed = entries.find(e => e.id === 'plan-future');
  expect(original).toMatchObject({ ts: '2026-06-29T12:34', what: '正在做的事' });
  expect(confirmed.planned).toBeFalsy();
  // Pushed off the taken minute, no two entries share a timestamp.
  expect(confirmed.ts).not.toBe('2026-06-29T12:34');
  const stamps = entries.map(e => e.ts);
  expect(new Set(stamps).size).toBe(stamps.length);
});

test('tapping a gap card opens the bounded backfill sheet', async ({ page }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);
  await page.locator('.entry.gap[data-action="backfill-seg"]').click();
  await expect(page.locator('#form-sheet-title')).toContainText('补录');
  await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T00:00');
  await expect(page.locator('#form-end-ts')).toHaveValue('2026-06-29T09:00');
});

test('v56 continuous log: single surface, bucket rails, now line, split lives in the edit sheet', async ({ page }) => {
  await boot(page, 375, 'two-records', false, FIXED_NOW);
  // 日视图时间轴收进一个连续容器；行按 data-b 上通高桶色竖脊。
  await expect(page.locator('#timeline .log')).toHaveCount(1);
  await expect(page.locator('.entry[data-id="today-1"]')).toHaveAttribute('data-b', 'job');
  await expect(page.locator('.entry.gap').first()).toHaveAttribute('data-b', 'unrecorded');
  // 今天视图有「现在」一线；已发生普通段行内不再有切一刀动作词。
  await expect(page.locator('.tl-now')).toHaveCount(1);
  await expect(page.locator('.tl-now')).toContainText('现在 12:34');
  await expect(page.locator('#timeline')).not.toContainText('切一刀');
  // 竖脊在容器左缘通高铺满（top≈行 top、bottom≈行 bottom），发丝分隔线避开它。
  const rail = await page.locator('.entry[data-id="today-1"]').evaluate(card => {
    const cardRect = card.getBoundingClientRect();
    const railStyle = getComputedStyle(card, '::before');
    return {
      width: railStyle.width,
      height: parseFloat(railStyle.height),
      cardHeight: cardRect.height
    };
  });
  expect(rail.width).toBe('4px');
  expect(Math.abs(rail.height - rail.cardHeight)).toBeLessThanOrEqual(1);
  // 切一刀住进编辑 sheet；打开后可见。
  await page.locator('.entry[data-id="today-1"] .e-what').click();
  await expect(page.getByRole('button', { name: '在这条记录内部切一刀' })).toBeVisible();
  await page.keyboard.press('Escape');
  // 离开今天：「现在」一线只属于今天。
  await page.locator('[data-action="shift-period"][data-delta="-1"]').click();
  await expect(page.locator('.tl-now')).toHaveCount(0);
});

test('wheel columns paint above the highlight band (P22)', async ({ page }) => {
  // 亮色 --accent-bg 不透明：高亮带若盖在列文字上方，选中行整行被涂掉。
  // paint 可见性无法直接断言（elementFromPoint 跳过 pointer-events:none），
  // 断言层序不变量：列必须建立高于高亮带的堆叠层。
  await page.emulateMedia({ colorScheme: 'light' });
  await boot(page, 375, 'two-records', false, FIXED_NOW);
  await page.locator('.entry.gap[data-action="backfill-seg"]').click();
  await expect(page.locator('.wheel-picker').first()).toBeVisible();
  const stacking = await page.evaluate(() => {
    const col = document.querySelector('.wheel-col');
    const hl = document.querySelector('.wheel-highlight');
    const colStyle = getComputedStyle(col);
    const hlStyle = getComputedStyle(hl);
    return {
      colPosition: colStyle.position,
      colZ: Number(colStyle.zIndex),
      hlZ: Number(hlStyle.zIndex)
    };
  });
  expect(stacking.colPosition).not.toBe('static');
  expect(stacking.colZ).toBeGreaterThan(stacking.hlZ);
});

test('editing a record can change its start time via the wheel', async ({ page }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);
  await page.locator('.entry[data-id="today-1"] .e-what').click();
  // R3: 编辑态时间滚轮折叠为触发行，先点开才能看到 picker。
  await expect(page.locator('[data-role="edit-time-section"]')).toBeHidden();
  await page.locator('[data-action="toggle-edit-start-time"]').click();
  await expect(page.locator('[data-role="edit-time-section"]')).toBeVisible();
  await page.locator('[data-role="edit-start-wheel"] [data-role="text"]').fill('2026-06-29 09:10');
  await page.locator('[data-role="edit-start-wheel"] [data-role="text"]').blur();
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries.find(e => e.id === 'today-1').ts).toBe('2026-06-29T09:10');
});

test('editing a saved record without touching time keeps its timestamp unchanged (R3 collapsed by default)', async ({ page }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);
  await page.locator('.entry[data-id="today-1"] .e-what').click();
  await expect(page.locator('[data-role="edit-time-section"]')).toBeHidden();
  await page.locator('[data-role="edit-what"]').fill('改了内容没碰时间');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  const saved = entries.find(e => e.id === 'today-1');
  expect(saved.ts).toBe('2026-06-29T09:00');
  expect(saved.what).toBe('改了内容没碰时间');
});

test('editing a planned entry keeps its time wheel always expanded (R3 exemption)', async ({ page }) => {
  await boot(page, 768, 'planned-only', false, FIXED_NOW);
  await page.locator('.entry.planned[data-id="plan-1"] .e-what').click();
  await expect(page.locator('.form-sheet-panel')).toHaveAttribute('data-mode', 'edit');
  // 计划编辑不折叠：没有触发行/edit-time-section 包装，picker 直接可见。
  await expect(page.locator('[data-action="toggle-edit-start-time"]')).toHaveCount(0);
  await expect(page.locator('[data-role="edit-time-section"]')).toHaveCount(0);
  await expect(page.locator('[data-role="edit-wheel"] [data-role="text"]')).toBeVisible();
});

test.describe('swipe-left action track (mobile gesture)', () => {
  test.use({ hasTouch: true });
  test('swiping a record card reveals 2x72 actions and edit remains explicit', async ({ page }) => {
    await boot(page, 375, 'two-records', false, FIXED_NOW);
    const card = page.locator('.entry[data-id="today-2"]');
    const row = page.locator('.swipe-row[data-swipe-id="today-2"]');
    await expect(card).toBeVisible();
    await expect(row.locator('.swipe-actions')).toBeHidden();
    const box = await card.boundingBox();
    const y = box.y + box.height / 2;
    await page.evaluate(({ startX, y }) => {
      const body = document.querySelector('.entry[data-id="today-2"] .e-body');
      const mk = x => ({ identifier: 1, target: body, clientX: x, clientY: y, pageX: x, pageY: y });
      const fire = (type, x) => {
        const tl = type === 'touchend' ? [] : [mk(x)];
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, {
          touches: { value: tl },
          targetTouches: { value: tl },
          changedTouches: { value: [mk(x)] }
        });
        body.dispatchEvent(event);
      };
      fire('touchstart', startX);
      for (let i = 1; i <= 8; i++) fire('touchmove', startX - i * 12);
      fire('touchend', startX - 96);
    }, { startX: box.x + box.width * 0.6, y });
    await expect(row).toHaveClass(/swipe-open/);
    await expect(row.locator('.swipe-actions')).toBeVisible();
    await expect(row.locator('.swipe-actions')).toHaveAttribute('aria-hidden', 'false');
    const widths = await row.locator('.swipe-action').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().width));
    expect(widths).toEqual([72, 72]);
    await row.getByRole('button', { name: '编辑记录' }).click();
    await expect(page.locator('#form-sheet')).toBeVisible();
    await expect(page.locator('.form-sheet-panel')).toHaveAttribute('data-mode', 'edit');
    await expect(page.locator('.form-sheet-panel')).toHaveAttribute('data-id', 'today-2');
  });
});

test('full interval edit previews previous/current/next and moves the shared end boundary', async ({ page }) => {
  await boot(page, 768, 'interval-three', false, '2026-06-29T20:00:30');
  await page.locator('.entry[data-id="various"] .e-what').click();
  await page.locator('[data-action="toggle-edit-start-time"]').click();
  await expect(page.locator('[data-role="edit-limits"]')).toContainText('前一段');
  await expect(page.locator('[data-role="edit-limits"]')).toContainText('下一段');

  const startInput = page.locator('[data-role="edit-start-wheel"] [data-role="text"]');
  const endInput = page.locator('[data-role="edit-end-wheel"] [data-role="text"]');
  await startInput.fill('2026-06-29 15:50');
  await startInput.blur();
  await endInput.fill('2026-06-29 18:11');
  await endInput.blur();

  const rows = page.locator('[data-role="interval-preview"] .preview-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('14:30-15:50');
  await expect(rows.nth(1)).toContainText('15:50-18:11');
  await expect(rows.nth(2)).toContainText('18:11-19:11');
  await page.getByRole('button', { name: '保存修改' }).click();

  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries.find(entry => entry.id === 'various').ts).toBe('2026-06-29T15:50');
  expect(entries.find(entry => entry.id === 'focus').ts).toBe('2026-06-29T18:11');
  expect(entries.find(entry => entry.id === 'after').ts).toBe('2026-06-29T19:11');
});

test('today tail switches between a true ongoing end and a fixed unrecorded tail', async ({ page }) => {
  await boot(page, 768, 'ongoing-tail', false, FIXED_NOW);
  await page.locator('.entry[data-id="ongoing"] .e-what').click();
  await page.locator('[data-action="toggle-edit-start-time"]').click();
  await expect(page.locator('[data-role="edit-end-mode"]')).toHaveValue('now');
  await page.getByRole('button', { name: '固定结束' }).click();
  const endInput = page.locator('[data-role="edit-end-wheel"] [data-role="text"]');
  await endInput.fill('2026-06-29 11:30');
  await endInput.blur();
  await expect(page.locator('[data-role="interval-preview"]')).toContainText('未记录');
  await page.getByRole('button', { name: '保存修改' }).click();

  let entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries.find(entry => entry.id === 'ongoing').ongoing).toBeFalsy();
  expect(entries).toEqual(expect.arrayContaining([expect.objectContaining({ ts: '2026-06-29T11:30', what: '', tags: [] })]));

  await page.locator('.entry[data-id="ongoing"] .e-what').click();
  await page.locator('[data-action="toggle-edit-start-time"]').click();
  await page.getByRole('button', { name: '至今' }).click();
  await page.getByRole('button', { name: '保存修改' }).click();
  entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries.find(entry => entry.id === 'ongoing').ongoing).toBe(true);
  expect(entries.some(entry => entry.what === '')).toBe(false);
});

test('split sheet freezes bounds and labels whole, edge, and internal previews', async ({ page }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);
  // v56：从编辑 sheet 进入切一刀（openFormSheet('new') 会清 sheetEditId 并整面换内容）。
  await page.locator('.entry[data-id="today-1"] .e-what').click();
  await page.getByRole('button', { name: '在这条记录内部切一刀' }).click();
  await expect(page.locator('#form-sheet-title')).toContainText('切一刀');
  await expect(page.locator('[data-role="backfill-limits"]')).toContainText('09:00');
  await expect(page.locator('[data-role="backfill-limits"]')).toContainText('10:00');
  await expect(page.locator('.preview-head')).toHaveText('整段改为');

  const start = page.locator('[data-role="backfill-start-mount"] [data-role="text"]');
  const end = page.locator('[data-role="backfill-end-mount"] [data-role="text"]');
  await start.fill('2026-06-29 09:20');
  await start.blur();
  await expect(page.locator('.preview-head')).toHaveText('贴边后为两段');
  await end.fill('2026-06-29 09:40');
  await end.blur();
  await expect(page.locator('.preview-head')).toHaveText('切分后为三段');
  await expect(page.locator('[data-role="interval-preview"] .preview-row')).toHaveCount(3);
});

test('delete confirmation is exact and the saved deletion can be undone for 8 seconds', async ({ page }) => {
  await boot(page, 768, 'three-labels', false, FIXED_NOW);
  await page.locator('.entry[data-id="tl-b"] .e-what').click();
  await page.getByRole('button', { name: '删除这条记录' }).click();
  await expect(page.locator('.delete-target')).toContainText('09:00-10:00');
  await expect(page.locator('.delete-result')).toContainText('未记录');
  await page.getByRole('button', { name: '确认删除记录' }).click();
  await expect(page.locator('#undo-toast')).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(entry => entry.id === 'tl-b'));
  expect(restored).toMatchObject({ what: '写代码', tags: ['求职推进'] });
  await expect(page.locator('#undo-toast')).toBeHidden();
});

test('delete reconnects only exactly matching neighbors', async ({ page }) => {
  await boot(page, 768, 'same-neighbors', false, FIXED_NOW);
  await page.locator('.entry[data-id="same-middle"] .e-what').click();
  await page.getByRole('button', { name: '删除这条记录' }).click();
  await expect(page.locator('.delete-result')).toContainText('接回一段');
  await page.getByRole('button', { name: '确认删除记录' }).click();
  const ids = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.map(entry => entry.id));
  expect(ids).not.toContain('same-middle');
  expect(ids).not.toContain('same-right');
  expect(ids).toContain('same-left');
});

test('cross-tab data change cancels delete undo instead of overwriting newer data', async ({ page, context }) => {
  await boot(page, 768, 'three-labels', false, FIXED_NOW);
  const other = await context.newPage();
  await other.goto('/');
  await other.waitForFunction(() => document.body.classList.contains('app-ready'));

  await page.locator('.entry[data-id="tl-b"] .e-what').click();
  await page.getByRole('button', { name: '删除这条记录' }).click();
  await page.getByRole('button', { name: '确认删除记录' }).click();
  await expect(page.locator('#undo-toast')).toBeVisible();
  await other.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    data.entries.push({ id: 'other-tab', ts: '2026-06-29T11:30', what: '另一标签页', tags: ['求职推进'] });
    localStorage.setItem('timelog.v1', JSON.stringify(data));
  });
  await expect(page.locator('#undo-toast')).toContainText('撤销已取消');
  await expect(page.locator('#undo-toast [data-action="undo-delete"]')).toBeHidden();
  await other.close();
});

test('interval save recomputes against latest cross-tab data and requires reconfirmation', async ({ page, context }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);
  const other = await context.newPage();
  await other.goto('/');
  await other.waitForFunction(() => document.body.classList.contains('app-ready'));
  await page.locator('.entry[data-id="today-1"] .e-what').click();
  await page.locator('[data-action="toggle-edit-start-time"]').click();
  await page.locator('[data-role="edit-what"]').fill('跨标签确认');

  await other.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    data.entries.find(entry => entry.id === 'today-2').what = '另一标签页改了后一段';
    localStorage.setItem('timelog.v1', JSON.stringify(data));
  });
  await expect(page.locator('#cross-tab-banner')).toBeVisible();
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.locator('[data-role="conflict-error"]')).toContainText('请再次确认');
  await expect(page.locator('#form-sheet')).toBeVisible();
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  await other.close();
});

test('conflicting import shows safe side-by-side cards, blocks writing, and replans live', async ({ page }) => {
  await boot(page, 375, 'two-records', false, FIXED_NOW);
  await page.evaluate(() => { window.__importPwned = 0; });
  const maliciousId = '<img src=x onerror="window.__importPwned=1">';
  const chooserPromise = page.waitForEvent('filechooser');
  await openBackupMenu(page);
  await page.getByRole('button', { name: '导入 JSON 备份' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'timelog-conflict.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: 1,
      entries: [
        { id: maliciousId, ts: '2026-06-29T09:00', what: '<script>bad()</script>', tags: ['求职推进'] },
        { id: 'incoming-2', ts: '2026-06-29T10:00', what: '备份里的另一条', tags: ['吃饭'] }
      ]
    }))
  });
  await expect(page.locator('[data-role="import-summary"]')).toHaveText('2 条冲突 · 已处理 0/2');
  await expect(page.locator('.import-conflict-card')).toHaveCount(2);
  await expect(page.locator('[data-role="import-error"]')).toContainText('备份中');
  await expect(page.locator('[data-role="import-error"]')).toContainText('本机中');
  await expect(page.locator('[data-role="import-error"]')).toContainText('<script>bad()</script>');
  await expect(page.locator('[data-role="import-error"]')).toContainText('写代码');
  await expect(page.locator('[data-role="import-error"]')).not.toContainText(maliciousId);
  await expect(page.locator('[data-role="import-error"] img')).toHaveCount(0);
  await expect(page.locator('#import-confirm-btn')).toBeDisabled();

  await page.locator('#import-shift-hours').fill('2');
  await expect(page.locator('[data-role="import-summary"]')).toHaveText('可导入 2 条 · 已存在跳过 0 条');
  await expect(page.locator('#import-confirm-btn')).toBeEnabled();
  await expect(page.locator('[data-role="import-error"]')).toBeHidden();
  await page.locator('#import-shift-hours').fill('0');
  await expect(page.locator('#import-confirm-btn')).toBeDisabled();

  const result = await page.evaluate(() => ({
    pwned: window.__importPwned,
    entries: JSON.parse(localStorage.getItem('timelog.v1')).entries
  }));
  expect(result.pwned).toBe(0);
  expect(result.entries).toHaveLength(2);
});

test('import conflicts can be resolved per item with local, backup, or conservative text merge', async ({ page }) => {
  await boot(page, 375, 'interval-three', false, '2026-06-29T20:00:30');
  const chooserPromise = page.waitForEvent('filechooser');
  await openBackupMenu(page);
  await page.getByRole('button', { name: '导入 JSON 备份' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'timelog-resolve-conflicts.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: 1,
      entries: [
        { id: 'backup-a', ts: '2026-06-29T14:30', what: '备份想替换前一段', tags: ['吃饭'] },
        { id: 'backup-b', ts: '2026-06-29T15:39', what: '使用备份这一条', tags: ['睡觉'] },
        { id: 'backup-c', ts: '2026-06-29T16:14', what: '补充的备份文字', tags: ['吃饭'] }
      ]
    }))
  });

  const cards = page.locator('.import-conflict-card');
  await expect(cards).toHaveCount(3);
  await cards.nth(0).getByRole('button', { name: '保留本机' }).click();
  await cards.nth(1).getByRole('button', { name: '使用备份' }).click();
  await cards.nth(2).getByRole('button', { name: '合并文字' }).click();
  await expect(page.locator('[data-role="import-summary"]')).toHaveText('3 条冲突 · 已处理 3/3');
  await expect(page.locator('#import-confirm-btn')).toBeEnabled();
  await expect(cards.nth(2)).toContainText('保留本机时间、标签和状态');

  page.once('dialog', dialog => dialog.accept());
  await page.locator('#import-confirm-btn').click();
  await expect(page.locator('#form-sheet-title')).toHaveText('更多');
  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries.find(entry => entry.ts === '2026-06-29T14:30')).toMatchObject({ id: 'before', what: '前一段', tags: ['睡觉'] });
  expect(entries.find(entry => entry.ts === '2026-06-29T15:39')).toMatchObject({ id: 'backup-b', what: '使用备份这一条', tags: ['睡觉'] });
  expect(entries.find(entry => entry.ts === '2026-06-29T16:14')).toMatchObject({
    id: 'focus',
    what: '专注\n\n补充的备份文字',
    tags: ['求职推进']
  });
});

test('ten import conflicts all render, stay atomic, and reject stale resolution signatures', async ({ page }) => {
  await boot(page, 375, 'one-record', false, FIXED_NOW);
  const localEntries = Array.from({ length: 10 }, (_, index) => ({
    id: `local-${index}`,
    ts: `2026-06-29T${String(index + 8).padStart(2, '0')}:00`,
    what: `本机 ${index + 1}`,
    tags: ['求职推进']
  }));
  const incomingEntries = localEntries.map((entry, index) => ({
    id: `incoming-${index}`,
    ts: entry.ts,
    what: `备份 ${index + 1}`,
    tags: ['吃饭']
  }));
  await page.evaluate(entries => {
    localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries }));
  }, localEntries);

  const chooserPromise = page.waitForEvent('filechooser');
  await openBackupMenu(page);
  await page.getByRole('button', { name: '导入 JSON 备份' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'timelog-ten-conflicts.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, entries: incomingEntries }))
  });

  const cards = page.locator('.import-conflict-card');
  await expect(cards).toHaveCount(10);
  for (let index = 0; index < 9; index++) {
    await cards.nth(index).getByRole('button', { name: '使用备份' }).click();
  }
  await expect(page.locator('[data-role="import-summary"]')).toHaveText('10 条冲突 · 已处理 9/10');
  await expect(page.locator('#import-confirm-btn')).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.map(entry => entry.id))).toEqual(localEntries.map(entry => entry.id));

  await cards.nth(9).getByRole('button', { name: '使用备份' }).click();
  await expect(page.locator('#import-confirm-btn')).toBeEnabled();
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    data.entries[0].what = '另一标签页改过';
    localStorage.setItem('timelog.v1', JSON.stringify(data));
  });
  await page.locator('#import-confirm-btn').click();
  await expect(page.locator('[data-role="import-summary"]')).toHaveText('10 条冲突 · 已处理 0/10');
  await expect(page.locator('[data-role="import-error"]')).toContainText('本机数据或平移结果已变化');
  await expect(page.locator('#import-confirm-btn')).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.some(entry => entry.id.startsWith('incoming-')))).toBe(false);

  for (let index = 0; index < 10; index++) {
    await cards.nth(index).getByRole('button', { name: '使用备份' }).click();
  }
  await expect(page.locator('#import-confirm-btn')).toBeEnabled();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#import-confirm-btn').click();
  await expect(page.locator('#form-sheet-title')).toHaveText('更多');
  const finalIds = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.map(entry => entry.id));
  expect(finalIds).toEqual(incomingEntries.map(entry => entry.id));
});

test('renamed defaults stay renamed and mainline/chip duplicates are rejected safely', async ({ page }) => {
  await boot(page, 768, 'renamed-default', false, FIXED_NOW);
  await openBackupMenu(page);
  await page.getByRole('button', { name: '配置标签' }).click();
  await expect(page.locator('.cfg-name')).toHaveValue('休息');
  await expect(page.locator('.config-body')).not.toContainText('睡觉');
  await page.locator('.cfg-name').fill('求职推进');
  await page.getByRole('button', { name: '保存标签配置' }).click();
  await expect(page.locator('[data-role="config-error"]')).toContainText('已经是主线标签');
  const config = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.config')));
  expect(config.chips).toEqual([expect.objectContaining({ name: '休息' })]);
});

test('quota failure keeps edited form content and existing data intact', async ({ page }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);
  await page.locator('.entry[data-id="today-1"] .e-what').click();
  await page.locator('[data-role="edit-what"]').fill('配额失败仍保留');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'timelog.v1') throw new DOMException('quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.locator('#form-sheet')).toBeVisible();
  await expect(page.locator('[data-role="edit-what"]')).toHaveValue('配额失败仍保留');
  await expect(page.locator('[data-role="conflict-error"]')).toContainText('存储空间不足');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(entry => entry.id === 'today-1').what);
  expect(stored).toBe('写代码');
});

test('share prefers files, survives canShare exceptions, and preserves cell structure', async ({ page }) => {
  await boot(page, 768, 'one-record', false, FIXED_NOW);
  await page.evaluate(() => {
    window.__shareCalls = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => { throw new Error('probe failed'); } });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: payload => { window.__shareCalls.push({ files: Boolean(payload.files), text: Boolean(payload.text) }); return Promise.resolve(); }
    });
  });
  await openBackupMenu(page);
  await page.locator('#backup-send-btn').click();
  await expect(page.locator('#backup-send-btn [data-role="cell-label"]')).toHaveText('已分享备份');
  await expect(page.locator('#backup-send-btn .cell-chevron')).toHaveCount(1);
  expect(await page.evaluate(() => window.__shareCalls)).toEqual([{ files: false, text: true }]);

  await page.evaluate(() => {
    window.__shareCalls = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: payload => Boolean(payload.files) });
  });
  await page.locator('#backup-send-btn').click();
  await expect.poll(() => page.evaluate(() => window.__shareCalls)).toEqual([{ files: true, text: false }]);
});

test('iOS storage uses the system file sheet, while cancellation never creates a hidden download', async ({ page }) => {
  await boot(page, 375, 'one-record', false, FIXED_NOW);
  await page.evaluate(() => {
    window.__shareCalls = [];
    window.__fallbackClicks = 0;
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)' });
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'iPhone' });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: payload => Boolean(payload.files) });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: payload => { window.__shareCalls.push({ files: Boolean(payload.files), name: payload.files?.[0]?.name || '' }); return Promise.resolve(); }
    });
    HTMLAnchorElement.prototype.click = function () { window.__fallbackClicks += 1; };
  });
  await openBackupMenu(page);
  await expect(page.locator('#backup-download-btn')).toHaveText(/存储备份/);
  await expect(page.locator('#backup-send-btn')).toBeVisible();
  await page.locator('#backup-download-btn').click();
  await expect.poll(() => page.evaluate(() => window.__shareCalls)).toEqual([
    { files: true, name: expect.stringMatching(/^timelog-\d{8}-\d{6}\.json$/) }
  ]);
  expect(await page.evaluate(() => window.__fallbackClicks)).toBe(0);

  await page.evaluate(() => {
    window.__shareCalls = [];
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: payload => {
        window.__shareCalls.push({ files: Boolean(payload.files) });
        return Promise.reject(new DOMException('cancelled', 'AbortError'));
      }
    });
  });
  await page.locator('#backup-download-btn').click();
  await expect.poll(() => page.evaluate(() => window.__shareCalls)).toEqual([{ files: true }]);
  expect(await page.evaluate(() => window.__fallbackClicks)).toBe(0);
});

test('desktop storage remains a direct JSON download', async ({ page }) => {
  await boot(page, 768, 'one-record', false, FIXED_NOW);
  await openBackupMenu(page);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#backup-download-btn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^timelog-\d{8}-\d{6}\.json$/);
});

test('share falls back to download without Web Share and cancellation never downloads', async ({ page }) => {
  await boot(page, 768, 'one-record', false, FIXED_NOW);
  await openBackupMenu(page);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#backup-send-btn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^timelog-\d{8}-\d{6}\.json$/);

  await page.evaluate(() => {
    window.__shareCalls = 0;
    window.__fallbackClicks = 0;
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: payload => Boolean(payload.files) });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: () => {
        window.__shareCalls += 1;
        return Promise.reject(new DOMException('cancelled', 'AbortError'));
      }
    });
    HTMLAnchorElement.prototype.click = function () { window.__fallbackClicks += 1; };
  });
  await page.locator('#backup-send-btn').click();
  await expect.poll(() => page.evaluate(() => window.__shareCalls)).toBe(1);
  expect(await page.evaluate(() => window.__fallbackClicks)).toBe(0);
  await expect(page.locator('#backup-send-btn [data-role="cell-label"]')).toHaveText('分享备份');
});

test('dismissing a cross-tab notice renders the latest stored data', async ({ page, context }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);
  const other = await context.newPage();
  await other.goto('/');
  await other.waitForFunction(() => document.body.classList.contains('app-ready'));

  await page.locator('.entry[data-id="today-1"] .e-what').click();
  await other.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    data.entries.find(entry => entry.id === 'today-2').what = '另一标签页的新内容';
    localStorage.setItem('timelog.v1', JSON.stringify(data));
  });
  await expect(page.locator('#cross-tab-banner')).toBeVisible();
  await page.locator('[data-action="dismiss-cross-tab-banner"]').click();
  await expect(page.locator('#cross-tab-banner')).toBeHidden();
  await expect(page.locator('.entry[data-id="today-2"] .e-what')).toHaveText('另一标签页的新内容');
  await expect(page.locator('#form-sheet')).toBeVisible();
  await other.close();
});

test('waiting service worker prompt has a reachable update button above the mobile FAB', async ({ page }) => {
  await page.addInitScript(() => {
    window.__swUpdates = 0;
    window.__swMessages = [];
    window.__visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => window.__visibility
    });
    // waiting 必须是 EventTarget：v64 起 applyUpdate 会挂 statechange 第二成功路径。
    const waiting = new EventTarget();
    waiting.state = 'installed';
    waiting.postMessage = message => { window.__swMessages.push(message); };
    const registration = new EventTarget();
    registration.waiting = waiting;
    registration.installing = null;
    registration.update = () => {
      window.__swUpdates += 1;
      return Promise.resolve();
    };
    const serviceWorker = new EventTarget();
    serviceWorker.controller = {};
    serviceWorker.register = () => Promise.resolve(registration);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorker
    });
  });
  await boot(page, 375, 'one-record', false, FIXED_NOW);

  await expect(page.locator('#update-banner')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__swUpdates)).toBe(1);
  const promptOverlapsFab = await page.evaluate(() => {
    const prompt = document.getElementById('update-banner').getBoundingClientRect();
    const fab = document.getElementById('add-btn').getBoundingClientRect();
    return prompt.left < fab.right && prompt.right > fab.left && prompt.top < fab.bottom && prompt.bottom > fab.top;
  });
  expect(promptOverlapsFab).toBe(false);
  await expect(page.locator('#update-banner')).toHaveCSS('position', 'fixed');
  const updateButtonReceivesHit = await page.locator('[data-action="update-app"]').evaluate(button => {
    const box = button.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return Boolean(hit && hit.closest('[data-action="update-app"]') === button);
  });
  expect(updateButtonReceivesHit).toBe(true);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => page.evaluate(() => window.__swUpdates)).toBe(2);
  await page.locator('[data-action="update-app"]').click();
  expect(await page.evaluate(() => window.__swMessages)).toEqual([{ type: 'SKIP_WAITING' }]);
});

test('unacknowledged update click times out into an actionable full-quit hint', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-06-29T12:34:30') });
  await page.addInitScript(() => {
    // C1 现场复刻：SKIP_WAITING 石沉大海，statechange 与 controllerchange 都不来。
    const waiting = new EventTarget();
    waiting.state = 'installed';
    waiting.postMessage = () => {};
    const registration = new EventTarget();
    registration.waiting = waiting;
    registration.installing = null;
    registration.update = () => Promise.resolve();
    const serviceWorker = new EventTarget();
    serviceWorker.controller = {};
    serviceWorker.register = () => Promise.resolve(registration);
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
  });
  await boot(page, 375, 'one-record');
  await expect(page.locator('#update-banner')).toBeVisible();
  await page.locator('[data-action="update-app"]').click();
  await page.clock.runFor(8000);
  const stuck = page.locator('[data-role="update-stuck"]');
  await expect(stuck).toBeVisible();
  await expect(stuck).toContainText('完全退出');
  await expect(page.locator('[data-action="update-app"]')).toBeHidden();
  await page.locator('[data-action="dismiss-update-banner"]').click();
  await expect(page.locator('#update-banner')).toBeHidden();
});

test('update click reloads when the waiting worker activates without controllerchange', async ({ page }) => {
  await page.addInitScript(() => {
    // C1 第二成功路径：iOS 丢 controllerchange 时，waiting worker 自身的
    // statechange→activated 仍应触发 reload，不能吊死在超时指引上。
    const waiting = new EventTarget();
    waiting.state = 'installed';
    waiting.postMessage = message => {
      if (message && message.type === 'SKIP_WAITING') {
        setTimeout(() => {
          waiting.state = 'activated';
          waiting.dispatchEvent(new Event('statechange'));
        }, 0);
      }
    };
    const registration = new EventTarget();
    registration.waiting = waiting;
    registration.installing = null;
    registration.update = () => Promise.resolve();
    const serviceWorker = new EventTarget();
    serviceWorker.controller = {};
    serviceWorker.register = () => Promise.resolve(registration);
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
  });
  await boot(page, 375, 'one-record', false, FIXED_NOW);
  await expect(page.locator('#update-banner')).toBeVisible();
  await page.evaluate(() => { window.__preReloadSentinel = true; });
  await page.locator('[data-action="update-app"]').click();
  // reload 后 window 属性清空——sentinel 消失即证明页面真的重载了。
  await page.waitForFunction(() => window.__preReloadSentinel === undefined);
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
});

test('v57 date entry matrix forces history/future modes and hides creation at +8', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW, null, null, 'log');
  await expect(page.locator('#add-btn')).toContainText('记一条');

  await page.locator('[data-action="shift-period"][data-delta="1"]').click();
  await expect(page.locator('#add-btn')).toContainText('计划一条');
  await page.locator('#add-btn').click();
  await expect(page.locator('#form-sheet-title')).toContainText('计划');
  await expect(page.locator('[data-role="record-mode-seg"]')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('timelog.recordMode'))).toBe('log');
  await page.getByRole('button', { name: '取消新增记录' }).click();

  for (let i = 0; i < 6; i += 1) await page.locator('[data-action="shift-period"][data-delta="1"]').click();
  await expect(page.locator('#add-btn')).toBeVisible();
  await expect(page.locator('#add-btn')).toContainText('计划一条');
  await page.locator('[data-action="shift-period"][data-delta="1"]').click();
  await expect(page.locator('#add-btn')).toBeHidden();
  await expect(page.locator('#list-fade')).toBeHidden();

  await page.locator('#today-btn').click();
  await page.locator('[data-action="shift-period"][data-delta="-1"]').click();
  await expect(page.locator('#add-btn')).toContainText('记一条');
  await page.locator('#add-btn').click();
  await expect(page.locator('#form-sheet-title')).toContainText('补记');
  await expect(page.locator('[data-role="record-mode-seg"]')).toHaveCount(0);
  await page.getByRole('button', { name: '取消新增记录' }).click();

  await page.locator('#today-btn').click();
  await page.locator('#add-btn').click();
  await expect(page.locator('[data-role="record-mode-seg"]')).toBeVisible();
  await expect(page.locator('[data-role="record-mode-seg"] [data-mode="log"]')).toHaveClass(/active/);
});

test('+8 day keeps existing plans viewable and editable while FAB stays hidden', async ({ page }) => {
  await boot(page, 768, 'planned-far', false, FIXED_NOW, 8);
  await expect(page.locator('#add-btn')).toBeHidden();
  await expect(page.locator('.entry[data-id="plan-far"]')).toBeVisible();
  await page.locator('.entry[data-id="plan-far"]').click();
  await expect(page.locator('#form-sheet-title')).toContainText('编辑');
});

test('plan defaults use the first valid five-minute tick, including midnight rollover', async ({ page }) => {
  await boot(page, 768, 'empty', false, '2026-06-29T12:56:00', null, null, 'plan');
  await page.locator('#add-btn').click();
  await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T13:05');
  await page.getByRole('button', { name: '取消新增记录' }).click();
  await page.evaluate(() => window.__setFixedNow('2026-06-29T23:58:00'));
  await page.locator('#add-btn').click();
  await expect(page.locator('#form-ts')).toHaveValue('2026-06-30T00:05');
});

test('changing a new-plan date and cancelling leaves the main page date untouched; saving switches only after success', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW, null, null, 'log');
  await page.locator('#add-btn').click();
  await page.getByRole('button', { name: '记录计划中' }).click();
  await setFormTimestamp(page, '#form-ts', '2026-07-06T23:59');
  await page.getByRole('button', { name: '取消新增记录' }).click();
  await expect(page.locator('#period-label')).toHaveAttribute('aria-label', /2026\/06\/29/);
  expect(await page.evaluate(() => localStorage.getItem('timelog.selectedDate'))).toBe('2026-06-29');

  await page.locator('#add-btn').click();
  await setFormTimestamp(page, '#form-ts', '2026-07-06T23:59');
  await page.locator('#form-what').fill('第七天计划');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  await page.getByRole('button', { name: '保存时间记录' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('timelog.selectedDate'))).toBe('2026-07-06');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(entry => entry.what === '第七天计划'));
  expect(saved).toMatchObject({ ts: '2026-07-06T23:59', planned: true });
});

test('+8 plan time stays in the sheet with an inline error and never writes', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW, null, null, 'plan');
  await page.locator('#add-btn').click();
  await setFormTimestamp(page, '#form-ts', '2026-07-07T00:00');
  await page.locator('#form-what').fill('越界计划');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  await page.getByRole('button', { name: '保存时间记录' }).click();
  await expect(page.locator('#form-sheet')).toBeVisible();
  await expect(page.locator('[data-role="time-error"]')).toContainText('第 7 天 23:59');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.some(entry => entry.what === '越界计划'))).toBe(false);
});

for (const planCase of [
  { name: 'expired', state: 'planned-expired', offset: null, id: 'plan-expired', invalid: '2026-06-29T09:01' },
  { name: 'within-five-minutes', state: 'planned-near', offset: null, id: 'plan-near', invalid: '2026-06-29T12:38' },
  { name: 'beyond-seven-days', state: 'planned-far', offset: 8, id: 'plan-far', invalid: '2026-07-07T10:00' }
]) {
  test(`existing ${planCase.name} plan can edit text unchanged but any time change revalidates`, async ({ page }) => {
    await boot(page, 768, planCase.state, false, FIXED_NOW, planCase.offset);
    await page.locator(`.entry[data-id="${planCase.id}"]`).click();
    await expect(page.locator('.plan-expired-hint')).toBeVisible();
    await page.locator('[data-role="edit-what"]').fill(`${planCase.name} 文案已改`);
    await page.getByRole('button', { name: '保存修改' }).click();
    await expect(page.locator('#form-sheet')).toBeHidden();
    expect(await page.evaluate(id => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(entry => entry.id === id).what, planCase.id)).toBe(`${planCase.name} 文案已改`);

    await page.locator(`.entry[data-id="${planCase.id}"]`).click();
    await setPlannedEditTimestamp(page, planCase.invalid);
    await page.getByRole('button', { name: '保存修改' }).click();
    await expect(page.locator('[data-role="time-error"]')).toBeVisible();
    await setPlannedEditTimestamp(page, '2026-06-30T09:00');
    await page.getByRole('button', { name: '保存修改' }).click();
    await expect(page.locator('#form-sheet')).toBeHidden();
    expect(await page.evaluate(id => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(entry => entry.id === id).ts, planCase.id)).toBe('2026-06-30T09:00');
  });
}

test('planned edit exemption compares against the latest entry from the same load graph', async ({ page }) => {
  await boot(page, 768, 'planned-expired', false, FIXED_NOW);
  await page.locator('.entry[data-id="plan-expired"]').click();
  await page.locator('[data-role="edit-what"]').fill('只改文字');
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    data.entries.find(entry => entry.id === 'plan-expired').ts = '2026-06-29T08:00';
    localStorage.setItem('timelog.v1', JSON.stringify(data));
  });
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.locator('[data-role="time-error"]')).toBeVisible();
  const latest = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(entry => entry.id === 'plan-expired'));
  expect(latest).toMatchObject({ ts: '2026-06-29T08:00', what: '过期计划' });
});

test('DST planning window uses a real Playwright timezone context', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'America/New_York' });
  const page = await context.newPage();
  await boot(page, 768, 'empty', false, '2026-03-07T12:00:00');
  const result = await page.evaluate(async () => {
    const { planningWindow, validateTsForMode } = await import('/src/time.js');
    const now = new Date(2026, 2, 7, 12, 0, 0);
    const window = planningWindow(now);
    return {
      max: `${window.maxExclusive.getFullYear()}-${String(window.maxExclusive.getMonth() + 1).padStart(2, '0')}-${String(window.maxExclusive.getDate()).padStart(2, '0')}T${String(window.maxExclusive.getHours()).padStart(2, '0')}:${String(window.maxExclusive.getMinutes()).padStart(2, '0')}`,
      calendarHours: (window.maxExclusive - new Date(2026, 2, 7, 0, 0, 0)) / 3600000,
      lastMinuteOk: validateTsForMode('2026-03-14T23:59', { planned: true, now }).ok,
      boundaryOk: validateTsForMode('2026-03-15T00:00', { planned: true, now }).ok,
      offsetBefore: new Date(2026, 2, 7, 12).getTimezoneOffset(),
      offsetAfter: new Date(2026, 2, 9, 12).getTimezoneOffset()
    };
  });
  expect(result).toMatchObject({ max: '2026-03-15T00:00', calendarHours: 191, lastMinuteOk: true, boundaryOk: false });
  expect(result.offsetBefore).not.toBe(result.offsetAfter);
  await context.close();
});

test('overnight FAB defaults to today, writes two day-local segments, and switches to today', async ({ page }) => {
  await boot(page, 768, 'yesterday-placeholder', false, '2026-06-29T08:00:00', -1);
  await page.locator('#add-btn').click();
  await expect(page.locator('#form-sheet-title')).toContainText('过夜续记');
  await expect(page.locator('[data-role="overnight-summary"]')).toContainText('续昨晚 23:00 起 · 到今天 08:00 · ~9h');
  await page.locator('#form-what').fill('睡觉');
  await selectSleepTag(page);
  await page.getByRole('button', { name: '保存时间记录' }).click();
  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ ts: '2026-06-28T23:00', what: '睡觉', tags: ['睡觉'] }),
    expect.objectContaining({ ts: '2026-06-29T00:00', what: '睡觉', tags: ['睡觉'] }),
    expect.objectContaining({ ts: '2026-06-29T08:00', what: '', tags: [] })
  ]));
  expect(await page.evaluate(() => localStorage.getItem('timelog.selectedDate'))).toBe('2026-06-29');
});

test('overnight can explicitly stop at 24:00 and remain on yesterday', async ({ page }) => {
  await boot(page, 768, 'yesterday-placeholder', false, '2026-06-29T08:00:00', -1);
  await page.locator('#add-btn').click();
  await page.getByRole('button', { name: '只记到 24:00' }).click();
  await page.locator('#form-what').fill('睡觉');
  await selectSleepTag(page);
  await page.getByRole('button', { name: '保存时间记录' }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(stored.find(entry => entry.id === 'yesterday-open')).toMatchObject({ ts: '2026-06-28T23:00', what: '睡觉', tags: ['睡觉'] });
  expect(stored.some(entry => entry.ts.startsWith('2026-06-29'))).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('timelog.selectedDate'))).toBe('2026-06-28');
});

test('moving overnight start into today creates one today segment and removes the day-end choice', async ({ page }) => {
  await boot(page, 768, 'yesterday-placeholder', false, '2026-06-29T08:00:00', -1);
  await page.locator('#add-btn').click();
  await setFormTimestamp(page, '#form-ts', '2026-06-29T02:00');
  await expect(page.getByRole('button', { name: '只记到 24:00' })).toBeHidden();
  await page.locator('#form-what').fill('睡觉');
  await selectSleepTag(page);
  await page.getByRole('button', { name: '保存时间记录' }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(stored.find(entry => entry.id === 'yesterday-open')).toMatchObject({ what: '', tags: [] });
  expect(stored).toEqual(expect.arrayContaining([
    expect.objectContaining({ ts: '2026-06-29T02:00', what: '睡觉' }),
    expect.objectContaining({ ts: '2026-06-29T08:00', what: '' })
  ]));
  expect(stored.some(entry => entry.ts === '2026-06-29T00:00')).toBe(false);
});

test('overnight uses the first real today entry as hard end and preserves it', async ({ page }) => {
  await boot(page, 768, 'overnight-with-today-real', false, '2026-06-29T08:00:00', -1);
  await page.locator('#add-btn').click();
  await expect(page.locator('[data-role="overnight-summary"]')).toContainText('到今天 07:30');
  await page.locator('#form-what').fill('睡觉');
  await selectSleepTag(page);
  await page.getByRole('button', { name: '保存时间记录' }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(stored.find(entry => entry.id === 'today-real')).toMatchObject({ ts: '2026-06-29T07:30', what: '洗漱' });
  expect(stored.some(entry => entry.ts === '2026-06-29T08:00')).toBe(false);
});

test('overnight boundary plan blocks today branch but leaves the 24:00 branch usable', async ({ page }) => {
  await boot(page, 768, 'overnight-midnight-plan', false, '2026-06-29T08:00:00', -1);
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('睡觉');
  await selectSleepTag(page);
  await expect(page.locator('.preview-head.is-error')).toContainText('00:00');
  await page.getByRole('button', { name: '保存时间记录' }).click();
  await expect(page.locator('[data-role="conflict-error"]')).toContainText('00:00');
  await page.getByRole('button', { name: '只记到 24:00' }).click();
  await page.getByRole('button', { name: '保存时间记录' }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(stored.find(entry => entry.id === 'midnight-plan')).toMatchObject({ planned: true, what: '午夜计划' });
  expect(stored.find(entry => entry.id === 'yesterday-open')).toMatchObject({ what: '睡觉' });
  expect(await page.evaluate(() => localStorage.getItem('timelog.selectedDate'))).toBe('2026-06-28');
});

test('overnight preview invalidates after latest data changes and requires a second confirmation', async ({ page }) => {
  await boot(page, 768, 'yesterday-placeholder', false, '2026-06-29T08:00:00', -1);
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('睡觉');
  await selectSleepTag(page);
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    data.entries.push({ id: 'cross-tab-real', ts: '2026-06-29T07:00', what: '洗漱', tags: ['洗漱'] });
    localStorage.setItem('timelog.v1', JSON.stringify(data));
  });
  await page.getByRole('button', { name: '保存时间记录' }).click();
  await expect(page.locator('[data-role="conflict-error"]')).toContainText('请再次确认');
  await expect(page.locator('[data-role="overnight-summary"]')).toContainText('到今天 07:00');
  await page.getByRole('button', { name: '保存时间记录' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(stored.some(entry => entry.id === 'cross-tab-real')).toBe(true);
  expect(stored.some(entry => entry.ts === '2026-06-29T08:00')).toBe(false);
});

test('overnight form is data-shape only: midnight hard end and backfill do not trigger it', async ({ page }) => {
  await boot(page, 768, 'overnight-hardend-midnight', false, '2026-06-29T08:00:00', -1);
  await page.locator('#add-btn').click();
  await expect(page.locator('#form-sheet-title')).not.toContainText('过夜续记');
  await page.getByRole('button', { name: '取消新增记录' }).click();
});

test('backfill on yesterday placeholder remains ordinary backfill, not overnight continuation', async ({ page }) => {
  await boot(page, 768, 'yesterday-placeholder', false, '2026-06-29T08:00:00', -1);
  await page.locator('[data-action="backfill-seg"]').first().click();
  await expect(page.locator('#form-sheet-title')).toContainText('补录');
  await expect(page.locator('[data-role="overnight-end-mode"]')).toHaveCount(0);
});

test('boottrace is absent without the exact fragment', async ({ page }) => {
  await boot(page, 768, 'one-record', false, FIXED_NOW);
  await expect(page.locator('#boottrace-hud')).toHaveCount(0);
  expect(await page.evaluate(() => window.__timelogBootTrace)).toBeUndefined();
});

test('boottrace reports ordered phases and snapshot outcomes outside the v53 snapshot range', async ({ page }) => {
  await boot(page, 768, 'one-record', false, FIXED_NOW, null, null, null, '/#boottrace=1');
  const hud = page.locator('#boottrace-hud');
  await expect(hud).toBeVisible();
  let text = await hud.textContent();
  for (const mark of ['html_inline_start', 'app_module_body_start', 'init_start', 'first_render_complete', 'app_ready']) {
    expect(text).toContain(mark);
  }
  expect(text).toContain('snapshot=pending → no-snapshot');
  expect(text).toContain('不含点击主屏图标');
  expect(text).not.toContain('响应式测试记录');
  const placement = await page.locator('#boottrace-hud').evaluate(node => ({
    bodyChild: node.parentElement === document.body,
    insideApp: document.querySelector('.app').contains(node),
    insideFab: document.getElementById('add-btn').contains(node)
  }));
  expect(placement).toEqual({ bodyChild: true, insideApp: false, insideFab: false });

  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  text = await page.locator('#boottrace-hud').textContent();
  expect(text).toContain('snapshot=pending → dom-restored → adopted');
  expect(text).toContain('snapshot_adopted');

  await page.evaluate(() => {
    const snapshot = JSON.parse(sessionStorage.getItem('timelog.bootSnapshot.v1'));
    snapshot.appVersion = 'old';
    sessionStorage.setItem('timelog.bootSnapshot.v1', JSON.stringify(snapshot));
  });
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  await expect(page.locator('#boottrace-hud')).toContainText('dom-restored → rejected:version');

  await page.evaluate(() => {
    const snapshot = JSON.parse(sessionStorage.getItem('timelog.bootSnapshot.v1'));
    snapshot.today = '1999-01-01';
    sessionStorage.setItem('timelog.bootSnapshot.v1', JSON.stringify(snapshot));
  });
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  await expect(page.locator('#boottrace-hud')).toContainText('rejected:date');

  await page.evaluate(() => {
    const snapshot = JSON.parse(sessionStorage.getItem('timelog.bootSnapshot.v1'));
    snapshot.dataRaw = 'different';
    sessionStorage.setItem('timelog.bootSnapshot.v1', JSON.stringify(snapshot));
  });
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  await expect(page.locator('#boottrace-hud')).toContainText('rejected:data');

  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  await expect(page.locator('#boottrace-hud')).toHaveCount(0);
});

test('boot diagnostics are off by default and write nothing', async ({ page }) => {
  await boot(page, 768, 'one-record', false, FIXED_NOW);
  expect(await page.evaluate(() => localStorage.getItem('timelog.bootDiag.v1'))).toBeNull();
});

test('enabled boot diagnostics append one privacy-bounded sample per boot with retention', async ({ page }) => {
  await boot(page, 768, 'one-record', false, FIXED_NOW);
  // boot() 的 init script 每次导航都 localStorage.clear() 后重新播种，所以诊断
  // key 必须由**之后注册**（因此之后执行）的 init script 写入，再 reload 生效。
  await page.addInitScript(() => {
    // 35 条旧样本挤压 30 条环形上限；at 递增让新样本的 gapMin 可计算。
    const samples = Array.from({ length: 35 }, (_, i) => ({ at: 1000000 + i * 60000, readyMs: 100 }));
    localStorage.setItem('timelog.bootDiag.v1', JSON.stringify({ enabled: true, samples }));
  });
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  await page.waitForFunction(() => {
    const parsed = JSON.parse(localStorage.getItem('timelog.bootDiag.v1') || 'null');
    return Boolean(parsed && parsed.samples.length && parsed.samples[parsed.samples.length - 1].ver);
  });
  const raw = await page.evaluate(() => localStorage.getItem('timelog.bootDiag.v1'));
  const parsed = JSON.parse(raw);
  expect(parsed.enabled).toBe(true);
  expect(parsed.samples.length).toBe(30);
  const sample = parsed.samples[parsed.samples.length - 1];
  // 字段白名单：只允许计时/布尔/命中数，任何新增字段都必须在这里显式过审。
  expect(Object.keys(sample).sort()).toEqual([
    'at', 'cache', 'cacheCount', 'cacheFiles', 'controlled', 'gapMin', 'htmlMs',
    'moduleMs', 'nav', 'persisted', 'readyMs', 'snapshot', 'standalone', 'ver'
  ]);
  expect(typeof sample.at).toBe('number');
  expect(typeof sample.controlled).toBe('boolean');
  expect(typeof sample.standalone).toBe('boolean');
  // same-tab reload 可能命中 v53 启动快照，snapshot 如实为 true；只锁类型。
  expect(typeof sample.snapshot).toBe('boolean');
  expect(sample.moduleMs).toBeGreaterThanOrEqual(0);
  expect(sample.readyMs).toBeGreaterThanOrEqual(sample.moduleMs);
  expect(typeof sample.gapMin).toBe('number');
  // 隐私金丝雀：样本串里绝不能出现任何记录内容。
  expect(raw).not.toContain('响应式测试记录');
});

test('more sheet toggles boot diagnostics, copies samples, and disable wipes them', async ({ page }) => {
  await page.addInitScript(() => {
    window.__copiedDiag = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: text => { window.__copiedDiag = text; return Promise.resolve(); } }
    });
  });
  await boot(page, 768, 'one-record', false, FIXED_NOW);
  await openBackupMenu(page);
  await expect(page.locator('[data-action="toggle-boot-diag"]')).toContainText('启动诊断：关');
  await expect(page.locator('#boot-diag-copy-btn')).toHaveCount(0);
  await page.locator('[data-action="toggle-boot-diag"]').click();
  await expect(page.locator('[data-action="toggle-boot-diag"]')).toContainText('启动诊断：开');
  await expect(page.locator('#boot-diag-copy-btn')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.bootDiag.v1')).enabled)).toBe(true);

  // boot() 的 init script 每次导航都 clear() 存储，reload 前用后注册的 init
  // script 把 UI 刚打开的开关接回去，才能覆盖「开着开关重启会记样本」。
  await page.addInitScript(() => {
    localStorage.setItem('timelog.bootDiag.v1', JSON.stringify({ enabled: true, samples: [] }));
  });
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  await page.waitForFunction(() => {
    const parsed = JSON.parse(localStorage.getItem('timelog.bootDiag.v1') || 'null');
    return Boolean(parsed && parsed.samples.length >= 1);
  });
  await openBackupMenu(page);
  await page.locator('#boot-diag-copy-btn').click();
  await page.waitForFunction(() => window.__copiedDiag !== '');
  const text = await page.evaluate(() => window.__copiedDiag);
  expect(text).toContain('# 时间尺启动诊断');
  expect(text).toContain('- UA: ');
  expect(text).toContain('SW接管');
  expect(text).not.toContain('响应式测试记录');

  await page.locator('[data-action="toggle-boot-diag"]').click();
  await expect(page.locator('[data-action="toggle-boot-diag"]')).toContainText('启动诊断：关');
  await expect(page.locator('#boot-diag-copy-btn')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('timelog.bootDiag.v1'))).toBeNull();
});

test('short viewport more sheet scrolls instead of compressing cell groups', async ({ page }) => {
  await boot(page, 375, 'one-record', false, FIXED_NOW);
  // 最坏内容量：开启启动诊断（第四个分组 + 提示行），并压到 SE 级矮视口，
  // 让内容总高必然超过面板可用高度——v62 真机上这会把所有分组压扁裁切（P34）。
  await page.evaluate(() => localStorage.setItem('timelog.bootDiag.v1', JSON.stringify({ enabled: true, samples: [] })));
  await page.setViewportSize({ width: 375, height: 600 });
  await openBackupMenu(page);
  const clipped = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.more-body .cell-group').forEach(group => {
      if (group.scrollHeight > group.clientHeight + 1) {
        out.push(`${group.textContent.trim().slice(0, 10)}: ${group.scrollHeight}>${group.clientHeight}`);
      }
    });
    return out;
  });
  expect(clipped).toEqual([]);
  // 超高必须转为正文滚动：滚到底后版本号可见，证明尾部内容可达而非被裁。
  const version = page.locator('.app-version');
  await version.scrollIntoViewIfNeeded();
  await expect(version).toBeVisible();
  // 同缺陷类的第二现场：标签高级设置同样是 cell-group 装在 grid 正文里（且为
  // .tall 定高面板），矮视口下分组同样不得被压缩裁切。
  await page.getByRole('button', { name: '配置标签' }).click();
  await expect(page.locator('#form-sheet-title')).toHaveText('标签高级设置');
  const configClipped = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.config-body .cell-group').forEach(group => {
      if (group.scrollHeight > group.clientHeight + 1) {
        out.push(`${group.textContent.trim().slice(0, 10)}: ${group.scrollHeight}>${group.clientHeight}`);
      }
    });
    return out;
  });
  expect(configClipped).toEqual([]);
});

test('persistent storage is requested at app-ready', async ({ page }) => {
  await page.addInitScript(() => {
    if (window.StorageManager && StorageManager.prototype.persist) {
      StorageManager.prototype.persist = function () { window.__persistRequested = true; return Promise.resolve(false); };
    } else {
      window.__persistRequested = 'unsupported';
    }
  });
  await boot(page, 768, 'one-record', false, FIXED_NOW);
  await page.waitForFunction(() => window.__persistRequested !== undefined);
  const requested = await page.evaluate(() => window.__persistRequested);
  expect(requested === true || requested === 'unsupported').toBe(true);
});

test('ongoing minutes update on the minute without reopening the page', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-06-29T12:34:30') });
  await boot(page, 768, 'ongoing-tail');
  const before = await page.locator('.entry[data-id="ongoing"] .e-dur').textContent();
  await page.clock.fastForward(60_000);
  await expect.poll(() => page.locator('.entry[data-id="ongoing"] .e-dur').textContent()).not.toBe(before);
});

test('PWA resume immediately catches an ongoing duration up to the current minute', async ({ page }) => {
  await boot(page, 375, 'tail-placeholder', false, '2026-06-29T12:34:30');
  await expect(page.locator('.hero-aux')).toContainText('截至 12:34');
  await expect(page.locator('#add-btn .fab-sub')).toContainText('已 ~2h34min');

  await page.evaluate(() => {
    window.__setFixedNow('2026-06-29T18:55:10');
    window.dispatchEvent(new Event('focus'));
  });

  await expect(page.locator('.hero-aux')).toContainText('截至 18:55');
  await expect(page.locator('#add-btn .fab-sub')).toContainText('已 ~8h55min');
});

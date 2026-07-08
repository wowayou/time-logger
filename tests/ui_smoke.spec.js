import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { FIXED_NOW, STATES, VIEWPORTS, boot, expectNoHorizontalOverflow, openBackupMenu } from './ui_fixture.js';

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
  test(`more sheet keeps layout when share is ${share ? 'available' : 'hidden'}`, async ({ page }) => {
    await boot(page, 320, 'one-record', share);
    await openBackupMenu(page);
    if (share) await expect(page.locator('#share-btn')).toBeVisible();
    else await expect(page.locator('#share-btn')).toBeHidden();
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

test('375px header hides title without overflowing', async ({ page }) => {
  await boot(page, 375, 'one-record');
  await expect(page.locator('.hdr-title')).toBeHidden();
  await expectNoHorizontalOverflow(page);
});

test('new entry shows continuation context and recomputes start', async ({ page }) => {
  await boot(page, 768, 'tail-placeholder', false, FIXED_NOW);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  const panel = page.locator('.form-sheet-panel');
  await expect(panel).toBeFocused();
  await expect(page.locator('[data-role="start-time-label"]')).toHaveText('10:00');
  await expect(page.locator('[data-role="duration-label"]')).not.toBeEmpty();
  const tooltipVisibility = await page.locator('.icon-btn').first()
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
  await expect(page.locator('#timeline')).toContainText('进行中·还没记');
  await expect(page.locator('#timeline')).toContainText('未记录·进行中');
});

test('past-day save does not create today placeholder', async ({ page }) => {
  await boot(page, 768, 'yesterday-placeholder', false, FIXED_NOW, -1);
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
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
  await expect(page.locator('#timeline')).toContainText('进行中·还没记');
  await expect(page.locator('#ruler')).toContainText('维持 20.5%');
  await expect(page.locator('#ruler')).not.toContainText('未记录 100%');

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

test('help close is a text button and import shift dialog stays custom', async ({ page }) => {
  await boot(page, 375, 'empty');
  await page.getByRole('button', { name: '打开说明' }).click();
  await expect(page.locator('.help-body')).toBeVisible();
  await expect(page.locator('.form-sheet-panel')).toBeFocused();
  // v34 C 语法：sheet 头部是「关闭」文字按钮，不再是 icon。
  await expect(page.getByRole('button', { name: '关闭说明' })).toHaveText('关闭');

  await page.keyboard.press('Escape');
  const chooserPromise = page.waitForEvent('filechooser');
  await openBackupMenu(page);
  await page.getByRole('button', { name: '导入 JSON 备份' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'timelog-empty.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, entries: [] }))
  });
  await expect(page.locator('#form-sheet-title')).toContainText('导入时区平移');
  await expect(page.locator('#import-shift-hours')).toBeVisible();
  await page.getByRole('button', { name: '取消导入' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
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
  await expect(page.locator('#form-sheet-title')).toContainText('导入时区平移');
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
  await openBackupMenu(page);
  await page.getByRole('button', { name: '下载 JSON 备份' }).click();
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

  await expect(page.locator('#form-sheet-title')).toContainText('导入时区平移');
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

  await expect(page.getByRole('button', { name: '计划一条新的时间记录' })).toHaveText('+ 计划一条');
  await expect(page.locator('#timeline')).toContainText('计划·#求职推进');
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
  await expect(page.locator('#timeline')).toContainText('进行中·还没记');
});

test('summary includes a plan section for day view', async ({ page, context }) => {
  await boot(page, 768, 'planned-only', false, FIXED_NOW);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openBackupMenu(page);
  await page.getByRole('button', { name: '复制当前视图摘要' }).click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
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

test('editing an existing record persists content and tag (① commitEdit single load)', async ({ page }) => {
  await boot(page, 768, 'one-record', false, FIXED_NOW);

  // Open the existing record's edit sheet.
  await page.getByRole('button', { name: '编辑记录' }).click();
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

  await page.locator('.entry[data-id="today-long"] [data-action="start-edit"]').click();
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
  await page.addInitScript(() => localStorage.setItem('timelog.recordMode', 'plan'));
  await boot(page, 768, 'two-records', false, FIXED_NOW);

  // Backfill the gap before the first record on *today*. Previously the leaked
  await page.addInitScript(() => localStorage.setItem('timelog.recordMode', 'plan'));
  await boot(page, 768, 'two-records', false, FIXED_NOW);

  // Backfill the gap before the first record on *today*. Previously the leaked
  // plan pref opened the form in 计划 mode with a past ts, so ✓ silently failed.
  await page.getByRole('button', { name: '补录这段未记录时间' }).first().click();
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

test('③ backfilling a middle placeholder fills it in place via its 补/切 button', async ({ page }) => {
  await boot(page, 768, 'mid-placeholder', false, FIXED_NOW);

  // The stranded mid-day placeholder (09:00→11:00) now carries its own 补/切
  // button, prefilled with the segment bounds. carveInsert reuses the placeholder
  // (start == its ts) so it fills in place and keeps id 'mid-open'.
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

test('splitting a labeled segment carves three parts and leaves neighbors intact', async ({ page }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);

  // 写代码 spans 09:00→10:00. Carve 09:20→09:40 as a different activity; the
  // original 写代码 must resume at 09:40 and 改bug (10:00) must be untouched.
  await page.locator('[data-action="backfill-seg"][data-ts="2026-06-29T09:00"]').click();
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
  // The carve never touched the next real record.
  expect(entries.find(e => e.ts === '2026-06-29T10:00')).toMatchObject({ what: '改 bug', tags: ['求职推进'] });
});

test('deleting a standalone middle record turns its span 未记录, never the previous label', async ({ page }) => {
  await boot(page, 768, 'three-labels', false, FIXED_NOW);
  page.on('dialog', dialog => dialog.accept());

  // 睡一会 | 写代码 | 吃早饭. Deleting 写代码 (distinct neighbors) must not stretch
  // 睡觉 over 09:00→10:00 — that span becomes an honest 未记录 placeholder.
  await page.locator('.entry[data-id="tl-b"] [data-action="delete-entry"]').click();

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
  await page.locator('.entry.gap [data-action="backfill-seg"]').click();
  await expect(page.locator('#form-sheet-title')).toContainText('补录');
  await expect(page.locator('#form-ts')).toHaveValue('2026-06-29T00:00');
  await expect(page.locator('#form-end-ts')).toHaveValue('2026-06-29T09:00');
});

test('editing a record can change its start time via the wheel', async ({ page }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);
  await page.locator('.entry[data-id="today-1"] [data-action="start-edit"]').click();
  await page.locator('[data-role="edit-wheel"] [data-role="text"]').fill('2026-06-29 09:10');
  await page.locator('[data-role="edit-wheel"] [data-role="text"]').blur();
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries.find(e => e.id === 'today-1').ts).toBe('2026-06-29T09:10');
});

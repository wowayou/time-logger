import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { FIXED_NOW, STATES, VIEWPORTS, boot, expectNoHorizontalOverflow } from './ui_fixture.js';

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
  test(`footer does not overflow when share is ${share ? 'available' : 'hidden'}`, async ({ page }) => {
    await boot(page, 320, 'one-record', share);
    if (share) await expect(page.locator('#share-btn')).toBeVisible();
    else await expect(page.locator('#share-btn')).toBeHidden();
    await expectNoHorizontalOverflow(page);
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
  const tooltipVisibility = await page.locator('.form-sheet-actions .icon-btn').first()
    .evaluate(btn => getComputedStyle(btn, '::after').visibility);
  expect(tooltipVisibility).toBe('hidden');

  await page.locator('[data-action="toggle-start-time"]').click();
  await expect(page.locator('#form-wheel-mount')).toBeVisible();
  await expect.poll(async () => page.locator('#form-wheel-mount')
    .evaluate(mount => mount.contains(document.activeElement))).toBe(true);

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

test('help close icon and import shift dialog stay custom', async ({ page }) => {
  await boot(page, 375, 'empty');
  await page.getByRole('button', { name: '打开说明' }).click();
  await expect(page.locator('.help-body')).toBeVisible();
  await expect(page.locator('.form-sheet-panel')).toBeFocused();
  await expect(page.locator('.form-sheet-actions [data-action="close-form"] svg path')).toHaveCount(2);
  const helpTooltipVisibility = await page.locator('.form-sheet-actions [data-action="close-form"]')
    .evaluate(btn => getComputedStyle(btn, '::after').visibility);
  expect(helpTooltipVisibility).toBe('hidden');

  await page.keyboard.press('Escape');
  const chooserPromise = page.waitForEvent('filechooser');
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

// v1.0.0：版本号改三段式后，**数据面必须一个字节都没变**。
//
// 这几条锁的是同一件事：产品版本（manifest / CACHE / APP_VERSION）与数据版本
// （存储键 `timelog.v1`、备份载荷 `version: 1`）是两件事。CLAUDE.md 一直这么写，
// 但在这一批之前那只是文字承诺——没有任何判据会因为有人把存储键跟着产品版本
// 改名而变红。改名的后果是所有存量用户的记录一次性「消失」（键读不到＝空数据），
// 而且是静默的：应用照常启动，只是空了。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot, openBackupSheet } from './ui_fixture.js';

// v93 时代导出的真实备份形态：载荷 version 1，meta 只有那三个字段，没有 app 版本。
const LEGACY_BACKUP = {
  version: 1,
  meta: {
    exportedAt: '2026-08-15T03:21:44.000Z',
    sourceTimezoneOffsetMinutes: -480,
    sourceTimeZone: 'Asia/Shanghai'
  },
  // 真实 config 形状：主线是字符串数组，chips 只允许 maintain/leak 且 longOk 必填布尔。
  config: {
    version: 1,
    mainline: ['求职推进'],
    chips: [
      { name: '吃饭', bucket: 'maintain', longOk: false },
      { name: '睡觉', bucket: 'maintain', longOk: true }
    ]
  },
  firstUsedDate: '2026-06-01',
  entries: [
    { id: 'legacy-1', ts: '2026-06-28T09:00', what: 'v93 时代的记录', tags: ['求职推进'] },
    { id: 'legacy-2', ts: '2026-06-28T11:30', what: 'v93 时代的第二条', tags: ['吃饭'] }
  ]
};

test('v1.0.0: a backup exported by the single-integer era imports unchanged', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await boot(page, 375, 'empty', false, FIXED_NOW);

  const chooserPromise = page.waitForEvent('filechooser');
  await openBackupSheet(page);
  await page.getByRole('button', { name: '导入 JSON 备份' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'timelog-20260815-112144.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(LEGACY_BACKUP))
  });

  await expect(page.locator('[data-role="import-summary"]')).toContainText('可导入 2 条');
  await expect(page.locator('#import-confirm-btn')).toBeEnabled();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#import-confirm-btn').click();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')));
  expect(stored.entries.find(entry => entry.id === 'legacy-1'))
    .toMatchObject({ ts: '2026-06-28T09:00', what: 'v93 时代的记录', tags: ['求职推进'] });
  expect(stored.entries.find(entry => entry.id === 'legacy-2'))
    .toMatchObject({ ts: '2026-06-28T11:30', what: 'v93 时代的第二条', tags: ['吃饭'] });
  expect(pageErrors).toHaveLength(0);
});

test('v1.0.0: the export payload carries data version 1 and no app version at all', async ({ page }) => {
  await page.addInitScript(() => {
    window.__copiedBackup = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: text => { window.__copiedBackup = text; return Promise.resolve(); } }
    });
  });
  await boot(page, 768, 'one-record', false, FIXED_NOW);

  // 走真实导出路径（复制 JSON 备份），不是自己拼一个对象。
  await openBackupSheet(page);
  await page.locator('[data-action="copy-json"]').click();
  // copyText 走 clipboard.writeText().then(...)，写入落在微任务里，轮询到非空。
  await expect.poll(() => page.evaluate(() => window.__copiedBackup)).not.toBe('');
  const payload = JSON.parse(await page.evaluate(() => window.__copiedBackup));

  expect(payload.version, '备份载荷版本是数据 schema 版本，不跟随产品版本').toBe(1);
  // 这是 v93↔v1.0.0 双向可读的**原因**：导出不写 app 版本，导入也不校验它。
  // 一旦有人往 meta 里塞版本并在导入端校验，跨版本备份就会开始互相拒绝。
  expect(Object.keys(payload.meta).sort())
    .toEqual(['exportedAt', 'sourceTimeZone', 'sourceTimezoneOffsetMinutes']);
  expect(JSON.stringify(payload)).not.toContain('1.0.0');
});


test('v1.0.0 REDLIGHT: changing the storage key name would make the test fail', async ({ page }) => {
  // P35 红灯纪律：改坏守卫时对应用例必须变红。把 src/storage.js 的 `const KEY`
  // 改成跟随产品版本（`timelog.v1.0.0`），前一条的反向哨兵必须红——那正是它
  // 存在的意义。**探针必须在夹具写种子后安装**，否则会捕获夹具自己的写入。
  await boot(page, 768, 'one-record', false, FIXED_NOW);

  // 夹具已写完种子，现在安装探针（拦截后续真实保存的 setItem）
  await page.evaluate(() => {
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      // 数据键是 timelog.v1（精确匹配，不被 timelog.view / timelog.bootSnapshot.v1 误触）
      if (name === 'timelog.v1') {
        localStorage.setItem('__timelogKeyProbe', name);
      }
      return originalSet.call(this, name, value);
    };
  });

  // 触发真实保存：新增一条记录
  await page.locator('#add-btn').click();
  await expect(page.locator('#form-sheet')).toBeVisible();
  await page.locator('#form-what').fill('红灯探针记录');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  await page.getByRole('button', { name: '保存时间记录' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  await expect(page.locator('#timeline')).toContainText('红灯探针记录');

  // 断言探针捕获到的键是 timelog.v1
  const probed = await page.evaluate(() => localStorage.getItem('__timelogKeyProbe'));
  expect(probed, '这条是守卫真实值的红灯锁，本断言必须通过').toBe('timelog.v1');

  // 额外断言：保存的内容确实写进了 timelog.v1
  const saved = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    return data.entries.some(e => e.what === '红灯探针记录');
  });
  expect(saved, '保存的记录必须真实写入 timelog.v1').toBe(true);
});

test('v1.0.0: the key the app actually writes to is timelog.v1, not a versioned one', async ({ page }) => {
  // 反向哨兵。**不能只看 Object.keys(localStorage)**：夹具自己往 `timelog.v1`
  // 写种子，那个键无论源码声明什么都存在；键被改名后应用只是读不到、从不写带
  // 版本的键，于是「没有三段式键」这条恒真——第一版就是这么写的，红灯没点亮才
  // 逮到。判据必须是**应用实际写入了哪个键**。
  await page.addInitScript(() => {
    window.__writtenKeys = [];
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      window.__writtenKeys.push(name);
      return originalSet.call(this, name, value);
    };
  });
  await boot(page, 768, 'one-record', false, FIXED_NOW);

  // 触发一次真实写入：新增一条记录。
  await page.locator('#add-btn').click();
  await expect(page.locator('#form-sheet')).toBeVisible();
  await page.locator('#form-what').fill('版本迁移写入探针');
  await page.getByRole('button', { name: '选择标签：求职推进' }).click();
  await page.getByRole('button', { name: '保存时间记录' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  await expect(page.locator('#timeline')).toContainText('版本迁移写入探针');

  const written = await page.evaluate(() => window.__writtenKeys);
  expect(written, '记录写入必须落在 timelog.v1').toContain('timelog.v1');
  expect(written.filter(key => /^timelog\..*\d+\.\d+\.\d+/.test(key)),
    '不得写入任何带三段式版本号的 localStorage 键').toEqual([]);

  const dataVersion = await page.evaluate(
    () => JSON.parse(localStorage.getItem('timelog.v1')).version);
  expect(dataVersion, '数据版本与产品版本必须仍然是两件事').toBe(1);
});

test('v1.0.0: the boot snapshot version gate rejects a snapshot written by the old format', async ({ page }) => {
  // 升级后第一次冷启动会判定 rejected:version 并退回正常启动路径——设计如此
  // （旧 DOM 形态不能在新版 JS 下继续活着），不是回归。这里锁死它仍然生效：
  // 换了版本格式后若门失效，旧快照会被当成有效帧恢复。
  await boot(page, 768, 'one-record', false, FIXED_NOW);
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));

  // 判据与 SPEC-013 的 locale 门同一手法：往快照 HTML 里放一个 sentinel，
  // 快照被采用则 sentinel 还在，被拒则重建后消失。
  const forged = await page.evaluate(() => {
    document.querySelector('.entry').dataset.versionSentinel = 'stale';
    const snapshot = JSON.parse(sessionStorage.getItem('timelog.bootSnapshot.v1'));
    if (!snapshot) return null;
    snapshot.appHtml = document.querySelector('.app').innerHTML;
    snapshot.appVersion = '93';
    sessionStorage.setItem('timelog.bootSnapshot.v1', JSON.stringify(snapshot));
    return snapshot.appVersion;
  });
  expect(forged, '主渲染后应当写过启动快照').toBe('93');

  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  await expect(page.locator('.entry[data-version-sentinel="stale"]'),
    '旧格式版本写的快照必须被拒、界面重建').toHaveCount(0);
  await expect(page.locator('#timeline')).toContainText('响应式测试记录');
});

import { expect, test } from '@playwright/test';
import { boot, FIXED_NOW, openAdvancedSheet, openBackupMenu, openBackupSheet } from './ui_fixture.js';

// Isolated synthetic storage only. Keep a native handle for byte comparisons
// while window.localStorage or getItem is denied; never change browser settings.
async function denyReads(page, kind, key = 'timelog.v1') {
  await page.evaluate(({ kind, key }) => {
    const store = window.localStorage;
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem;
    const keys = ['timelog.v1', 'timelog.config', 'timelog.quotes'];
    const raw = () => Object.fromEntries(keys.map(k => [k, get.call(store, k)]));
    window.__readProbe = { before: raw(), raw, denied: 0, writes: [] };
    const probe = window.__readProbe;
    Storage.prototype.setItem = function(k, value) {
      if (this === store && keys.includes(k)) probe.writes.push(k);
      return set.call(this, k, value);
    };
    Storage.prototype.removeItem = function(k) {
      if (this === store && keys.includes(k)) probe.writes.push(k);
      return remove.call(this, k);
    };
    if (kind === 'getter') {
      Object.defineProperty(window, 'localStorage', { configurable: true, get() {
        probe.denied++;
        throw new DOMException('Synthetic denied getter', 'SecurityError');
      } });
    } else {
      Storage.prototype.getItem = function(k) {
        if (this === store && k === key) {
          probe.denied++;
          throw new DOMException('Synthetic denied getItem', 'SecurityError');
        }
        return get.call(this, k);
      };
    }
    window.__restoreReads = () => {
      Object.defineProperty(window, 'localStorage', descriptor);
      Storage.prototype.getItem = get;
    };
    window.__restoreProbe = () => {
      window.__restoreReads();
      Storage.prototype.setItem = set;
      Storage.prototype.removeItem = remove;
    };
  }, { kind, key });
}

async function unchanged(page) {
  const state = await page.evaluate(() => ({
    before: window.__readProbe.before, raw: window.__readProbe.raw(),
    denied: window.__readProbe.denied, writes: window.__readProbe.writes
  }));
  expect(state.denied).toBeGreaterThan(0);
  expect(state.raw).toEqual(state.before);
  expect(state.writes).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

for (const kind of ['getter', 'getItem']) {
  test(`F2 minimal: ${kind} denied edit reports permission and recovers once`, async ({ page }) => {
    await boot(page, 768, 'mid-placeholder', false, FIXED_NOW);
    await page.locator('.entry[data-id="mid-a"] .e-what').click();
    const input = page.locator('[data-role="edit-what"]');
    await input.fill('合成读取拒绝草稿');
    await denyReads(page, kind);
    await page.locator('[data-action="commit-edit"]').click();
    await expect(page.locator('[data-role="conflict-error"]')).toContainText('不允许');
    await expect(input).toHaveValue('合成读取拒绝草稿');
    await unchanged(page);
    await page.evaluate(() => window.__restoreReads());
    await page.locator('[data-action="commit-edit"]').click();
    await expect(page.locator('#form-sheet')).toBeHidden();
    const result = await page.evaluate(() => ({
      entries: JSON.parse(localStorage.getItem('timelog.v1')).entries,
      writes: window.__readProbe.writes
    }));
    expect(result.entries.filter(e => e.what === '合成读取拒绝草稿')).toHaveLength(1);
    expect(result.writes).toEqual(['timelog.v1']);
  });

  test(`F2 minimal: ${kind} denied undo retains recovery in original window`, async ({ page }) => {
    await boot(page, 768, 'three-labels', false, FIXED_NOW);
    const before = await page.evaluate(() => localStorage.getItem('timelog.v1'));
    await page.locator('.entry[data-id="tl-b"] .e-what').click();
    await page.locator('#form-sheet [data-action="request-delete"]').click();
    await page.locator('[data-action="confirm-delete"]').click();
    await expect(page.locator('#form-sheet')).toBeHidden();
    await denyReads(page, kind);
    await page.locator('[data-action="undo-delete"]').click();
    await expect(page.locator('#info-toast')).toContainText('不允许');
    await expect(page.locator('[data-action="undo-delete"]')).toBeVisible();
    await unchanged(page);
    await page.evaluate(() => window.__restoreReads());
    await page.locator('[data-action="undo-delete"]').click();
    expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(before);
    expect(await page.evaluate(() => window.__readProbe.writes)).toEqual(['timelog.v1']);
  });
}

for (const kind of ['getter', 'getItem']) {
  for (const mode of ['new', 'plan', 'plan-edit', 'fill', 'split', 'overnight']) {
    test(`F2: ${kind} denied ${mode} write keeps raw/draft and recovers once`, async ({ page }) => {
      const fixture = mode === 'plan-edit' ? 'planned-expired' : mode === 'split' ? 'pending-confirm-lunch'
        : mode === 'overnight' ? 'yesterday-placeholder' : 'mid-placeholder';
      await boot(page, 768, fixture, false, FIXED_NOW, mode === 'overnight' ? -1 : null, null, mode === 'plan' ? 'plan' : null);
      if (mode === 'plan-edit') await page.locator('.entry[data-id="plan-expired"] .e-what').click();
      else if (mode === 'fill') await page.locator('.entry[data-id="mid-open"] [data-action="backfill-seg"]').click();
      else if (mode === 'split') await page.locator('.entry[data-id="lunch-start"] [data-action="backfill-seg"]').click();
      else await page.locator('#add-btn').click();
      const input = page.locator(mode === 'plan-edit' ? '[data-role="edit-what"]' : '#form-what');
      const save = page.locator(mode === 'plan-edit' ? '[data-action="commit-edit"]' : '[data-action="save-entry"]');
      await input.fill('合成共享写路径草稿');
      await denyReads(page, kind);
      await save.click();
      await expect(page.locator('[data-role="conflict-error"]')).toContainText('不允许');
      await expect(input).toHaveValue('合成共享写路径草稿');
      await unchanged(page);
      await page.evaluate(() => window.__restoreReads());
      await save.click();
      await expect(page.locator('#form-sheet')).toBeHidden();
      const result = await page.evaluate(() => ({
        count: JSON.parse(localStorage.getItem('timelog.v1')).entries.filter(e => e.what === '合成共享写路径草稿').length,
        writes: window.__readProbe.writes
      }));
      expect(result.count).toBe(mode === 'overnight' ? 2 : 1);
      expect(result.writes).toEqual(['timelog.v1']);
    });
  }

  for (const action of ['delete', 'confirm-planned', 'confirm-segment']) {
    test(`F2: ${kind} denied ${action} does not mistake missing data for a valid action`, async ({ page }) => {
      await boot(page, 768, action === 'delete' ? 'three-labels' : action === 'confirm-planned' ? 'planned-expired' : 'pending-confirm-lunch', false, FIXED_NOW);
      if (action === 'delete') {
        await page.locator('.entry[data-id="tl-b"] .e-what').click();
        await page.locator('#form-sheet [data-action="request-delete"]').click();
      }
      const button = page.locator(`[data-action="${action === 'delete' ? 'confirm-delete' : action}"]`);
      await denyReads(page, kind);
      await button.click();
      await expect(page.locator(action === 'delete' ? '[data-role="delete-error"]' : '#info-toast')).toContainText('不允许');
      await unchanged(page);
      await page.evaluate(() => window.__restoreReads());
      await button.click();
      const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
      if (action === 'delete') expect(entries.find(e => e.id === 'tl-b').what).toBe('');
      else if (action === 'confirm-planned') expect(entries.find(e => e.id === 'plan-expired').planned).toBeUndefined();
      else expect(entries.find(e => e.id === 'lunch-start').longConfirm).toEqual({ startTs: '2026-06-29T08:00', endTs: '2026-06-29T12:00' });
      expect(await page.evaluate(() => window.__readProbe.writes)).toEqual(['timelog.v1']);
    });
  }
}

for (const mode of ['config', 'advanced', 'motto', 'quotes', 'disable-quotes']) {
  test(`F2: denied ${mode} key is checked before mutation, then restores normally`, async ({ page }) => {
    await boot(page, 768, 'mid-placeholder', false, FIXED_NOW);
    if (mode === 'quotes' || mode === 'disable-quotes') await page.evaluate(() => {
      localStorage.setItem('timelog.quotes', JSON.stringify({ version: 1, enabled: true, items: ['合成旧句。'], anchor: '2026-06-29' }));
    });
    let input, save, role;
    if (mode === 'config') {
      await openBackupMenu(page);
      await page.locator('[data-action="open-tag-config"]').click();
      const row = page.locator('.cfg-row[data-original-name="睡觉"]');
      await row.locator('.cfg-chip').click();
      input = row.locator('.cfg-name');
      save = page.locator('[data-action="save-tag-config"]');
      role = 'config-error';
    } else if (mode === 'advanced') {
      await openAdvancedSheet(page);
      save = page.locator('[data-action="toggle-long-review"]');
      role = 'advanced-error';
    } else {
      await page.locator('#motto-line').click();
      if (mode === 'disable-quotes') await page.locator('[data-action="pick-motto-mode"][data-mode="motto"]').click();
      input = page.locator(mode === 'quotes' ? '[data-role="quotes-input"]' : '[data-role="motto-input"]');
      save = page.locator('[data-action="save-motto"]');
      role = 'motto-error';
    }
    if (input) await input.fill('合成设置草稿');
    await denyReads(page, 'getItem', mode === 'quotes' || mode === 'disable-quotes' ? 'timelog.quotes' : 'timelog.config');
    await save.click();
    await expect(page.locator(`[data-role="${role}"]`)).toContainText('不允许');
    if (input) await expect(input).toHaveValue('合成设置草稿');
    await unchanged(page);
    await page.evaluate(() => window.__restoreReads());
    await save.click();
    const state = await page.evaluate(() => ({
      config: JSON.parse(localStorage.getItem('timelog.config')), quotes: JSON.parse(localStorage.getItem('timelog.quotes')),
      writes: window.__readProbe.writes
    }));
    if (mode === 'config') expect(state.config.chips.some(c => c.name === '合成设置草稿')).toBe(true);
    else if (mode === 'advanced') expect(state.config.longReview).toBe(true);
    else if (mode === 'quotes') expect(state.quotes.items).toEqual(['合成设置草稿']);
    else expect(state.config.motto).toBe('合成设置草稿');
    if (mode === 'disable-quotes') expect(state.quotes).toMatchObject({ enabled: false, items: ['合成旧句。'] });
    expect(state.writes).toEqual(mode === 'config' ? ['timelog.v1', 'timelog.config'] : mode === 'quotes' ? ['timelog.quotes']
      : mode === 'disable-quotes' ? ['timelog.config', 'timelog.quotes'] : ['timelog.config']);
  });
}

test('F2: new records cannot be saved against an unreadable tag configuration', async ({ page }) => {
  await boot(page, 768, 'mid-placeholder', false, FIXED_NOW);
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('合成自定义标签记录');
  await page.locator('#form-ctag').fill('合成新标签');
  await denyReads(page, 'getItem', 'timelog.config');
  await page.locator('[data-action="save-entry"]').click();
  await expect(page.locator('[data-role="conflict-error"]')).toContainText('不允许');
  await unchanged(page);
  await page.evaluate(() => window.__restoreReads());
  await page.locator('[data-action="save-entry"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.filter(e => e.what === '合成自定义标签记录'))).toHaveLength(1);
});

async function importFile(page, payload) {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-action="import-json"]').click();
  await (await chooser).setFiles({ name: 'synthetic-read-check.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
}
const importedEntry = { id: 'read-import', ts: '2026-06-28T07:00', what: '合成导入记录', tags: ['睡觉'] };

for (const [kind, key] of [['getter', 'timelog.v1'], ['getItem', 'timelog.v1'], ['getItem', 'timelog.config']]) {
  test(`F2: import ${kind}/${key} refusal writes nothing; explicit retry only previews`, async ({ page }) => {
    await boot(page, 768, 'mid-placeholder', false, FIXED_NOW);
    await openBackupSheet(page);
    await importFile(page, { version: 1, entries: [importedEntry] });
    await expect(page.locator('#import-confirm-btn')).toBeEnabled();
    await denyReads(page, kind, key);
    await page.locator('#import-confirm-btn').click();
    await expect(page.locator('[data-role="import-error"]')).toContainText('不允许');
    await unchanged(page);
    await page.evaluate(() => window.__restoreReads());
    await page.locator('[data-action="retry-import-preview"]').click();
    await unchanged(page);
    await page.locator('#import-confirm-btn').click();
    await expect(page.locator('#form-sheet-title')).toHaveText('备份与导入');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.filter(e => e.id === 'read-import'))).toEqual([importedEntry]);
    expect(await page.evaluate(() => window.__readProbe.writes)).toEqual(['timelog.v1', 'timelog.config']);
  });
}

test('F2: a denied first import preview can be retried without reselecting the file', async ({ page }) => {
  await boot(page, 768, 'mid-placeholder', false, FIXED_NOW);
  await openBackupSheet(page);
  await denyReads(page, 'getItem');
  await importFile(page, { version: 1, entries: [importedEntry] });
  await expect(page.locator('[data-role="import-read-failure"]')).toContainText('不允许');
  await expect(page.locator('#import-confirm-btn')).toBeDisabled();
  await unchanged(page);
  await page.evaluate(() => window.__restoreReads());
  await page.locator('[data-action="retry-import-preview"]').click();
  await expect(page.locator('#import-confirm-btn')).toBeEnabled();
  await unchanged(page);
  await page.locator('#import-confirm-btn').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.filter(e => e.id === 'read-import'))).toEqual([importedEntry]);
});

test('F2: a denied conflict action retains the existing cards and choices for retry', async ({ page }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);
  await openBackupSheet(page);
  await importFile(page, { version: 1, entries: [
    { id: 'today-1', ts: '2026-06-29T09:00', what: '合成备份一', tags: ['睡觉'] },
    { id: 'today-2', ts: '2026-06-29T10:00', what: '合成备份二', tags: ['睡觉'] }
  ] });
  const cards = page.locator('.import-conflict-card');
  await expect(cards).toHaveCount(2);
  await cards.nth(0).getByRole('button', { name: '保留本机', exact: true }).click();
  await denyReads(page, 'getItem');
  await cards.nth(1).getByRole('button', { name: '合并文字', exact: true }).click();
  await expect(page.locator('[data-role="import-read-failure"]')).toContainText('不允许');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).getByRole('button', { name: '保留本机', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await unchanged(page);
  await page.evaluate(() => window.__restoreReads());
  await page.locator('[data-action="retry-import-preview"]').click();
  await expect(cards.nth(0).getByRole('button', { name: '保留本机', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#import-confirm-btn')).toBeDisabled();
  await cards.nth(1).getByRole('button', { name: '合并文字', exact: true }).click();
  await page.locator('#import-confirm-btn').click();
  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);
  expect(entries.find(e => e.id === 'today-1').what).toBe('写代码');
  expect(entries.find(e => e.id === 'today-2').what).toBe('改 bug\n\n合成备份二');
});

for (const problem of ['denied', 'concurrent']) {
  test(`F2: optional imported quotes ${problem} preserve local content and report the actual reason`, async ({ page }) => {
    await boot(page, 768, 'two-records', false, FIXED_NOW);
    await openBackupSheet(page);
    await importFile(page, { version: 1, entries: [importedEntry], quotes: { version: 1, enabled: true, items: ['合成备份句。'], anchor: '2026-06-29' } });
    await expect(page.locator('#import-confirm-btn')).toBeEnabled();
    if (problem === 'denied') await denyReads(page, 'getItem', 'timelog.quotes');
    else await page.evaluate(() => {
      const get = Storage.prototype.getItem;
      let injected = false;
      Storage.prototype.getItem = function(key) {
        const raw = get.call(this, key);
        if (this === localStorage && key === 'timelog.quotes' && !injected) {
          injected = true;
          localStorage.setItem(key, JSON.stringify({ version: 1, enabled: true, items: ['合成较新本机句。'], anchor: '2026-06-29' }));
        }
        return raw;
      };
    });
    await page.locator('#import-confirm-btn').click();
    await expect(page.locator('#info-toast')).toContainText(problem === 'denied' ? '不允许' : '本机句库已在别处更新');
    await expect(page.locator('#info-toast')).not.toContainText('空间不足');
    if (problem === 'denied') await page.evaluate(() => window.__restoreReads());
    const state = await page.evaluate(() => ({ entries: JSON.parse(localStorage.getItem('timelog.v1')).entries, quotes: JSON.parse(localStorage.getItem('timelog.quotes')) }));
    expect(state.entries.filter(e => e.id === 'read-import')).toEqual([importedEntry]);
    expect(state.quotes && state.quotes.items).toEqual(problem === 'denied' ? null : ['合成较新本机句。']);
  });
}

test('F2: a denied undo does not reset the original eight-second deadline', async ({ page }) => {
  await page.clock.install({ time: new Date(FIXED_NOW) });
  await boot(page, 768, 'three-labels', false, FIXED_NOW);
  await page.locator('.entry[data-id="tl-b"] .e-what').click();
  await page.locator('#form-sheet [data-action="request-delete"]').click();
  // Freeze the clock before deletion schedules its eight-second timer.
  await page.clock.pauseAt(new Date('2026-06-29T12:35:30'));
  await page.locator('[data-action="confirm-delete"]').click();
  await denyReads(page, 'getItem');
  await page.clock.runFor(7000);
  await page.locator('[data-action="undo-delete"]').click();
  await expect(page.locator('[data-action="undo-delete"]')).toBeVisible();
  await unchanged(page);
  await page.evaluate(() => window.__restoreReads());
  await page.clock.runFor(1001);
  // One-shot after clock delivery: do not wait until an accidentally reset timer expires.
  expect(await page.locator('#undo-toast').isVisible()).toBe(false);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.find(e => e.id === 'tl-b').what)).toBe('');
});

test('F2: a real concurrent write still invalidates undo after storage access recovers', async ({ page, context }) => {
  await boot(page, 768, 'three-labels', false, FIXED_NOW);
  const other = await context.newPage();
  await other.goto('/');
  await other.waitForFunction(() => document.body.classList.contains('app-ready'));
  await page.locator('.entry[data-id="tl-b"] .e-what').click();
  await page.locator('#form-sheet [data-action="request-delete"]').click();
  await page.locator('[data-action="confirm-delete"]').click();
  await denyReads(page, 'getItem');
  await page.locator('[data-action="undo-delete"]').click();
  await expect(page.locator('#info-toast')).toContainText('不允许');
  await page.evaluate(() => window.__restoreReads());
  const newer = await other.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    data.entries.push({ id: 'other-after-denial', ts: '2026-06-28T08:00', what: '合成另一页新记录', tags: ['睡觉'] });
    localStorage.setItem('timelog.v1', JSON.stringify(data));
    return JSON.stringify(data);
  });
  await expect(page.locator('#undo-toast')).toContainText('撤销已取消');
  await expect(page.locator('[data-action="undo-delete"]')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(newer);
  await other.close();
});

test('F2: valid empty storage still creates one record, without a false permission failure', async ({ page }) => {
  await boot(page, 768, 'empty', false, FIXED_NOW);
  await page.evaluate(() => ['timelog.v1', 'timelog.config', 'timelog.quotes'].forEach(key => localStorage.removeItem(key)));
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('合成空库首条');
  await page.locator('[data-action="save-entry"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries.filter(e => e.what === '合成空库首条'))).toHaveLength(1);
});

test('F2: defaults preview refuses an unreadable configuration without losing staged edits', async ({ page }) => {
  await boot(page, 768, 'mid-placeholder', false, FIXED_NOW);
  await page.evaluate(() => {
    const config = JSON.parse(localStorage.getItem('timelog.config'));
    config.chips = config.chips.filter(chip => chip.name !== '吃饭');
    localStorage.setItem('timelog.config', JSON.stringify(config));
  });
  await openBackupMenu(page);
  await page.locator('[data-action="open-tag-config"]').click();
  const row = page.locator('.cfg-row[data-original-name="睡觉"]');
  await row.locator('.cfg-chip').click();
  await row.locator('.cfg-name').fill('合成暂存改名');
  await denyReads(page, 'getItem', 'timelog.config');
  await page.locator('[data-action="preview-locale-defaults"]').click();
  await expect(page.locator('[data-role="config-error"]')).toContainText('不允许');
  await expect(row.locator('.cfg-name')).toHaveValue('合成暂存改名');
  await expect(page.locator('[data-role="defaults-preview"]')).toHaveCount(0);
  await unchanged(page);
  await page.evaluate(() => window.__restoreReads());
  await page.locator('[data-action="preview-locale-defaults"]').click();
  await expect(page.locator('[data-role="defaults-preview"]')).toBeVisible();
  await expect(row.locator('.cfg-name')).toHaveValue('合成暂存改名');
  await unchanged(page);
});

test('F2: checked snapshots pair one read with its data and never swallow an unknown read error', async ({ page }) => {
  await boot(page, 768, 'two-records', false, FIXED_NOW);
  const result = await page.evaluate(async () => {
    const storage = await import('/src/storage.js');
    const pairs = [['timelog.v1', 'loadSnapshotChecked', 'data'], ['timelog.config', 'loadConfigSnapshotChecked', 'config'], ['timelog.quotes', 'loadQuotesSnapshotChecked', 'lib']];
    const get = Storage.prototype.getItem, results = [];
    try {
      for (const [key, reader, field] of pairs) {
        let calls = 0;
        const raw = get.call(localStorage, key);
        Storage.prototype.getItem = function(k) {
          if (this === localStorage && k === key) { calls++; return calls === 1 ? raw : 'DIFFERENT_SECOND_READ'; }
          return get.call(this, k);
        };
        const snapshot = storage[reader]();
        results.push({ ok: snapshot.ok, calls, rawMatches: snapshot.raw === (key === 'timelog.quotes' ? raw : raw || ''), hasData: field in snapshot });
      }
      Storage.prototype.getItem = () => { throw new TypeError('Synthetic unexpected read error'); };
      for (const [, reader] of pairs) {
        try { storage[reader](); results.push({ error: 'not-thrown' }); }
        catch (error) { results.push({ error: error.name }); }
      }
    } finally { Storage.prototype.getItem = get; }
    return results;
  });
  expect(result.slice(0, 3)).toEqual(Array(3).fill({ ok: true, calls: 1, rawMatches: true, hasData: true }));
  expect(result.slice(3)).toEqual(Array(3).fill({ error: 'TypeError' }));
});

// v1.16.1 · 导入冲突三选一键高 44（维护者 2026-11-27「冲突按钮改到 44px」）。
//
// 此前 `.import-conflict-actions button` 写死 min-height 38px：达到 2.5.8 AA（24×24），
// 但低于项目 44px 主要触控基线。锁的是：
// ① 两种冲突卡（同 ID 内容不同 / 同一时刻两条）里每个键高 ≥ 44、同一行等高、不伸出卡片，
//    键面四角附近点下去命中的就是该键（真实命中区，不只看盒子）；点选后高度不变。
// ② 320px 英文：文字不被裁、页面不横向溢出。
// ③ 200% 字号令牌、320px：键随内容长高、不裁字、不横向溢出（min-height 只是下限）。
import { expect, test } from '@playwright/test';
import { boot, FIXED_NOW, openBackupSheet } from './ui_fixture.js';
import { bootLocale } from './i18n_fixture.js';

const TODAY = '2026-06-29';
const INCOMING = [
  { id: 'today-1', ts: `${TODAY}T09:00`, what: '合成备份同ID', tags: ['睡觉'] },
  { id: 'incoming-time', ts: `${TODAY}T10:00`, what: '合成备份同刻', tags: ['吃饭'] }
];

async function importConflicts(page, entries = INCOMING) {
  await openBackupSheet(page);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-action="import-json"]').click();
  await (await chooser).setFiles({ name: 'synthetic-conflicts.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, entries })) });
  await expect(page.locator('.import-conflict-card').first()).toBeVisible();
}

// 逐卡量键：高、是否伸出卡片、是否裁字、四角内缩 3px 处的命中是否是它自己。
async function measure(page) {
  return page.evaluate(() => [...document.querySelectorAll('.import-conflict-card')].map(card => {
    card.scrollIntoView({ block: 'center' });
    const cr = card.getBoundingClientRect();
    return [...card.querySelectorAll('.import-conflict-actions button')].map(b => {
      const r = b.getBoundingClientRect();
      const pts = [[r.left + 3, r.top + 3], [r.right - 3, r.top + 3], [r.left + 3, r.bottom - 3], [r.right - 3, r.bottom - 3]];
      return {
        label: b.textContent.trim(),
        h: r.height,
        outside: r.left < cr.left - 0.5 || r.right > cr.right + 0.5,
        clipped: b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1,
        hits: pts.every(([x, y]) => { const el = document.elementFromPoint(x, y); return el === b || b.contains(el); })
      };
    });
  }));
}

function expectUsable(cards, label) {
  expect(cards.length, label).toBe(2);
  for (const row of cards) {
    expect(row.length, label).toBe(3);
    for (const b of row) {
      expect(b.h, `${label} ${b.label} height`).toBeGreaterThanOrEqual(44);
      expect(b.outside, `${label} ${b.label} outside card`).toBe(false);
      expect(b.clipped, `${label} ${b.label} clipped`).toBe(false);
      expect(b.hits, `${label} ${b.label} hit target`).toBe(true);
    }
    expect(Math.max(...row.map(b => b.h)) - Math.min(...row.map(b => b.h)), `${label} equal heights`).toBeLessThanOrEqual(0.5);
  }
}

async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test('① 两种冲突卡的三选一键高 ≥ 44、等高、命中区就是键面，点选后不变', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page, 390, 'two-records', false, FIXED_NOW);
  await importConflicts(page);
  const cards = page.locator('.import-conflict-card');
  await expect(cards.nth(0)).toContainText('同一记录的内容不同');
  await expect(cards.nth(1)).toContainText('同一时刻有两条记录');
  expectUsable(await measure(page), 'zh 390');

  await cards.nth(0).getByRole('button', { name: '保留本机', exact: true }).click();
  await cards.nth(1).getByRole('button', { name: '合并文字', exact: true }).click();
  await expect(cards.nth(0).getByRole('button', { name: '保留本机', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#import-confirm-btn')).toBeEnabled();
  expectUsable(await measure(page), 'zh 390 after choosing');
});

test('② 320px 英文：键高 ≥ 44、不裁字、页面不横向溢出', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bootLocale(page, {
    locale: 'en', width: 320,
    entries: [{ id: 'today-1', ts: `${TODAY}T09:00`, what: 'Synthetic local text', tags: ['Sleep'] }, { id: 'today-2', ts: `${TODAY}T10:00`, what: 'Synthetic lunch', tags: ['Meals'] }]
  });
  await page.locator('[data-action="open-more"]').click();
  await page.locator('[data-action="open-backup"]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-action="import-json"]').click();
  await (await chooser).setFiles({ name: 'synthetic-conflicts.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, entries: INCOMING })) });
  await expect(page.locator('.import-conflict-card')).toHaveCount(2);
  expectUsable(await measure(page), 'en 320');
  expect(await noHorizontalOverflow(page)).toBe(0);
});

test('③ 200% 字号令牌、320px：键随内容长高、不裁字、不横向溢出', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page, 320, 'two-records', false, FIXED_NOW);
  await page.evaluate(() => {
    const root = document.documentElement;
    for (const key of ['cap', 'ui', 'ui-strong', 'body', 'input', 'title']) {
      const v = parseFloat(getComputedStyle(root).getPropertyValue('--fs-' + key));
      root.style.setProperty('--fs-' + key, v * 2 + 'px');
    }
  });
  await importConflicts(page);
  const cards = await measure(page);
  expectUsable(cards, 'zh 320 200%');
  // 字号翻倍后两行字（或更高）必须撑开键，而不是被 44 的下限截住。
  expect(Math.max(...cards.flat().map(b => b.h))).toBeGreaterThan(44);
  expect(await noHorizontalOverflow(page)).toBe(0);
});

// SPEC-014: thin English-locale UI smoke (kept to a handful of cases — the
// existing tests/ui_smoke.spec.js already covers behavior exhaustively in
// zh; this file only proves the en catalog actually reaches the DOM and that
// the v77 FAB copy variants, the SPEC-013 snapshot locale door, and the new
// language switch all work under a real en boot, not just in the catalog
// file itself.
import { expect, test } from '@playwright/test';
import { bootLocale, TODAY_KEY, YESTERDAY_KEY } from './i18n_fixture.js';

// ① header / view switching renders in English, and <html lang> follows.
test('day view chrome renders in English', async ({ page }) => {
  await bootLocale(page, { entries: [] });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#view-tabs button')).toHaveText(['Day', 'Week', 'Month', 'Year']);
  await expect(page.locator('#list-label')).toHaveText('Timeline');
});

// ② FAB copy, placeholder-tail variant (v77 "From {time}").
test('a history day with a placeholder tail says "From"', async ({ page }) => {
  await bootLocale(page, {
    entries: [{ id: 'yesterday-open', ts: `${YESTERDAY_KEY}T23:00`, what: '', tags: [] }],
    selectedDate: YESTERDAY_KEY
  });
  await expect(page.locator('#add-btn .fab-sub')).toHaveText('From 23:00');
});

// ② FAB copy, real-tail variant (v77 "Backfill from {time}") + ③ new entry
// saves through the form at the nudged default start time.
test('a history day with a real tail says "Backfill from", and the entry saves', async ({ page }) => {
  await bootLocale(page, {
    entries: [{ id: 'yesterday-1', ts: `${YESTERDAY_KEY}T23:00`, what: 'residual note', tags: ['杂'] }],
    selectedDate: YESTERDAY_KEY
  });
  const sub = page.locator('#add-btn .fab-sub');
  await expect(sub).toBeVisible();
  await expect(sub).toHaveText('Backfill from 23:01');

  await page.locator('#add-btn').click();
  await expect(page.locator('#form-sheet-title')).toContainText('Backfill');
  await page.locator('#form-what').fill('backfilled note');
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  await expect(page.locator('.entry', { hasText: 'backfilled note' })).toBeVisible();

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries
    .filter(e => e.what === 'backfilled note').map(e => e.ts));
  expect(saved).toHaveLength(1);
  expect(saved[0].slice(11)).toBe('23:01');
});

// ④ the four bucket names appear where they are meant to: the new-entry
// bucket selector (Focus/Upkeep/Drift) and the day hero aux row (Unlogged).
test('the four bucket names render as Focus/Upkeep/Drift/Unlogged', async ({ page }) => {
  await bootLocale(page, {
    entries: [{ id: 'today-1', ts: `${TODAY_KEY}T09:00`, what: 'writing code', tags: ['求职推进'] }]
  });
  await expect(page.locator('.hero-aux')).toContainText('Upkeep');
  await expect(page.locator('.hero-aux')).toContainText('Unlogged');

  await page.locator('#add-btn').click();
  const bucketSeg = page.locator('.bucket-seg').first();
  await expect(bucketSeg).toContainText('Focus');
  await expect(bucketSeg).toContainText('Upkeep');
  await expect(bucketSeg).toContainText('Drift');
});

// ⑤ the more sheet renders in English and the privacy policy link points at
// the English page (SPEC-014 §1.6 / from SPEC-015 §4).
test('the more sheet renders English cells with the English privacy policy link', async ({ page }) => {
  await bootLocale(page, { entries: [] });
  await page.locator('[data-action="open-more"]').click();
  await expect(page.locator('#form-sheet-title')).toHaveText('More');
  await expect(page.locator('[data-action="open-tag-config"]')).toContainText('Tag settings');
  await expect(page.locator('[data-action="open-help"]')).toContainText('Help');

  const privacyLink = page.locator('a[href$="/privacy/"]');
  await expect(privacyLink).toContainText('Privacy Policy');
  await expect(privacyLink).toHaveAttribute('href', 'https://time.eigentime.org/en/privacy/');
  await expect(privacyLink).toHaveAttribute('target', '_blank');
  await expect(privacyLink).toHaveAttribute('rel', 'noopener');
});

// ⑥ switching back to Chinese from the language seg takes effect immediately
// (no reload, no lost undo state).
test('switching language back to Chinese takes effect immediately', async ({ page }) => {
  await bootLocale(page, { entries: [] });
  await page.locator('[data-action="open-more"]').click();
  await page.locator('[data-action="set-locale"][data-locale="zh"]').click();
  await expect(page.locator('#form-sheet-title')).toHaveText('更多');

  await page.getByRole('button', { name: '关闭更多菜单' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh');
  await expect(page.locator('#view-tabs button').first()).toHaveText('天');
});

// SPEC-013's boot-snapshot locale door, exercised from the en side for the
// first time (the existing zh-side test in ui_smoke.spec.js only proves a
// zh boot rejects a snapshot tagged 'en'; this proves the converse).
test('a boot snapshot written under zh is discarded when the resolved locale is en', async ({ page }) => {
  await bootLocale(page, {
    entries: [{ id: 'today-1', ts: `${TODAY_KEY}T09:00`, what: 'writing code', tags: ['求职推进'] }]
  });
  await expect(page.locator('#timeline')).toContainText('writing code');

  await page.evaluate(() => {
    document.querySelector('.entry').dataset.localeSentinel = 'stale';
    const snapshot = JSON.parse(sessionStorage.getItem('timelog.bootSnapshot.v1'));
    snapshot.appHtml = document.querySelector('.app').innerHTML;
    snapshot.locale = 'zh';
    sessionStorage.setItem('timelog.bootSnapshot.v1', JSON.stringify(snapshot));
  });

  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));

  await expect(page.locator('.entry[data-locale-sentinel="stale"]')).toHaveCount(0);
  await expect(page.locator('#timeline')).toContainText('writing code');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

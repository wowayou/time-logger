// v1.15.6 · 时间分析的复制入口 + 周期明细标出当前行（维护者 2026-11-27 选定第二批）。
//
// 锁的是：
// ① 「复制本期摘要」是本期结论之下、键之上的文字按钮，打开即在视口内（v1.15.4 是排行之后的
//    绿色听筒圆钮，390×844 要先滚约 300px）；只有一个，听筒没了。
// ② 换周期/选键会整块重建分析内容：重建后仍只有一个按钮，文字复位；复制反馈每次现查节点，
//    重建后再复制照样显示，2.2 秒后复位；连点时只留最后一次的定时器；读屏 status 同步。
//    旧路径（无 clipboard）复制后焦点回到按钮，不掉到 body。
// ③ 周/月视图含今天的日期行带「今天」、年视图本月带「本月」（文字 + aria-current），无记录也标；
//    历史周期没有。下钻目的地不变。
// ④ 有数据的行里，有分钟的桶用正文色，恰为 0 分钟的保持灰字——按分钟判（1 分钟也算有）。
//
// FIXED_NOW＝2026-06-29（周一）12:34。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot, openBackupMenu } from './ui_fixture.js';
import { bootLocale } from './i18n_fixture.js';

const copyBtn = page => page.locator('#form-sheet .an-copy');
const copyLabel = page => page.locator('#form-sheet .an-copy [data-role="an-call-label"]');
const copyStatus = page => page.locator('#form-sheet [data-role="an-copy-status"]');

async function openAnalytics(page) {
  await openBackupMenu(page);
  await page.locator('[data-action="open-analytics"]').click();
  await expect(page.locator('#form-sheet-title')).toHaveText('时间分析');
}

function stubClipboard(page) {
  return page.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: text => { window.__copied.push(text); return Promise.resolve(); } }
    });
  });
}

test('① 复制按钮在结论之下、键之上，打开即在视口内；听筒圆钮不再出现', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await openAnalytics(page);
  await expect(copyBtn(page)).toHaveCount(1);
  await expect(copyBtn(page)).toHaveText('复制本期摘要');
  await expect(page.locator('#form-sheet .an-call')).toHaveCount(0);
  const layout = await page.evaluate(() => {
    const q = s => document.querySelector(`#form-sheet ${s}`);
    const display = q('.an-display'), copy = q('.an-copy'), pad = q('[data-role="an-pad"]');
    const body = q('.analytics-body');
    const r = copy.getBoundingClientRect();
    return {
      afterDisplay: Boolean(display.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING),
      beforePad: Boolean(copy.compareDocumentPosition(pad) & Node.DOCUMENT_POSITION_FOLLOWING),
      scrollTop: body.scrollTop, top: r.top, bottom: r.bottom, vh: innerHeight, h: r.height
    };
  });
  expect(layout.afterDisplay).toBe(true);
  expect(layout.beforePad).toBe(true);
  expect(layout.scrollTop).toBe(0);
  expect(layout.top).toBeGreaterThan(0);
  expect(layout.bottom).toBeLessThanOrEqual(layout.vh);
  expect(layout.h).toBeGreaterThanOrEqual(44);
});

test('② 换周期、选键后仍只有一个按钮；复制反馈可见、读屏同步，2.2 秒后复位', async ({ page }) => {
  await stubClipboard(page);
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await openAnalytics(page);

  await copyBtn(page).click();
  await expect(copyLabel(page)).toHaveText('✓ 已复制本期摘要');
  await expect(copyStatus(page)).toHaveText('✓ 已复制本期摘要');
  const weekText = await page.evaluate(() => window.__copied.at(-1));
  expect(weekText.length).toBeGreaterThan(0);

  // 复制后立刻换周期：内容整块重建，新按钮是初始文字，旧定时器不得把新按钮改坏。
  await page.locator('#form-sheet [data-action="analytics-period"][data-period="month"]').click();
  await expect(copyBtn(page)).toHaveCount(1);
  await expect(copyLabel(page)).toHaveText('复制本期摘要');
  await expect(copyStatus(page)).toHaveText('');

  await page.locator('#form-sheet [data-action="analytics-pick"]').nth(1).click();
  await expect(copyBtn(page)).toHaveCount(1);
  await copyBtn(page).click();
  await expect(copyLabel(page)).toHaveText('✓ 已复制本期摘要');
  const monthText = await page.evaluate(() => window.__copied.at(-1));
  expect(monthText).not.toBe(weekText);
  await page.waitForTimeout(2600);
  await expect(copyLabel(page)).toHaveText('复制本期摘要');
  await expect(copyStatus(page)).toHaveText('');
  expect(await page.evaluate(() => window.__copied.length)).toBe(2);
});

test('② 连点两次：第一次的复位定时器不提前撤掉第二次的反馈', async ({ page }) => {
  await stubClipboard(page);
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await openAnalytics(page);
  await copyBtn(page).click();
  await expect(copyLabel(page)).toHaveText('✓ 已复制本期摘要');
  await page.waitForTimeout(1500);
  await copyBtn(page).click();
  // 此时距第一次 2.5s，已过它的 2.2s 复位点、未到第二次的（3.7s）：一次性读取，不重试。
  await page.waitForTimeout(1000);
  expect(await copyLabel(page).textContent()).toBe('✓ 已复制本期摘要');
  await expect(copyLabel(page)).toHaveText('复制本期摘要', { timeout: 3000 });
  expect(await page.evaluate(() => window.__copied.length)).toBe(2);
});

test('② 没有 clipboard 时走旧路径：复制成功后焦点回到按钮', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    window.__legacyCopies = 0;
    document.execCommand = cmd => { if (cmd === 'copy') window.__legacyCopies += 1; return cmd === 'copy'; };
  });
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await openAnalytics(page);
  await copyBtn(page).focus();
  await page.keyboard.press('Enter');
  await expect(copyLabel(page)).toHaveText('✓ 已复制本期摘要');
  expect(await page.evaluate(() => window.__legacyCopies)).toBe(1);
  expect(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('an-copy'))).toBe(true);
});

test('③ 周/月视图标「今天」、年视图标「本月」，带 aria-current；历史周期不标，下钻不变', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  const marked = () => page.locator('#timeline .sum-row[aria-current="date"]');

  await page.locator('[data-action="view"][data-view="week"]').click();
  await expect(page.locator('#timeline .sum-row')).toHaveCount(7);
  await expect(marked()).toHaveCount(1);
  await expect(marked()).toHaveAttribute('data-date', '2026-06-29');
  await expect(marked().locator('.sum-badge')).toHaveText('今天');
  await expect(marked()).toHaveAttribute('aria-label', /今天/);
  await expect(page.locator('#timeline .sum-badge')).toHaveCount(1);

  await page.locator('[data-action="view"][data-view="month"]').click();
  await expect(marked()).toHaveCount(1);
  await expect(marked()).toHaveAttribute('data-date', '2026-06-29');
  await expect(marked().locator('.sum-badge')).toHaveText('今天');

  await page.locator('[data-action="view"][data-view="year"]').click();
  await expect(page.locator('#timeline .sum-row')).toHaveCount(12);
  await expect(marked()).toHaveCount(1);
  await expect(marked()).toHaveAttribute('data-date', '2026-06-01');
  await expect(marked().locator('.sum-badge')).toHaveText('本月');

  await page.locator('[data-action="shift-period"][data-delta="-1"]').click();
  await expect(page.locator('#timeline .sum-row')).toHaveCount(12);
  await expect(page.locator('#timeline .sum-badge')).toHaveCount(0);
  await expect(marked()).toHaveCount(0);
  await page.locator('[data-action="shift-period"][data-delta="1"]').click();

  await marked().click();
  await expect(page.locator('#timeline .sum-row')).toHaveCount(30);
  await expect(marked()).toHaveAttribute('data-date', '2026-06-29');
});

test('③ 今天没有记录时这一行仍标「今天」', async ({ page }) => {
  await boot(page, 390, 'yesterday-residual', false, FIXED_NOW);
  await page.locator('[data-action="view"][data-view="week"]').click();
  const today = page.locator('#timeline .sum-row[data-date="2026-06-29"]');
  await expect(today).toHaveClass(/is-empty/);
  await expect(today).toHaveAttribute('aria-current', 'date');
  await expect(today.locator('.sum-badge')).toHaveText('今天');
});

test('③ 英文年视图标 This month', async ({ page }) => {
  await bootLocale(page, { locale: 'en' });
  await page.locator('[data-action="view"][data-view="year"]').click();
  const row = page.locator('#timeline .sum-row[aria-current="date"]');
  await expect(row).toHaveCount(1);
  await expect(row.locator('.sum-badge')).toHaveText('This month');
  await expect(row).toHaveAttribute('aria-label', 'Open detail for Jun (This month)');
});

test('④ 有数据的行：有分钟的桶正文色，恰为 0 分钟灰字；1 分钟也算有', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    entries: [
      { id: 'a', ts: '2026-06-29T09:00', what: '写代码', tags: ['求职推进'] },
      { id: 'b', ts: '2026-06-29T10:00', what: '刷了一分钟', tags: ['刷手机'] },
      { id: 'c', ts: '2026-06-29T10:01', what: '', tags: [] }
    ],
    config: {
      version: 1,
      mainline: ['求职推进'],
      chips: [{ name: '吃饭', bucket: 'maintain', longOk: false }, { name: '刷手机', bucket: 'leak', longOk: false }]
    }
  });
  await page.locator('[data-action="view"][data-view="week"]').click();
  const row = page.locator('#timeline .sum-row[data-date="2026-06-29"]');
  const spans = await row.locator('.sum-b').evaluateAll(els => els.map(el => ({
    b: el.dataset.b, zero: el.classList.contains('is-zero'), text: el.textContent, color: getComputedStyle(el).color
  })));
  const colors = await page.evaluate(() => {
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    const read = v => { probe.style.color = `var(${v})`; return getComputedStyle(probe).color; };
    const out = { text: read('--text'), muted: read('--muted') };
    probe.remove();
    return out;
  });
  expect(spans.map(s => s.b)).toEqual(['job', 'maintain', 'leak', 'unrecorded']);
  const by = Object.fromEntries(spans.map(s => [s.b, s]));
  expect(by.maintain.zero).toBe(true);
  expect(by.maintain.color).toBe(colors.muted);
  for (const b of ['job', 'leak', 'unrecorded']) {
    expect(by[b].zero).toBe(false);
    expect(by[b].color).toBe(colors.text);
  }
  expect(by.leak.text).not.toContain(' 0%');
});

// v1.5.6：v1.5.5 只修了标签设置的「1 entries」，英文界面其余计数文案同病——
// 导入冲突进度与完成提示（1 conflicts）、时区平移建议（-1 hours）、时间分析的覆盖
// 天数（1/1 days）、启动诊断（last 1 launches、1 files）。中文两形同值，字面不变
// （唯一例外：导入完成提示「处理冲突 N 条」→「处理 N 条冲突」，与进度行共用一个词组）。
//
// 同一行还有一个中英都错的真缺陷：趋势方向按近半/前半**均值**判定，而「连续 N 期」
// 只数**末尾**连续同向的期数——最后一期回落时方向仍是「走高」、期数却是 0，显示成
// 「主线连续 0 期走高」。不足 2 期时改说「近期走高」，与已有的「近期平稳」同一说法。
import { expect, test } from '@playwright/test';
import { bootLocale, TODAY_KEY } from './i18n_fixture.js';

const p2 = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

// 2026-06-29（TODAY_KEY）是周一。往前 4 个已完成周、每周 5 个工作日，主线每天
// dailyMins[w] 分钟，配一条维持段做边界；本周一再记一天，让当期覆盖率是 1/1。
function weeklyEntries(dailyMins, { mainline, upkeep }) {
  const out = [];
  const monday = new Date(2026, 5, 29);
  dailyMins.forEach((mins, i) => {
    const weekStart = new Date(monday);
    weekStart.setDate(monday.getDate() - (dailyMins.length - i) * 7);
    for (let d = 0; d < 5; d += 1) {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + d);
      const dk = dateKey(day);
      out.push({ id: `w${i}-${d}-a`, ts: `${dk}T09:00`, what: 'work', tags: [mainline] });
      out.push({ id: `w${i}-${d}-b`, ts: `${dk}T${p2(9 + Math.floor(mins / 60))}:${p2(mins % 60)}`, what: 'rest', tags: [upkeep] });
    }
  });
  out.push({ id: 'today-a', ts: `${TODAY_KEY}T09:00`, what: 'work', tags: [mainline] });
  out.push({ id: 'today-b', ts: `${TODAY_KEY}T10:00`, what: 'rest', tags: [upkeep] });
  return out;
}

const LOCALES = {
  en: {
    config: { version: 1, mainline: ['Job hunt'], chips: [{ name: 'Rest', bucket: 'maintain' }] },
    tags: { mainline: 'Job hunt', upkeep: 'Rest' }
  },
  zh: {
    config: { version: 1, mainline: ['求职推进'], chips: [{ name: '睡觉', bucket: 'maintain' }] },
    tags: { mainline: '求职推进', upkeep: '睡觉' }
  }
};

async function stubClipboard(page) {
  await page.addInitScript(() => {
    window.__copied = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: text => { window.__copied = text; return Promise.resolve(); } }
    });
  });
}

async function openAnalytics(page, locale) {
  await page.locator('[data-action="open-more"]').click();
  await page.locator('[data-action="open-analytics"]').click();
  await expect(page.locator('#form-sheet .an-trend')).toBeVisible();
}

async function copiedText(page) {
  await page.waitForFunction(() => window.__copied && window.__copied.length > 0);
  return page.evaluate(() => window.__copied);
}

// 每周 5 天 × [60,120,180,150] 分钟 → [300,600,900,750]：均值判走高，最后一期回落。
const FINAL_DIP = [60, 120, 180, 150];
// [60,120,180,240] → [300,600,900,1200]：末尾连续 3 期走高。
const RISING = [60, 120, 180, 240];

const TREND_CASES = [
  { locale: 'en', series: FINAL_DIP, trend: 'Focus trending up lately', not: 'running' },
  { locale: 'en', series: RISING, trend: 'Focus up 3 periods running', not: 'lately' },
  { locale: 'zh', series: FINAL_DIP, trend: '主线近期走高', not: '连续' },
  { locale: 'zh', series: RISING, trend: '主线连续 3 期走高', not: '近期' }
];

for (const { locale, series, trend, not } of TREND_CASES) {
  test(`analytics trend line (${locale}, ${series === FINAL_DIP ? 'final dip' : 'rising'}): ${trend}`, async ({ page }) => {
    const { config, tags } = LOCALES[locale];
    await bootLocale(page, { locale, config, entries: weeklyEntries(series, tags) });
    await openAnalytics(page, locale);
    await expect(page.locator('#form-sheet .an-trend')).toHaveText(trend);
    await expect(page.locator('#form-sheet .an-trend')).not.toContainText(not);
  });
}

// 周一中午：本周已历 1 天且已记录 → 覆盖 1/1；分母为 1 时英文用单数。
test('analytics coverage uses the singular for a one-day denominator, on screen and in the copied summary', async ({ page }) => {
  const { config, tags } = LOCALES.en;
  await stubClipboard(page);
  await bootLocale(page, { locale: 'en', config, entries: weeklyEntries(RISING, tags) });
  await openAnalytics(page, 'en');
  await expect(page.locator('#form-sheet .an-coverage')).toHaveText(/^Logged 1\/1 day · /);
  await page.locator('#form-sheet [data-action="analytics-summary"]').click();
  const text = await copiedText(page);
  expect(text).toContain('Logged: 1/1 day\n');
});

// 周三：本周已历 3 天，复数形不受影响；中文字面与改动前逐字相同。
test('analytics coverage keeps the plural for longer denominators, and Chinese text is unchanged', async ({ page }) => {
  await stubClipboard(page);
  const wednesday = '2026-07-01T12:00:00';
  const { config, tags } = LOCALES.en;
  await bootLocale(page, { locale: 'en', now: wednesday, config, entries: weeklyEntries(RISING, tags) });
  await openAnalytics(page, 'en');
  await expect(page.locator('#form-sheet .an-coverage')).toHaveText(/^Logged 1\/3 days · /);

  const zh = LOCALES.zh;
  await bootLocale(page, { locale: 'zh', now: wednesday, config: zh.config, entries: weeklyEntries(RISING, zh.tags) });
  await openAnalytics(page, 'zh');
  await expect(page.locator('#form-sheet .an-coverage')).toHaveText(/^记录覆盖 1\/3 天 · 共计 /);
  await page.locator('#form-sheet [data-action="analytics-summary"]').click();
  expect(await copiedText(page)).toContain('记录覆盖：1/3 天\n');
});

async function importBackup(page, payload) {
  await page.locator('[data-action="open-more"]').click();
  await page.locator('[data-action="open-backup"]').click();
  await page.locator('[data-action="import-json"]').click();
  await page.setInputFiles('#import-file', {
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload), 'utf-8')
  });
  await expect(page.locator('#import-confirm-btn')).toBeVisible();
}

test('import: one conflict reads "1 conflict" in the progress line and the completion message', async ({ page }) => {
  await bootLocale(page, {
    locale: 'en',
    config: LOCALES.en.config,
    entries: [{ id: 'same', ts: `${TODAY_KEY}T09:00`, what: 'local text', tags: ['Job hunt'] }]
  });
  await importBackup(page, {
    version: 1,
    entries: [{ id: 'same', ts: `${TODAY_KEY}T09:00`, what: 'backup text', tags: ['Job hunt'] }]
  });
  const summary = page.locator('[data-role="import-summary"]');
  await expect(summary).toHaveText('1 conflict · 0/1 resolved');
  await page.locator('.import-conflict-card').getByRole('button', { name: 'Keep local' }).click();
  await expect(summary).toHaveText('1 conflict · 1/1 resolved');
  await page.locator('#import-confirm-btn').click();
  await expect(page.locator('[data-role="info-message"]')).toContainText('resolved 1 conflict.');
});

test.describe('timezone shift hint', () => {
  test.use({ timezoneId: 'Asia/Shanghai' });

  for (const [sourceOffset, expected] of [[-540, 'Suggested shift: -1 hour;'], [-570, 'Suggested shift: -1.5 hours;']]) {
    test(`suggests ${expected}`, async ({ page }) => {
      await bootLocale(page, { locale: 'en', config: LOCALES.en.config });
      await importBackup(page, {
        version: 1,
        meta: { exportedAt: '2026-06-29T03:00:00.000Z', sourceTimezoneOffsetMinutes: sourceOffset },
        entries: [{ id: 'remote', ts: `${TODAY_KEY}T09:00`, what: 'remote entry', tags: ['Job hunt'] }]
      });
      await expect(page.locator('.import-shift-body .form-hint')).toContainText(expected);
    });
  }
});

// 启动诊断是维护者复制给自己排障的文本；样本由测试直接写入，只看排版。
const DIAG_SAMPLE = {
  at: Date.UTC(2026, 5, 29, 4, 0), ver: '1.5.6', gapMin: 5, nav: 'navigate', controlled: true,
  sw: 'a:activated', persisted: true, cache: 'timelog-v1.5.6', cacheFiles: 1, cacheCount: 1,
  htmlMs: 10, moduleMs: 20, fcpMs: 30, readyMs: 40, standalone: false, snapshot: false
};

for (const [locale, expected] of [
  ['en', ['(last 1 launch)', 'cache timelog-v1.5.6 (1 file)']],
  ['zh', ['（最近 1 次启动）', '缓存 timelog-v1.5.6(1文件)']]
]) {
  test(`boot diagnostics copy one launch and one cached file (${locale})`, async ({ page }) => {
    await stubClipboard(page);
    await bootLocale(page, { locale, config: LOCALES[locale].config });
    await page.evaluate(sample => {
      localStorage.setItem('timelog.bootDiag.v1', JSON.stringify({ enabled: true, samples: [sample] }));
    }, DIAG_SAMPLE);
    await page.locator('[data-action="open-more"]').click();
    await page.locator('[data-action="open-advanced"]').click();
    await page.locator('[data-action="copy-boot-diag"]').click();
    const text = await copiedText(page);
    for (const fragment of expected) expect(text).toContain(fragment);
  });
}

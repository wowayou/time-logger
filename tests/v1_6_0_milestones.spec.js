// v1.6.0（D32）：记录里程碑。按**累计**记录日（与 header「已记录 N 天」同一口径，中断
// 不清零），节点 7 · 30 · 100 · 200 · 365，之后每满 100。两处效果：
//   ① header：今天恰好是第 N 个记录日（N 为节点）时整天换成 accent 浅底胶囊，文字不变，
//      读屏多说一句——完全从数据派生，刷新、恢复备份都一致，第二天自然消失；
//   ② 保存那一刻：本机记录写入让累计记录日跨过节点时，亮一次「里程碑：已记录满 N 天」。
//      导入、撤销删除不庆祝——它们不是「今天又记了一天」。
import { expect, test } from '@playwright/test';
import { bootLocale, TODAY_KEY } from './i18n_fixture.js';

const p2 = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

// 今天（2026-06-29）之前的 n 个自然日，每天一条真实记录。
function pastDays(n) {
  const out = [];
  for (let i = n; i >= 1; i -= 1) {
    const day = new Date(2026, 5, 29);
    day.setDate(day.getDate() - i);
    out.push({ id: `past-${i}`, ts: `${dateKey(day)}T09:00`, what: '读书', tags: ['阅读'] });
  }
  return out;
}

const CONFIG = { version: 1, mainline: ['阅读'], chips: [{ name: '睡觉', bucket: 'maintain' }] };
const usage = page => page.locator('#usage-day');
const toast = page => page.locator('#info-toast');

async function saveTodayEntry(page, what) {
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill(what);
  await page.locator('#form-sheet [data-action="save-entry"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
}

// 否定断言不能靠自动重试（一开始就成立，会把「稍后才冒出来」放过去），也不能只看
// 最后一眼：导入完成提示 320ms 后会覆盖同一个 toast，先亮过的里程碑提示就看不见了。
// 所以在动作之前挂一个观察器，记下 toast 每次变化时的文字与 class，最后逐条检查。
async function watchToasts(page) {
  await page.evaluate(() => {
    const el = document.getElementById('info-toast');
    window.__toastLog = [];
    const note = () => window.__toastLog.push({ hidden: el.hidden, milestone: el.classList.contains('is-milestone'), text: el.textContent.trim() });
    new MutationObserver(note).observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
  });
}

async function expectNoMilestoneToast(page) {
  await page.waitForTimeout(900);
  const log = await page.evaluate(() => window.__toastLog);
  expect(Array.isArray(log)).toBe(true);
  for (const item of log) {
    expect(item.milestone).toBe(false);
    expect(item.text).not.toContain('里程碑');
    expect(item.text).not.toContain('Milestone');
  }
  return log;
}

test('saving the record that makes today the 7th logged day shows the milestone once', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: CONFIG, entries: pastDays(6) });
  await expect(usage(page)).toContainText('已记录 6 天');
  await expect(usage(page)).not.toHaveClass(/is-milestone/);

  await saveTodayEntry(page, '今天第一条');
  await expect(toast(page)).toBeVisible();
  await expect(toast(page)).toHaveClass(/is-milestone/);
  await expect(toast(page)).toHaveText('里程碑：已记录满 7 天');
  await expect(usage(page)).toContainText('已记录 7 天');
  await expect(usage(page)).toHaveClass(/is-milestone/);
  await expect(usage(page)).toHaveAttribute('aria-label', /今天是第 7 个记录日，里程碑$/);
});

test('a milestone day stays highlighted after reload, and a second record that day does not celebrate again', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    config: CONFIG,
    entries: [...pastDays(29), { id: 'today-1', ts: `${TODAY_KEY}T09:00`, what: '早上', tags: ['阅读'] }]
  });
  await expect(usage(page)).toHaveClass(/is-milestone/);
  await expect(usage(page)).toHaveAttribute('aria-label', /今天是第 30 个记录日/);
  expect(await toast(page).isHidden()).toBe(true);

  await watchToasts(page);
  await saveTodayEntry(page, '今天第二条');
  await expect(usage(page)).toContainText('已记录 30 天');
  await expectNoMilestoneToast(page);
  await expect(usage(page)).toHaveClass(/is-milestone/);
});

test('the 8th logged day is not a node: no toast, no highlight', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: CONFIG, entries: pastDays(7) });
  await watchToasts(page);
  await saveTodayEntry(page, '第八天');
  await expect(usage(page)).toContainText('已记录 8 天');
  await expectNoMilestoneToast(page);
  expect(await usage(page).evaluate(el => el.classList.contains('is-milestone'))).toBe(false);
});

test('the highlight is gone the next day when nothing is logged yet', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    config: CONFIG,
    now: '2026-06-30T08:00:00',
    entries: [...pastDays(6), { id: 'today-1', ts: `${TODAY_KEY}T09:00`, what: '昨天达成', tags: ['阅读'] }]
  });
  await expect(usage(page)).toContainText('已记录 7 天');
  expect(await usage(page).evaluate(el => el.classList.contains('is-milestone'))).toBe(false);
});

test('marking a planned entry as done can reach a milestone too', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    config: CONFIG,
    entries: [...pastDays(6), { id: 'plan-1', ts: `${TODAY_KEY}T10:00`, what: '计划读书', tags: ['阅读'], planned: true }]
  });
  await expect(usage(page)).toContainText('已记录 6 天');
  await page.locator('[data-action="confirm-planned"][data-id="plan-1"]').click();
  await expect(toast(page)).toHaveText('里程碑：已记录满 7 天');
  await expect(usage(page)).toHaveClass(/is-milestone/);
});

test('undoing a delete restores the highlight but does not celebrate again', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    config: CONFIG,
    entries: [...pastDays(6), { id: 'today-1', ts: `${TODAY_KEY}T09:00`, what: '今天这条', tags: ['阅读'] }]
  });
  await expect(usage(page)).toHaveClass(/is-milestone/);
  await page.locator('.entry[data-id="today-1"] .e-what').click();
  await page.getByRole('button', { name: '删除这条记录' }).click();
  await page.getByRole('button', { name: '确认删除记录' }).click();
  await expect(usage(page)).toContainText('已记录 6 天');
  await expect(usage(page)).not.toHaveClass(/is-milestone/);

  await watchToasts(page);
  await page.locator('#undo-toast [data-action="undo-delete"]').click();
  await expect(usage(page)).toContainText('已记录 7 天');
  await expect(usage(page)).toHaveClass(/is-milestone/);
  await expectNoMilestoneToast(page);
});

test('an import that reaches a node is reflected in the header but does not celebrate', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: CONFIG, entries: pastDays(6) });
  await page.locator('[data-action="open-more"]').click();
  await page.locator('[data-action="open-backup"]').click();
  await page.locator('[data-action="import-json"]').click();
  await page.setInputFiles('#import-file', {
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: 1,
      entries: [{ id: 'imported-today', ts: `${TODAY_KEY}T09:00`, what: '导入的', tags: ['阅读'] }]
    }), 'utf-8')
  });
  await watchToasts(page);
  await page.locator('#import-confirm-btn').click();
  await expect(toast(page)).toContainText('导入');
  await expect(usage(page)).toContainText('已记录 7 天');
  await expect(usage(page)).toHaveClass(/is-milestone/);
  const log = await expectNoMilestoneToast(page);
  expect(log.some(item => item.text.includes('导入'))).toBe(true);
});

test('English copy: toast and screen-reader text', async ({ page }) => {
  await bootLocale(page, {
    locale: 'en',
    config: { version: 1, mainline: ['Reading'], chips: [{ name: 'Sleep', bucket: 'maintain' }] },
    entries: pastDays(6).map(e => ({ ...e, what: 'read', tags: ['Reading'] }))
  });
  await saveTodayEntry(page, 'first today');
  await expect(toast(page)).toHaveText('Milestone: 7 days logged');
  await expect(usage(page)).toHaveText('Day 7 of logging · 7 days logged');
  await expect(usage(page)).toHaveAttribute('aria-label', 'Day 7 of logging, with 7 days actually logged; today is logging day 7, a milestone');
});

for (const scheme of ['light', 'dark']) {
  test(`320px ${scheme}: the 100th-day pill uses the accent tint and stays clear of the more button`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await bootLocale(page, {
      locale: 'zh',
      width: 320,
      config: CONFIG,
      entries: [...pastDays(99), { id: 'today-1', ts: `${TODAY_KEY}T09:00`, what: '第一百天', tags: ['阅读'] }]
    });
    await expect(usage(page)).toHaveClass(/is-milestone/);
    const m = await page.evaluate(() => {
      const el = document.getElementById('usage-day');
      const probe = document.createElement('div');
      probe.style.cssText = 'background: var(--accent-bg); color: var(--accent);';
      document.body.appendChild(probe);
      const want = getComputedStyle(probe);
      const got = getComputedStyle(el);
      const more = document.querySelector('[data-action="open-more"]').getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const result = {
        bg: got.backgroundColor, wantBg: want.backgroundColor,
        color: got.color, wantColor: want.color,
        right: box.right, moreLeft: more.left,
        scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth
      };
      probe.remove();
      return result;
    });
    expect(m.bg).toBe(m.wantBg);
    expect(m.color).toBe(m.wantColor);
    expect(m.right).toBeLessThanOrEqual(m.moreLeft);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
  });
}

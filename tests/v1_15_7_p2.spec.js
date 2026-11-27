// v1.15.7 · P2：日视图首屏、日期导航、悬停与大字下的「更多」（维护者 2026-11-27「P2 也按你的
// 建议做」；顶部字样按视图改为维护者选定的「今天 / 本周 / 本月 / 今年」）。
//
// 锁的是：
// ① 顶部日期栏的字样跟视图走：日「今天」、周「本周」、月「本月」、年「今年」（英文同理）；
//    离开当前周期不显示。此前四个视图都写「今天」。
// ② 「正在做」条在时间轴标题行里（标题左、条占余宽），列表紧跟其下；320px 标题不折行；
//    事项名至少 5em，放不下整条换行，条内不裁切、不横向溢出。
//    升级路径：旧版启动快照（条在 hero 与格言之间、appVersion 旧）被版本门拒绝后，render
//    把条移进标题行——不靠静态壳重建。
// ③ 周期标题是页面底上的文字，不再与 ‹ › 同一层按钮壳。
// ④ 能悬停的精确指针：时间轴行、明细行、更多里的行、‹ › 悬停有底色；正在编辑的行不变。
// ⑤ 200% 字号令牌、320px：「更多」里主题/时间轴/语言三行标题不被挤成一字一行，分段不伸出
//    面板，三个选项都能点；正常字号 320px 英文仍同一行（哨兵）。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot, expectNoHorizontalOverflow } from './ui_fixture.js';
import { bootLocale } from './i18n_fixture.js';

const badge = page => page.locator('#period-label .period-today-badge');

test('① 顶部字样：今天 / 本周 / 本月 / 今年，离开当前周期即消失', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  await expect(badge(page)).toHaveText('今天');
  for (const [view, text] of [['week', '本周'], ['month', '本月'], ['year', '今年']]) {
    await page.locator(`[data-action="view"][data-view="${view}"]`).click();
    await expect(badge(page)).toHaveText(text);
    await page.locator('[data-action="shift-period"][data-delta="-1"]').click();
    await expect(badge(page)).toHaveCount(0);
    await page.locator('#today-btn').click();
    await expect(badge(page)).toHaveText(text);
  }
});

test('① 英文：Today / This week / This month / This year', async ({ page }) => {
  await bootLocale(page, { locale: 'en' });
  await expect(badge(page)).toHaveText('Today');
  for (const [view, text] of [['week', 'This week'], ['month', 'This month'], ['year', 'This year']]) {
    await page.locator(`[data-action="view"][data-view="${view}"]`).click();
    await expect(badge(page)).toHaveText(text);
  }
});

async function stripGeometry(page) {
  return page.evaluate(() => {
    const strip = document.getElementById('now-strip');
    const label = document.getElementById('list-label');
    const motto = document.getElementById('motto-line');
    const first = document.querySelector('#timeline .entry, #timeline .tl-now');
    const s = strip.getBoundingClientRect(), l = label.getBoundingClientRect();
    return {
      inHead: strip.parentElement === document.querySelector('.tl-head'),
      afterMotto: Boolean(motto.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING),
      labelCenterInStrip: l.top + l.height / 2 >= s.top && l.top + l.height / 2 <= s.bottom,
      labelH: l.height,
      labelLineH: parseFloat(getComputedStyle(label).lineHeight) || parseFloat(getComputedStyle(label).fontSize) * 1.5,
      gapToList: first.getBoundingClientRect().top - s.bottom
    };
  });
}

test('② 「正在做」在时间轴标题行，列表紧跟其下', async ({ page }) => {
  await boot(page, 390, 'ongoing-tail', false, FIXED_NOW);
  await expect(page.locator('#now-strip')).toBeVisible();
  const g = await stripGeometry(page);
  expect(g.inHead).toBe(true);
  expect(g.afterMotto).toBe(true);
  expect(g.labelCenterInStrip).toBe(true);
  expect(g.gapToList).toBeLessThanOrEqual(20);
  await page.locator('#now-strip').click();
  await expect(page.locator('#form-sheet [data-role="edit-what"]')).toHaveValue('进行中的事');
});

test('② 320px：标题不折行，不横向溢出', async ({ page }) => {
  await boot(page, 320, 'ongoing-tail', false, FIXED_NOW);
  await expect(page.locator('#now-strip')).toBeVisible();
  const g = await stripGeometry(page);
  expect(g.inHead).toBe(true);
  expect(g.labelH).toBeLessThanOrEqual(g.labelLineH * 1.5);
  await expectNoHorizontalOverflow(page);
});

for (const width of [320, 360]) {
  test(`② ${width}px 英文长事项：条内不裁切、事项名至少 5em、不横向溢出`, async ({ page }) => {
    await bootLocale(page, {
      locale: 'en', width,
      entries: [
        { id: 'a', ts: '2026-06-29T00:00', what: 'Sleep', tags: ['睡觉'] },
        { id: 'b', ts: '2026-06-29T08:00', what: 'Synthetic ongoing task with a fairly long name', tags: ['Focus'], ongoing: true }
      ]
    });
    await expect(page.locator('#now-strip')).toBeVisible();
    const m = await page.evaluate(() => {
      const strip = document.getElementById('now-strip');
      const sr = strip.getBoundingClientRect();
      const what = strip.querySelector('.now-what');
      return {
        clipped: [...strip.children].some(k => { const r = k.getBoundingClientRect(); return r.right > sr.right + 0.5 || r.left < sr.left - 0.5; }),
        whatEm: what.getBoundingClientRect().width / parseFloat(getComputedStyle(what).fontSize)
      };
    });
    // 第一版：320px 末尾被裁成「5h 41m so」（时长未钉 nowrap），或事项名只剩「Sy…」、整条撑出 106px。
    expect(m.clipped).toBe(false);
    expect(m.whatEm).toBeGreaterThanOrEqual(4.99);
    await expectNoHorizontalOverflow(page);
  });
}

test('② 升级路径：旧版快照把条放在 hero 与格言之间，被版本门拒绝后归位到标题行', async ({ page }) => {
  await boot(page, 390, 'ongoing-tail', false, FIXED_NOW);
  await expect(page.locator('#now-strip')).toBeVisible();
  // 把本版写下的快照改造成「旧版」：条移回格言之前、版本号改旧。
  const ok = await page.evaluate(() => {
    const key = 'timelog.bootSnapshot.v1';
    const snap = JSON.parse(sessionStorage.getItem(key));
    if (!snap) return false;
    const holder = document.createElement('div');
    holder.innerHTML = snap.appHtml;
    const strip = holder.querySelector('#now-strip');
    const motto = holder.querySelector('#motto-line');
    motto.parentElement.insertBefore(strip, motto);
    snap.appHtml = holder.innerHTML;
    snap.appVersion = 'old-version-for-test';  // 不能写具体旧版号：升版前 APP_VERSION 可能恰好等于它，快照会被直接采用
    sessionStorage.setItem(key, JSON.stringify(snap));
    return true;
  });
  expect(ok).toBe(true);
  // #boottrace=1 记下快照状态序列：必须先「恢复旧 DOM」再被「版本门拒绝」，否则用例前提不成立。
  await page.evaluate(() => { location.hash = 'boottrace=1'; });
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  const states = await page.evaluate(() => window.__timelogBootTrace && window.__timelogBootTrace.snapshotStates);
  expect(states).toEqual(expect.arrayContaining(['dom-restored', 'rejected:version']));
  await expect(page.locator('#now-strip')).toBeVisible();
  expect((await stripGeometry(page)).inHead).toBe(true);
  await expect(page.locator('#now-strip')).toHaveCount(1);
});

test('③ 周期标题是页面底上的文字，‹ › 仍是按钮壳', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  const bg = await page.evaluate(() => {
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    probe.style.backgroundColor = 'var(--chrome)';
    const chrome = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      label: getComputedStyle(document.getElementById('period-label')).backgroundColor,
      nav: getComputedStyle(document.querySelector('.nav-btn')).backgroundColor,
      chrome
    };
  });
  expect(bg.label).toBe('rgba(0, 0, 0, 0)');
  expect(bg.nav).toBe(bg.chrome);
});

test('④ 精确指针悬停：行与 ‹ › 有底色，正在编辑的行不变', async ({ page }) => {
  await boot(page, 390, 'two-records', false, FIXED_NOW);
  expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)).toBe(true);
  const bgOf = loc => loc.evaluate(el => getComputedStyle(el).backgroundColor);
  const row = page.locator('#timeline .entry[data-action="start-edit"]').first();
  const rest = await bgOf(row);
  await row.hover();
  await expect.poll(() => bgOf(row)).not.toBe(rest);
  await page.mouse.move(1, 1);
  await expect.poll(() => bgOf(row)).toBe(rest);

  const nav = page.locator('.nav-btn').first();
  const navRest = await bgOf(nav);
  await nav.hover();
  await expect.poll(() => bgOf(nav)).not.toBe(navRest);
  await page.mouse.move(1, 1);

  // 正在编辑的行保持编辑底色，悬停不覆盖它。
  await row.click();
  await expect(page.locator('#form-sheet [data-role="edit-what"]')).toBeVisible();
  const editing = page.locator('#timeline .entry.sheet-editing');
  await expect(editing).toHaveCount(1);
  const editBg = await bgOf(editing);
  const box = await editing.boundingBox();
  await page.evaluate(() => document.querySelector('.form-sheet').style.pointerEvents = 'none');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  expect(await bgOf(editing)).toBe(editBg);
});

test('④ 明细行悬停有底色（含无记录的行）', async ({ page }) => {
  await boot(page, 390, 'one-record', false, FIXED_NOW);
  await page.locator('[data-action="view"][data-view="week"]').click();
  const bgOf = loc => loc.evaluate(el => getComputedStyle(el).backgroundColor);
  for (const sel of ['#timeline .sum-row:not(.is-empty)', '#timeline .sum-row.is-empty']) {
    const r = page.locator(sel).first();
    const rest = await bgOf(r);
    await r.hover();
    await expect.poll(() => bgOf(r)).not.toBe(rest);
    await page.mouse.move(1, 1);
  }
});

async function scaleFonts(page, factor) {
  await page.evaluate(f => {
    const root = document.documentElement;
    for (const key of ['cap', 'ui', 'ui-strong', 'body', 'input', 'title']) {
      root.style.setProperty('--fs-' + key, parseFloat(getComputedStyle(root).getPropertyValue('--fs-' + key)) * f + 'px');
    }
  }, factor);
}

async function moreRows(page) {
  await page.locator('[data-action="open-more"]').click();
  await expect(page.locator('#form-sheet .cell-row')).toHaveCount(3);
  return page.locator('#form-sheet .cell-row').evaluateAll(rows => rows.map(row => {
    const label = row.querySelector(':scope > span');
    const seg = row.querySelector('.theme-seg');
    const body = row.closest('.form-sheet-body').getBoundingClientRect();
    const l = label.getBoundingClientRect(), s = seg.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(label).lineHeight) || parseFloat(getComputedStyle(label).fontSize) * 1.5;
    return { label: label.textContent, labelLines: Math.round(l.height / lh), segInside: s.left >= body.left - 1 && s.right <= body.right + 1, sameRow: Math.abs((l.top + l.bottom) / 2 - (s.top + s.bottom) / 2) < 8 };
  }));
}

for (const locale of ['zh', 'en']) {
  test(`⑤ 200% 字号令牌 320px（${locale}）：「更多」三行标题单行、分段不出面板、选项可点`, async ({ page }) => {
    await bootLocale(page, { locale, width: 320, height: 700 });
    await scaleFonts(page, 2);
    const rows = await moreRows(page);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.labelLines, r.label).toBe(1);
      expect(r.segInside, r.label).toBe(true);
    }
    await expectNoHorizontalOverflow(page);
    const scaled = page.locator('#density-seg button').nth(2);
    await scaled.click();
    await expect(scaled).toHaveAttribute('aria-pressed', 'true');
  });
}

test('⑤ 哨兵（前后都绿）：正常字号 320px 英文，三行标题与分段仍在同一行', async ({ page }) => {
  await bootLocale(page, { locale: 'en', width: 320, height: 700 });
  const rows = await moreRows(page);
  for (const r of rows) {
    expect(r.sameRow, r.label).toBe(true);
    expect(r.segInside, r.label).toBe(true);
  }
});

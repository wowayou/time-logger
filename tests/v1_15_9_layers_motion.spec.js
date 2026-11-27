// v1.15.9 · SPEC-016 C 期：层级表与动效（维护者 2026-11-27「P3 也按你的建议做」）。
//
// 锁的是：
// ① 全局层级按令牌表从低到高：状态栏遮罩 < 列表渐隐 < 记一条 = 撤销提示 < 更新横幅 < 表单 sheet
//    < 信息提示 < 跨标签横幅；且每层都取自 --z-* 令牌（改令牌即改全局顺序，不再散落裸数字）。
// ② 减少动效：主界面、周视图、新建、更多、编辑、删除后的撤销提示、时间分析展开事项、标签设置
//    这些状态里，不得有仍在播放的动画，也不得有位移类过渡（transform / 位置 / 尺寸 / flex）；
//    颜色与透明度的渐变不算位移（WCAG 2.3.3 的「运动」）。含 ::before / ::after。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot } from './ui_fixture.js';

const LAYERS = [
  ['.statusbar-scrim', '--z-scrim'],
  ['#list-fade', '--z-fade'],
  ['#add-btn', '--z-float'],
  ['#undo-toast', '--z-float'],
  ['#update-banner', '--z-banner'],
  ['#form-sheet', '--z-sheet'],
  ['#info-toast', '--z-notice'],
  ['#cross-tab-banner', '--z-cross-tab']
];

test('① 全局层级按令牌表排序，且取自 --z-* 令牌', async ({ page }) => {
  await boot(page, 390, 'two-records', false, FIXED_NOW);
  const rows = await page.evaluate(layers => layers.map(([sel, token]) => {
    const el = document.querySelector(sel);
    const root = getComputedStyle(document.documentElement);
    return { sel, token, z: Number(getComputedStyle(el).zIndex), tokenValue: Number(root.getPropertyValue(token).trim()) };
  }), LAYERS);
  for (const r of rows) {
    expect(Number.isFinite(r.z), r.sel).toBe(true);
    expect(r.z, `${r.sel} should use ${r.token}`).toBe(r.tokenValue);
  }
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], cur = rows[i];
    if (prev.token === cur.token) expect(cur.z, `${cur.sel} shares ${cur.token} with ${prev.sel}`).toBe(prev.z);
    else expect(cur.z, `${cur.sel} above ${prev.sel}`).toBeGreaterThan(prev.z);
  }
});

const MOTION_PROPS = /^(all|transform|translate|scale|rotate|top|right|bottom|left|inset.*|width|height|min-.*|max-.*|margin.*|padding.*|flex.*|grid.*)$/;

async function motionOffenders(page) {
  return page.evaluate(re => {
    const motion = new RegExp(re);
    const secs = v => v.split(',').map(s => s.trim()).map(s => s.endsWith('ms') ? parseFloat(s) / 1000 : parseFloat(s));
    const out = [];
    const describe = el => (el.id ? `#${el.id}` : '') + (typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '') || el.tagName.toLowerCase();
    for (const el of document.querySelectorAll('body *')) {
      for (const pseudo of [null, '::before', '::after']) {
        const cs = getComputedStyle(el, pseudo);
        if (pseudo && cs.content === 'none') continue;
        const props = cs.transitionProperty.split(',').map(s => s.trim());
        const durs = secs(cs.transitionDuration);
        props.forEach((prop, i) => {
          const d = durs[i % durs.length] || 0;
          if (d > 0 && motion.test(prop)) out.push(`${describe(el)}${pseudo || ''} transition ${prop} ${d}s`);
        });
        const names = cs.animationName.split(',').map(s => s.trim());
        const adur = secs(cs.animationDuration);
        names.forEach((name, i) => {
          if (name !== 'none' && (adur[i % adur.length] || 0) > 0 && cs.animationPlayState !== 'paused') out.push(`${describe(el)}${pseudo || ''} animation ${name}`);
        });
      }
    }
    return [...new Set(out)];
  }, MOTION_PROPS.source);
}

// 从「更多」下钻的页取消后先回「更多」，再取消才关掉。
async function closeSheets(page) {
  for (let i = 0; i < 3 && await page.locator('#form-sheet').isVisible(); i++) {
    await page.locator('#form-sheet .sh-cancel').click();
  }
  await expect(page.locator('#form-sheet')).toBeHidden();
}

test('② 减少动效：各状态里没有位移类过渡或在播动画', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page, 390, 'ongoing-tail', false, FIXED_NOW);
  const report = {};
  report.day = await motionOffenders(page);

  await page.locator('[data-action="view"][data-view="week"]').click();
  report.week = await motionOffenders(page);
  await page.locator('[data-action="view"][data-view="day"]').click();

  await page.locator('#add-btn').click();
  await expect(page.locator('#form-what')).toBeVisible();
  report.newForm = await motionOffenders(page);
  await page.locator('#form-sheet .sh-cancel').click();
  await expect(page.locator('#form-sheet')).toBeHidden();

  await page.locator('[data-action="open-more"]').click();
  report.more = await motionOffenders(page);
  await page.locator('[data-action="open-analytics"]').click();
  const multi = page.locator('#form-sheet [data-action="analytics-item"]').first();
  if (await multi.count()) await multi.click();
  report.analytics = await motionOffenders(page);
  await closeSheets(page);

  await page.locator('[data-action="open-more"]').click();
  await page.locator('[data-action="open-tag-config"]').click();
  report.tags = await motionOffenders(page);
  await closeSheets(page);

  await page.locator('#now-strip').click();
  await expect(page.locator('#form-sheet [data-role="edit-what"]')).toBeVisible();
  report.edit = await motionOffenders(page);
  await page.locator('#form-sheet [data-action="request-delete"]').click();
  await page.locator('#form-sheet [data-action="confirm-delete"], #form-sheet .sh-done').first().click();
  await expect(page.locator('#undo-toast')).toBeVisible();
  report.undo = await motionOffenders(page);

  expect(report).toEqual({ day: [], week: [], newForm: [], more: [], analytics: [], tags: [], edit: [], undo: [] });
});

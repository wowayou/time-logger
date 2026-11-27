// v1.15.5 · 「记一条」表单瘦身（维护者 2026-11-27 选定第一批：不折叠自定义标签框）。
// 以 v1.15.4 运行时双引擎 10/12 红（余 2 为历史日哨兵）；只撤掉 pickRecordMode 里的
// hidden 切换，① 在「切到计划」一步红。
//
// 锁的是：
// ① 今天「已发生」的普通新建不显示说明行「写下刚才做了什么」——标题、字段名「做了什么」与
//    占位例句已说清要写什么；切到「计划」显示「写下计划要做什么」，切回又隐藏。
// ② 编辑（显示原正文）、补一下、历史日补记的说明行照常显示。历史日补记是前后都绿的
//    哨兵；编辑与补一下在 v1.15.4 上也红——390×820 下网格已把它们的说明行压成 0（即③）。
// ③ 说明行不被压扁：.form-lede 的 overflow:hidden 让网格项自动最小高度归零，计划表单
//    390×820 下两引擎都压成 0，375×667 普通新建压到 15.8px、字被拦腰裁掉（P34 同一机制）。
// ④ 归类分段的选中项带桶色圆点（与标签 chip 同色），未选项留同宽透明空位；编辑表单共用。
//
// 夹具 tail-placeholder + FIXED_NOW：今天 09:00「写代码」#求职推进 + 10:00 占位，默认桶＝主线。
import { expect, test } from '@playwright/test';
import { FIXED_NOW, boot } from './ui_fixture.js';

const lede = page => page.locator('#form-sheet .form-lede');
const bucketBtn = (page, bucket) => page.locator(`#form-sheet .bucket-seg button[data-bucket="${bucket}"]`);

async function openNew(page) {
  await page.locator('#add-btn').click();
  await expect(page.locator('#form-what')).toBeVisible();
}

// 说明行实际占的高度不得小于它的内容高度（被网格压扁时 height < scrollHeight；scrollHeight
// 取整、height 带小数，容差 1px——压扁时实测是 0 或 15.8px，远在容差之外）。
async function ledeBox(page) {
  return lede(page).evaluate(el => ({ h: el.getBoundingClientRect().height, sh: el.scrollHeight, text: el.textContent }));
}

test('① 今天已发生的普通新建不显示说明行；切到计划显示、切回又隐藏', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await openNew(page);
  await expect(lede(page)).toBeHidden();
  await expect(page.locator('#form-sheet-title')).toHaveText('记一条 · 刚才这一阵');
  await expect(page.locator('#form-sheet [data-role="what-label"]')).toHaveText('做了什么');

  await page.locator('#form-sheet [data-action="pick-record-mode"][data-mode="plan"]').click();
  await expect(lede(page)).toBeVisible();
  await expect(lede(page)).toHaveText('写下计划要做什么');

  await page.locator('#form-sheet [data-action="pick-record-mode"][data-mode="log"]').click();
  await expect(lede(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test('① 以计划模式打开（偏好记住了计划）时说明行可见', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW, null, null, 'plan');
  await openNew(page);
  await expect(lede(page)).toBeVisible();
  await expect(lede(page)).toHaveText('写下计划要做什么');
});

test('② 编辑与补一下的说明行照常显示（且不被压扁成 0）', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await page.locator('#timeline [data-action="start-edit"]', { hasText: '写代码' }).first().click();
  await expect(lede(page)).toBeVisible();
  await expect(lede(page)).toHaveText('写代码');
  await page.locator('#form-sheet [data-action="cancel-edit"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();

  await page.locator('#timeline [data-action="backfill-seg"]').first().click();
  await expect(page.locator('#form-what')).toBeVisible();
  await expect(lede(page)).toBeVisible();
  await expect(lede(page)).toHaveText('写下这一段做了什么');
});

test('② 哨兵（前后都绿）：历史日的新建（补记）说明行照常显示', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW, -1);
  await openNew(page);
  await expect(lede(page)).toBeVisible();
  await expect(lede(page)).toHaveText('写下这一段做了什么');
});

test('③ 375×667 矮屏：计划与编辑表单的说明行不被网格压扁', async ({ page }) => {
  await boot(page, 375, 'tail-placeholder', false, FIXED_NOW, null, null, 'plan');
  await page.setViewportSize({ width: 375, height: 667 });
  await openNew(page);
  const plan = await ledeBox(page);
  expect(plan.text).toBe('写下计划要做什么');
  expect(plan.h).toBeGreaterThanOrEqual(plan.sh - 1);
  await page.locator('#form-sheet .sh-cancel').click();
  await expect(page.locator('#form-sheet')).toBeHidden();

  await page.locator('#timeline [data-action="start-edit"]', { hasText: '写代码' }).first().click();
  await expect(page.locator('#form-sheet [data-role="edit-what"]')).toBeVisible();
  const edit = await ledeBox(page);
  expect(edit.text).toBe('写代码');
  expect(edit.h).toBeGreaterThanOrEqual(edit.sh - 1);
});

test('④ 归类选中项带桶色圆点，未选项同宽透明；换桶圆点跟着走，编辑表单同样', async ({ page }) => {
  await boot(page, 390, 'tail-placeholder', false, FIXED_NOW);
  await openNew(page);
  const dots = () => page.locator('#form-sheet .bucket-seg button').evaluateAll(btns => btns.map(b => {
    const cs = getComputedStyle(b, '::before');
    return { bucket: b.dataset.bucket, pressed: b.getAttribute('aria-pressed'), bg: cs.backgroundColor, w: cs.width, content: cs.content };
  }));
  const colors = await page.evaluate(() => {
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    const out = {};
    for (const [bucket, v] of [['job', '--accent'], ['maintain', '--maintain'], ['leak', '--leak']]) {
      probe.style.color = `var(${v})`;
      out[bucket] = getComputedStyle(probe).color;
    }
    probe.remove();
    return out;
  });
  const expectDotOn = async bucket => {
    const list = await dots();
    expect(list.map(d => d.bucket)).toEqual(['job', 'maintain', 'leak']);
    for (const d of list) {
      expect(d.content).not.toBe('none');
      expect(d.w).toBe('8px');
      expect(d.bg).toBe(d.bucket === bucket ? colors[bucket] : 'rgba(0, 0, 0, 0)');
      expect(d.pressed).toBe(String(d.bucket === bucket));
    }
  };
  await expectDotOn('job');
  await bucketBtn(page, 'leak').click();
  await expectDotOn('leak');
  await bucketBtn(page, 'maintain').click();
  await expectDotOn('maintain');
  await page.locator('#form-sheet .sh-cancel').click();
  await expect(page.locator('#form-sheet')).toBeHidden();

  await page.locator('#timeline [data-action="start-edit"]', { hasText: '写代码' }).first().click();
  await expect(page.locator('#form-sheet [data-role="edit-what"]')).toBeVisible();
  await expectDotOn('job');
});

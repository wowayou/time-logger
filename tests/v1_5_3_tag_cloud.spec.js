// SPEC-017（v1.5.3）：标签高级设置改成「标签云 + 点开就地编辑」，加历史主线折叠与筛选；
// 补回默认标签的预览不再落在视口外；合并提示在改名撞名时说「你把 A 改成了 B」。
// 保存 / 合并 / 并发 / 暂存回填的既有语义由 tag_config*.spec.js、tag_merge.spec.js 守着，
// 这里只锁本次新增的呈现行为。
import { expect, test } from '@playwright/test';
import { bootLocale, TODAY_KEY } from './i18n_fixture.js';
import { cfgRow, openCfgRow } from './cfg_fixture.js';

const MAINLINE = ['求职推进', '当前主线', '副业', '阅读', 'blog', '持续学习', '杂', 'develop', 'app推进', '开发', '试试', '博客', '雖離但都是主線'];
const MAINTAIN = ['睡觉', '吃饭', '洗漱', '通勤', '家务', '运动健康', '午睡', '买菜', '做饭', '看病', '理发', '收拾', '散步', '冥想'];
const LEAK = ['娱乐', '刷手机', '发呆', '短视频', '游戏', '闲聊', 'B站', '小红书'];
const MANY = {
  version: 1,
  longReview: true,
  mainline: MAINLINE,
  chips: [
    ...MAINTAIN.map(name => ({ name, bucket: 'maintain', longOk: name === '睡觉' })),
    ...LEAK.map(name => ({ name, bucket: 'leak', longOk: false }))
  ]
};
// 前 20 个标签各一条记录（每天一条，时刻互不相同），其余为零记录。
const MANY_ENTRIES = [...MAINLINE, ...MAINTAIN, ...LEAK].slice(0, 20).map((tag, i) => ({
  id: `e${i}`, ts: `2026-06-${String(10 + i).padStart(2, '0')}T09:00`, what: '记录', tags: [tag]
}));

const readConfig = page => page.evaluate(() => JSON.parse(localStorage.getItem('timelog.config')));

async function openConfig(page) {
  await page.locator('[data-action="open-more"]').click();
  await page.getByRole('button', { name: '配置标签' }).click();
  await expect(page.locator('#form-sheet-title')).toHaveText('标签高级设置');
}

async function expectInViewport(locator) {
  await expect(locator).toBeInViewport();
}

test('35 tags fit in well under 40% of the old 3301px sheet', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: MANY, entries: MANY_ENTRIES, width: 390, height: 820 });
  await openConfig(page);
  const size = await page.locator('.config-body').evaluate(el => ({ h: el.scrollHeight, w: el.scrollWidth, cw: el.clientWidth }));
  // 旧版每行是常驻表单，同一份数据 3301px（SPEC-017 §1 实测）；验收线 40%。
  expect(size.h).toBeLessThanOrEqual(1320);
  expect(size.w).toBeLessThanOrEqual(size.cw);
});

test('a chip opens in place, one card at a time, and the chip shows staged state', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: MANY, entries: MANY_ENTRIES });
  await openConfig(page);
  const sleep = cfgRow(page, '睡觉');
  const meal = cfgRow(page, '吃饭');
  await expect(sleep.locator('.cfg-editor')).toBeHidden();

  await openCfgRow(page, '睡觉');
  await expect(sleep.locator(':scope > .cfg-chip')).toHaveAttribute('aria-expanded', 'true');
  await expect(sleep.locator('.cfg-name')).toBeVisible();

  // 一次只展开一张：点开吃饭，睡觉收起。
  await openCfgRow(page, '吃饭');
  await expect(sleep.locator('.cfg-editor')).toBeHidden();
  await expect(sleep.locator(':scope > .cfg-chip')).toHaveAttribute('aria-expanded', 'false');

  // 改名：卡里显示原名，chip 上显示「原名→新名」并带暂存小点；改回去全部消失。
  await meal.locator('.cfg-name').fill('用餐');
  await expect(meal.locator('[data-role="cfg-was"]')).toHaveText('原名「吃饭」');
  await expect(meal.locator('.cfg-chip-was')).toHaveText('吃饭');
  await expect(meal.locator('.cfg-chip-name')).toHaveText('用餐');
  await expect(meal).toHaveClass(/is-dirty/);
  await meal.locator('.cfg-name').fill('吃饭');
  await expect(meal.locator('[data-role="cfg-was"]')).toBeHidden();
  await expect(meal.locator('.cfg-chip-was')).toBeHidden();
  await expect(meal).not.toHaveClass(/is-dirty/);

  // 改桶后收起：chip 留在原组，圆点换色（data-b），仍标为已修改。
  await meal.locator('[data-action="cfg-pick-bucket"][data-bucket="leak"]').click();
  await meal.locator(':scope > .cfg-chip').click();
  await expect(meal.locator('.cfg-editor')).toBeHidden();
  await expect(meal).toHaveAttribute('data-b', 'leak');
  await expect(meal).toHaveClass(/is-dirty/);
  await expect(page.locator('.cfg-section[data-bucket="maintain"]').locator('.cfg-row[data-original-name="吃饭"]')).toHaveCount(1);
  await expect(meal.locator(':scope > .cfg-chip')).toHaveAttribute('aria-label', /已修改/);

  // 零记录标签点删除后收起：chip 划掉，读屏说「待删除」。
  const nap = await openCfgRow(page, '冥想');
  await nap.locator('[data-action="cfg-toggle-delete"]').click();
  await nap.locator(':scope > .cfg-chip').click();
  await expect(nap.locator('.cfg-chip-name')).toHaveCSS('text-decoration-line', 'line-through');
  await expect(nap.locator(':scope > .cfg-chip')).toHaveAttribute('aria-label', /待删除/);

  // 收起不是保存：全部改动仍等「保存」一起落库。
  expect((await readConfig(page)).chips.find(c => c.name === '吃饭').bucket).toBe('maintain');
  await page.getByRole('button', { name: '保存标签配置' }).click();
  const saved = await readConfig(page);
  expect(saved.chips.find(c => c.name === '吃饭').bucket).toBe('leak');
  expect(saved.chips.some(c => c.name === '冥想')).toBe(false);
});

test('an empty draft disappears when collapsed; a named draft stays as a 新 chip and saves', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: MANY, entries: MANY_ENTRIES });
  await openConfig(page);
  const maintain = page.locator('.cfg-section[data-bucket="maintain"]');
  await maintain.locator('[data-action="cfg-add-row"]').click();
  await expect(maintain.locator('.cfg-row[data-new="1"] .cfg-name')).toBeFocused();
  await openCfgRow(page, '睡觉');
  await expect(maintain.locator('.cfg-row[data-new="1"]')).toHaveCount(0);

  await maintain.locator('[data-action="cfg-add-row"]').click();
  await maintain.locator('.cfg-row[data-new="1"] .cfg-name').fill('拉伸');
  await openCfgRow(page, '睡觉');
  const draft = maintain.locator('.cfg-row[data-new="1"]');
  await expect(draft.locator('.cfg-editor')).toBeHidden();
  await expect(draft.locator('.cfg-chip-name')).toHaveText('拉伸');
  await expect(draft.locator('.cfg-chip-meta')).toHaveText('新');
  await page.getByRole('button', { name: '保存标签配置' }).click();
  expect((await readConfig(page)).chips.find(c => c.name === '拉伸')).toMatchObject({ bucket: 'maintain' });
});

test('past focuses fold by default, edited ones stay visible, and local re-renders keep open/fold/query state', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: MANY, entries: MANY_ENTRIES });
  await openConfig(page);
  const fold = page.locator('.cfg-fold');
  await expect(fold).toHaveText(/历史主线 · 12 个/);
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(cfgRow(page, '副业').locator(':scope > .cfg-chip')).toBeHidden();
  await expect(cfgRow(page, '求职推进').locator(':scope > .cfg-chip')).toBeVisible();

  // 折叠不藏暂存改动：改过名的历史行在收起折叠后仍露在外面。
  const side = await openCfgRow(page, '副业');
  await side.locator('.cfg-name').fill('副业项目');
  await side.locator(':scope > .cfg-chip').click();
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(side.locator(':scope > .cfg-chip')).toBeVisible();
  await expect(cfgRow(page, '杂').locator(':scope > .cfg-chip')).toBeHidden();

  // 「设为当前」原地重渲：折叠状态、展开的卡、筛选词都原样回来。
  await fold.click();
  const search = page.locator('[data-role="cfg-search"]');
  await search.fill('blog');
  await openCfgRow(page, 'blog');
  await cfgRow(page, 'blog').locator('[data-action="set-current-mainline"]').click();
  expect((await readConfig(page)).mainline[0]).toBe('blog');
  await expect(search).toHaveValue('blog');
  await expect(cfgRow(page, 'blog').locator(':scope > .cfg-chip')).toHaveAttribute('aria-expanded', 'true');
  await expect(cfgRow(page, '睡觉')).toBeHidden();
  await search.fill('');
  await expect(page.locator('.cfg-fold')).toHaveAttribute('aria-expanded', 'true');
  await expect(cfgRow(page, '副业').locator('.cfg-name')).toHaveValue('副业项目');
});

test('fewer than three past focuses and fewer than 12 tags: no fold, no search box', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    config: { version: 1, mainline: ['求职推进', '杂', '阅读'], chips: [{ name: '睡觉', bucket: 'maintain', longOk: true }] }
  });
  await openConfig(page);
  await expect(page.locator('.cfg-fold')).toHaveCount(0);
  await expect(page.locator('[data-role="cfg-search"]')).toHaveCount(0);
  await expect(cfgRow(page, '阅读').locator(':scope > .cfg-chip')).toBeVisible();
});

test('search only filters what is shown: hidden rows still save, misses say so, errors reveal a hidden row', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: MANY, entries: MANY_ENTRIES, width: 390, height: 700 });
  await openConfig(page);
  const search = page.locator('[data-role="cfg-search"]');

  // 先把「睡觉」名字清空（会被拦下），再筛到看不见它的词。
  // （展开着的卡不受筛选影响——不把正在编辑的东西从手底下抽走——所以先收起。）
  const sleep = await openCfgRow(page, '睡觉');
  await sleep.locator('.cfg-name').fill('');
  await sleep.locator(':scope > .cfg-chip').click();
  await search.fill('刷');
  await expect(sleep).toBeHidden();
  await expect(cfgRow(page, '刷手机')).toBeVisible();
  await expect(page.locator('.cfg-section[data-bucket="job"]')).toBeHidden();

  await search.fill('不存在的词');
  await expect(page.locator('[data-role="cfg-no-match"]')).toBeVisible();

  // 保存被拦下：筛选清空，出错行展开、聚焦并在视口里。
  await page.getByRole('button', { name: '保存标签配置' }).click();
  await expect(search).toHaveValue('');
  await expect(sleep.locator('.cfg-name')).toBeFocused();
  await expectInViewport(sleep.locator('.cfg-name'));

  // 被筛掉的行照常保存。
  await sleep.locator('.cfg-name').fill('午觉');
  await sleep.locator(':scope > .cfg-chip').click();
  await search.fill('刷');
  await expect(sleep).toBeHidden();
  await page.getByRole('button', { name: '保存标签配置' }).click();
  const names = (await readConfig(page)).chips.map(c => c.name);
  expect(names).toContain('午觉');
  expect(names).not.toContain('睡觉');
});

test('restoring defaults brings the preview into view, focuses 添加, then shows the first added tag', async ({ page }) => {
  // 标签多到正文需要滚动：入口与预览都在底部。重渲染会把正文滚回顶部——旧版因此
  // 「点了入口什么都没发生」（真机验收：显示了、但实际没补回）。
  const chips = Array.from({ length: 80 }, (_, i) => ({ name: `标签${i + 1}`, bucket: i % 2 ? 'leak' : 'maintain', longOk: false }));
  await bootLocale(page, { locale: 'zh', width: 375, height: 600, config: { version: 1, mainline: ['求职推进'], chips } });
  await openConfig(page);
  const entry = page.locator('[data-action="preview-locale-defaults"]');
  await entry.click();
  const preview = page.locator('[data-role="defaults-preview"]');
  await expectInViewport(preview);
  const apply = page.locator('[data-action="apply-locale-defaults"]');
  await expect(apply).toBeFocused();
  await expectInViewport(apply);

  await page.locator('[data-action="cancel-locale-defaults"]').click();
  await expect(entry).toBeFocused();
  await expectInViewport(entry);

  await entry.click();
  await apply.click();
  expect((await readConfig(page)).chips.some(c => c.name === '睡觉')).toBe(true);
  const first = cfgRow(page, '睡觉').locator(':scope > .cfg-chip');
  await expect(first).toBeFocused();
  await expectInViewport(first);
});

test('the merge prompt says "you renamed A to B" when one side was renamed, and keeps the old line for case variants', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    config: { version: 1, mainline: ['求职推进', '阅读', 'blog'], chips: [{ name: 'sleep', bucket: 'maintain', longOk: false }, { name: 'Sleep', bucket: 'maintain', longOk: false }] },
    entries: [
      { id: 'a', ts: `${TODAY_KEY}T08:00`, what: '读书', tags: ['阅读'] },
      { id: 'b', ts: `${TODAY_KEY}T09:00`, what: '写博客', tags: ['blog'] },
      { id: 'c', ts: `${TODAY_KEY}T10:00`, what: '睡', tags: ['Sleep'] }
    ]
  });
  await openConfig(page);
  // 存量 sleep/Sleep 并存：沿用「是同一个标签名」。
  await page.getByRole('button', { name: '保存标签配置' }).click();
  const box = page.locator('[data-role="config-error"]');
  await expect(box).toContainText('是同一个标签名');
  await expect(box).not.toContainText('你把');
  await page.locator('[data-action="dismiss-tag-merge"]').click();

  // 合并掉大小写变体后，再把 blog 改成「阅读」。
  await page.getByRole('button', { name: '保存标签配置' }).click();
  await page.locator('[data-action="confirm-tag-merge"]').click();
  await page.getByRole('button', { name: '配置标签' }).click();
  const blog = await openCfgRow(page, 'blog');
  await blog.locator('.cfg-name').fill('阅读');
  await page.getByRole('button', { name: '保存标签配置' }).click();
  await expect(box).toContainText('你把「blog」改成了「阅读」，而「阅读」已存在');
  await expect(box).toContainText('按「阅读」所在的桶统计');
  // 出问题的那一行是展开的，卡里写着原名。
  await expect(blog.locator('[data-role="cfg-was"]')).toHaveText('原名「blog」');
});

test('English: the chip label, fold and search read naturally', async ({ page }) => {
  await bootLocale(page, { locale: 'en', config: MANY, entries: MANY_ENTRIES });
  await page.locator('[data-action="open-more"]').click();
  await page.getByRole('button', { name: 'Configure tags' }).click();
  await expect(page.locator('.cfg-fold')).toHaveText(/Past focuses · 12/);
  await expect(page.locator('[data-role="cfg-search"]')).toHaveAttribute('placeholder', 'Filter tags');
  await expect(cfgRow(page, '睡觉').locator(':scope > .cfg-chip')).toHaveAttribute('aria-label', '睡觉, 1 entry');
  await expect(cfgRow(page, '冥想').locator(':scope > .cfg-chip')).toHaveAttribute('aria-label', '冥想, no entries');
});

// v85：标签合并 + 大小写不敏感的重名判定（D20 文末受理项）。
// 触发是维护者的两句话：「sleep 和 Sleep 应该算同一个吧」，以及中英默认标签
// 并存的那张截图（`睡觉` 与 `Sleep` 是同一件事却是两个标签，而且**合不了**）。
import { expect, test } from '@playwright/test';
import { bootLocale, TODAY_KEY } from './i18n_fixture.js';

const CONFIG = {
  version: 1,
  mainline: ['求职推进'],
  chips: [
    { name: '睡觉', bucket: 'maintain', longOk: true },
    { name: 'Sleep', bucket: 'maintain', longOk: false },
    { name: '刷手机', bucket: 'leak', longOk: false }
  ]
};

const readConfig = page => page.evaluate(() => JSON.parse(localStorage.getItem('timelog.config')));
const readEntries = page => page.evaluate(() => JSON.parse(localStorage.getItem('timelog.v1')).entries);

async function openConfig(page) {
  await page.locator('[data-action="open-more"]').click();
  await page.getByRole('button', { name: '配置标签' }).click();
  await expect(page.locator('#form-sheet-title')).toHaveText('标签高级设置');
}

test('v85: renaming a tag onto an existing one offers a merge instead of a dead end', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    config: CONFIG,
    entries: [
      { id: 'a', ts: `${TODAY_KEY}T08:00`, what: '午睡', tags: ['Sleep'] },
      { id: 'b', ts: `${TODAY_KEY}T09:00`, what: '再睡', tags: ['Sleep'] },
      { id: 'c', ts: `${TODAY_KEY}T10:00`, what: '睡了', tags: ['睡觉'] }
    ]
  });
  await openConfig(page);
  await page.locator('.cfg-row[data-original-name="Sleep"] .cfg-name').fill('睡觉');
  await page.getByRole('button', { name: '保存标签配置' }).click();

  const box = page.locator('[data-role="config-error"]');
  await expect(box).toContainText('2 条记录会归到「睡觉」');
  // 提示不是终点：给一个显式的「合并」按钮，点了才动数据。
  await page.locator('[data-action="confirm-tag-merge"]').click();

  const config = await readConfig(page);
  expect(config.chips.map(c => c.name)).toEqual(['睡觉', '刷手机']);
  // 目标标签保留自己的桶与 longOk，不被来源覆盖。
  expect(config.chips.find(c => c.name === '睡觉')).toMatchObject({ bucket: 'maintain', longOk: true });
  const entries = await readEntries(page);
  expect(entries.filter(e => (e.tags || [])[0] === '睡觉').map(e => e.id).sort()).toEqual(['a', 'b', 'c']);
  expect(entries.some(e => (e.tags || [])[0] === 'Sleep')).toBe(false);
});

test('v85: a config that already holds sleep and Sleep is not a dead end', async ({ page }) => {
  // 判定改严之后，存量同时存有两种拼写的 config 每次保存都会撞上重名——如果没有
  // 合并出口，用户就永远存不了这张设置页。记录多的留下，少的并进去。
  await bootLocale(page, {
    locale: 'zh',
    config: { version: 1, mainline: ['求职推进'], chips: [
      { name: 'sleep', bucket: 'maintain', longOk: false },
      { name: 'Sleep', bucket: 'maintain', longOk: true }
    ] },
    entries: [
      { id: 'a', ts: `${TODAY_KEY}T08:00`, what: '一', tags: ['Sleep'] },
      { id: 'b', ts: `${TODAY_KEY}T09:00`, what: '二', tags: ['Sleep'] },
      { id: 'c', ts: `${TODAY_KEY}T10:00`, what: '三', tags: ['sleep'] }
    ]
  });
  await openConfig(page);
  await page.getByRole('button', { name: '保存标签配置' }).click();
  await expect(page.locator('[data-role="config-error"]')).toContainText('「sleep」的 1 条记录会归到「Sleep」');
  await page.locator('[data-action="confirm-tag-merge"]').click();

  const config = await readConfig(page);
  expect(config.chips.map(c => c.name)).toEqual(['Sleep']);
  const entries = await readEntries(page);
  expect(entries.every(e => (e.tags || [])[0] === 'Sleep')).toBe(true);
});

test('v85: a brand-new row colliding with an existing tag is a plain duplicate, not a merge', async ({ page }) => {
  // 草稿行从未落库，「合并」无从谈起——那只是「别建这个」。
  await bootLocale(page, { locale: 'zh', config: CONFIG });
  await openConfig(page);
  await page.locator('.cfg-section').filter({ hasText: '维持标签' }).locator('[data-action="cfg-add-row"]').click();
  await page.locator('.cfg-row[data-new="1"] .cfg-name').fill('SLEEP');
  await page.getByRole('button', { name: '保存标签配置' }).click();
  await expect(page.locator('[data-role="config-error"]')).toContainText('重复');
  await expect(page.locator('[data-action="confirm-tag-merge"]')).toHaveCount(0);
  expect((await readConfig(page)).chips.map(c => c.name)).toEqual(['睡觉', 'Sleep', '刷手机']);
});

test('v85: a merge confirmed against stale counts asks again', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    config: CONFIG,
    entries: [{ id: 'a', ts: `${TODAY_KEY}T08:00`, what: '午睡', tags: ['Sleep'] }]
  });
  await openConfig(page);
  await page.locator('.cfg-row[data-original-name="Sleep"] .cfg-name').fill('睡觉');
  await page.getByRole('button', { name: '保存标签配置' }).click();
  await expect(page.locator('[data-role="config-error"]')).toContainText('1 条记录');
  // 另一个标签页又给来源标签记了一条：确认过的计划已经过期。
  await page.evaluate(todayKey => {
    const data = JSON.parse(localStorage.getItem('timelog.v1'));
    data.entries.push({ id: 'x', ts: `${todayKey}T11:00`, what: '别处记的', tags: ['Sleep'] });
    localStorage.setItem('timelog.v1', JSON.stringify(data));
  }, TODAY_KEY);
  await page.locator('[data-action="confirm-tag-merge"]').click();
  // 没有直接写入，而是按新数据重新问一次。
  await expect(page.locator('[data-role="config-error"]')).toContainText('2 条记录');
  expect((await readConfig(page)).chips.map(c => c.name)).toContain('Sleep');
});

test('v85: logging a case-variant tag reuses the existing tag and stores its canonical spelling', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', config: CONFIG });
  await page.getByRole('button', { name: '记一条新的时间记录' }).click();
  await page.locator('#form-what').fill('午睡');
  await page.locator('[data-action="pick-form-bucket"][data-bucket="maintain"]').click();
  await page.locator('#form-ctag').fill('SLEEP');
  await page.getByRole('button', { name: '保存时间记录' }).click();

  // 不长出第二个标签……
  expect((await readConfig(page)).chips.map(c => c.name)).toEqual(['睡觉', 'Sleep', '刷手机']);
  // ……记录也存权威拼写，而不是当时敲的那种。
  const entries = await readEntries(page);
  expect(entries.find(e => e.what === '午睡').tags).toEqual(['Sleep']);
  await expect(page.locator('#timeline')).toContainText('#Sleep');
});

test('v85: case-insensitive identity applies to logging, bucketing and import', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    config: CONFIG,
    // 记录里存的是 `sleep`，config 里是 `Sleep`——同一个标签，必须按维持统计，
    // 而不是掉进未记录。
    entries: [{ id: 'a', ts: `${TODAY_KEY}T08:00`, what: '午睡', tags: ['sleep'] }]
  });
  await expect(page.locator('.hero-aux')).toContainText('维持');
  const buckets = await page.evaluate(async () => {
    const mod = await import('/src/storage.js');
    const config = mod.loadConfig();
    return {
      lower: mod.bucketForTag('sleep', config),
      upper: mod.bucketForTag('SLEEP', config),
      canonical: mod.canonicalTagName('sLeEp', config),
      longOk: mod.longOkForTag('SLEEP', config)
    };
  });
  expect(buckets).toEqual({ lower: 'maintain', upper: 'maintain', canonical: 'Sleep', longOk: false });

  // 导入：备份里的 `SLEEP` 与本机的 `Sleep` 是同一个标签，不得长出第二个 chip。
  const merged = await page.evaluate(async () => {
    const mod = await import('/src/storage.js');
    const local = mod.loadConfig();
    return mod.mergeImportedConfig(local, {
      version: 1,
      mainline: ['求职推进'],
      chips: [{ name: 'SLEEP', bucket: 'leak', longOk: false }, { name: '新标签', bucket: 'leak', longOk: false }]
    }).chips.map(c => `${c.name}:${c.bucket}`);
  });
  expect(merged).toEqual(['睡觉:maintain', 'Sleep:maintain', '刷手机:leak', '新标签:leak']);
});

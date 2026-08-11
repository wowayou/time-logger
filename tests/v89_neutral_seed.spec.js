// v89：出厂默认主线必须是中性占位，不是维护者自己的目标。
//
// 背景：种子此前是 zh「求职推进」/ en「Job search」——那是本项目作者当时的处境。
// 而对外定位是目标中立的「5 秒记下真实做了什么」，于是一个不在找工作的新用户第一次
// 打开记录表单，唯一那个已经预填好的东西对他是错的。这不是「缺一个新手引导」，
// 恰恰相反：产品的首次体验本来就零步骤，问题出在那个零步骤里唯一的预设值。
import { expect, test } from '@playwright/test';
import { bootLocale } from './i18n_fixture.js';

async function mainlineNames(page) {
  await page.locator('[data-action="open-more"]').click();
  await page.locator('[data-action="open-tag-config"]').click();
  return page.$$eval('.cfg-row[data-kind="mainline"] .cfg-name', els => els.map(el => el.value));
}

test('a fresh zh install seeds a neutral mainline placeholder, not the author goal', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', entries: [] });
  await expect.poll(() => mainlineNames(page)).toEqual(['当前主线']);
});

test('a fresh en install seeds a neutral mainline placeholder, not the author goal', async ({ page }) => {
  await bootLocale(page, { locale: 'en', entries: [] });
  await expect.poll(() => mainlineNames(page)).toEqual(['Current focus']);
});

// 反向哨兵：种子只在**全新安装**时生效，存量 config 一个字都不能被改写。
// 这条在改种子时前后都必须绿——它锁的是「零迁移」，不是新默认值本身。
test('an existing config keeps its own mainline verbatim after the seed changed', async ({ page }) => {
  await bootLocale(page, {
    locale: 'zh',
    entries: [],
    config: {
      version: 1,
      mainline: ['求职推进'],
      chips: [{ name: '睡觉', bucket: 'maintain', longOk: true }]
    }
  });
  await expect.poll(() => mainlineNames(page)).toEqual(['求职推进']);
});

// 「主线/维持」自解释，「偏航」不是。它第一次出现时唯一的解释在「···」更多的说明里，
// 而那是新用户最不会点的地方。桶提示行随选中的桶实时切换、就在桶控件下方，是解释它
// 的天然位置。判据同时锁「不含褒贬」——CLAUDE.md 红线要求偏航不得回退成道德评判措辞。
test('picking 偏航 explains what it means right there, without moralising', async ({ page }) => {
  await bootLocale(page, { locale: 'zh', entries: [] });
  await page.locator('#add-btn').click();
  const hint = page.locator('[data-role="mainline-hint"]');
  await expect(hint).toContainText('自定义标签将归入「主线」');

  await page.locator('[data-role="form-bucket-seg"] [data-bucket="leak"]').click();
  await expect(hint).toContainText('偏离当前主线的时间');
  await expect(hint).toContainText('不含褒贬');
  await expect(hint).not.toContainText('逃避');
});

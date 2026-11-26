// 手动发布后核对：只读、全新浏览器上下文，不接触已安装用户的数据。
// node scripts/check_help_release.mjs https://time.eigentime.org/app/ 1.15.3
import { chromium, expect } from '@playwright/test';
const [base, version] = process.argv.slice(2);
const url = new URL(base);
if (!['https://time.eigentime.org/app/', 'https://wowayou.github.io/time-logger/'].includes(url.href)
  && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) throw Error('expected deployed or loopback app');
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('expected release version');
const b = await chromium.launch();
try {
  const c = await b.newContext({ viewport: { width: 375, height: 667 }, locale: 'zh-CN' });
  const p = await c.newPage();
  p.setDefaultTimeout(15000);
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(url.href);
  await p.waitForFunction(() => document.body.classList.contains('app-ready') && navigator.serviceWorker.controller);
  expect(await p.evaluate(async () => (await (await fetch('manifest.webmanifest')).json()).version)).toBe(version);
  expect(await p.evaluate(() => caches.keys())).toContain(`timelog-v${version}`);
  await c.setOffline(true);
  await p.reload();
  await p.locator('[data-action="open-more"]').click();
  await expect(p.locator('.app-version')).toContainText(version);
  await p.locator('[data-action="open-help"]').click();
  await expect(p.locator('.help-body section')).toBeInViewport({ ratio: 1 });
  await expect(p.locator('.help-body section')).toContainText('摘要不能用来恢复');
  await expect(p.locator('.help-body details')).toHaveCount(4);
  await expect(p.locator('.help-body details[open]')).toHaveCount(0);
  await p.locator('.help-body summary').last().click();
  await expect(p.locator('.help-body details[open] p')).toContainText('导入是合并');
  await p.keyboard.press('Escape');
  await expect(p.locator('#form-sheet-title')).toHaveText('更多');
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ at: new Date().toISOString(), url: url.href, version, engine: b.version(), offlineReloadAndHelp: 'passed' }));
} finally { await b.close(); }

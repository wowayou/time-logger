// 手动、仅回环：用已发布源码跑一遍任务，再在同一 origin 升到工作树并离线重开。
// 不读取个人备份/浏览器配置；不下载依赖、部署或模拟 Android 系统手势。
import { chromium, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { extname } from 'node:path';

const tag = process.argv[2];
if (!/^v\d+\.\d+\.\d+$/.test(tag || '')) throw Error('用法：node scripts/check_browser_journey.mjs v1.15.1（仓库根目录）');
const fromTag = file => execFileSync('git', ['show', `${tag}:${file}`]);
async function runtime(read) {
  const sw = (await read('sw.js')).toString();
  const list = [...sw.match(/const FILES = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/([^']*)'/g)].map(m => m[1]);
  return new Map(await Promise.all(list.map(async name => [name, await read(name || 'index.html')])));
}
const old = await runtime(fromTag), next = await runtime(readFile);
const cacheName = assets => assets.get('sw.js').toString().match(/const CACHE = '([^']+)'/)[1];
if (cacheName(old) === cacheName(next)) throw Error('此操作单要求两个不同的缓存版本');
let serving = old;
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!serving.has(name)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': types[extname(name || 'index.html')], 'Cache-Control': 'no-store' }).end(serving.get(name));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
let browser;
try {
  browser = await chromium.launch();
  const start = async () => {
    const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    await page.clock.setFixedTime(new Date('2026-06-29T12:34:30'));
    await page.goto(url);
    await page.waitForFunction(() => document.body.classList.contains('app-ready') && navigator.serviceWorker.controller);
    return page;
  };
  const backupMenu = async p => {
    await p.locator('[data-action="open-more"]').click();
    await p.locator('[data-action="open-backup"]').click();
  };
  const source = await start();
  await source.locator('#add-btn').click();
  await source.locator('#form-what').fill('合成：读书');
  await source.locator('[data-action="save-entry"]').click();
  await source.locator('.entry .e-what').filter({ hasText: '合成：读书' }).click();
  await source.locator('[data-role="edit-what"]').fill('合成：读书与笔记');
  await source.locator('[data-action="commit-edit"]').click();
  await expect(source.locator('#timeline')).toContainText('合成：读书与笔记');
  await backupMenu(source);
  const [download] = await Promise.all([source.waitForEvent('download'), source.locator('#backup-download-btn').click()]);
  const buffer = await readFile(await download.path());
  const exported = JSON.parse(buffer);
  const dest = await start();
  await backupMenu(dest);
  await dest.locator('#import-file').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer });
  await dest.locator('#import-confirm-btn').click();
  const raw = p => p.evaluate(() => ['timelog.v1', 'timelog.config', 'timelog.quotes'].map(k => localStorage.getItem(k)));
  await expect.poll(async () => JSON.parse((await raw(dest))[0])?.entries).toEqual(exported.entries);
  await expect.poll(async () => JSON.parse((await raw(dest))[1])).toMatchObject(exported.config);
  console.log(`${tag}: create/edit/timeline/download/import into clean context passed`);
  await dest.context().close();
  const before = await raw(source);
  await source.context().setOffline(true);
  await source.reload();
  await expect(source.locator('#timeline')).toContainText('合成：读书与笔记');
  await source.context().setOffline(false);
  serving = next;
  await source.evaluate(async () => (await navigator.serviceWorker.ready).update());
  await expect(source.locator('#update-banner')).toBeVisible();
  expect(await raw(source)).toEqual(before);
  await Promise.all([source.waitForEvent('load'), source.locator('[data-action="update-app"]').click()]);
  await expect.poll(() => source.evaluate(() => caches.keys())).toEqual([cacheName(next)]);
  await source.context().setOffline(true);
  await source.reload();
  await expect(source.locator('#timeline')).toContainText('合成：读书与笔记');
  expect(await raw(source)).toEqual(before);
  console.log(`${cacheName(old)} → ${cacheName(next)}: explicit update, offline reopen and data equality passed`);
  await source.clock.setFixedTime(new Date('2026-06-29T12:49:30'));
  await source.locator('#add-btn').click();
  await source.locator('#form-what').fill('合成：断网记录');
  await source.locator('[data-action="save-entry"]').click();
  await expect(source.locator('#form-sheet')).toBeHidden();
  await source.reload();
  await expect(source.locator('#timeline')).toContainText('合成：断网记录');
  const after = JSON.parse((await raw(source))[0]).entries;
  expect(after.filter(e => e.what === '合成：断网记录')).toHaveLength(1);
  expect(after.filter(e => e.what === '合成：读书与笔记')).toHaveLength(1);
  console.log('candidate: offline save survives a second offline reload');
} finally { await browser?.close(); server.closeAllConnections(); server.close(); }

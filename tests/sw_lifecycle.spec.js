// Real install/waiting/activate boundaries, using the actual sw.js and runtime
// assets. Versions and the failed response are fixture-only, never disk edits.
import { test as base, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { extname } from 'node:path';

const swSource = await readFile('sw.js', 'utf8');
const files = [...swSource.match(/const FILES = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/([^']*)'/g)].map(m => m[1]);
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
const OLD = 'timelog-v9.8.1', NEXT = 'timelog-v9.8.2';

const test = base.extend({
  runtimeServer: async ({}, use) => {
    const state = { version: OLD, failPath: '', failedRequests: 0, requests: 0 };
    const server = http.createServer(async (req, res) => {
      const path = new URL(req.url, 'http://127.0.0.1').pathname.slice(1);
      state.requests += 1;
      if (req.method !== 'GET' || !files.includes(path) || state.requests > 200) { res.writeHead(404); res.end(); return; }
      if (state.failPath && path === state.failPath) { state.failedRequests += 1; res.writeHead(503); res.end('synthetic install failure'); return; }
      try {
        const file = path || 'index.html';
        let body = await readFile(file);
        if (file === 'sw.js') body = Buffer.from(swSource.replace(/const CACHE = '[^']+';/, `const CACHE = '${state.version}';`));
        res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(body);
      } catch { res.writeHead(404); res.end(); }
    });
    // Bound to loopback, port allocated by the OS; no closed-port HTTP probe.
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try { await use({ state, url: `http://127.0.0.1:${server.address().port}/` }); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
});
test.use({ serviceWorkers: 'allow' });

async function bootWorker(page, runtimeServer) {
  await page.addInitScript(() => {
    const RealDate = Date, fixed = new RealDate('2026-06-29T12:34:30').getTime();
    window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
    if (!localStorage.getItem('timelog.v1')) {
      localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries: [
        { id: 'sw-original', ts: '2026-06-29T08:00', what: '合成 SW 原记录', tags: ['合成主线'] },
        { id: 'sw-gap', ts: '2026-06-29T09:00', what: '', tags: [] }
      ] }));
      localStorage.setItem('timelog.config', JSON.stringify({ version: 1, mainline: ['合成主线'], chips: [] }));
      localStorage.setItem('timelog.selectedDate', '2026-06-29');
      localStorage.setItem('timelog.openDate', '2026-06-29');
      localStorage.setItem('timelog.view', 'day');
      localStorage.setItem('timelog.locale', 'zh');
    }
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(runtimeServer.url);
  await page.waitForFunction(() => document.body.classList.contains('app-ready') && Boolean(navigator.serviceWorker.controller));
  await expectCache(page, OLD);
}

async function expectCache(page, cacheName) {
  await expect.poll(() => page.evaluate(async name => {
    if (!(await caches.keys()).includes(name)) return 0;
    return (await (await caches.open(name)).keys()).length;
  }, cacheName)).toBe(files.length);
}

async function waitForUpdate(page) {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    window.__controllerBeforeUpdate = navigator.serviceWorker.controller;
    await reg.update();
  });
  await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting));
  await expect(page.locator('#update-banner')).toBeVisible();
}

async function applyUpdate(page) {
  await Promise.all([
    page.waitForEvent('load'),
    page.locator('#update-banner [data-action="update-app"]').click()
  ]);
  await page.waitForFunction(() => document.body.classList.contains('app-ready') && Boolean(navigator.serviceWorker.controller));
  await expectCache(page, NEXT);
  expect(await page.evaluate(() => caches.keys())).not.toContain(OLD);
}

test('R05: a real waiting worker changes neither the controller nor data before the update click', async ({ page, runtimeServer }) => {
  await bootWorker(page, runtimeServer);
  const raw = await page.evaluate(() => localStorage.getItem('timelog.v1'));
  runtimeServer.state.version = NEXT;
  await waitForUpdate(page);
  await expectCache(page, NEXT);
  expect(await page.evaluate(() => navigator.serviceWorker.controller === window.__controllerBeforeUpdate)).toBe(true);
  expect(await page.evaluate(() => caches.keys())).toContain(OLD);
  expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(raw);
  await applyUpdate(page);
  expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(raw);
  expect(runtimeServer.state.requests).toBeLessThanOrEqual(200);
});

test('R05: one failed precache rejects installation, preserves the active worker, then recovers on an explicit new check', async ({ page, runtimeServer }) => {
  await bootWorker(page, runtimeServer);
  runtimeServer.state.version = NEXT;
  runtimeServer.state.failPath = 'packs/focus-zh.txt';
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    window.__failedInstallState = '';
    window.__controllerBeforeUpdate = navigator.serviceWorker.controller;
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker.addEventListener('statechange', () => { window.__failedInstallState = worker.state; });
    }, { once: true });
    await reg.update();
  });
  await page.waitForFunction(() => window.__failedInstallState === 'redundant');
  expect(runtimeServer.state.failedRequests).toBeGreaterThan(0);
  expect(await page.evaluate(() => navigator.serviceWorker.controller === window.__controllerBeforeUpdate)).toBe(true);
  expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting))).toBe(false);
  await expectCache(page, OLD);
  await page.locator('#add-btn').click();
  await page.locator('#form-what').fill('安装失败后仍可记录的合成内容');
  await page.getByRole('button', { name: '选择标签：合成主线' }).click();
  await page.locator('[data-action="save-entry"]').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  const raw = await page.evaluate(() => localStorage.getItem('timelog.v1'));
  expect(JSON.parse(raw).entries.find(e => e.id === 'sw-original').what).toBe('合成 SW 原记录');
  // This is the recovery branch under test, not a retry of a failed assertion.
  runtimeServer.state.failPath = '';
  await waitForUpdate(page);
  await applyUpdate(page);
  expect(await page.evaluate(() => localStorage.getItem('timelog.v1'))).toBe(raw);
  expect(runtimeServer.state.requests).toBeLessThanOrEqual(200);
});

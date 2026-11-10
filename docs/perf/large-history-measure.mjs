// Manual local measurement: 2 engines × 2 sizes × 3 before/after pairs.
// Run: node docs/perf/large-history-measure.mjs [baseline-ref] [output-in-tmp]
// Synthetic data only; no external requests or persistent browser profiles.
import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const baseline = process.argv[2] || 'b4f78bb';
const output = process.argv[3] || '/tmp/time-large-history.json';
const modules = ['stats', 'entry_model', 'app'];
const source = { before: {}, after: {} };
for (const name of modules) {
  source.before[name] = execFileSync('git', ['show', `${baseline}:src/${name}.js`], { cwd: root, encoding: 'utf8', timeout: 10000 });
  source.after[name] = fs.readFileSync(path.join(root, `src/${name}.js`), 'utf8');
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let file = path.join(root, new URL(req.url, 'http://localhost').pathname);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (error, data) => {
    res.writeHead(error ? 404 : 200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(error ? 'not found' : data);
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const cases = ['before', 'after', 'after', 'before', 'before', 'after'];
const results = [];

function seed({ count }) {
  const entries = [];
  const pad = n => String(n).padStart(2, '0');
  const RealDate = Date;
  const now = new RealDate(2026, 10, 9, 12, 34).getTime();
  window.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  for (let i = 0; i < count; i++) {
    const day = Math.floor(i / 15);
    const d = new Date(2026, 10, 9 - Math.floor((count - 1) / 15) + day, 8 + Math.floor(i % 15 / 2), (i % 2) * 30);
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    entries.push({ id: `synthetic-${i}`, ts, what: `合成记录 ${i}，用于性能测量。`, tags: [i % 2 ? '阅读' : '工作'] });
  }
  if (!sessionStorage.getItem('perf-seeded')) {
    localStorage.clear();
    localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries }));
    localStorage.setItem('timelog.config', JSON.stringify({ version: 1, mainline: ['工作'], chips: [{ name: '阅读', bucket: 'maintain', longOk: false }] }));
    localStorage.setItem('timelog.firstUsedDate', '2020-01-01');
    localStorage.setItem('timelog.helpSeen.v16', '1');
    sessionStorage.setItem('perf-seeded', '1');
  }
  const realParse = JSON.parse;
  window.perfDataParses = 0;
  JSON.parse = function (str, ...args) {
    if (typeof str === 'string' && str.startsWith('{"version":1,"entries":')) window.perfDataParses++;
    return realParse.call(this, str, ...args);
  };
}

const readBoot = () => ({ trace: window.__timelogBootTrace, parses: window.perfDataParses });
const appReady = () => document.body.classList.contains('app-ready');
try {
  for (const engine of ['chromium', 'webkit']) {
    const env = { ...process.env, GSETTINGS_BACKEND: 'memory' };
    for (const key of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete env[key];
    const browser = await ({ chromium, webkit })[engine].launch({ headless: true, ...(engine === 'webkit' ? { env } : {}) });
    try {
      for (const variant of cases) for (const count of [5000, 20000]) {
        const context = await browser.newContext({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai', viewport: { width: 390, height: 820 }, serviceWorkers: 'block' });
        context.setDefaultTimeout(30000);
        // Both variants use routing so their HTTP cache behavior is identical.
        await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
        for (const mod of modules) {
          await context.route(`**/src/${mod}.js`, route => route.fulfill({ contentType: 'text/javascript', body: source[variant][mod] }));
        }
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(String(error)));
        await page.addInitScript(seed, { count });
        await page.goto(base + '/#boottrace=1');
        await page.waitForFunction(appReady);
        const cold = await page.evaluate(readBoot);
        const interactions = await page.evaluate(() => {
          const rows = [];
          for (const view of ['week', 'month', 'year', 'day']) {
            const start = performance.now();
            document.querySelector(`[data-action="view"][data-view="${view}"]`).click();
            void document.body.offsetHeight;
            rows.push({ view, ms: performance.now() - start, text: document.querySelector('#ruler').innerText + '\n' + document.querySelector('#timeline').innerText });
          }
          const start = performance.now();
          document.querySelector('#add-btn').click();
          void document.body.offsetHeight;
          const openMs = performance.now() - start;
          document.querySelector('[data-action="close-form"]').click();
          return { rows, openMs };
        });
        await page.reload();
        await page.waitForFunction(appReady);
        const warm = await page.evaluate(readBoot);
        const row = { engine, variant, count, cold, warm, interactions, errors };
        results.push(row);
        console.log(JSON.stringify({ engine, variant, count, cold: cold.trace.marks.find(mark => mark.name === 'app_ready').at, coldParses: cold.parses, warm: warm.trace.marks.find(mark => mark.name === 'app_ready').at, warmParses: warm.parses, views: interactions.rows.map(r => [r.view, r.ms]), openMs: interactions.openMs, errors }));
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }
  fs.writeFileSync(output, JSON.stringify({ baseline, results }, null, 2));
  for (const row of results) {
    assert.deepEqual(row.errors, []);
    const reference = results.find(r => r.engine === row.engine && r.count === row.count && r.variant === 'before');
    assert.deepEqual(row.interactions.rows.map(r => r.text), reference.interactions.rows.map(r => r.text), `${row.engine}/${row.count}: rendered output changed`);
  }
  console.log(`Verified ${results.length} cases; results: ${output}`);
} finally {
  server.close();
}

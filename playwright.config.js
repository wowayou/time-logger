// @ts-check
import { defineConfig } from '@playwright/test';

const staticServer = [
  "const fs = require('fs')",
  "const http = require('http')",
  "const path = require('path')",
  "const root = process.cwd()",
  "const types = {'.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json; charset=utf-8'}",
  "http.createServer((req, res) => { const url = new URL(req.url, 'http://127.0.0.1:4173'); let filePath = path.normalize(path.join(root, decodeURIComponent(url.pathname))); if (!filePath.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; } const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null; if (stat && stat.isDirectory()) filePath = path.join(filePath, 'index.html'); fs.readFile(filePath, (err, body) => { if (err) { res.writeHead(404); res.end('not found'); return; } res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' }); res.end(body); }); }).listen(4173, '127.0.0.1')"
].join(';');

const webkitLibraryPath = process.env.PLAYWRIGHT_WEBKIT_LD_LIBRARY_PATH;
const webkitExecutablePath = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  // Keep one slot per engine during the dual-engine gate. Four-way contention
  // made WebKit's first warmed navigation slower than its 5,000-entry case.
  workers: 2,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    {
      name: 'webkit',
      use: {
        browserName: 'webkit',
        ...(webkitLibraryPath ? {
          launchOptions: {
            env: { ...process.env, LD_LIBRARY_PATH: webkitLibraryPath },
            ...(webkitExecutablePath ? { executablePath: webkitExecutablePath } : {})
          }
        } : {})
      }
    }
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // UI cases must not leak a real persistent worker/cache into later tests;
    // the dedicated update-flow case injects a deterministic registration stub.
    serviceWorkers: 'block',
    // SPEC-014: this sandbox's browsers report navigator.languages as
    // ["en-US"] by default. Before src/locales/en.js existed that was
    // harmless (SUPPORTED_LOCALES only had 'zh', so resolveLocale() always
    // fell through to the DEFAULT_LOCALE fallback regardless of navLangs).
    // Now that 'en' is a real supported locale, an unpinned en-US context
    // would make resolveLocale('', ['en-US']) match 'en' via the
    // startsWith('en-') branch — i.e. every one of the 272 existing zh
    // assertions would silently render in English with zero code changes on
    // their part. Pinning the context locale to zh-CN keeps
    // navigator.languages = ['zh-CN'] so the existing suite keeps resolving
    // 'zh' exactly as before; the new en-locale specs are unaffected because
    // they explicitly set localStorage['timelog.locale'] = 'en' before
    // navigation, and the stored preference always wins over navLangs.
    locale: 'zh-CN',
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {})
  },
  webServer: {
    command: `node -e ${JSON.stringify(staticServer)}`,
    url: 'http://127.0.0.1:4173/',
    // v65 教训：true 会把 4173 上任何陈旧 server 当被测应用（228 用例假超时烧 4.5h）。
    // false＝端口被占直接报错，宁可失败也不静默测错对象。
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe'
  }
});

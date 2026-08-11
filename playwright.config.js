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

// 把开发机/CI 的 HTTP 代理挡在 WebKit 之外。
//
// v87/v88 两个版本的 release notes 都写着「webkit 未在本机跑通（环境问题）」，
// 双引擎门禁的一半一直空着，根因到 v89 才查清：开发机的 GNOME 系统代理是 manual
// 模式而**绕行白名单为空**，连回环都不放行。Chromium 读 `no_proxy` 环境变量（那里
// 有白名单）故一直正常；Playwright 的 Linux WebKit 是 GTK 构建，代理走 GIO/GSettings，
// 于是 http://127.0.0.1:4173 也被发往代理，返回 502、页面从未加载——`boot()` 卡满
// 30s 超时，症状是「挂起」而不是报错，看起来像浏览器坏了。
//
// 本套件零外部依赖、只打自家的 127.0.0.1:4173，所以对 WebKit 一律直连。三格对照
// 实测**两处都必须做，少一个仍然全红**：GSettings 断了它会退回环境变量，环境变量
// 摘了它还有 GSettings。（`use.proxy` 解决不了：Playwright 的 proxy 选项要的是一个
// 真代理地址，填 `direct://` 会让 WebKit 去解析一个叫 "direct" 的主机，比不填更糟。）
const PROXY_ENV_KEYS = ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'];

function webkitLaunchEnv() {
  const env = { ...process.env };
  PROXY_ENV_KEYS.forEach(key => { delete env[key]; });
  env.GSETTINGS_BACKEND = 'memory';
  if (webkitLibraryPath) env.LD_LIBRARY_PATH = webkitLibraryPath;
  return env;
}

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
        launchOptions: {
          env: webkitLaunchEnv(),
          // executablePath 的条件保持原样（只在同时给了库路径时生效），本次只加 env。
          ...(webkitLibraryPath && webkitExecutablePath ? { executablePath: webkitExecutablePath } : {})
        }
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

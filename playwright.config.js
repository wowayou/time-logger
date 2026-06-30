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

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {})
  },
  webServer: {
    command: `node -e ${JSON.stringify(staticServer)}`,
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'pipe'
  }
});

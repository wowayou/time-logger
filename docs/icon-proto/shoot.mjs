import { chromium } from 'playwright';
const url = 'file://' + process.cwd() + '/docs/icon-proto/gallery.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 2 });
await p.goto(url);
await p.waitForTimeout(200);
await p.screenshot({ path: 'docs/icon-proto/gallery.png', fullPage: true });
await b.close();
console.log('shot');

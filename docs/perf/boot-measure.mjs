import { chromium } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const MIME = { '.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json' };

const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p==='/') p='/index.html';
  const fp = path.join(ROOT,p);
  fs.readFile(fp,(e,buf)=>{
    if(e){res.statusCode=404;res.end('nf');return;}
    res.setHeader('Content-Type', MIME[path.extname(fp)]||'application/octet-stream');
    res.end(buf);
  });
});
await new Promise(r=>server.listen(0,r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

async function measure(label, throttle){
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  if (throttle){
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions',{offline:false, latency:throttle.latency, downloadThroughput:throttle.down, uploadThroughput:throttle.up});
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:throttle.cpu});
  }
  await page.goto(base+'/#boottrace=1',{waitUntil:'load'});
  await page.waitForFunction(()=>document.body.classList.contains('app-ready'),{timeout:15000});
  const trace = await page.evaluate(()=>window.__timelogBootTrace);
  const first = trace.marks[0].at;
  const rows = trace.marks.map((m,i)=>{
    const prev = i? trace.marks[i-1].at : first;
    return `  ${String(Math.round(m.at-first)).padStart(6)}ms  (+${String(Math.round(m.at-prev)).padStart(5)})  ${m.name}`;
  });
  console.log(`\n=== ${label} ===`);
  console.log(rows.join('\n'));
  console.log(`  snapshot: ${trace.snapshotStates.join(' → ')}`);
  await browser.close();
}

await measure('no throttle (warm dev box)', null);
// Simulated mid-tier mobile: ~3x CPU, ~fast-3G latency
await measure('CPU 4x + 3G-ish', {latency:150, down: 1.6*1024*1024/8, up: 750*1024/8, cpu:4});
await measure('CPU 6x + slow-3G', {latency:300, down: 780*1024/8, up: 330*1024/8, cpu:6});

server.close();

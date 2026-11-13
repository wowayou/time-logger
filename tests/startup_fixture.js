// Test-only startup evidence. Observe Playwright events without injecting code,
// changing app-ready, retrying navigation or wrapping the application's rAF.
// Only failed tests collect terminal DOM flags; never read storage, page text,
// response bodies, headers, full URLs or exception messages.
import { test as base, expect } from '@playwright/test';

export { expect };
const MAX_PAGES = 4;
const MAX_REQUESTS = 80;
const MAX_EVENTS = 32;
const MAX_ERRORS = 8;
const READ_TIMEOUT_MS = 1200;

function runtimePath(url) {
  try {
    const path = new URL(url).pathname;
    if (/\/(?:app\/|time-logger\/)?$/.test(path)) return 'index.html';
    return path.match(/(?:^|\/)(src\/(?:locales\/)?[a-z_]+\.js|styles\.css|index\.html|manifest\.webmanifest|sw\.js|icon\.svg|icons\/[a-z0-9-]+\.png|packs\/[a-z-]+\.txt)$/)?.[1] || '[other]';
  } catch { return '[other]'; }
}

function errorFrames(error) {
  return String(error.stack || '').split('\n').slice(0, 12).flatMap(line => {
    const frame = line.match(/(https?:\/\/[^\s)]+):(\d+):(\d+)/);
    return frame ? [{ path: runtimePath(frame[1]), line: Number(frame[2]), column: Number(frame[3]) }] : [];
  });
}

async function terminalState(page) {
  if (page.isClosed()) return { closed: true };
  let timer;
  try {
    return await Promise.race([
      page.evaluate(() => ({
        readyState: document.readyState,
        visibility: document.visibilityState,
        focused: document.hasFocus(),
        appReady: document.body?.classList.contains('app-ready') || false,
        bootRestored: document.body?.classList.contains('boot-restored') || false,
        timelineChildren: document.getElementById('timeline')?.children.length || 0,
        moduleElements: document.querySelectorAll('script[type="module"]').length,
        elapsedMs: Math.round(performance.now())
      })).catch(() => ({ unavailable: 'page-unavailable' })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ unavailable: 'read-timeout' }), READ_TIMEOUT_MS); })
    ]);
  } finally { clearTimeout(timer); }
}

export function observeStartup(context) {
  const rows = [];
  let droppedPages = 0;
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const observe = page => {
    if (rows.some(row => row.page === page)) return;
    if (rows.length >= MAX_PAGES) { droppedPages++; return; }
    const requests = new Map(), events = [], errors = [], listeners = [];
    const row = { page, requests, events, errors, listeners, droppedRequests: 0, droppedEvents: 0, droppedErrors: 0 };
    rows.push(row);
    const on = (name, fn) => { page.on(name, fn); listeners.push([name, fn]); };
    const event = name => {
      if (events.length === MAX_EVENTS) { events.shift(); row.droppedEvents++; }
      events.push({ event: name, atMs: elapsed() });
    };
    on('request', request => {
      if (requests.size === MAX_REQUESTS) { requests.delete(requests.keys().next().value); row.droppedRequests++; }
      requests.set(request, { path: runtimePath(request.url()), state: 'pending', atMs: elapsed() });
    });
    on('response', response => {
      const record = requests.get(response.request());
      if (record) record.status = response.status();
    });
    on('requestfinished', request => {
      const record = requests.get(request);
      if (record) { record.state = 'finished'; record.endMs = elapsed(); }
    });
    on('requestfailed', request => {
      const record = requests.get(request);
      if (record) {
        record.state = 'failed';
        record.endMs = elapsed();
        record.code = String(request.failure()?.errorText || '').match(/ERR_[A-Z0-9_]+/)?.[0] || 'request-failed';
      }
    });
    on('pageerror', error => {
      if (errors.length === MAX_ERRORS) { errors.shift(); row.droppedErrors++; }
      errors.push({ name: ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'SecurityError'].includes(error.name) ? error.name : 'Error', frames: errorFrames(error), atMs: elapsed() });
    });
    on('domcontentloaded', () => event('domcontentloaded'));
    on('load', () => event('load'));
    on('crash', () => event('crash'));
    on('close', () => event('close'));
    on('framenavigated', frame => { if (frame === page.mainFrame()) event('navigation'); });
  };
  context.pages().forEach(observe);
  context.on('page', observe);
  return {
    async snapshot() {
      return { droppedPages, pages: await Promise.all(rows.map(async row => ({
        state: await terminalState(row.page),
        requests: [...row.requests.values()], events: row.events.slice(), errors: row.errors.slice(),
        droppedRequests: row.droppedRequests, droppedEvents: row.droppedEvents, droppedErrors: row.droppedErrors
      }))) };
    },
    dispose() {
      context.off('page', observe);
      for (const row of rows) for (const [name, listener] of row.listeners) row.page.off(name, listener);
    }
  };
}

// Scoped to test files with historical startup failures, not the timing stress
// suite. Main and secondary pages are both observed before their navigation.
export const test = base.extend({
  startupEvidence: [async ({ context }, use, testInfo) => {
    const observer = observeStartup(context);
    try {
      await use();
    } finally {
      try {
        if (testInfo.status !== testInfo.expectedStatus) await testInfo.attach('startup-evidence', {
          body: JSON.stringify(await observer.snapshot(), null, 2), contentType: 'application/json'
        });
      } finally { observer.dispose(); }
    }
  }, { auto: true, timeout: 5000 }]
});

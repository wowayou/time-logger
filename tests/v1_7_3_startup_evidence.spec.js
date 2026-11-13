import { test, expect } from '@playwright/test';
import { EventEmitter } from 'node:events';
import { observeStartup } from './startup_fixture.js';
import { boot, FIXED_NOW } from './ui_fixture.js';

test('F4: diagnostics distinguish the failed second page without recording storage, text or URL queries', async ({ page, context }, testInfo) => {
  const beforeListeners = context.listenerCount('page');
  const observer = observeStartup(context);
  try {
    await boot(page, 390, 'two-records', false, FIXED_NOW);
    const other = await context.newPage();
    await other.route('**/src/app.js', route => route.abort('failed'));
    await other.goto('/?synthetic-private=SyntheticSensitiveMarker');
    const pageError = other.waitForEvent('pageerror');
    await other.evaluate(() => setTimeout(() => { throw new TypeError('SyntheticSensitiveMarker'); }, 0));
    await pageError;
    const report = await observer.snapshot();
    expect(report.pages).toHaveLength(2);
    expect(report.pages[0].state.appReady).toBe(true);
    expect(report.pages[1].state.appReady).toBe(false);
    expect(report.pages[1].requests.some(r => r.path === 'src/app.js' && r.state === 'failed')).toBe(true);
    expect(report.pages[1].errors.some(error => error.name === 'TypeError')).toBe(true);
    const json = JSON.stringify(report);
    expect(json).not.toContain('SyntheticSensitiveMarker');
    expect(json).not.toContain('写代码');
    expect(json).not.toContain('timelog.v1');
    await testInfo.attach('synthetic-startup-observer-check', { body: json, contentType: 'application/json' });
    await other.close();
  } finally { observer.dispose(); }
  expect(context.listenerCount('page')).toBe(beforeListeners);
});

test('F4: observer data, terminal reads and listeners stay bounded', async () => {
  const context = new EventEmitter();
  context.pages = () => [];
  const observer = observeStartup(context);
  const pages = [];
  try {
    for (let i = 0; i < 6; i++) {
      const page = new EventEmitter();
      page.isClosed = () => false;
      page.evaluate = () => i === 0 ? new Promise(() => {}) : Promise.resolve({ appReady: false });
      pages.push(page);
      context.emit('page', page);
    }
    for (let i = 0; i < 100; i++) {
      const request = { url: () => `http://127.0.0.1:4173/src/app.js?synthetic-private=${i}` };
      pages[0].emit('request', request);
      pages[0].emit('requestfinished', request);
      pages[0].emit('load');
      pages[0].emit('pageerror', new TypeError('not retained'));
    }
    const report = await observer.snapshot();
    expect(report.droppedPages).toBe(2);
    expect(report.pages).toHaveLength(4);
    expect(report.pages[0].state).toEqual({ unavailable: 'read-timeout' });
    expect(report.pages[0].requests).toHaveLength(80);
    expect(report.pages[0].events).toHaveLength(32);
    expect(report.pages[0].errors).toHaveLength(8);
    expect(report.pages[0]).toMatchObject({ droppedRequests: 20, droppedEvents: 68, droppedErrors: 92 });
    expect(JSON.stringify(report)).not.toContain('synthetic-private');
  } finally { observer.dispose(); }
  expect(context.listenerCount('page')).toBe(0);
  for (const page of pages) expect(page.eventNames()).toEqual([]);
});

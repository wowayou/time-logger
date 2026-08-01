// Stress tests — run with: npm run test:stress
// Independent from the smoke suite; shares the same static server and ui_fixture boot helpers.
// Each test group is self-contained: data is injected via addInitScript / page.evaluate.

import { test, expect } from '@playwright/test';

// ─── Data generator ───────────────────────────────────────────────────────────
// Produces realistic entries mirroring real backup statistics:
//   ~15 entries/day, 25-tag pool, ~6% with longConfirm, 60-80 char notes.
const TAG_POOL = [
  'app推進', '開發', '求职推进', '睡觉', '吃饭', '洗漱', '杂', '娱乐', '運動健康',
  '整理', '持續學習', '研究·学工具·逃避', '試試', '各種', '会议', '阅读', '休息',
  '复盘', '写作', '运动', '购物', '家务', '学习', '工作', '聊天'
];

function generateEntries(count) {
  const entries = [];
  let current = new Date('2025-01-01T08:00:00');

  for (let i = 0; i < count; i++) {
    const pad = n => String(n).padStart(2, '0');
    const ts = `${current.getFullYear()}-${pad(current.getMonth() + 1)}-${pad(current.getDate())}T${pad(current.getHours())}:${pad(current.getMinutes())}`;
    const entry = {
      id: i.toString(36).padStart(9, '0'),
      ts,
      what: `压测生成记录${i}，内容用于模拟真实备注长度`,
      tags: [TAG_POOL[i % TAG_POOL.length]]
    };
    // ~6% have longConfirm (matching real backup ratio)
    if (i % 17 === 0 && i > 0) {
      entry.longConfirm = { startTs: entries[i - 1].ts, endTs: ts };
    }
    entries.push(entry);
    // Advance 15–40 min (matches real avg of 15–18 entries/day)
    current = new Date(current.getTime() + (15 + (i % 6) * 5) * 60_000);
  }
  return entries;
}

// ─── A 类：数据规模压测 ────────────────────────────────────────────────────────
// 判据从**绝对壁钟阈值**改为**相对空数据基线的倍率**（HANDOFF 登记的方向）。
//
// 为什么必须改：绝对阈值测的是这台机器有多忙，不是代码有多快。实测（同一次
// 运行、同一台机器）：空数据启动 webkit 383ms / chromium 327ms，而 500 条是
// 0.97×/0.98×——**500 条数据本身几乎不产生任何开销**。原来 450ms 的阈值因此
// 完全由「空载启动成本」决定：机器闲时 ~250ms 通过，机器忙时 ~390ms+ 假红。
// 它长期在双引擎上飘，每次都要用未改动代码做对照才能排除，成本比它的价值高。
//
// 现在每个用例先在同一 page 上量一次**空数据**基线（中位数），再量目标数据量，
// 断言倍率。这才对应用例名字里的「数据规模」：机器速度被基线约掉，剩下的就是
// 数据带来的增量。倍率上限按实测留足头寸，同时仍能抓住真回归——例如把统计写成
// O(n²)，5000 条会远远冲破 2.5×。
const BOOT_SAMPLES = 3;
const SCALE_CASES = [
  // 实测倍率（本机、取最小值口径）：见下方 console 输出；上限留足头寸，同时
  // 仍能抓住真回归——把统计写成 O(n²) 的话 5000 条会远远冲破 2.5×。
  { count: 500,  label: '小压 500 条  (~1 个月)',  maxRatio: 1.6 },
  { count: 2000, label: '中压 2000 条 (~4 个月)',  maxRatio: 1.9 },
  { count: 5000, label: '极压 5000 条 (~11 个月)', maxRatio: 2.5 }
];

/**
 * 同一 page 上量启动耗时，取 N 次里的**最小值**。
 * 取最小而非中位：干扰只会让测量变慢、不会让它变快，所以最小值＝最少被干扰的
 * 那一次，是噪声机器上做基准的标准做法。中位数在实测里仍会被基线抖动带偏
 * （基线样本见过 431/315/336 的跨度），留给 500 条的头寸只剩 14%，等于把刚修掉
 * 的飘又请回来。entries 为空即基线。
 */
async function medianBoot(page, entries) {
  await page.addInitScript(({ seed }) => {
    localStorage.clear();
    localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries: seed }));
  }, { seed: entries });
  // 预热一次，吸收一次性的进程/缓存成本。
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  const samples = [];
  for (let i = 0; i < BOOT_SAMPLES; i += 1) {
    const t0 = Date.now();
    await page.goto('/');
    await page.waitForFunction(() => document.body.classList.contains('app-ready'));
    samples.push(Date.now() - t0);
  }
  return { best: Math.min(...samples), samples };
}

test.describe('A 类：数据规模', () => {
  for (const { count, label, maxRatio } of SCALE_CASES) {
    test(label, async ({ page }) => {
      const baseline = await medianBoot(page, []);
      const loadedBoot = await medianBoot(page, generateEntries(count));
      const ratio = loadedBoot.best / baseline.best;

      // Also measure stats recompute via timeline render
      const renderMs = await page.evaluate(() => {
        const t = performance.now();
        // Force a synchronous layout read to flush pending render work
        document.getElementById('timeline').getBoundingClientRect();
        return performance.now() - t;
      });

      console.log(`[A] ${label}: baseline=${baseline.best}ms [${baseline.samples.join(', ')}] `
        + `loaded=${loadedBoot.best}ms [${loadedBoot.samples.join(', ')}] ratio=${ratio.toFixed(2)}x `
        + `render-flush=${renderMs.toFixed(1)}ms`);
      expect(ratio, `boot ratio vs empty-dataset baseline < ${maxRatio}x `
        + `(baseline ${baseline.best}ms, loaded ${loadedBoot.best}ms)`).toBeLessThan(maxRatio);

      // Verify data integrity after load
      const loaded = await page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('timelog.v1')); } catch { return null; }
      });
      expect(loaded).not.toBeNull();
      expect(Array.isArray(loaded.entries)).toBe(true);
      expect(loaded.entries.length).toBe(count);
    });
  }
});

// ─── B 类：交互压测 ────────────────────────────────────────────────────────────
// 2000-entry base. 20 rounds of write-cycle: parse → add entry → stringify → setItem.
// Then dispatch a StorageEvent so the app's cross-tab listener fires render(),
// which exercises the full read → normalizeEntries path.
// Pass: P90 single write-cycle < 100ms, 0 console errors, JSON stays valid each round.

test.describe('B 类：交互压测', () => {
  test('2000-entry base — 20 轮写入循环 (parse/add/stringify/setItem)', async ({ page }) => {
    const entries = generateEntries(2000);
    await page.addInitScript(({ entries }) => {
      localStorage.clear();
      localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries }));
    }, { entries });
    await page.goto('/');
    await page.waitForFunction(() => document.body.classList.contains('app-ready'));

    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    const results = await page.evaluate(({ tagPool }) => {
      const KEY = 'timelog.v1';
      const times = [];
      const parseErrors = [];
      let baseTs = new Date('2026-01-01T08:00:00');

      for (let i = 0; i < 20; i++) {
        const t0 = performance.now();

        // Read
        const d = JSON.parse(localStorage.getItem(KEY));
        if (!d || !Array.isArray(d.entries)) {
          parseErrors.push(`轮次 ${i}: parse 失败`);
          continue;
        }
        // Add entry (timestamps in 2026 don't overlap with 2025 base data)
        const pad = n => String(n).padStart(2, '0');
        const ts = `${baseTs.getFullYear()}-${pad(baseTs.getMonth() + 1)}-${pad(baseTs.getDate())}T${pad(baseTs.getHours())}:${pad(baseTs.getMinutes())}`;
        d.entries.push({ id: `b-stress-${i}`, ts, what: `B 类压测第 ${i} 轮`, tags: [tagPool[i % tagPool.length]] });
        // Write
        localStorage.setItem(KEY, JSON.stringify(d));
        times.push(performance.now() - t0);

        // Verify round-trip integrity
        const verify = JSON.parse(localStorage.getItem(KEY));
        if (!verify || !Array.isArray(verify.entries)) parseErrors.push(`轮次 ${i}: 写后 parse 失败`);

        baseTs = new Date(baseTs.getTime() + 30 * 60_000);
      }

      // Trigger cross-tab listener to exercise render() with the final 2020-entry set
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, storageArea: localStorage }));

      const finalCount = JSON.parse(localStorage.getItem(KEY))?.entries?.length ?? -1;
      return { times, parseErrors, finalCount };
    }, { tagPool: TAG_POOL });

    const p90Idx = Math.floor(results.times.length * 0.9);
    const p90 = [...results.times].sort((a, b) => a - b)[p90Idx] ?? 0;
    console.log(`[B] 20 轮 P90=${p90.toFixed(1)}ms, 最终条数=${results.finalCount}`);

    expect(results.parseErrors, '每轮 JSON 必须可解析').toHaveLength(0);
    expect(p90, 'P90 写入耗时 < 100ms').toBeLessThan(100);
    expect(results.finalCount).toBe(2020); // 2000 base + 20 added
    expect(consoleErrors).toHaveLength(0);
  });

  test('2000-entry base — 渲染后 timeline 条目可见', async ({ page }) => {
    const entries = generateEntries(2000);
    await page.addInitScript(({ entries }) => {
      localStorage.clear();
      localStorage.setItem('timelog.v1', JSON.stringify({ version: 1, entries }));
    }, { entries });
    await page.goto('/');
    await page.waitForFunction(() => document.body.classList.contains('app-ready'));
    // Timeline must render something (today has no entries but ruler should show totals)
    const timelineVisible = await page.evaluate(() => {
      const tl = document.getElementById('timeline');
      return tl && tl.children.length > 0;
    });
    expect(timelineVisible).toBe(true);
  });
});

// ─── C 类：存储配额极限压测 ────────────────────────────────────────────────────
// Mock localStorage.setItem to throw QuotaExceededError on demand.
// Verifies that storage.js catches it gracefully: no unhandled page error,
// no data corruption, console.error logged.

test.describe('C 类：存储配额极限', () => {
  test('QuotaExceededError 被捕获，不崩溃，已有数据不损坏', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('timelog.v1', JSON.stringify({
        version: 1,
        entries: [{ id: 'init-1', ts: '2025-01-01T09:00', what: '初始记录', tags: ['杂'] }]
      }));
    });
    await page.goto('/');
    await page.waitForFunction(() => document.body.classList.contains('app-ready'));

    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    // Inject mock: next write to timelog.v1 throws QuotaExceededError
    await page.evaluate(() => {
      const real = localStorage.setItem.bind(localStorage);
      let blocked = false;
      localStorage.setItem = function (key, value) {
        if (key === 'timelog.v1' && !blocked) {
          blocked = true;
          const err = new DOMException('QuotaExceededError');
          Object.defineProperty(err, 'name', { value: 'QuotaExceededError' });
          throw err;
        }
        return real(key, value);
      };
    });

    // Trigger a save via the UI: open form → fill → save
    await page.getByRole('button', { name: '记一条新的时间记录' }).click();
    await page.locator('#form-what').fill('触发配额测试');
    await page.getByRole('button', { name: '保存时间记录' }).click();

    await page.waitForTimeout(300);

    // No unhandled QuotaExceededError at the page level
    const quotaErrors = pageErrors.filter(e => e.includes('QuotaExceededError'));
    expect(quotaErrors, 'QuotaExceededError 不能冒泡为页面错误').toHaveLength(0);

    // Existing data must be parseable and intact
    const data = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('timelog.v1')); } catch { return null; }
    });
    expect(data, '已有数据不能为 null').not.toBeNull();
    expect(Array.isArray(data.entries), '条目数组仍有效').toBe(true);
  });
});

// ─── D 类：跨标签数据冲突 ──────────────────────────────────────────────────────
// Two pages in the same browser context share localStorage and fire storage events.
// Idle case: page auto-re-renders when the other tab writes.
// Editing case: banner appears, then auto-hides after form close.

test.describe('D 类：跨标签冲突', () => {
  test('空闲标签页：另一标签写入后 1s 内自动刷新', async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    const initData = { version: 1, entries: [
      { id: 'base-1', ts: '2025-01-01T09:00', what: '初始记录', tags: ['杂'] }
    ]};

    for (const p of [pageA, pageB]) {
      await p.addInitScript(({ d }) => {
        localStorage.clear();
        localStorage.setItem('timelog.v1', JSON.stringify(d));
      }, { d: initData });
      await p.goto('/');
      await p.waitForFunction(() => document.body.classList.contains('app-ready'));
    }

    // pageB writes a new entry
    await pageB.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('timelog.v1'));
      d.entries.push({ id: 'cross-new', ts: '2025-01-01T10:00', what: '跨标签新增', tags: ['工作'] });
      localStorage.setItem('timelog.v1', JSON.stringify(d));
    });

    // pageA should receive the storage event and re-render within 1s
    await pageA.waitForFunction(
      () => JSON.parse(localStorage.getItem('timelog.v1'))?.entries?.length === 2,
      { timeout: 1000 }
    );

    // Verify no data corruption on pageA's view of localStorage
    const countA = await pageA.evaluate(
      () => JSON.parse(localStorage.getItem('timelog.v1'))?.entries?.length
    );
    expect(countA).toBe(2);
    // Cross-tab banner should NOT be visible in idle state
    await expect(pageA.locator('#cross-tab-banner')).toBeHidden();
  });

  test('编辑中：另一标签写入后 banner 出现，关闭表单后自动隐藏', async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    const initData = { version: 1, entries: [
      { id: 'base-2', ts: '2025-01-01T09:00', what: '初始记录', tags: ['杂'] }
    ]};

    for (const p of [pageA, pageB]) {
      await p.addInitScript(({ d }) => {
        localStorage.clear();
        localStorage.setItem('timelog.v1', JSON.stringify(d));
      }, { d: initData });
      await p.goto('/');
      await p.waitForFunction(() => document.body.classList.contains('app-ready'));
    }

    // pageA opens the edit form
    await pageA.getByRole('button', { name: '记一条新的时间记录' }).click();
    await expect(pageA.locator('#form-sheet')).toBeVisible();

    // pageB writes while pageA is editing
    await pageB.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('timelog.v1'));
      d.entries.push({ id: 'cross-during-edit', ts: '2025-01-01T11:00', what: '编辑时写入', tags: ['工作'] });
      localStorage.setItem('timelog.v1', JSON.stringify(d));
    });

    // pageA should show the cross-tab banner
    await expect(pageA.locator('#cross-tab-banner')).toBeVisible({ timeout: 1000 });

    // pageA closes the form — banner should auto-hide
    await pageA.keyboard.press('Escape');
    await expect(pageA.locator('#cross-tab-banner')).toBeHidden({ timeout: 1000 });
  });
});

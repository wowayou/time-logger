import { expect, test } from './startup_fixture.js';
import { boot, FIXED_NOW } from './ui_fixture.js';

const raw = page => page.evaluate(() => localStorage.getItem('timelog.v1'));

async function ready(page, width, motion = 'no-preference') {
  await page.emulateMedia({ reducedMotion: motion });
  await boot(page, width, 'tail-placeholder', false, FIXED_NOW);
  // Start from a settled launcher, not the independent cold-start fade.
  await expect(page.locator('#add-btn')).toHaveCSS('opacity', '1');
}

// Use the browser's real CSS transitions at a deterministic midpoint. No rAF
// replacement, sleeps, added styles or weakened motion preferences.
async function transitionMidpoint(page, selector) {
  return page.evaluate(selector => {
    document.querySelector(selector).click();
    return ['add-btn', 'list-fade'].map(id => {
      const el = document.getElementById(id);
      const animation = el.getAnimations().find(a => a.transitionProperty === 'opacity');
      if (!animation) return { id, missing: true, opacity: getComputedStyle(el).opacity };
      animation.pause();
      const duration = Number(animation.effect.getTiming().duration);
      animation.currentTime = duration / 2;
      const frames = animation.effect.getKeyframes();
      return { id, duration, from: frames[0].opacity, to: frames.at(-1).opacity,
        opacity: Number(getComputedStyle(el).opacity), hidden: el.hidden,
        pointerEvents: getComputedStyle(el).pointerEvents };
    });
  }, selector);
}

async function finishTransitions(page) {
  await page.evaluate(() => {
    for (const id of ['add-btn', 'list-fade']) {
      document.getElementById(id).getAnimations().forEach(a => a.finish());
    }
  });
}

for (const width of [390, 1280]) {
  for (const theme of ['light', 'dark']) {
    test(`FAB fades out/in with the sheet at ${width}px (${theme})`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: theme });
      await ready(page, width);
      const before = await raw(page);
      const bounds = await page.locator('#add-btn').boundingBox();
      const outgoing = await transitionMidpoint(page, '#add-btn');
      for (const item of outgoing) {
        expect(item.missing, JSON.stringify(item)).not.toBe(true);
        expect(item.from).toBe('1');
        expect(item.to).toBe('0');
        expect(item.duration).toBe(180);
        expect(item.opacity).toBeGreaterThan(0);
        expect(item.opacity).toBeLessThan(1);
        expect(item.hidden).toBe(false); // Business visibility is not modal state.
        expect(item.pointerEvents).toBe('none');
      }
      await page.screenshot({ path: info.outputPath('handoff-midpoint.png') });
      await finishTransitions(page);
      await expect(page.locator('#add-btn')).toHaveCSS('opacity', '0');
      await expect(page.locator('#list-fade')).toHaveCSS('opacity', '0');
      await expect(page.locator('.form-sheet-panel')).toBeFocused();
      await expect(page.locator('.form-sheet-panel')).toHaveCSS('opacity', '1');
      expect(await page.locator('#add-btn').boundingBox()).toEqual(bounds);
      await page.screenshot({ path: info.outputPath('sheet-open.png') });
      const incoming = await transitionMidpoint(page, '#form-sheet .sh-cancel');
      for (const item of incoming) {
        expect(item.missing, JSON.stringify(item)).not.toBe(true);
        expect(item.from).toBe('0');
        expect(item.to).toBe('1');
        expect(item.opacity).toBeGreaterThan(0);
        expect(item.opacity).toBeLessThan(1);
      }
      await finishTransitions(page);
      await expect(page.locator('#form-sheet')).toBeHidden();
      await expect(page.locator('#add-btn')).toHaveCSS('opacity', '1');
      await expect(page.locator('#list-fade')).toHaveCSS('opacity', '1');
      expect(await raw(page)).toBe(before);
      await info.attach('handoff', { body: JSON.stringify({ outgoing, incoming }), contentType: 'application/json' });
    });
  }

  test(`reduced motion switches immediately and keyboard focus stays correct at ${width}px`, async ({ page }) => {
    await ready(page, width, 'reduce');
    const before = await raw(page);
    const fab = page.locator('#add-btn');
    await fab.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.form-sheet-panel')).toBeFocused();
    expect(await page.evaluate(() => ['add-btn', 'list-fade'].map(id => {
      const el = document.getElementById(id);
      return { opacity: getComputedStyle(el).opacity, animations: el.getAnimations().length };
    }))).toEqual([{ opacity: '0', animations: 0 }, { opacity: '0', animations: 0 }]);
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => document.getElementById('form-sheet').contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#form-sheet')).toBeHidden();
    await expect(fab).toBeFocused();
    await expect(fab).toHaveCSS('opacity', '1');
    expect(await raw(page)).toBe(before);
  });
}

test('a rejected form opening leaves the launcher visible and usable', async ({ page }) => {
  await ready(page, 390);
  const before = await raw(page);
  await page.evaluate(() => {
    const get = Storage.prototype.getItem;
    window.__restoreFabReads = () => { Storage.prototype.getItem = get; };
    Storage.prototype.getItem = function(key) {
      if (key === 'timelog.v1') throw new DOMException('Synthetic read refusal', 'SecurityError');
      return get.call(this, key);
    };
  });
  await page.locator('#add-btn').click();
  await expect(page.locator('#info-toast')).toContainText('不允许');
  expect(await page.locator('#form-sheet').isHidden()).toBe(true);
  await expect(page.locator('#add-btn')).toHaveCSS('opacity', '1');
  await page.evaluate(() => window.__restoreFabReads());
  await page.locator('#add-btn').click();
  await expect(page.locator('#add-btn')).toHaveCSS('opacity', '0');
  expect(await raw(page)).toBe(before);
});

test('a close-and-reopen during the handoff cannot leave the launcher faded or corrupt the draft', async ({ page }) => {
  await ready(page, 390);
  const before = await raw(page);
  await page.locator('#add-btn').click();
  await expect(page.locator('#add-btn')).toHaveCSS('opacity', '0');
  await page.evaluate(() => {
    document.querySelector('#form-sheet .sh-cancel').click();
    document.getElementById('add-btn').click();
  });
  await page.locator('#form-what').fill('合成快速重开草稿');
  await expect(page.locator('#form-sheet')).not.toHaveClass(/sheet-closing/);
  await expect(page.locator('#add-btn')).toHaveCSS('opacity', '0');
  await page.locator('#form-sheet .sh-cancel').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  await expect(page.locator('#add-btn')).toHaveCSS('opacity', '1');
  await page.locator('#add-btn').click();
  await expect(page.locator('#form-what')).toHaveValue('');
  expect(await raw(page)).toBe(before);
});

test('opening and closing menus cannot revive a launcher hidden by the selected view', async ({ page }) => {
  await ready(page, 1280);
  await page.locator('[data-action="view"][data-view="week"]').click();
  await expect(page.locator('#add-btn')).toBeHidden();
  await page.locator('[data-action="open-more"]').click();
  await page.locator('#form-sheet .sh-cancel').click();
  await expect(page.locator('#form-sheet')).toBeHidden();
  await expect(page.locator('#add-btn')).toBeHidden();
  await expect(page.locator('#list-fade')).toBeHidden();
  await page.locator('[data-action="view"][data-view="day"]').click();
  await expect(page.locator('#add-btn')).toHaveCSS('opacity', '1');
});

test('reloading with an open form does not persist the handoff into the boot snapshot', async ({ page }) => {
  await ready(page, 390);
  const before = await raw(page);
  await page.locator('#add-btn').click();
  await expect(page.locator('#add-btn')).toHaveCSS('opacity', '0');
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('timelog.bootSnapshot.v1')).addHidden)).toBe(false);
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('app-ready'));
  await expect(page.locator('#form-sheet')).toBeHidden();
  await expect(page.locator('#add-btn')).toHaveCSS('opacity', '1');
  expect(await raw(page)).toBe(before);
});

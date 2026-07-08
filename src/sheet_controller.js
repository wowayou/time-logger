// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
import { mountTimePicker, setTimeInputError, useCompactTimePicker } from './pickers.js';
import {
  addOneMinute,
  carveInsert,
  conflictMessage,
  findTimeConflict,
  isPlaceholderEntry,
  normalizeEntries,
  openPlaceholderForDate
} from './entry_model.js';
import {
  BUCKETS,
  bucketForTag,
  countEntriesWithTag,
  migrateEntryTags,
  RECORD_MODE_KEY
} from './storage.js';
import { fmtMins, hhmm, minsBetweenDates, normalizeTimestamp, nowStr, todayStr, validateTs, validateTsForMode } from './time.js';
import { bucketHint, renderFormSheet, renderTagPicker } from './ui.js';

export function createSheetController(deps) {
  let sheetScrollY = 0;
  let sheetTimeMounted = false;
  let sheetLastFocus = null;
  let sheetTrapController = null;
  let sheetResizeTimer = null;
  let vvSettleTimer = null;
  let vvSettleCap = null;
  let vvGlideOffTimer = null;
  let vvRafId = null;
  let vvPredictionHold = false;
  let vvPredictionDeadline = 0;
  let teardownQueue = null;
  let formTag = '';
  let formBucket = 'job';
  let editBucket = 'job';
  let formRecordMode = 'log';
  let formBackfill = false;
  let formBackfillEnd = '';
  let configSnapshot = null;

  function getSheetMode() {
    const sheet = document.getElementById('form-sheet');
    const panel = sheet ? sheet.querySelector('.form-sheet-panel') : null;
    return sheet && panel && !sheet.hidden ? panel.dataset.mode || '' : '';
  }

  function isFormOpen() {
    const sheet = document.getElementById('form-sheet');
    const panel = sheet ? sheet.querySelector('.form-sheet-panel') : null;
    return Boolean(sheet && panel && !sheet.hidden && panel.dataset.mode === 'new');
  }

  function loadRecordModePref() {
    const saved = localStorage.getItem(RECORD_MODE_KEY);
    return saved === 'plan' ? 'plan' : 'log';
  }

  function saveRecordModePref(mode) {
    localStorage.setItem(RECORD_MODE_KEY, mode === 'plan' ? 'plan' : 'log');
  }

  function safeBucket(bucket) {
    return bucket === 'maintain' || bucket === 'leak' ? bucket : 'job';
  }

  function defaultBucketFromEntries() {
    const entries = deps.load().entries;
    const dateKey = deps.state.selectedDate || todayStr();
    const config = deps.loadConfig();
    const onDay = entries
      .filter(entry => !entry.planned && entry.ts.slice(0, 10) === dateKey)
      .sort((a, b) => a.ts < b.ts ? -1 : 1);
    for (let i = onDay.length - 1; i >= 0; i--) {
      const bucket = bucketForTag((onDay[i].tags || [])[0] || '', config);
      if (bucket !== 'unrecorded') return bucket;
    }
    return 'job';
  }

  function defaultPlanTimestamp() {
    const dateKey = deps.state.selectedDate || todayStr();
    if (dateKey > todayStr()) return `${dateKey}T09:00`;
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return normalizeTimestamp(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`);
  }

  function isHistoryDate(dateKey = deps.state.selectedDate) {
    return Boolean(dateKey && dateKey < todayStr());
  }

  function getFormWheelMount(panel) {
    if (!panel) return null;
    const planRow = panel.querySelector('[data-role="plan-time-row"]');
    if (planRow && !planRow.hidden) return planRow.querySelector('[data-role="form-wheel-mount"]');
    const startSection = panel.querySelector('[data-role="start-time-section"]');
    if (startSection && !startSection.hidden) return startSection.querySelector('[data-role="form-wheel-mount"]');
    return panel.querySelector('[data-role="form-wheel-mount"]');
  }

  function paintPrevSegment(panel, startTs) {
    startTs = normalizeTimestamp(startTs);
    if (!startTs) return;
    const settlement = deps.settlementEndFor(startTs, deps.state.selectedDate);
    const startLabel = panel ? panel.querySelector('[data-role="start-time-label"]') : null;
    const endLabel = panel ? panel.querySelector('[data-role="end-label"]') : null;
    const durationLabel = panel ? panel.querySelector('[data-role="duration-label"]') : null;
    if (startLabel) startLabel.textContent = hhmm(startTs);
    if (endLabel && settlement.endTs) endLabel.textContent = settlement.isNow ? '现在' : (settlement.isDayEnd ? '24:00' : hhmm(settlement.endTs));
    if (durationLabel && settlement.endTs) durationLabel.textContent = fmtMins(minsBetweenDates(new Date(startTs), new Date(settlement.endTs)));
  }

  function mountNewTimePicker(panel, ts) {
    const tsEl = panel ? panel.querySelector('#form-ts') : null;
    const mountEl = getFormWheelMount(panel);
    if (!tsEl) return;
    const startTs = normalizeTimestamp(ts) || (formRecordMode === 'plan' ? defaultPlanTimestamp() : deps.defaultFormTs());
    tsEl.value = startTs;
    if (formRecordMode !== 'plan') paintPrevSegment(panel, startTs);
    if (!mountEl) return;
    if (formRecordMode === 'plan' || !(panel.querySelector('[data-role="start-time-section"]') || {}).hidden) {
      mountTimePicker(mountEl, startTs, v => {
        tsEl.value = v;
        if (formRecordMode !== 'plan') paintPrevSegment(panel, v);
      });
    }
  }

  function paintBackfillDuration(panel) {
    const startTsEl = panel ? panel.querySelector('#form-ts') : null;
    const endTsEl = panel ? panel.querySelector('#form-end-ts') : null;
    const durLabel = panel ? panel.querySelector('[data-role="backfill-duration"]') : null;
    if (!startTsEl || !endTsEl || !durLabel) return;
    const s = normalizeTimestamp(startTsEl.value);
    const e = normalizeTimestamp(endTsEl.value);
    if (s && e && e > s) durLabel.textContent = `共 ${fmtMins(minsBetweenDates(new Date(s), new Date(e)))}`;
    else durLabel.textContent = s && e && e <= s ? '结束需晚于开始' : '';
  }

  function mountBackfillPickers(panel, startTs, endTs) {
    const startTsEl = panel ? panel.querySelector('#form-ts') : null;
    const endTsEl = panel ? panel.querySelector('#form-end-ts') : null;
    const startMount = panel ? panel.querySelector('[data-role="backfill-start-mount"]') : null;
    const endMount = panel ? panel.querySelector('[data-role="backfill-end-mount"]') : null;
    if (!startTsEl || !endTsEl) return;
    const s = normalizeTimestamp(startTs) || deps.defaultFormTs();
    const e = normalizeTimestamp(endTs) || s;
    startTsEl.value = s;
    endTsEl.value = e;
    paintBackfillDuration(panel);
    if (startMount) mountTimePicker(startMount, s, v => { startTsEl.value = v; paintBackfillDuration(panel); });
    if (endMount) mountTimePicker(endMount, e, v => { endTsEl.value = v; paintBackfillDuration(panel); });
  }

  // Light geometry-only write: cheap enough to call on every burst event
  // (see scheduleVisualViewportSync below). Split out from syncVisualViewport
  // so the burst path never pays for autosize on every frame.
  function writeViewportVars() {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const root = document.documentElement;
    // The iOS soft keyboard shrinks visualViewport and can offset it from the
    // layout viewport; publish both so the fixed sheet overlay tracks it and
    // the sticky head (with save ✓) stays on-screen. See docs/postmortems.md ⑧.
    root.style.setProperty('--vvt', `${Math.max(0, vv.offsetTop)}px`);
    root.style.setProperty('--vvh', `${vv.height}px`);
  }

  function syncVisualViewport() {
    writeViewportVars();
    // The keyboard opening/closing changes the viewport height the textarea cap
    // is derived from; re-run autosize so a long note re-clamps to the new fold.
    const openSheet = document.querySelector('#form-sheet:not([hidden]) .form-sheet-panel');
    if (openSheet) autosizeTextareas(openSheet);
  }

  function clearVisualViewport() {
    const root = document.documentElement;
    root.style.removeProperty('--vvt');
    root.style.removeProperty('--vvh');
  }

  // P16/P18: iOS animates the soft keyboard with a burst of discrete
  // visualViewport resize/scroll events. P16 waited for the burst to go quiet
  // (60ms; 400ms cap) before writing geometry at all, which stopped the
  // "二排抖动" (2-3 visible jumps) but left the sheet parked on stale geometry
  // for the whole keyboard animation — long enough for iOS to shove the fixed
  // sheet's head off-screen while revealing the focused control (P18: "表单
  // 遮挡"). Fix: keep writing geometry on every burst event (rAF-batched to at
  // most once per frame), but do it while .vv-glide's CSS transition is
  // already engaged, so the discrete writes become one continuous slide
  // instead of either "stale then snap" (old bug) or "jump 2-3 times" (P16's
  // original bug). The settle timers below now only own the FINAL pass:
  // autosize (needs the fold to have stopped moving) and keeping the focused
  // control in view.
  function clearViewportSettleTimers() {
    clearTimeout(vvSettleTimer);
    clearTimeout(vvSettleCap);
    clearTimeout(vvGlideOffTimer);
    if (vvRafId !== null) cancelAnimationFrame(vvRafId);
    vvSettleTimer = null;
    vvSettleCap = null;
    vvGlideOffTimer = null;
    vvRafId = null;
    vvPredictionHold = false;
  }

  // P20: after a blur the keyboard-collapse end state is fully known, so
  // predictKeyboardCollapse() glides the sheet there immediately. While the
  // keyboard is still mid-collapse, vv events report intermediate (shrunken)
  // heights — writing those would drag the sheet back down. This gate blocks
  // geometry writes for that window; a hard deadline keeps it from wedging.
  function predictionBlocksWrite() {
    if (!vvPredictionHold) return false;
    if (Date.now() > vvPredictionDeadline) {
      vvPredictionHold = false;
      return false;
    }
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    return Boolean(vv && (window.innerHeight - vv.height) > 120);
  }

  function ensureGlide() {
    const sheet = document.getElementById('form-sheet');
    if (!sheet || sheet.hidden) return;
    sheet.classList.add('vv-glide');
    clearTimeout(vvGlideOffTimer);
    vvGlideOffTimer = null;
  }

  function scheduleGlideOff() {
    const sheet = document.getElementById('form-sheet');
    if (!sheet) return;
    clearTimeout(vvGlideOffTimer);
    vvGlideOffTimer = setTimeout(() => sheet.classList.remove('vv-glide'), 260);
  }

  function scheduleVisualViewportSync() {
    if (document.body.classList.contains('sheet-closing')) return;
    ensureGlide();
    if (vvRafId === null) {
      vvRafId = requestAnimationFrame(() => {
        vvRafId = null;
        if (document.body.classList.contains('sheet-closing')) return;
        // P20: mid-collapse events must not drag the predicted geometry back.
        if (predictionBlocksWrite()) return;
        writeViewportVars();
      });
    }
    clearTimeout(vvSettleTimer);
    vvSettleTimer = setTimeout(applySettledViewport, 60);
    if (!vvSettleCap) vvSettleCap = setTimeout(applySettledViewport, 400);
  }

  function applySettledViewport() {
    clearTimeout(vvSettleTimer);
    clearTimeout(vvSettleCap);
    vvSettleTimer = null;
    vvSettleCap = null;
    if (document.body.classList.contains('sheet-closing')) return;
    // P20: the keyboard is still mid-collapse — stamping this stale geometry
    // would yank the sheet back down. Check again shortly; the prediction
    // deadline bounds this loop.
    if (predictionBlocksWrite()) {
      vvSettleTimer = setTimeout(applySettledViewport, 60);
      return;
    }
    vvPredictionHold = false;
    const sheet = document.getElementById('form-sheet');
    const open = Boolean(sheet && !sheet.hidden);
    syncVisualViewport();
    // Once the keyboard has settled, keep the focused control inside the
    // (possibly much shorter) fold instead of under the keyboard.
    const active = document.activeElement;
    const panel = open ? sheet.querySelector('.form-sheet-panel') : null;
    if (panel && active instanceof HTMLElement && panel.contains(active)
        && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
      active.scrollIntoView({ block: 'nearest' });
    }
    if (open) scheduleGlideOff();
  }

  // P20: the collapse's end state is fully known at blur time — body is locked
  // position:fixed, so layout viewport == keyboardless visual viewport. Glide
  // there NOW, in sync with the keyboard's own exit animation, instead of
  // waiting for sparse/late vv events: the growth happens behind the departing
  // keyboard and lands as one continuous slide instead of a hang-then-jump
  // (P19 only painted over the exposed strip; the content itself still jumped).
  function predictKeyboardCollapse(sheet) {
    vvPredictionHold = true;
    vvPredictionDeadline = Date.now() + 700;
    ensureGlide();
    const root = document.documentElement;
    root.style.setProperty('--vvt', '0px');
    root.style.setProperty('--vvh', `${window.innerHeight}px`);
    // Re-clamp textareas to the final fold in the same slide, so they don't
    // grow a second time when the settle pass lands.
    const panel = sheet.querySelector('.form-sheet-panel');
    if (panel) autosizeTextareas(panel, window.innerHeight);
    // Own the finish even if iOS fires no further vv events.
    clearTimeout(vvSettleTimer);
    vvSettleTimer = setTimeout(applySettledViewport, 120);
    if (!vvSettleCap) vvSettleCap = setTimeout(applySettledViewport, 400);
  }

  function onSheetFocusOut(e) {
    if (document.body.classList.contains('sheet-closing') || teardownQueue) return;
    const sheet = document.getElementById('form-sheet');
    if (!sheet || sheet.hidden) return;
    const from = e.target;
    if (!(from instanceof HTMLElement) || !sheet.contains(from)) return;
    if (from.tagName !== 'TEXTAREA' && from.tagName !== 'INPUT') return;
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    // At focusout time the keyboard is still on screen; if it isn't (desktop,
    // hardware keyboard, headless), there is nothing to predict.
    if (!vv || (window.innerHeight - vv.height) <= 120) return;
    requestAnimationFrame(() => {
      if (document.body.classList.contains('sheet-closing') || teardownQueue) return;
      if (sheet.hidden) return;
      const active = document.activeElement;
      // Focus hopped to another text control inside the sheet: keyboard stays.
      if (active instanceof HTMLElement && sheet.contains(active)
          && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return;
      predictKeyboardCollapse(sheet);
    });
  }

  function onSheetFocusIn(e) {
    if (!vvPredictionHold) return;
    const sheet = document.getElementById('form-sheet');
    if (!sheet || sheet.hidden) return;
    const to = e.target;
    // Keyboard is coming back: drop the prediction, resume normal tracking.
    if (to instanceof HTMLElement && sheet.contains(to)
        && (to.tagName === 'TEXTAREA' || to.tagName === 'INPUT')) {
      vvPredictionHold = false;
    }
  }

  function attachVisualViewport() {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    syncVisualViewport();
    vv.addEventListener('resize', scheduleVisualViewportSync);
    vv.addEventListener('scroll', scheduleVisualViewportSync);
    document.addEventListener('focusout', onSheetFocusOut);
    document.addEventListener('focusin', onSheetFocusIn);
  }

  function detachVisualViewport() {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (vv) {
      vv.removeEventListener('resize', scheduleVisualViewportSync);
      vv.removeEventListener('scroll', scheduleVisualViewportSync);
    }
    document.removeEventListener('focusout', onSheetFocusOut);
    document.removeEventListener('focusin', onSheetFocusIn);
    clearViewportSettleTimers();
    const sheet = document.getElementById('form-sheet');
    if (sheet) sheet.classList.remove('vv-glide');
    clearVisualViewport();
  }

  function lockBodyForSheet() {
    sheetScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${sheetScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.classList.add('sheet-open');
    attachVisualViewport();
  }

  function unlockBodyForSheet() {
    detachVisualViewport();
    document.body.classList.remove('sheet-open');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, sheetScrollY);
  }

  function trapFocus(container) {
    if (sheetTrapController) sheetTrapController.abort();
    sheetTrapController = new AbortController();
    container.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter(el => el.offsetParent !== null || el === document.activeElement);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }, { signal: sheetTrapController.signal });
  }

  function autosizeTextareas(scope = document, viewHOverride = 0) {
    // Grow to fit content, but CAP the height so a long note can never push the
    // rest of the form (or the save ✓) past the visible area — on iPhone SE2 with
    // the soft keyboard up the visual viewport is ~250px, so an uncapped textarea
    // full of text swallows the whole panel and the record becomes uneditable.
    // Past the cap the textarea scrolls internally (overflow-y auto below).
    // viewHOverride: P20 的失焦预测路径在键盘还没收完时就按"收起后的终态高度"
    // 重排 textarea，避免 settle 时 textarea 再长一截造成面板内二次位移。
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const viewH = viewHOverride || (vv && vv.height) || (typeof window !== 'undefined' ? window.innerHeight : 0) || 0;
    const cap = viewH ? Math.max(88, Math.round(viewH * 0.32)) : 200;
    scope.querySelectorAll('textarea.ta').forEach(textarea => {
      textarea.style.height = 'auto';
      const target = Math.min(Math.max(textarea.scrollHeight, 52), cap);
      textarea.style.height = `${target}px`;
      textarea.classList.toggle('ta-capped', textarea.scrollHeight > cap);
    });
  }

  function refreshFormTagArea(panel) {
    if (!panel) return;
    const chipWrap = panel.querySelector('#form-chips');
    if (chipWrap) {
      chipWrap.innerHTML = renderTagPicker('form', formTag, deps.loadConfig(), formBucket);
    }
    const hint = panel.querySelector('[data-role="mainline-hint"]');
    if (hint) hint.textContent = bucketHint(formBucket);
    panel.querySelectorAll('[data-role="form-bucket-seg"] button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.bucket === formBucket);
    });
    panel.querySelectorAll('[data-role="record-mode-seg"] button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === formRecordMode);
    });
  }

  function openFormSheet(opts) {
    const requestedMode = opts && opts.mode;
    const mode = ['edit', 'help', 'config', 'import-shift', 'more'].includes(requestedMode) ? requestedMode : 'new';
    const id = opts && opts.id;
    const entry = mode === 'edit' ? deps.load().entries.find(e => e.id === id) : null;
    if (mode === 'edit' && !entry) return;
    sheetLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (mode === 'new') {
      deps.state.view = 'day';
      deps.persistState();
      deps.setSheetEditId(null);
      formTag = '';
      formBucket = defaultBucketFromEntries();
      formRecordMode = loadRecordModePref();
      formBackfill = Boolean(opts && opts.backfill);
      formBackfillEnd = (opts && opts.endTs) || '';
      // Backfilling a known past gap is always an "already happened" record;
      // a leaked plan-mode pref would force a future ts and silently fail to save.
      if (isHistoryDate() || formBackfill) formRecordMode = 'log';
    } else if (mode === 'edit') {
      deps.setSheetEditId(id);
      sheetTimeMounted = false;
      editBucket = safeBucket(bucketForTag((entry.tags || [])[0] || '', deps.loadConfig()));
      deps.render();
    } else if (mode === 'config') {
      configSnapshot = JSON.parse(JSON.stringify(deps.loadConfig()));
    }
    const sheet = document.getElementById('form-sheet');
    const panel = sheet.querySelector('.form-sheet-panel');
    const ts = mode === 'edit'
      ? entry.ts
      : (opts && opts.ts) || (formRecordMode === 'plan' ? defaultPlanTimestamp() : deps.defaultFormTs());
    if (mode === 'new') {
      deps.setSelectedDate((normalizeTimestamp(ts) || nowStr()).slice(0, 10));
      deps.persistState();
    }
    panel.dataset.mode = mode;
    if (mode === 'edit') panel.dataset.id = id;
    else delete panel.dataset.id;
    panel.innerHTML = renderFormSheet({
      mode,
      entry,
      config: deps.loadConfig(),
      entries: deps.load().entries,
      importShiftHours: opts && opts.importShiftHours,
      importShiftHint: opts && opts.importShiftHint,
      shareSupported: typeof navigator !== 'undefined' && typeof navigator.share === 'function',
      targetDate: deps.state.selectedDate,
      isToday: deps.state.selectedDate === todayStr(),
      isHistoryDay: isHistoryDate(),
      backfill: Boolean(opts && opts.backfill),
      bucket: mode === 'edit' ? editBucket : formBucket,
      defaultBucket: formBucket,
      recordMode: formRecordMode
    });
    // ① Set the visualViewport geometry (--vvt/--vvh) BEFORE revealing the sheet
    // so the fixed overlay paints at the right size on the first frame instead of
    // snapping "small → bigger" a frame later (v30 bug1). lockBodyForSheet runs the
    // initial syncVisualViewport.
    lockBodyForSheet();
    sheet.hidden = false;
    if (mode === 'edit') {
      const editWheel = panel.querySelector('[data-role="edit-wheel"]');
      if (editWheel) {
        const tsEl = panel.querySelector('[data-role="edit-ts"]');
        mountTimePicker(editWheel, ts, v => {
          tsEl.value = v;
        });
        sheetTimeMounted = true;
      }
    } else if (mode === 'new') {
      if (formBackfill) mountBackfillPickers(panel, ts, formBackfillEnd);
      else mountNewTimePicker(panel, ts);
      const whatEl = panel.querySelector('#form-what');
      const ctagEl = panel.querySelector('#form-ctag');
      if (whatEl) whatEl.value = '';
      if (ctagEl) ctagEl.value = '';
      deps.renderChrome();
    }
    autosizeTextareas(panel);
    trapFocus(sheet);
    requestAnimationFrame(() => {
      panel.setAttribute('tabindex', '-1');
      panel.focus({ preventScroll: true });
    });
  }

  function softKeyboardUp() {
    // Heuristic for "the iOS soft keyboard is currently on screen": an input/
    // textarea holds focus AND the visual viewport is much shorter than the
    // layout viewport. Desktop, headless (Playwright) and no-keyboard closes all
    // fall through to false and keep the original synchronous teardown.
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return false;
    const active = document.activeElement;
    const isInput = Boolean(active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT'));
    const shrunk = (window.innerHeight - vv.height) > 120;
    return isInput && shrunk;
  }

  // P14: defer the sheet teardown until the soft keyboard has finished collapsing,
  // then close + render in a single frame — otherwise iOS dismisses the keyboard
  // AFTER our synchronous close and reflows the viewport a beat later, painting a
  // visible second jump on save. Only engaged when a keyboard is actually up;
  // desktop/headless run `run()` immediately so UI smoke never sees a deferral.
  function settleThenTeardown(run) {
    // A teardown is already waiting for the keyboard: join it instead of
    // running synchronously (Escape fires cancelEdit AND closeForm — the
    // second call arrives after blur, when softKeyboardUp() is false again).
    if (teardownQueue) { teardownQueue.push(run); return; }
    if (!softKeyboardUp()) { run(); return; }
    const vv = window.visualViewport;
    const active = document.activeElement;
    teardownQueue = [run];
    document.body.classList.add('sheet-closing');
    // The teardown owns geometry from here; drop any pending settled-sync so
    // the still-visible sheet can't grow to the restored viewport mid-close.
    clearViewportSettleTimers();
    if (active && typeof active.blur === 'function') active.blur();
    let done = false;
    let settleTimer = null;
    let cap = null;
    const finish = () => {
      if (done) return;
      done = true;
      vv.removeEventListener('resize', onResize);
      clearTimeout(settleTimer);
      clearTimeout(cap);
      requestAnimationFrame(() => {
        const queued = teardownQueue || [];
        teardownQueue = null;
        queued.forEach(fn => fn());
        requestAnimationFrame(() => document.body.classList.remove('sheet-closing'));
      });
    };
    const onResize = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(finish, 60);
    };
    vv.addEventListener('resize', onResize);
    // Cap: if the keyboard never reports a resize, don't hang the teardown.
    cap = setTimeout(finish, 250);
  }

  function closeFormSheet(opts = {}) {
    const restoreFocus = opts.restoreFocus !== false;
    const sheet = document.getElementById('form-sheet');
    const panel = sheet ? sheet.querySelector('.form-sheet-panel') : null;
    const wasOpen = Boolean(sheet && panel && !sheet.hidden);
    const mode = wasOpen ? panel.dataset.mode || '' : '';
    if (sheetTrapController) {
      sheetTrapController.abort();
      sheetTrapController = null;
    }
    if (sheet && panel) {
      sheet.hidden = true;
      panel.innerHTML = '';
      delete panel.dataset.id;
      delete panel.dataset.mode;
    }
    deps.setSheetEditId(null);
    sheetTimeMounted = false;
    formBackfill = false;
    formBackfillEnd = '';
    configSnapshot = null;
    if (wasOpen) unlockBodyForSheet();
    if (restoreFocus && sheetLastFocus && document.contains(sheetLastFocus)) {
      sheetLastFocus.focus();
    }
    sheetLastFocus = null;
    return mode;
  }

  function remountOpenSheetTimePickerIfNeeded() {
    const sheet = document.getElementById('form-sheet');
    const panel = sheet ? sheet.querySelector('.form-sheet-panel') : null;
    if (!sheet || !panel || sheet.hidden) return;
    const compact = useCompactTimePicker() ? '1' : '0';
    const mode = panel.dataset.mode || '';
    if (mode === 'new' && formBackfill) {
      const startMount = panel.querySelector('[data-role="backfill-start-mount"]');
      if (!startMount || startMount.dataset.pickerCompact === compact) return;
      mountBackfillPickers(panel, panel.querySelector('#form-ts').value, panel.querySelector('#form-end-ts').value);
      return;
    }
    if (mode === 'new') {
      const planRow = panel.querySelector('[data-role="plan-time-row"]');
      if (planRow && planRow.hidden) {
        const section = panel.querySelector('[data-role="start-time-section"]');
        if (section && section.hidden) return;
      }
    }
    const mountEl = mode === 'edit'
      ? panel.querySelector('[data-role="edit-wheel"]')
      : getFormWheelMount(panel);
    if (!mountEl || mountEl.dataset.pickerCompact === compact) return;
    const tsEl = mode === 'edit'
      ? panel.querySelector('[data-role="edit-ts"]')
      : panel.querySelector('#form-ts');
    if (!tsEl) return;
    if (mode === 'new') {
      mountNewTimePicker(panel, tsEl.value);
      return;
    }
    mountTimePicker(mountEl, tsEl.value, v => { tsEl.value = v; });
  }

  function handleResponsiveResize() {
    clearTimeout(sheetResizeTimer);
    sheetResizeTimer = setTimeout(remountOpenSheetTimePickerIfNeeded, 120);
  }

  function closeForm() {
    // Cancel/backdrop/Esc with the keyboard up had the same two-jump close as
    // the save paths (P14/P16); settle first, then tear down in one frame.
    settleThenTeardown(() => {
      const mode = closeFormSheet();
      if (mode === 'edit') deps.render();
    });
  }

  function openForm() {
    openFormSheet({ mode: 'new' });
  }

  function openMoreSheet(opts = {}) {
    openFormSheet({ mode: 'more', ...opts });
  }

  function openEditSheet(id) {
    openFormSheet({ mode: 'edit', id });
  }

  function closeEditSheet(opts = {}) {
    return closeFormSheet({ restoreFocus: opts.restoreFocus !== false });
  }

  function startEdit(id) {
    openEditSheet(id);
  }

  function cancelEdit() {
    settleThenTeardown(() => {
      const changed = Boolean(deps.getSheetEditId() || getSheetMode() === 'edit');
      closeEditSheet();
      if (changed) deps.render();
    });
  }

  function pickTag(el) {
    const wasSelected = el.classList.contains('sel');
    const panel = el.closest('.form-sheet-panel');
    const chipRoot = panel ? panel.querySelector('#form-chips, [data-role="edit-chips"]') : null;
    if (chipRoot) chipRoot.querySelectorAll('.chip').forEach(c => c.classList.remove('sel'));
    if (wasSelected) {
      formTag = '';
      return;
    }
    el.classList.add('sel');
    formTag = el.dataset.tag || '';
    if (el.dataset.bucket) {
      if (panel && panel.dataset.mode === 'edit') editBucket = el.dataset.bucket;
      else formBucket = el.dataset.bucket;
      refreshFormTagArea(panel);
      const editSeg = panel ? panel.querySelector('[data-role="edit-bucket-seg"]') : null;
      if (editSeg) {
        editSeg.querySelectorAll('button').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.bucket === editBucket);
        });
      }
    }
    const custom = panel ? panel.querySelector('#form-ctag, [data-role="edit-custom-tag"]') : null;
    if (custom) custom.value = '';
  }

  function pickBucket(el) {
    const panel = el.closest('.form-sheet-panel');
    const bucket = el.dataset.bucket || 'job';
    if (panel && panel.dataset.mode === 'edit') editBucket = bucket;
    else formBucket = bucket;
    formTag = '';
    if (panel) {
      const chipRoot = panel.querySelector('#form-chips, [data-role="edit-chips"]');
      if (chipRoot) {
        chipRoot.innerHTML = renderTagPicker(
          panel.dataset.mode === 'edit' ? 'edit' : 'form',
          '',
          deps.loadConfig(),
          bucket
        );
      }
      const seg = el.closest('[data-role="form-bucket-seg"], [data-role="edit-bucket-seg"]');
      if (seg) seg.querySelectorAll('button').forEach(btn => btn.classList.toggle('active', btn.dataset.bucket === bucket));
      const hint = panel.querySelector('[data-role="mainline-hint"]');
      if (hint) hint.textContent = bucketHint(bucket);
      const custom = panel.querySelector('#form-ctag, [data-role="edit-custom-tag"]');
      if (custom) custom.value = '';
    }
  }

  function pickRecordMode(el) {
    const panel = el.closest('.form-sheet-panel');
    if (el.dataset.mode === 'plan' && isHistoryDate()) return;
    formRecordMode = el.dataset.mode === 'plan' ? 'plan' : 'log';
    saveRecordModePref(formRecordMode);
    if (!panel) return;
    const logRow = panel.querySelector('[data-role="log-time-row"]');
    const planRow = panel.querySelector('[data-role="plan-time-row"]');
    const startSection = panel.querySelector('[data-role="start-time-section"]');
    if (logRow) logRow.hidden = formRecordMode === 'plan';
    if (planRow) planRow.hidden = formRecordMode !== 'plan';
    if (startSection) startSection.hidden = true;
    panel.querySelectorAll('[data-role="record-mode-seg"] button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === formRecordMode);
    });
    const title = panel.querySelector('#form-sheet-title');
    const what = panel.querySelector('.form-sheet-what');
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deps.state.selectedDate || '');
    const daySummary = m ? `${Number(m[2])}月${Number(m[3])}日` : '这一天';
    if (title) title.textContent = formRecordMode === 'plan' ? `计划 · ${daySummary}` : `记一条 · ${deps.state.selectedDate === todayStr() ? '刚才这一阵' : '补记'}`;
    if (what) what.textContent = formRecordMode === 'plan' ? '写下计划要做什么' : (deps.state.selectedDate === todayStr() ? '写下刚才做了什么' : '写下这一段做了什么');
    const whatLabel = panel.querySelector('[data-role="what-label"]');
    if (whatLabel) whatLabel.textContent = formRecordMode === 'plan' ? '计划做什么' : '做了什么';
    const whatInput = panel.querySelector('#form-what');
    if (whatInput) whatInput.setAttribute('placeholder', formRecordMode === 'plan' ? '准备面试 / 写方案…' : '写邮件 / 刷手机 / 准备面试…');
    const tsEl = panel.querySelector('#form-ts');
    if (tsEl) {
      tsEl.value = formRecordMode === 'plan' ? defaultPlanTimestamp() : deps.defaultFormTs();
      mountNewTimePicker(panel, tsEl.value);
    }
    deps.renderChrome();
  }

  function clearInlineError(scope, role = 'conflict-error') {
    const err = scope ? scope.querySelector(`[data-role="${role}"]`) : null;
    if (!err) return;
    err.hidden = true;
    err.innerHTML = '';
  }

  function showInlineError(scope, html, role = 'conflict-error') {
    const err = scope ? scope.querySelector(`[data-role="${role}"]`) : null;
    if (!err) return;
    err.innerHTML = html;
    err.hidden = false;
    // ④ A blocked ✓ must give feedback the user can actually see; the panel body
    // scrolls and the iOS keyboard can hide the lower half, so pull it into view.
    if (typeof err.scrollIntoView === 'function') {
      err.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function useConflictPlusMinute(el) {
    const panel = el.closest('.form-sheet-panel, .entry.editing');
    const mode = panel && panel.dataset.mode;
    const nextTs = addOneMinute(el.dataset.ts || '');
    const input = mode === 'edit' ? panel.querySelector('[data-role="edit-ts"]') : panel.querySelector('#form-ts');
    const mount = mode === 'edit'
      ? panel.querySelector('[data-role="edit-wheel"]')
      : getFormWheelMount(panel);
    if (input) input.value = nextTs;
    if (mode === 'new' && formRecordMode !== 'plan') paintPrevSegment(panel, nextTs);
    const startSection = mode === 'new' ? panel.querySelector('[data-role="start-time-section"]') : null;
    if (mount && (!(startSection && startSection.hidden) || formRecordMode === 'plan')) {
      mountTimePicker(mount, nextTs, v => {
        if (input) input.value = v;
        if (mode === 'new' && formRecordMode !== 'plan') paintPrevSegment(panel, v);
      });
      setTimeInputError(mount, '');
    }
    clearInlineError(panel);
  }

  function editConflictEntry(id) {
    closeFormSheet({ restoreFocus: false });
    openEditSheet(id);
  }

  function compactTagText(value) {
    return String(value || '').toLowerCase().replace(/[\s·._-]+/g, '');
  }

  function updateMainlineHint(input) {
    const box = input.closest('.form-sheet-panel, .entry.editing');
    const hint = box ? box.querySelector('[data-role="mainline-hint"]') : null;
    if (!hint) return;
    const value = input.value.trim();
    const compact = compactTagText(value);
    const config = deps.loadConfig();
    const bucket = box && box.dataset.mode === 'edit' ? editBucket : formBucket;
    const sameName = value ? config.chips.find(chip => chip.name === value) : null;
    if (sameName && sameName.bucket !== bucket) {
      // Recording never re-buckets an existing chip; tell the user their bucket
      // pick won't move it (matches the storage.addChipTag fix).
      hint.textContent = `「${value}」已是${BUCKETS[sameName.bucket]}标签，记录时仍按${BUCKETS[sameName.bucket]}归类。`;
      return;
    }
    const near = compact ? config.mainline.find(name => compactTagText(name) === compact && name !== value) : '';
    hint.textContent = near
      ? `可能已有相近标签「${near}」。留空可直接选历史 chip。`
      : bucketHint(bucket);
  }

  function syncCustomDraft(input) {
    const panel = input.closest('.form-sheet-panel, .entry.editing');
    if (!panel) return;
    const isEdit = panel.dataset.mode === 'edit';
    const chipRoot = panel.querySelector('#form-chips, [data-role="edit-chips"]');
    if (!chipRoot) return;
    formTag = '';
    chipRoot.innerHTML = renderTagPicker(isEdit ? 'edit' : 'form', input.value.trim(), deps.loadConfig(), isEdit ? editBucket : formBucket);
  }

  function rememberTag(tag, bucket, entries) {
    deps.rememberCustomTagForBucket(tag, safeBucket(bucket), entries);
  }

  function saveEntry() {
    const panel = document.querySelector('#form-sheet .form-sheet-panel');
    if (formBackfill) { saveBackfill(panel); return; }
    const timeScope = getFormWheelMount(panel) || panel;
    const planned = formRecordMode === 'plan';
    const checked = validateTsForMode(document.getElementById('form-ts').value, {
      planned,
      dateKey: deps.state.selectedDate
    });
    if (!checked.ok) {
      setTimeInputError(timeScope, checked.msg);
      const focusEl = timeScope && timeScope.querySelector('[data-role="text"], [data-role="date"]');
      if (focusEl) focusEl.focus();
      return;
    }
    setTimeInputError(timeScope, '');
    const what = document.getElementById('form-what').value.trim();
    if (!what) { document.getElementById('form-what').focus(); return; }
    const ctag = document.getElementById('form-ctag').value.trim();
    const tag = ctag || formTag || '未知';
    const d = deps.load();
    let placeholder = openPlaceholderForDate(d.entries, checked.ts.slice(0, 10));
    const conflict = findTimeConflict(d.entries, checked.ts, placeholder ? placeholder.id : '');
    if (conflict) {
      // A record can land exactly on an empty placeholder stranded in the
      // middle of the day (openPlaceholderForDate only finds the tail one).
      // Fill that placeholder in place instead of blocking it as a self-conflict.
      if (!planned && isPlaceholderEntry(conflict)) {
        placeholder = conflict;
      } else {
        showInlineError(panel, conflictMessage(conflict, checked.ts, 'use-conflict-plus-new'));
        return;
      }
    }
    if (ctag) rememberTag(ctag, formBucket, d.entries);
    if (planned) {
      d.entries.push({ id: deps.uid(), ts: checked.ts, what, tags: [tag], planned: true });
      deps.save(d);
      deps.setSelectedDate(checked.ts.slice(0, 10));
      settleThenTeardown(() => { closeForm(); deps.render(); });
      return;
    }
    if (placeholder) {
      placeholder.ts = checked.ts;
      placeholder.what = what;
      placeholder.tags = [tag];
      delete placeholder.longConfirm;
      delete placeholder.planned;
    } else {
      d.entries.push({ id: deps.uid(), ts: checked.ts, what, tags: [tag] });
    }
    // Single normalization out: coalesce redundant boundaries + re-ensure today's
    // tail placeholder so the next record's default start can never collide.
    normalizeEntries(d, { todayKey: todayStr(), createId: deps.uid });
    deps.save(d);
    deps.setSelectedDate(checked.ts.slice(0, 10));
    settleThenTeardown(() => { closeForm(); deps.render(); });
  }

  // 「补/切」: bounded insert into a segment. Carve [start, end) as the new label,
  // restoring the segment's original label at end (see entry_model.carveInsert).
  function saveBackfill(panel) {
    const startScope = (panel && panel.querySelector('[data-role="backfill-start-mount"]')) || panel;
    const endScope = (panel && panel.querySelector('[data-role="backfill-end-mount"]')) || panel;
    const startChecked = validateTs(document.getElementById('form-ts').value);
    if (!startChecked.ok) { setTimeInputError(startScope, startChecked.msg); return; }
    setTimeInputError(startScope, '');
    const endChecked = validateTs(document.getElementById('form-end-ts').value);
    if (!endChecked.ok) { setTimeInputError(endScope, endChecked.msg); return; }
    if (endChecked.ts <= startChecked.ts) { setTimeInputError(endScope, '结束时间要晚于开始时间。'); return; }
    setTimeInputError(endScope, '');
    const what = document.getElementById('form-what').value.trim();
    if (!what) { document.getElementById('form-what').focus(); return; }
    const ctag = document.getElementById('form-ctag').value.trim();
    const tag = ctag || formTag || '未知';
    const d = deps.load();
    // Cross-point guard: the window must lie within a single segment, else the
    // "restore original label at end" is ambiguous and would swallow a record.
    const crosser = d.entries.find(e => !e.planned && normalizeTimestamp(e.ts) && e.ts > startChecked.ts && e.ts < endChecked.ts);
    if (crosser) {
      showInlineError(panel, '这段里已有其它记录，请缩小范围或分两次补。');
      return;
    }
    if (ctag) rememberTag(ctag, formBucket, d.entries);
    const created = carveInsert(d.entries, { start: startChecked.ts, end: endChecked.ts, what, tag, createId: deps.uid });
    if (!created) { showInlineError(panel, '这段时间无法补录，请检查起止时间。'); return; }
    normalizeEntries(d, { todayKey: todayStr(), createId: deps.uid });
    deps.save(d);
    deps.setSelectedDate(startChecked.ts.slice(0, 10));
    settleThenTeardown(() => { closeForm(); deps.render(); });
  }

  function switchActivity() {
    deps.state.view = 'day';
    deps.setSelectedDate(todayStr());
    openFormSheet({ mode: 'new' });
  }

  function getEditingBox(id = deps.getSheetEditId()) {
    return Array.from(document.querySelectorAll('.entry.editing, .form-sheet-panel'))
      .find(el => el.dataset.id === String(id));
  }

  function pickEditTag(el) {
    pickTag(el);
  }

  function commitEdit(id) {
    const box = getEditingBox(id);
    if (!box) return;
    const tsEl = box.querySelector('[data-role="edit-ts"]');
    const whatEl = box.querySelector('[data-role="edit-what"]');
    const chipBox = box.querySelector('[data-role="edit-chips"]');
    const customEl = box.querySelector('[data-role="edit-custom-tag"]');
    const timeScope = box.querySelector('[data-role="edit-wheel"]') || box;
    const d = deps.load();
    const entry = d.entries.find(e => e.id === id);
    const planned = Boolean(entry && entry.planned);
    const checked = validateTsForMode(tsEl ? tsEl.value : '', {
      planned,
      dateKey: (tsEl && tsEl.value || '').slice(0, 10) || deps.state.selectedDate
    });
    if (!checked.ok) {
      setTimeInputError(timeScope, checked.msg);
      const focusEl = timeScope.querySelector('[data-role="text"], [data-role="date"]');
      if (focusEl) focusEl.focus();
      return;
    }
    setTimeInputError(timeScope, '');
    const what = whatEl ? whatEl.value.trim() : '';
    if (!what) { if (whatEl) whatEl.focus(); return; }
    const sel = chipBox ? chipBox.querySelector('.chip.sel') : null;
    const ctag = customEl ? customEl.value.trim() : '';
    const tag = ctag || (sel ? sel.dataset.tag : '未知');
    const conflict = findTimeConflict(d.entries, checked.ts, id);
    if (conflict) {
      showInlineError(box, conflictMessage(conflict, checked.ts, 'use-conflict-plus-edit'));
      return;
    }
    if (ctag) rememberTag(ctag, editBucket, d.entries.filter(item => item.id !== id));
    if (entry) {
      entry.ts = checked.ts;
      entry.what = what;
      entry.tags = [tag];
      if (planned) entry.planned = true;
      else delete entry.planned;
      normalizeEntries(d, { todayKey: todayStr(), createId: deps.uid });
      deps.save(d);
    }
    deps.setSelectedDate(checked.ts.slice(0, 10));
    settleThenTeardown(() => { closeEditSheet(); deps.render(); });
  }

  function toggleStartTime(el) {
    const panel = el.closest('.form-sheet-panel');
    if (!panel || formRecordMode === 'plan') return;
    const section = panel.querySelector('[data-role="start-time-section"]');
    const tsEl = panel.querySelector('#form-ts');
    if (!section || !tsEl) return;
    const willOpen = section.hidden;
    section.hidden = !willOpen;
    el.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    paintPrevSegment(panel, tsEl.value);
    if (willOpen) {
      mountNewTimePicker(panel, tsEl.value);
      requestAnimationFrame(() => {
        const focusEl = section.querySelector('[data-role="text"], [data-role="date"], button, input, [tabindex]:not([tabindex="-1"])');
        if (focusEl) focusEl.focus({ preventScroll: true });
      });
    }
  }

  function saveTagConfig() {
    const panel = document.querySelector('#form-sheet .form-sheet-panel');
    const rows = Array.from(panel.querySelectorAll('.cfg-row'));
    const rowStates = rows.map(row => ({
      originalName: row.dataset.originalName || row.querySelector('.cfg-name').value.trim(),
      name: row.querySelector('.cfg-name').value.trim(),
      bucket: row.querySelector('.cfg-bucket').value,
      longOk: row.querySelector('.cfg-long-ok').checked
    })).filter(chip => chip.name && (chip.bucket === 'maintain' || chip.bucket === 'leak'));
    if (!rowStates.length) {
      showInlineError(panel, '至少保留一个维持/漏损 chip。', 'config-error');
      return;
    }
    const duplicate = rowStates.find((chip, index) => rowStates.findIndex(item => item.name === chip.name) !== index);
    if (duplicate) {
      showInlineError(panel, `「${duplicate.name}」重复了，请合并成一个标签名。`, 'config-error');
      return;
    }
    const snapshot = configSnapshot || deps.loadConfig();
    const d = deps.load();
    for (const chip of rowStates) {
      if (chip.originalName && chip.originalName !== chip.name && countEntriesWithTag(d.entries, chip.originalName)) {
        migrateEntryTags(d.entries, chip.originalName, chip.name);
      }
    }
    const nextConfig = {
      ...deps.loadConfig(),
      mainline: snapshot.mainline,
      chips: rowStates.map(chip => ({ name: chip.name, bucket: chip.bucket, longOk: chip.longOk }))
    };
    deps.save(d);
    deps.saveConfig(nextConfig);
    closeForm();
    deps.render();
  }

  return {
    openForm,
    openFormSheet,
    openMoreSheet,
    isFormOpen,
    getSheetMode,
    closeForm,
    closeFormSheet,
    closeEditSheet,
    startEdit,
    cancelEdit,
    pickTag,
    pickBucket,
    pickRecordMode,
    useConflictPlusMinute,
    editConflictEntry,
    pickEditTag,
    commitEdit,
    switchActivity,
    saveEntry,
    autosizeTextareas,
    updateMainlineHint,
    syncCustomDraft,
    toggleStartTime,
    saveTagConfig,
    handleResponsiveResize,
    getEditingBox
  };
}

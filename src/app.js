import { mountTimePicker } from './pickers.js';
import {
  defaultFormTimestamp,
  settlementEndFor as getSettlementEndFor
} from './entry_model.js';
import {
  OPEN_DATE_KEY,
  SELECTED_DATE_KEY,
  THEME_KEY,
  VIEW_KEY,
  addMainlineTag,
  load,
  loadConfig,
  mergeImportedEntries,
  rememberTagForBucket,
  save,
  saveConfig,
  uid,
  validateImportData
} from './storage.js';
import { createIoActions } from './io_actions.js';
import { createSheetController } from './sheet_controller.js';
import {
  GAP,
  addBucket,
  buildRangeSegmentsFromEntries,
  classifySegment,
  confirmSegmentInData,
  emptyTotals,
  formatPercent,
  isKnownTag,
  isSegmentConfirmed,
  listPlannedEntries,
  percentValue,
  primaryTag,
  sortedEntriesFrom,
  summarizeEntries
} from './stats.js';
import {
  addDays,
  addMonths,
  addYears,
  dateLabel,
  localDateKey,
  minsBetweenDates,
  normalizeTimestamp,
  nowStr,
  parseDateKey,
  periodLabel as getPeriodLabel,
  periodRange as getPeriodRange,
  shortDateLabel,
  todayStr
} from './time.js';
import {
  renderRuler,
  renderSummaryRows,
  renderTimeline,
  setButtonTip
} from './ui.js';

  let editingId = null;
  let sheetEditId = null;
  let pendingUpdateRegistration = null;
  let updateReloading = false;
  let lastIntervalSignature = '';
  let state = { view: 'day', selectedDate: '' };
  const HELP_SEEN_KEY = 'timelog.helpSeen.v16';

  function defaultFormTs() {
    const entries = load().entries;
    const dateKey = state.selectedDate || todayStr();
    return defaultFormTimestamp(entries, dateKey);
  }

  function periodRange(view = state.view, dateKey = state.selectedDate) {
    return getPeriodRange(view, dateKey);
  }
  function periodLabel(opts = {}) {
    return getPeriodLabel(state.view, state.selectedDate, opts);
  }
  function periodFullLabel() {
    return getPeriodLabel(state.view, state.selectedDate);
  }

  function persistState() {
    localStorage.setItem(VIEW_KEY, state.view);
    localStorage.setItem(SELECTED_DATE_KEY, state.selectedDate);
  }

  // --- Theme ---
  function getSysPref() {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  function applyTheme(pref) {
    const html = document.documentElement;
    if (pref === 'auto') {
      html.removeAttribute('data-theme');
    } else {
      html.setAttribute('data-theme', pref);
    }
    const effective = pref === 'auto' ? getSysPref() : pref;
    document.getElementById('meta-theme-color').setAttribute('content', effective === 'light' ? '#f7f7fa' : '#0d0d14');
    document.querySelectorAll('#theme-seg button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === pref);
    });
  }
  function setThemePref(pref) {
    localStorage.setItem(THEME_KEY, pref);
    applyTheme(pref);
  }

  // --- Compute entries and summaries ---
  function sortedEntries() {
    return sortedEntriesFrom(load().entries);
  }
  function settlementEndFor(startTs, dateKey) {
    return getSettlementEndFor(load().entries, startTs, dateKey);
  }
  function buildRangeSegments(start, end, opts = {}) {
    return buildRangeSegmentsFromEntries(load().entries, start, end, opts);
  }
  function summarizeRange(start, end, opts = {}) {
    return summarizeEntries(load().entries, start, end, opts);
  }
  function computeDay() {
    const { start, end } = periodRange('day', state.selectedDate);
    const statEnd = state.selectedDate === todayStr() ? new Date() : end;
    const allEntries = load().entries;
    const segments = buildRangeSegmentsFromEntries(allEntries, start, statEnd);
    const timeline = segments.filter(segment => segment.e);
    const planned = listPlannedEntries(allEntries, state.selectedDate);
    return { timeline, planned, totals: summarizeEntries(allEntries, start, statEnd) };
  }
  function summaryRows() {
    const { start } = periodRange();
    if (state.view === 'week') {
      return Array.from({ length: 7 }, (_, i) => {
        const d = addDays(start, i);
        return { key: localDateKey(d), label: shortDateLabel(d), rangeStart: d, rangeEnd: addDays(d, 1), targetView: 'day' };
      });
    }
    if (state.view === 'month') {
      const rows = [];
      for (let d = new Date(start); d.getMonth() === start.getMonth(); d = addDays(d, 1)) {
        rows.push({ key: localDateKey(d), label: shortDateLabel(d), rangeStart: new Date(d), rangeEnd: addDays(d, 1), targetView: 'day' });
      }
      return rows;
    }
    if (state.view === 'year') {
      return Array.from({ length: 12 }, (_, i) => {
        const d = new Date(start.getFullYear(), i, 1);
        return { key: localDateKey(d), label: `${i + 1}月`, rangeStart: d, rangeEnd: addMonths(d, 1), targetView: 'month' };
      });
    }
    return [];
  }

  // --- Navigation ---
  function setView(view) {
    state.view = view;
    editingId = null;
    sheetController.closeEditSheet();
    sheetController.closeForm();
    persistState();
    render();
  }
  function setSelectedDate(dateKey) {
    state.selectedDate = dateKey;
    persistState();
  }
  function shiftPeriod(delta) {
    const d = parseDateKey(state.selectedDate) || new Date();
    if (state.view === 'day') setSelectedDate(localDateKey(addDays(d, delta)));
    if (state.view === 'week') setSelectedDate(localDateKey(addDays(d, delta * 7)));
    if (state.view === 'month') setSelectedDate(localDateKey(addMonths(d, delta)));
    if (state.view === 'year') setSelectedDate(localDateKey(addYears(d, delta)));
    editingId = null;
    sheetController.closeEditSheet();
    sheetController.closeForm();
    render();
  }
  function goToday() {
    setSelectedDate(todayStr());
    editingId = null;
    sheetController.closeEditSheet();
    sheetController.closeForm();
    render();
  }
  function drill(dateKey, view) {
    state.view = view;
    setSelectedDate(dateKey);
    editingId = null;
    sheetController.closeEditSheet();
    sheetController.closeForm();
    render();
  }

  // --- Render ---
  function render() {
    renderChrome();
    if (state.view === 'day') {
      const day = computeDay();
      renderRuler(day.totals, day.timeline.length || day.planned.length || day.totals.total, state.view);
      renderTimeline(day.timeline, { editingId, sheetEditId, plannedItems: day.planned });
      if (editingId) {
        const entry = load().entries.find(e => e.id === editingId);
        if (entry) {
          const editor = sheetController.getEditingBox(entry.id);
          const mountEl = editor ? editor.querySelector('[data-role="edit-wheel"]') : null;
          const tsEl = editor ? editor.querySelector('[data-role="edit-ts"]') : null;
          if (mountEl && tsEl) {
            mountTimePicker(mountEl, entry.ts, v => {
              tsEl.value = v;
            });
          }
        }
      }
      lastIntervalSignature = dataSignature();
      return;
    }
    const { start, end } = periodRange();
    renderRuler(summarizeRange(start, end), 1, state.view);
    renderSummary();
    lastIntervalSignature = dataSignature();
  }
  function renderChrome() {
    document.querySelectorAll('#view-tabs button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === state.view);
    });
    const periodEl = document.getElementById('period-label');
    periodEl.textContent = periodLabel({ short: state.view === 'week' });
    periodEl.setAttribute('aria-label', periodFullLabel());
    document.getElementById('add-btn').hidden = state.view !== 'day';
    const switchBtn = document.getElementById('switch-btn');
    if (switchBtn) switchBtn.hidden = state.view !== 'day';
    const periodNames = { day: '天', week: '周', month: '月', year: '年' };
    const todayLabels = { day: '回到今天', week: '回到本周', month: '回到本月', year: '回到今年' };
    const todayTip = `回到包含今天的当前${periodNames[state.view]}。`;
    const todayBtn = document.getElementById('today-btn');
    todayBtn.textContent = todayLabels[state.view];
    setButtonTip(todayBtn, todayTip, todayLabels[state.view]);
    document.querySelectorAll('[data-action="shift-period"]').forEach(btn => {
      const isPrev = Number(btn.dataset.delta || 0) < 0;
      const text = `切到${isPrev ? '上一' : '下一'}${periodNames[state.view]}。`;
      setButtonTip(btn, text, `${isPrev ? '上一' : '下一'}${periodNames[state.view]}`);
    });
    ioActions.updateShareAvailability();
    const labels = { day: '当日时间轴', week: '本周每日汇总', month: '本月每日汇总', year: '全年每月汇总' };
    document.getElementById('list-label').textContent = labels[state.view];
  }

  function renderSummary() {
    const rows = summaryRows().map(row => ({
      ...row,
      totals: summarizeRange(row.rangeStart, row.rangeEnd)
    }));
    renderSummaryRows(rows);
  }

  // --- Segment confirmation ---
  function confirmSegment(id, endTs) {
    const d = load();
    const result = confirmSegmentInData(d, id, endTs);
    if (!result.ok) {
      if (result.reason === 'stale') {
        alert('这段时间已经变化，请重新查看后再确认。');
      }
      render();
      return;
    }
    save(d);
    render();
  }

  // --- Delete ---
  function delEntry(id) {
    if (!confirm('删除这条记录？')) return;
    const d = load();
    d.entries = d.entries.filter(e => e.id !== id);
    save(d);
    if (editingId === id) editingId = null;
    if (sheetEditId === id) sheetController.closeEditSheet();
    render();
  }

  function confirmPlanned(id) {
    const d = load();
    const entry = d.entries.find(e => e.id === id);
    if (!entry || !entry.planned) return;
    delete entry.planned;
    if (new Date(entry.ts) > new Date()) entry.ts = nowStr();
    save(d);
    render();
  }

  // --- Data signature ---
  function dataSignature() {
    const d = load();
    return JSON.stringify({ view: state.view, selectedDate: state.selectedDate, entries: d.entries });
  }
  function openHelp(opts = {}) {
    if (opts.markSeen !== false) localStorage.setItem(HELP_SEEN_KEY, '1');
    sheetController.openFormSheet({ mode: 'help' });
  }
  function openTagConfig() {
    sheetController.openFormSheet({ mode: 'config' });
  }

  function openBackup() {
    ioActions.openBackupSheet();
  }

  const sheetController = createSheetController({
    state,
    load,
    loadConfig,
    save,
    saveConfig,
    addMainlineTag,
    rememberTagForBucket,
    uid,
    defaultFormTs,
    settlementEndFor,
    persistState,
    setSelectedDate,
    render,
    renderChrome,
    getEditingId: () => editingId,
    setEditingId: value => { editingId = value; },
    getSheetEditId: () => sheetEditId,
    setSheetEditId: value => { sheetEditId = value; }
  });

  const ioActions = createIoActions({
    state,
    load,
    loadConfig,
    save,
    saveConfig,
    validateImportData,
    mergeImportedEntries,
    periodRange,
    periodFullLabel,
    computeDay,
    summaryRows,
    summarizeRange,
    openFormSheet: opts => sheetController.openFormSheet(opts),
    closeForm: () => sheetController.closeForm(),
    render
  });

  // --- App update prompt ---
  function showUpdatePrompt(registration) {
    pendingUpdateRegistration = registration;
    const banner = document.getElementById('update-banner');
    if (banner) banner.hidden = false;
  }
  function applyUpdate() {
    const worker = pendingUpdateRegistration && pendingUpdateRegistration.waiting;
    if (!worker) {
      window.location.reload();
      return;
    }
    updateReloading = true;
    worker.postMessage({ type: 'SKIP_WAITING' });
  }

  // --- Test API ---
  function exposeTestApi() {
    document.body.classList.add('app-ready');
    window.__timelogTest = {
      GAP,
      addBucket,
      buildRangeSegmentsFromEntries,
      classifySegment,
      confirmSegmentInData,
      emptyTotals,
      formatPercent,
      isKnownTag,
      isSegmentConfirmed,
      minsBetweenDates,
      normalizeTimestamp,
      percentValue,
      primaryTag,
      listPlannedEntries,
      sortedEntriesFrom,
      summarizeEntries
    };
  }

  // --- Actions ---
  function registerActions() {
    document.addEventListener('click', e => {
      const el = e.target.closest('[data-action]');
      if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      const action = el.dataset.action;
      if (action === 'theme') setThemePref(el.dataset.theme);
      if (action === 'view') setView(el.dataset.view);
      if (action === 'shift-period') shiftPeriod(Number(el.dataset.delta || 0));
      if (action === 'today') goToday();
      if (action === 'open-form') sheetController.openForm();
      if (action === 'switch-activity') sheetController.switchActivity();
      if (action === 'open-help') openHelp();
      if (action === 'open-backup') openBackup();
      if (action === 'open-tag-config') openTagConfig();
      if (action === 'toggle-start-time') sheetController.toggleStartTime(el);
      if (action === 'pick-form-tag') sheetController.pickTag(el);
      if (action === 'pick-form-bucket') sheetController.pickBucket(el);
      if (action === 'pick-record-mode') sheetController.pickRecordMode(el);
      if (action === 'save-entry') sheetController.saveEntry();
      if (action === 'close-form') sheetController.closeForm();
      if (action === 'use-conflict-plus-new' || action === 'use-conflict-plus-edit') sheetController.useConflictPlusMinute(el);
      if (action === 'edit-conflict-entry') sheetController.editConflictEntry(el.dataset.id);
      if (action === 'start-edit') sheetController.startEdit(el.dataset.id);
      if (action === 'pick-edit-tag') sheetController.pickEditTag(el);
      if (action === 'pick-edit-bucket') sheetController.pickBucket(el);
      if (action === 'toggle-edit-time') sheetController.toggleEditTime(el);
      if (action === 'commit-edit') sheetController.commitEdit(el.dataset.id || editingId);
      if (action === 'cancel-edit') sheetController.cancelEdit();
      if (action === 'add-config-chip') sheetController.addConfigChip();
      if (action === 'remove-config-chip') sheetController.removeConfigChip(el);
      if (action === 'remove-mainline-name') sheetController.removeMainlineName(el);
      if (action === 'save-tag-config') sheetController.saveTagConfig();
      if (action === 'confirm-planned') confirmPlanned(el.dataset.id);
      if (action === 'confirm-segment') confirmSegment(el.dataset.id, el.dataset.end);
      if (action === 'delete-entry') delEntry(el.dataset.id);
      if (action === 'drill') drill(el.dataset.date, el.dataset.view);
      if (action === 'copy-summary') ioActions.copyCurrentViewSummary();
      if (action === 'copy-json') ioActions.copyJSON();
      if (action === 'download-json') ioActions.downloadJSON();
      if (action === 'import-json') ioActions.importJSON();
      if (action === 'cancel-import-shift') ioActions.cancelImportShift();
      if (action === 'confirm-import-shift') ioActions.confirmImportShift();
      if (action === 'share-json') ioActions.shareJSON();
      if (action === 'update-app') applyUpdate();
    });
    document.getElementById('import-file').addEventListener('change', ioActions.handleImport);
    document.addEventListener('input', e => {
      if (e.target instanceof HTMLTextAreaElement && e.target.classList.contains('ta')) {
        sheetController.autosizeTextareas(e.target.parentElement || document);
      }
      if (e.target instanceof HTMLInputElement && (e.target.id === 'form-ctag' || e.target.matches('[data-role="edit-custom-tag"]'))) {
        sheetController.updateMainlineHint(e.target);
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { sheetController.cancelEdit(); sheetController.closeForm(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (editingId || sheetEditId) { sheetController.commitEdit(editingId || sheetEditId); return; }
        if (sheetController.isFormOpen()) sheetController.saveEntry();
      }
    });
    window.addEventListener('resize', sheetController.handleResponsiveResize, { passive: true });
    window.addEventListener('orientationchange', sheetController.handleResponsiveResize, { passive: true });
  }

  // --- Register SW ---
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (updateReloading) window.location.reload();
    });
    navigator.serviceWorker.register('sw.js').then(reg => {
      if (reg.waiting && navigator.serviceWorker.controller) showUpdatePrompt(reg);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdatePrompt(reg);
        });
      });
    }).catch(() => {});
  }

  // --- Init ---
  let tickTimer = null;

  function startTickTimer() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      if (document.hidden) return;
      if (editingId || sheetEditId || sheetController.isFormOpen() || sheetController.getSheetMode()) return;
      const signature = dataSignature();
      if (signature === lastIntervalSignature) return;
      render();
    }, 60000);
  }

  function stopTickTimer() {
    if (!tickTimer) return;
    clearInterval(tickTimer);
    tickTimer = null;
  }

  function init() {
    const today = todayStr();
    const savedView = localStorage.getItem(VIEW_KEY);
    const savedDate = parseDateKey(localStorage.getItem(SELECTED_DATE_KEY));
    state.view = ['day', 'week', 'month', 'year'].includes(savedView) ? savedView : 'day';
    state.selectedDate = savedDate ? localDateKey(savedDate) : today;
    localStorage.setItem(OPEN_DATE_KEY, today);
    persistState();

    applyTheme(localStorage.getItem(THEME_KEY) || 'auto');
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    if (mq.addEventListener) mq.addEventListener('change', () => applyTheme(localStorage.getItem(THEME_KEY) || 'auto'));
    document.getElementById('hdr-date').textContent = dateLabel(new Date());
    render();
    document.body.classList.add('app-ready');
    if (!navigator.webdriver && !localStorage.getItem(HELP_SEEN_KEY)) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => openHelp());
      });
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopTickTimer();
      else startTickTimer();
    }, { passive: true });
    startTickTimer();
  }

  if (window.__TIMELOG_TEST__) {
    exposeTestApi();
  } else {
    registerActions();
    registerServiceWorker();
    init();
  }

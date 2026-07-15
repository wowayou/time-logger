// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
import {
  addOneMinute,
  entriesRevision,
  defaultFormTimestamp,
  findTimeConflict,
  normalizeEntries,
  planDeleteEntry,
  settlementEndFor as getSettlementEndFor
} from './entry_model.js';
import {
  OPEN_DATE_KEY,
  RECORD_MODE_KEY,
  SELECTED_DATE_KEY,
  THEME_KEY,
  VIEW_KEY,
  ensureFirstUsedDate,
  load,
  loadConfig,
  mergeImportedConfig,
  mergeImportedEntries,
  mergeImportedFirstUsedDate,
  readFirstUsedDate,
  rememberCustomTagForBucket,
  save,
  saveConfig,
  uid,
  validateImportData
} from './storage.js';
import { createIoActions } from './io_actions.js';
import { createSheetController } from './sheet_controller.js';
import {
  buildRangeSegmentsFromEntries,
  confirmSegmentInData,
  listPlannedEntries,
  summarizeEntries
} from './stats.js';
import {
  addDays,
  addMonths,
  addYears,
  fmtMins,
  hhmm,
  inclusiveCalendarDayCount,
  entryModeForDate,
  localDateKey,
  minsBetweenDates,
  nowStr,
  parseDateKey,
  periodLabel as getPeriodLabel,
  periodRange as getPeriodRange,
  shortDateLabel,
  todayStr
} from './time.js';
import {
  APP_VERSION,
  esc,
  iconSvg,
  renderDayHero,
  renderRuler,
  renderSummaryRows,
  renderTimeline,
  setButtonTip
} from './ui.js';

  const bootTrace = window.__timelogBootTrace || null;
  function markBootTrace(name) {
    if (!bootTrace) return;
    const previous = bootTrace.marks.length ? bootTrace.marks[bootTrace.marks.length - 1].at : 0;
    bootTrace.marks.push({ name, at: Math.max(previous, performance.now()) });
  }
  function setBootSnapshotState(state) {
    if (!bootTrace) return;
    bootTrace.snapshot = state;
    bootTrace.snapshotStates.push(state);
  }
  markBootTrace('app_module_body_start');

  let sheetEditId = null;
  let pendingUpdateRegistration = null;
  let updateReloading = false;
  let pendingDelete = null;
  let undoDeleteState = null;
  let lastIntervalSignature = '';
  let firstUsedDate = '';
  let state = { view: 'day', selectedDate: '' };
  const HELP_SEEN_KEY = 'timelog.helpSeen.v16';
  const BOOT_SNAPSHOT_KEY = 'timelog.bootSnapshot.v1';
  const UNRECORDED_GAP_FLOOR_MIN = 15;

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
    document.getElementById('meta-theme-color').setAttribute('content', effective === 'light' ? '#f7f5f1' : '#0e0f13');
    document.querySelectorAll('#theme-seg button').forEach(btn => {
      const selected = btn.dataset.theme === pref;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
  }
  function setThemePref(pref) {
    localStorage.setItem(THEME_KEY, pref);
    applyTheme(pref);
  }

  // --- Compute entries and summaries ---
  function settlementEndFor(startTs, dateKey) {
    return getSettlementEndFor(load().entries, startTs, dateKey);
  }
  function summarizeRange(start, end, opts = {}) {
    return summarizeEntries(load().entries, start, end, opts);
  }
  function computeDay() {
    const { start, end } = periodRange('day', state.selectedDate);
    const statEnd = state.selectedDate === todayStr() ? new Date() : end;
    const allEntries = load().entries;
    const segments = buildRangeSegmentsFromEntries(allEntries, start, statEnd);
    const timeline = segments.filter(segment => segment.e || segment.mins >= UNRECORDED_GAP_FLOOR_MIN);
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
  const VIEW_ORDER = ['day', 'week', 'month', 'year'];
  function setView(view) {
    const direction = Math.sign(VIEW_ORDER.indexOf(view) - VIEW_ORDER.indexOf(state.view));
    state.view = view;
    sheetController.closeEditSheet();
    sheetController.closeForm();
    persistState();
    render();
    animateContentEnter(direction);
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
    sheetController.closeEditSheet();
    sheetController.closeForm();
    render();
    animateContentEnter(Math.sign(delta));
  }
  function goToday() {
    const prevDate = state.selectedDate;
    setSelectedDate(todayStr());
    sheetController.closeEditSheet();
    sheetController.closeForm();
    render();
    const today = todayStr();
    animateContentEnter(today > prevDate ? 1 : (today < prevDate ? -1 : 0));
  }
  function drill(dateKey, view) {
    state.view = view;
    setSelectedDate(dateKey);
    sheetController.closeEditSheet();
    sheetController.closeForm();
    render();
  }

  // R7：切视图/切周期后内容方向性滑入（280ms）——只在导航函数里、render() 之后
  // 调用，纯视觉糖：从偏移位滑到原位，不影响内容或任何时序；reduced-motion 跳过。
  // direction: 1=正向（下一段/更晚的视图/更晚的日期），-1=反向，0/falsy=不动画。
  function animateContentEnter(direction) {
    if (!direction) return;
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const dx = direction > 0 ? 14 : -14;
    [document.getElementById('ruler'), document.getElementById('timeline')].forEach(el => {
      if (!el) return;
      el.style.transition = 'none';
      el.style.transform = `translateX(${dx}px)`;
      el.style.opacity = '0';
      void el.offsetWidth;
      requestAnimationFrame(() => {
        el.style.transition = 'transform 0.28s ease-out, opacity 0.22s ease';
        el.style.transform = '';
        el.style.opacity = '';
        const clear = () => { el.style.transition = ''; el.removeEventListener('transitionend', clear); };
        el.addEventListener('transitionend', clear);
      });
    });
  }

  // --- Render ---
  function render() {
    renderChrome();
    if (state.view === 'day') {
      const day = computeDay();
      const isToday = state.selectedDate === todayStr();
      renderDayHero(day.totals, day.timeline.length || day.planned.length || day.totals.total, {
        isToday,
        asOf: nowStr().slice(11, 16)
      });
      renderTimeline(day.timeline, {
        sheetEditId,
        plannedItems: day.planned,
        isToday,
        nowLabel: nowStr().slice(11, 16)
      });
      lastIntervalSignature = dataSignature();
      saveBootSnapshot();
      return;
    }
    const { start, end } = periodRange();
    renderRuler(summarizeRange(start, end), 1, state.view);
    renderSummary();
    lastIntervalSignature = dataSignature();
    saveBootSnapshot();
  }

  function saveBootSnapshot() {
    try {
      const app = document.querySelector('.app');
      const addBtn = document.getElementById('add-btn');
      const listFade = document.getElementById('list-fade');
      if (!app || !addBtn) return;
      sessionStorage.setItem(BOOT_SNAPSHOT_KEY, JSON.stringify({
        // v56：快照带版本戳——应用更新后（SKIP_WAITING reload）不得把旧版 DOM 形态
        // 交给新版 JS 还跳过首轮渲染；init() 里版本不符则按无快照走正常启动。
        appVersion: APP_VERSION,
        appHtml: app.innerHTML,
        addHtml: addBtn.innerHTML,
        addHidden: addBtn.hidden,
        addAria: addBtn.getAttribute('aria-label') || '',
        fadeHidden: listFade ? listFade.hidden : true,
        dataRaw: localStorage.getItem('timelog.v1'),
        configRaw: localStorage.getItem('timelog.config'),
        view: localStorage.getItem(VIEW_KEY),
        selectedDate: localStorage.getItem(SELECTED_DATE_KEY),
        recordMode: localStorage.getItem(RECORD_MODE_KEY),
        today: todayStr()
      }));
    } catch {}
  }
  function renderChrome() {
    const crossTabBanner = document.getElementById('cross-tab-banner');
    if (crossTabBanner) crossTabBanner.hidden = true;
    document.querySelectorAll('#view-tabs button').forEach(btn => {
      const selected = btn.dataset.view === state.view;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
    const usageDay = inclusiveCalendarDayCount(firstUsedDate, todayStr());
    const usageEl = document.getElementById('usage-day');
    if (usageEl) {
      usageEl.textContent = `使用第 ${usageDay} 天`;
      usageEl.setAttribute('aria-label', `已在本机使用第 ${usageDay} 天`);
    }
    // R5：当前周期是否包含今天——驱动「回到今天」按钮的条件渲染 + 日期行内的
    // 「今天」常驻高亮字样，两处共用同一次判定。
    const { start: periodStart, end: periodEnd } = periodRange();
    const todayDate = parseDateKey(todayStr());
    const inCurrentPeriod = Boolean(todayDate && todayDate >= periodStart && todayDate < periodEnd);
    const periodEl = document.getElementById('period-label');
    const periodText = periodLabel({ short: state.view === 'week' });
    periodEl.innerHTML = inCurrentPeriod
      ? `${periodText} <span class="period-today-badge">今天</span>`
      : periodText;
    periodEl.setAttribute('aria-label', periodFullLabel());
    // R2+FAB：悬浮「记一条」——只在日视图出现；主文案随计划/记录模式，副文案标注
    // 续记起点（续 X 起 · 已 Ymin）。底部渐隐遮罩与 FAB 同步显隐。
    const addBtn = document.getElementById('add-btn');
    const listFade = document.getElementById('list-fade');
    const isDay = state.view === 'day';
    const dateMode = entryModeForDate(state.selectedDate);
    const canCreate = isDay && dateMode.canCreate;
    addBtn.hidden = !canCreate;
    if (listFade) listFade.hidden = !canCreate;
    if (canCreate) {
      const preferPlan = localStorage.getItem(RECORD_MODE_KEY) === 'plan';
      const isPlan = dateMode.forcedMode === 'plan' || (dateMode.kind === 'today' && preferPlan);
      const mainLabel = isPlan ? '＋ 计划一条' : '＋ 记一条';
      const sub = fabSubCopy();
      addBtn.innerHTML = `<span class="fab-main">${mainLabel}</span>${sub ? `<span class="fab-sub">${esc(sub)}</span>` : ''}`;
      // FAB 有可见文案，不需要 hover tooltip；且 `button[data-tip]` 会把 position 强制
      // 成 relative（tooltip 定位规则），破坏 fixed 悬浮——所以只设 aria-label，不设 data-tip。
      addBtn.setAttribute('aria-label', isPlan ? '计划一条新的时间记录' : '记一条新的时间记录');
    }
    const periodNames = { day: '天', week: '周', month: '月', year: '年' };
    const todayLabels = { day: '回到今天', week: '回到本周', month: '回到本月', year: '回到今年' };
    const todayTip = `回到包含今天的当前${periodNames[state.view]}。`;
    const todayBtn = document.getElementById('today-btn');
    // R5：只在离开当前周期（已不含今天）后才出现，避免常驻占位。
    todayBtn.hidden = inCurrentPeriod;
    todayBtn.textContent = todayLabels[state.view];
    setButtonTip(todayBtn, todayTip, todayLabels[state.view]);
    document.querySelectorAll('[data-action="shift-period"]').forEach(btn => {
      const isPrev = Number(btn.dataset.delta || 0) < 0;
      const text = `切到${isPrev ? '上一' : '下一'}${periodNames[state.view]}。`;
      setButtonTip(btn, text, `${isPrev ? '上一' : '下一'}${periodNames[state.view]}`);
    });
    const labels = { day: '当日时间轴', week: '本周每日汇总', month: '本月每日汇总', year: '全年每月汇总' };
    document.getElementById('list-label').textContent = labels[state.view];
  }

  // R2+FAB 副文案：续记起点。今天有记录 → 「续 hh:mm 起 · 已 Ymin」；今天空 →
  // 「今天还没记」；历史日有记录 → 「续 hh:mm 起」；历史空 → 「这天还没记」。
  function fabSubCopy() {
    const dateKey = state.selectedDate;
    const isToday = dateKey === todayStr();
    const dayLogged = load().entries.filter(e => !e.planned && e.ts.slice(0, 10) === dateKey);
    if (!dayLogged.length) return isToday ? '今天还没记' : '这天还没记';
    const start = defaultFormTimestamp(load().entries, dateKey);
    if (!isToday) return `续 ${hhmm(start)} 起`;
    const settlement = settlementEndFor(start, dateKey);
    const dur = settlement.endTs ? minsBetweenDates(new Date(start), new Date(settlement.endTs)) : 0;
    return `续 ${hhmm(start)} 起 · 已 ${fmtMins(dur)}`;
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
    normalizeEntries(d, { todayKey: todayStr(), createId: uid });
    save(d);
    render();
  }

  // --- Delete / undo ---
  function deleteError(message) {
    const error = document.querySelector('#form-sheet [data-role="delete-error"]');
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
  }

  function requestDelete(id, opts = {}) {
    const d = load();
    const entry = d.entries.find(item => item.id === id);
    const plan = planDeleteEntry(d.entries, id, { todayKey: todayStr(), nowTs: nowStr() });
    if (!entry || !plan.ok) return;
    pendingDelete = {
      id,
      plan,
      returnToEdit: opts.returnToEdit !== false && sheetController.getSheetMode() === 'edit'
    };
    sheetController.openFormSheet({ mode: 'delete-confirm', deletePlan: plan, deleteEntry: entry });
  }

  function cancelDelete() {
    const pending = pendingDelete;
    pendingDelete = null;
    sheetController.closeFormSheet({ restoreFocus: false });
    if (pending && pending.returnToEdit) sheetController.startEdit(pending.id);
    else render();
  }

  function hideUndoToast() {
    if (undoDeleteState && undoDeleteState.timer) clearTimeout(undoDeleteState.timer);
    undoDeleteState = null;
    const toast = document.getElementById('undo-toast');
    if (toast) toast.hidden = true;
  }

  function showUndoToast(beforeData, afterRevision) {
    hideUndoToast();
    const toast = document.getElementById('undo-toast');
    if (!toast) return;
    const message = toast.querySelector('[data-role="undo-message"]');
    const button = toast.querySelector('[data-action="undo-delete"]');
    if (message) message.textContent = '已删除';
    if (button) button.hidden = false;
    toast.hidden = false;
    const timer = setTimeout(hideUndoToast, 8000);
    undoDeleteState = { beforeData, afterRevision, timer };
  }

  function cancelUndoForConflict() {
    if (!undoDeleteState) return;
    const toast = document.getElementById('undo-toast');
    const message = toast && toast.querySelector('[data-role="undo-message"]');
    const button = toast && toast.querySelector('[data-action="undo-delete"]');
    if (undoDeleteState.timer) clearTimeout(undoDeleteState.timer);
    undoDeleteState = null;
    if (message) message.textContent = '数据已在别处更新，撤销已取消';
    if (button) button.hidden = true;
    if (toast) {
      toast.hidden = false;
      setTimeout(() => { toast.hidden = true; }, 3000);
    }
  }

  function confirmDelete(id) {
    if (!pendingDelete || pendingDelete.id !== id) return;
    const d = load();
    const entry = d.entries.find(item => item.id === id);
    const latest = planDeleteEntry(d.entries, id, { todayKey: todayStr(), nowTs: nowStr() });
    if (!entry || !latest.ok) {
      deleteError(latest.message || '这条记录已经不存在。');
      return;
    }
    if (latest.resultSignature !== pendingDelete.plan.resultSignature) {
      pendingDelete.plan = latest;
      sheetController.openFormSheet({
        mode: 'delete-confirm',
        deletePlan: latest,
        deleteEntry: entry,
        deleteStale: true
      });
      return;
    }
    const beforeData = JSON.parse(JSON.stringify(d));
    d.entries = latest.resultEntries;
    if (!save(d)) {
      deleteError('本机存储空间不足，删除没有执行；请先导出备份并清理空间。');
      return;
    }
    pendingDelete = null;
    sheetController.closeFormSheet({ restoreFocus: false });
    render();
    showUndoToast(beforeData, entriesRevision(d.entries));
  }

  function undoDelete() {
    const pending = undoDeleteState;
    if (!pending) return;
    const current = load();
    if (entriesRevision(current.entries) !== pending.afterRevision) {
      cancelUndoForConflict();
      return;
    }
    if (!save(pending.beforeData)) {
      cancelUndoForConflict();
      return;
    }
    hideUndoToast();
    render();
  }

  function confirmPlanned(id) {
    const d = load();
    const entry = d.entries.find(e => e.id === id);
    if (!entry || !entry.planned) return;
    delete entry.planned;
    if (new Date(entry.ts) > new Date()) entry.ts = nowStr();
    // ⑥ Confirming to "now" can collide with an existing entry on that exact
    // minute. Every other write path guards same-ts; here there is no sheet to
    // host an inline prompt, so nudge forward to the next free minute (matching
    // the "+1min" direction) instead of silently creating a duplicate timestamp.
    while (findTimeConflict(d.entries, entry.ts, entry.id)) {
      entry.ts = addOneMinute(entry.ts);
    }
    normalizeEntries(d, { todayKey: todayStr(), createId: uid });
    save(d);
    render();
  }

  // --- Data signature ---
  function dataSignature() {
    const d = load();
    const { start, end } = periodRange();
    const now = new Date();
    const liveMinute = now >= start && now < end ? nowStr() : '';
    return JSON.stringify({ view: state.view, selectedDate: state.selectedDate, today: todayStr(), liveMinute, entries: d.entries });
  }
  function openHelp(opts = {}) {
    if (opts.markSeen !== false) localStorage.setItem(HELP_SEEN_KEY, '1');
    sheetController.openFormSheet({ mode: 'help' });
  }
  function openTagConfig() {
    sheetController.openFormSheet({ mode: 'config' });
  }

  const sheetController = createSheetController({
    state,
    load,
    loadConfig,
    save,
    saveConfig,
    rememberCustomTagForBucket,
    uid,
    defaultFormTs,
    settlementEndFor,
    persistState,
    setSelectedDate,
    render,
    renderChrome,
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
    mergeImportedConfig,
    readFirstUsedDate,
    // 起始日的权威副本是 app.js 的 firstUsedDate，导入后必须同步刷新，
    // 否则 header 的「使用第 N 天」会停在导入前的值直到下次冷启动。
    adoptImportedFirstUsedDate: value => {
      firstUsedDate = mergeImportedFirstUsedDate(value, todayStr());
    },
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

  // --- Actions ---
  function registerActions() {
    // 新发现：header「···」更多按钮此前是裸文本字形，换成 iconSvg 体系图标（一次性
    // 注入，因为它是 index.html 静态壳里的按钮，不像其它图标按钮那样走 JS 模板渲染）。
    const moreBtn = document.querySelector('[data-action="open-more"]');
    if (moreBtn) moreBtn.innerHTML = iconSvg('more');
    document.addEventListener('click', e => {
      const el = e.target.closest('[data-action]');
      if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      const action = el.dataset.action;
      if (action === 'theme') setThemePref(el.dataset.theme);
      if (action === 'view') setView(el.dataset.view);
      if (action === 'shift-period') shiftPeriod(Number(el.dataset.delta || 0));
      if (action === 'today') goToday();
      if (action === 'open-form') sheetController.openForm();
      if (action === 'backfill-seg') sheetController.openFormSheet({
        mode: 'new',
        ts: el.dataset.ts,
        endTs: el.dataset.end,
        backfill: true,
        backfillKind: el.dataset.kind,
        sourceId: el.dataset.sourceId || ''
      });
      if (action === 'open-help') openHelp();
      if (action === 'open-more') sheetController.openMoreSheet();
      if (action === 'open-tag-config') openTagConfig();
      if (action === 'toggle-start-time') sheetController.toggleStartTime(el);
      if (action === 'toggle-edit-start-time') sheetController.toggleEditStartTime(el);
      if (action === 'pick-edit-end-mode') sheetController.pickEditEndMode(el);
      if (action === 'pick-form-tag') sheetController.pickTag(el);
      if (action === 'pick-form-bucket') sheetController.pickBucket(el);
      if (action === 'pick-record-mode') sheetController.pickRecordMode(el);
      if (action === 'pick-overnight-end-mode') sheetController.pickOvernightEndMode(el);
      if (action === 'save-entry') sheetController.saveEntry();
      if (action === 'close-form') {
        if (sheetController.getSheetMode() === 'delete-confirm') cancelDelete();
        else sheetController.closeForm();
        renderIfCrossTabPending();
      }
      if (action === 'use-conflict-plus-new' || action === 'use-conflict-plus-edit') sheetController.useConflictPlusMinute(el);
      if (action === 'edit-conflict-entry') sheetController.editConflictEntry(el.dataset.id);
      if (action === 'start-edit') sheetController.startEdit(el.dataset.id);
      if (action === 'pick-edit-tag') sheetController.pickEditTag(el);
      if (action === 'pick-edit-bucket') sheetController.pickBucket(el);
      if (action === 'commit-edit') sheetController.commitEdit(el.dataset.id || sheetEditId);
      if (action === 'cancel-edit') sheetController.cancelEdit();
      if (action === 'save-tag-config') sheetController.saveTagConfig();
      if (action === 'confirm-planned') confirmPlanned(el.dataset.id);
      if (action === 'confirm-segment') confirmSegment(el.dataset.id, el.dataset.end);
      if (action === 'request-delete') requestDelete(el.dataset.id);
      if (action === 'confirm-delete') confirmDelete(el.dataset.id);
      if (action === 'cancel-delete') cancelDelete();
      if (action === 'undo-delete') undoDelete();
      if (action === 'drill') drill(el.dataset.date, el.dataset.view);
      if (action === 'copy-summary') ioActions.copyCurrentViewSummary();
      if (action === 'copy-json') ioActions.copyJSON();
      if (action === 'download-json') ioActions.downloadJSON();
      if (action === 'import-json') ioActions.importJSON();
      if (action === 'cancel-import-shift') ioActions.cancelImportShift();
      if (action === 'confirm-import-shift') ioActions.confirmImportShift();
      if (action === 'resolve-import-conflict') ioActions.resolveImportConflict(el.dataset.key, el.dataset.resolution);
      if (action === 'send-backup') ioActions.shareJSON();
      if (action === 'update-app') applyUpdate();
      if (action === 'dismiss-cross-tab-banner') {
        const b = document.getElementById('cross-tab-banner');
        if (b) b.hidden = true;
        cancelUndoForConflict();
        render();
      }
    });
    document.getElementById('import-file').addEventListener('change', ioActions.handleImport);
    document.addEventListener('input', e => {
      if (e.target instanceof HTMLTextAreaElement && e.target.classList.contains('ta')) {
        sheetController.autosizeTextareas(e.target.parentElement || document);
      }
      if (e.target instanceof HTMLInputElement && (e.target.id === 'form-ctag' || e.target.matches('[data-role="edit-custom-tag"]'))) {
        sheetController.updateMainlineHint(e.target);
        sheetController.syncCustomDraft(e.target);
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.target.id === 'import-shift-hours') ioActions.previewImportShift(e.target.value);
        sheetController.handleFormInput(e.target);
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (sheetController.getSheetMode() === 'delete-confirm') cancelDelete();
        else { sheetController.cancelEdit(); sheetController.closeForm(); }
        renderIfCrossTabPending();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (sheetEditId) { sheetController.commitEdit(sheetEditId); return; }
        if (sheetController.isFormOpen()) sheetController.saveEntry();
      }
    });
    window.addEventListener('resize', sheetController.handleResponsiveResize, { passive: true });
    window.addEventListener('orientationchange', sheetController.handleResponsiveResize, { passive: true });
    window.addEventListener('storage', e => {
      if (e.key !== 'timelog.v1') return;
      cancelUndoForConflict();
      if (sheetEditId || sheetController.isFormOpen() || sheetController.getSheetMode()) {
        const b = document.getElementById('cross-tab-banner');
        if (b) b.hidden = false;
      } else {
        render();
      }
    });
  }

  function renderIfCrossTabPending() {
    const b = document.getElementById('cross-tab-banner');
    if (b && !b.hidden) render();
  }

  // 触摸/触控笔左滑揭示 2x72px 编辑/删除轨道。一次只开一张；纵向滚动、点空白、
  // 打开另一张都会关闭。桌面鼠标不启用，键盘仍走点卡片编辑与编辑页删除。
  function registerCardSwipe() {
    const timeline = document.getElementById('timeline');
    if (!timeline) return;
    const TRACK = 144;
    const SNAP = 72;
    let active = null;
    let openRow = null;
    let suppressClickUntil = 0;

    function setActionsEnabled(row, enabled) {
      const actions = row && row.querySelector('.swipe-actions');
      if (!actions) return;
      actions.setAttribute('aria-hidden', String(!enabled));
      actions.querySelectorAll('button').forEach(button => { button.tabIndex = enabled ? 0 : -1; });
    }

    function setOffset(row, offset, animate = false) {
      const card = row && row.querySelector('.entry');
      if (!card) return;
      card.style.transition = animate ? 'transform 180ms cubic-bezier(.2,.8,.2,1)' : 'none';
      card.style.transform = offset ? `translateX(${offset}px)` : '';
      row.dataset.swipeOffset = String(offset);
      row.classList.toggle('swipe-open', offset === -TRACK);
      if (offset < 0) row.classList.add('swipe-revealing');
      else if (!animate) row.classList.remove('swipe-revealing');
      setActionsEnabled(row, offset === -TRACK);
      if (animate) setTimeout(() => {
        if (document.contains(card)) {
          card.style.transition = '';
          if (!offset) row.classList.remove('swipe-revealing');
        }
      }, 200);
    }

    function closeOpen(animate = true) {
      if (openRow && document.contains(openRow)) setOffset(openRow, 0, animate);
      openRow = null;
    }

    function finishGesture(cancelled = false) {
      if (!active) return;
      const { row, offset, axis, velocity } = active;
      const shouldOpen = !cancelled && axis === 'x' && (offset <= -SNAP || velocity < -0.45);
      if (shouldOpen) {
        if (openRow && openRow !== row) setOffset(openRow, 0, true);
        setOffset(row, -TRACK, true);
        openRow = row;
      } else {
        setOffset(row, 0, true);
        if (openRow === row) openRow = null;
      }
      if (axis === 'x') suppressClickUntil = performance.now() + 350;
      active = null;
    }

    function begin(row, x, y, source, pointerId = null) {
      if (!row || !row.querySelector('.entry[data-action="start-edit"]')) return;
      if (openRow && openRow !== row) closeOpen(true);
      active = {
        row,
        source,
        pointerId,
        startX: x,
        startY: y,
        base: Number(row.dataset.swipeOffset || 0),
        offset: Number(row.dataset.swipeOffset || 0),
        axis: '',
        lastX: x,
        lastAt: performance.now(),
        velocity: 0
      };
    }

    function move(x, y, event) {
      if (!active) return;
      const dx = x - active.startX;
      const dy = y - active.startY;
      if (!active.axis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        active.axis = Math.abs(dx) > Math.abs(dy) + 4 ? 'x' : 'y';
        if (active.axis === 'y') {
          closeOpen(true);
          active = null;
          return;
        }
      }
      if (active.axis !== 'x') return;
      const now = performance.now();
      const elapsed = Math.max(1, now - active.lastAt);
      active.velocity = (x - active.lastX) / elapsed;
      active.lastX = x;
      active.lastAt = now;
      active.offset = Math.max(-TRACK, Math.min(0, active.base + dx));
      setOffset(active.row, active.offset, false);
      if (event && event.cancelable) event.preventDefault();
    }

    timeline.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      if (e.target.closest('.mini-btn, .swipe-action')) return;
      const row = e.target.closest('.swipe-row');
      begin(row, e.clientX, e.clientY, 'pointer', e.pointerId);
      if (active && row.setPointerCapture) row.setPointerCapture(e.pointerId);
    });
    timeline.addEventListener('pointermove', e => {
      if (!active || active.source !== 'pointer' || active.pointerId !== e.pointerId) return;
      move(e.clientX, e.clientY, e);
    });
    timeline.addEventListener('pointerup', e => {
      if (active && active.source === 'pointer' && active.pointerId === e.pointerId) finishGesture(false);
    });
    timeline.addEventListener('pointercancel', e => {
      if (active && active.source === 'pointer' && active.pointerId === e.pointerId) finishGesture(true);
    });

    // Synthetic TouchEvent coverage and older WebKit fallback.
    timeline.addEventListener('touchstart', e => {
      if (active || e.touches.length !== 1 || e.target.closest('.mini-btn, .swipe-action')) return;
      const touch = e.touches[0];
      begin(e.target.closest('.swipe-row'), touch.clientX, touch.clientY, 'touch');
    }, { passive: true });
    timeline.addEventListener('touchmove', e => {
      if (!active || active.source !== 'touch' || e.touches.length !== 1) return;
      move(e.touches[0].clientX, e.touches[0].clientY, e);
    }, { passive: false });
    timeline.addEventListener('touchend', () => {
      if (active && active.source === 'touch') finishGesture(false);
    }, { passive: true });
    timeline.addEventListener('touchcancel', () => {
      if (active && active.source === 'touch') finishGesture(true);
    }, { passive: true });

    timeline.addEventListener('click', e => {
      const row = e.target.closest('.swipe-row');
      if (e.target.closest('.swipe-action')) {
        if (row === openRow) closeOpen(false);
        return;
      }
      if (performance.now() < suppressClickUntil || (row && row === openRow)) {
        e.preventDefault();
        e.stopPropagation();
        if (row === openRow) closeOpen(true);
      }
    });
    document.addEventListener('pointerdown', e => {
      if (openRow && !e.target.closest('.swipe-row')) closeOpen(true);
    }, { passive: true });
    window.addEventListener('scroll', () => closeOpen(true), { passive: true });

    // R6：卡片是 role=button 的 div，键盘 Enter/Space 激活（等价点击）——保 a11y 不回退。
    timeline.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      const cardEl = e.target.closest('.entry[data-action]');
      if (!cardEl || cardEl !== e.target) return;
      e.preventDefault();
      cardEl.click();
    });
  }

  // --- Register SW ---
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (updateReloading) window.location.reload();
    });
    navigator.serviceWorker.register('sw.js').then(reg => {
      // 新 worker 进入 waiting 后始终提示，由用户点击后才 skipWaiting + reload。
      // 不在空闲态静默重载：用户需要看见版本边界，也避免刷新造成视觉闪烁。
      const consider = () => {
        if (updateReloading) return;
        if (!reg.waiting || !navigator.serviceWorker.controller) return;
        showUpdatePrompt(reg);
      };
      consider();
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) consider();
        });
      });
      // 主动、及时地复查新版本——iOS Safari（尤其 standalone PWA）不会主动/及时
      // 复查 sw.js。每次冷启动 + 每次切回前台都强制 update()，让新版尽快到达。
      const checkForUpdate = () => { reg.update().catch(() => {}); };
      checkForUpdate();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
    }).catch(() => {});
  }

  // --- Init ---
  let tickTimer = null;

  function refreshLiveClock() {
    if (document.hidden) return;
    if (sheetEditId || sheetController.isFormOpen() || sheetController.getSheetMode()) return;
    const signature = dataSignature();
    if (signature === lastIntervalSignature) return;
    render();
  }

  function startTickTimer() {
    if (tickTimer !== null) return;
    const delay = 60000 - (Date.now() % 60000);
    tickTimer = setTimeout(() => {
      tickTimer = null;
      refreshLiveClock();
      startTickTimer();
    }, delay);
  }

  function stopTickTimer() {
    if (tickTimer === null) return;
    clearTimeout(tickTimer);
    tickTimer = null;
  }

  function resumeLiveClock() {
    // iOS standalone may suspend/discard a timer without clearing its JS id.
    // Always replace it, and reconcile immediately instead of waiting up to a minute.
    stopTickTimer();
    refreshLiveClock();
    startTickTimer();
  }

  function init() {
    markBootTrace('init_start');
    const today = todayStr();
    firstUsedDate = ensureFirstUsedDate(today, load().entries);
    const savedView = localStorage.getItem(VIEW_KEY);
    const savedDate = parseDateKey(localStorage.getItem(SELECTED_DATE_KEY));
    state.view = ['day', 'week', 'month', 'year'].includes(savedView) ? savedView : 'day';
    state.selectedDate = savedDate ? localDateKey(savedDate) : today;
    localStorage.setItem(OPEN_DATE_KEY, today);
    persistState();

    applyTheme(localStorage.getItem(THEME_KEY) || 'auto');
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    if (mq.addEventListener) mq.addEventListener('change', () => applyTheme(localStorage.getItem(THEME_KEY) || 'auto'));
    // v53：命中快照则跳过首轮渲染（恢复节点保持同一 DOM，不闪）。v56 补版本门：
    // 快照是旧版本写的就当没有快照——旧 DOM 形态不能在新版 JS 下继续活着。
    let restoredBootFrame = window.__timelogBootRestored === true;
    if (restoredBootFrame) {
      try {
        const snap = JSON.parse(sessionStorage.getItem(BOOT_SNAPSHOT_KEY));
        if (!snap || snap.appVersion !== APP_VERSION) {
          restoredBootFrame = false;
          setBootSnapshotState('rejected:version');
        }
      } catch {
        restoredBootFrame = false;
        setBootSnapshotState('rejected:invalid');
      }
    }
    if (restoredBootFrame) {
      lastIntervalSignature = dataSignature();
      setBootSnapshotState('adopted');
      markBootTrace('snapshot_adopted');
    } else {
      render();
      markBootTrace('first_render_complete');
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.body.classList.add('app-ready');
        markBootTrace('app_ready');
        initBootTraceHud();
        document.body.classList.remove('boot-restored');
        delete window.__timelogBootRestored;
        if (!navigator.webdriver && !localStorage.getItem(HELP_SEEN_KEY)) openHelp();
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopTickTimer();
      else resumeLiveClock();
    }, { passive: true });
    window.addEventListener('pageshow', resumeLiveClock, { passive: true });
    window.addEventListener('focus', resumeLiveClock, { passive: true });
    startTickTimer();
  }

  function initBootTraceHud() {
    if (!bootTrace || document.getElementById('boottrace-hud')) return;
    const hud = document.createElement('div');
    hud.id = 'boottrace-hud';
    hud.setAttribute('aria-label', '启动分段诊断');
    hud.style.cssText = 'position:fixed;left:4px;right:4px;bottom:max(4px,env(safe-area-inset-bottom));'
      + 'z-index:2147483646;pointer-events:none;max-height:48vh;overflow:auto;'
      + 'font:10px/1.45 ui-monospace,Menlo,monospace;color:#b8ffab;background:rgba(0,0,0,.82);'
      + 'border:1px solid rgba(184,255,171,.35);border-radius:8px;padding:6px 8px;'
      + 'white-space:pre-wrap;word-break:break-word';
    const first = bootTrace.marks[0] ? bootTrace.marks[0].at : 0;
    const marks = bootTrace.marks.map((mark, index) => {
      const previous = index ? bootTrace.marks[index - 1].at : first;
      return `${String(index + 1).padStart(2, '0')} ${mark.name} +${Math.round(mark.at - previous)}ms (${Math.round(mark.at - first)}ms)`;
    });
    const nav = performance.getEntriesByType('navigation')[0];
    const navLines = nav
      ? ['startTime', 'requestStart', 'responseStart', 'responseEnd', 'domInteractive', 'domContentLoadedEventEnd', 'loadEventEnd']
          .filter(key => Number.isFinite(nav[key]) && (key === 'startTime' || nav[key] > 0))
          .map(key => `${key}=${Math.round(nav[key])}ms`)
      : ['Navigation Timing unavailable'];
    hud.textContent = [
      `boottrace v${APP_VERSION} snapshot=${bootTrace.snapshotStates.join(' → ')}`,
      ...marks,
      `page total=${Math.round((bootTrace.marks[bootTrace.marks.length - 1]?.at || first) - first)}ms`,
      '── Navigation Timing（从 navigation 起算，不含点击主屏图标到 WebKit 开始导航前的系统时间）',
      ...navLines
    ].join('\n');
    document.body.appendChild(hud);
  }

  // --- vv 诊断 HUD（?vvdebug=1 启用；P20 键盘时序与分享能力真机取证，无参数时零成本） ---
  function initVvDebugHud() {
    let enabled = false;
    try { enabled = new URLSearchParams(window.location.search).has('vvdebug'); } catch {}
    if (!enabled) return;
    const hud = document.createElement('div');
    hud.setAttribute('aria-hidden', 'true');
    hud.style.cssText = 'position:fixed;left:4px;right:4px;top:max(4px,env(safe-area-inset-top));'
      + 'z-index:2147483647;pointer-events:none;font:10px/1.45 ui-monospace,Menlo,monospace;'
      + 'color:#7cff5e;background:rgba(0,0,0,0.72);border-radius:8px;padding:5px 7px;'
      + 'white-space:pre-wrap;word-break:break-all';
    document.body.appendChild(hud);
    const t0 = performance.now();
    const lines = [];
    const vv = window.visualViewport;
    const standalone = Boolean(
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || navigator.standalone
    );
    const header = () =>
      `v${APP_VERSION} share:${typeof navigator.share} canShare:${typeof navigator.canShare} standalone:${standalone}\n`
      + `inner:${window.innerHeight} vv:${vv ? `${Math.round(vv.height)}@${Math.round(vv.offsetTop)}` : 'n/a'}`;
    const paint = () => { hud.textContent = `${header()}\n──\n${lines.join('\n')}`; };
    window.__vvlog = msg => {
      lines.push(`${String(Math.round(performance.now() - t0)).padStart(6)} ${msg}`);
      if (lines.length > 16) lines.shift();
      paint();
    };
    if (vv) {
      vv.addEventListener('resize', () => window.__vvlog(`vv:resize h=${Math.round(vv.height)} top=${Math.round(vv.offsetTop)}`));
      vv.addEventListener('scroll', () => window.__vvlog(`vv:scroll h=${Math.round(vv.height)} top=${Math.round(vv.offsetTop)}`));
    }
    document.addEventListener('focusin', e => window.__vvlog(`focusin ${e.target && e.target.tagName}`));
    document.addEventListener('focusout', e => window.__vvlog(`focusout ${e.target && e.target.tagName}`));
    window.__vvlog('HUD ready');
  }

  registerActions();
  registerCardSwipe();
  registerServiceWorker();
  initVvDebugHud();
  init();

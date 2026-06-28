import { mountTimePicker, setTimeInputError, useCompactTimePicker } from './pickers.js';
import {
  OPEN_DATE_KEY,
  SELECTED_DATE_KEY,
  THEME_KEY,
  VIEW_KEY,
  load,
  mergeImportedEntries,
  save,
  uid,
  validateImportData
} from './storage.js';
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
  fmtDateTime,
  fmtMins,
  fmtPlainMins,
  fmtTs,
  hhmm,
  localDateKey,
  minsBetweenDates,
  normalizeTimestamp,
  nowStr,
  p2,
  parseDateKey,
  periodLabel as getPeriodLabel,
  periodRange as getPeriodRange,
  shortDateLabel,
  todayStr,
  validateTs
} from './time.js';
import {
  renderFormSheet,
  renderRuler,
  renderSummaryRows,
  renderTimeline,
  setButtonTip
} from './ui.js';

  let editingId = null;
  let sheetEditId = null;
  let sheetScrollY = 0;
  let sheetTimeMounted = false;
  let sheetLastFocus = null;
  let sheetTrapController = null;
  let sheetResizeTimer = null;
  let pendingUpdateRegistration = null;
  let updateReloading = false;
  let formTag = '';
  let state = { view: 'day', selectedDate: '' };

  function defaultFormTs() {
    const n = new Date();
    const candidate = `${state.selectedDate || todayStr()}T${p2(n.getHours())}:${p2(n.getMinutes())}`;
    return new Date(candidate) > new Date(Date.now() + 5 * 60000) ? nowStr() : candidate;
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
  function buildRangeSegments(start, end, opts = {}) {
    return buildRangeSegmentsFromEntries(load().entries, start, end, opts);
  }
  function summarizeRange(start, end, opts = {}) {
    return summarizeEntries(load().entries, start, end, opts);
  }
  function computeDay() {
    const { start, end } = periodRange('day', state.selectedDate);
    const statEnd = state.selectedDate === todayStr() ? new Date() : end;
    const allEntries = sortedEntries();
    const segments = buildRangeSegmentsFromEntries(allEntries, start, statEnd);
    const timeline = segments.filter(segment => {
      if (!segment.e) return false;
      const t = new Date(segment.e.ts);
      return t >= start && t < end;
    });
    return { timeline, totals: summarizeEntries(allEntries, start, statEnd) };
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
    closeEditSheet();
    closeForm();
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
    closeEditSheet();
    closeForm();
    render();
  }
  function goToday() {
    setSelectedDate(todayStr());
    editingId = null;
    closeEditSheet();
    closeForm();
    render();
  }
  function drill(dateKey, view) {
    state.view = view;
    setSelectedDate(dateKey);
    editingId = null;
    closeEditSheet();
    closeForm();
    render();
  }

  // --- Render ---
  function render() {
    renderChrome();
    if (state.view === 'day') {
      const day = computeDay();
      renderRuler(day.totals, day.timeline.length || day.totals.total, state.view);
      renderTimeline(day.timeline, { editingId, sheetEditId });
      if (editingId) {
        const entry = load().entries.find(e => e.id === editingId);
        if (entry) {
          const editor = getEditingBox(entry.id);
          const mountEl = editor ? editor.querySelector('[data-role="edit-wheel"]') : null;
          const tsEl = editor ? editor.querySelector('[data-role="edit-ts"]') : null;
          if (mountEl && tsEl) {
            mountTimePicker(mountEl, entry.ts, v => {
              tsEl.value = v;
            });
          }
        }
      }
      return;
    }
    const { start, end } = periodRange();
    renderRuler(summarizeRange(start, end), 1, state.view);
    renderSummary();
  }
  function renderChrome() {
    document.querySelectorAll('#view-tabs button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === state.view);
    });
    const periodEl = document.getElementById('period-label');
    periodEl.textContent = periodLabel({ short: state.view === 'week' });
    periodEl.setAttribute('aria-label', periodFullLabel());
    document.getElementById('add-btn').hidden = state.view !== 'day';
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
    updateShareAvailability();
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

  // --- Form ---
  function openForm() {
    openFormSheet({ mode: 'new' });
  }
  function isFormOpen() {
    const sheet = document.getElementById('form-sheet');
    const panel = sheet ? sheet.querySelector('.form-sheet-panel') : null;
    return Boolean(sheet && panel && !sheet.hidden && panel.dataset.mode === 'new');
  }
  function getSheetMode() {
    const sheet = document.getElementById('form-sheet');
    const panel = sheet ? sheet.querySelector('.form-sheet-panel') : null;
    return sheet && panel && !sheet.hidden ? panel.dataset.mode || '' : '';
  }
  function openFormSheet(opts) {
    const mode = opts && opts.mode === 'edit' ? 'edit' : 'new';
    const id = opts && opts.id;
    const entry = mode === 'edit' ? load().entries.find(e => e.id === id) : null;
    if (mode === 'edit' && !entry) return;
    sheetLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (mode === 'new') {
      state.view = 'day';
      persistState();
      editingId = null;
      sheetEditId = null;
      formTag = '';
    } else {
      editingId = null;
      sheetEditId = id;
      sheetTimeMounted = false;
      render();
    }
    const sheet = document.getElementById('form-sheet');
    const panel = sheet.querySelector('.form-sheet-panel');
    const ts = mode === 'edit' ? entry.ts : defaultFormTs();
    panel.dataset.mode = mode;
    if (mode === 'edit') panel.dataset.id = id;
    else delete panel.dataset.id;
    panel.innerHTML = renderFormSheet({ mode, entry });
    sheet.hidden = false;
    lockBodyForSheet();
    if (mode === 'edit') {
      const tsEl = panel.querySelector('[data-role="edit-ts"]');
      mountTimePicker(panel.querySelector('[data-role="edit-wheel"]'), ts, v => {
        tsEl.value = v;
      });
      sheetTimeMounted = true;
    } else {
      document.getElementById('form-ts').value = ts;
      mountTimePicker(document.getElementById('form-wheel-mount'), ts, v => {
        document.getElementById('form-ts').value = v;
      });
      document.getElementById('form-what').value = '';
      document.getElementById('form-ctag').value = '';
      document.querySelectorAll('#form-chips .chip').forEach(c => c.classList.remove('sel'));
      renderChrome();
    }
    trapFocus(sheet);
    requestAnimationFrame(() => {
      const focusEl = sheet.querySelector('[data-role="date"], [data-role="text"], .inp, button');
      if (focusEl) focusEl.focus();
    });
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
    sheetEditId = null;
    sheetTimeMounted = false;
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
    const mountEl = mode === 'edit'
      ? panel.querySelector('[data-role="edit-wheel"]')
      : document.getElementById('form-wheel-mount');
    if (!mountEl || mountEl.dataset.pickerCompact === compact) return;
    const tsEl = mode === 'edit'
      ? panel.querySelector('[data-role="edit-ts"]')
      : document.getElementById('form-ts');
    if (!tsEl) return;
    mountTimePicker(mountEl, tsEl.value, v => {
      tsEl.value = v;
    });
  }
  function handleResponsiveResize() {
    clearTimeout(sheetResizeTimer);
    sheetResizeTimer = setTimeout(remountOpenSheetTimePickerIfNeeded, 120);
  }
  function closeForm() {
    const mode = closeFormSheet();
    if (mode === 'edit') render();
  }
  function pickTag(el) {
    const wasSelected = el.classList.contains('sel');
    document.querySelectorAll('#form-chips .chip').forEach(c => c.classList.remove('sel'));
    if (wasSelected) {
      formTag = '';
      return;
    }
    el.classList.add('sel');
    formTag = el.dataset.tag || '';
    document.getElementById('form-ctag').value = '';
  }
  function saveEntry() {
    const timeScope = document.getElementById('form-wheel-mount');
    const checked = validateTs(document.getElementById('form-ts').value);
    if (!checked.ok) {
      setTimeInputError(timeScope, checked.msg);
      const focusEl = timeScope.querySelector('[data-role="text"], [data-role="date"]');
      if (focusEl) focusEl.focus();
      return;
    }
    setTimeInputError(timeScope, '');
    const what = document.getElementById('form-what').value.trim();
    if (!what) { document.getElementById('form-what').focus(); return; }
    const ctag = document.getElementById('form-ctag').value.trim();
    const tag = ctag || formTag || '未知';
    const d = load();
    d.entries.push({ id: uid(), ts: checked.ts, what, tags: [tag] });
    save(d);
    setSelectedDate(checked.ts.slice(0, 10));
    closeForm();
    render();
  }

  // --- Edit ---
  function getEditingBox(id = editingId) {
    return Array.from(document.querySelectorAll('.entry.editing, .form-sheet-panel'))
      .find(el => el.dataset.id === String(id));
  }
  function lockBodyForSheet() {
    sheetScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${sheetScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.classList.add('sheet-open');
  }
  function unlockBodyForSheet() {
    document.body.classList.remove('sheet-open');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, sheetScrollY);
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
    const changed = Boolean(editingId || sheetEditId || getSheetMode() === 'edit');
    closeEditSheet();
    editingId = null;
    if (changed) render();
  }
  function pickEditTag(el) {
    const box = el.closest('.entry.editing, .form-sheet-panel');
    const chipBox = box ? box.querySelector('[data-role="edit-chips"]') : null;
    if (!chipBox) return;
    const wasSelected = el.classList.contains('sel');
    chipBox.querySelectorAll('.chip').forEach(c => c.classList.remove('sel'));
    if (wasSelected) return;
    el.classList.add('sel');
    const custom = box.querySelector('[data-role="edit-custom-tag"]');
    if (custom) custom.value = '';
  }
  function toggleEditTime(el) {
    const box = el.closest('.entry.editing, .form-sheet-panel');
    if (!box) return;
    const section = box.querySelector('[data-role="edit-time-section"]');
    const mountEl = box.querySelector('[data-role="edit-wheel"]');
    const tsEl = box.querySelector('[data-role="edit-ts"]');
    if (!section || !mountEl || !tsEl) return;
    const willOpen = section.hidden;
    section.hidden = !willOpen;
    el.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    el.textContent = willOpen ? '收起时间' : '修改时间';
    if (willOpen && (!sheetTimeMounted || box.classList.contains('entry'))) {
      mountTimePicker(mountEl, tsEl.value, v => {
        tsEl.value = v;
      });
      sheetTimeMounted = true;
    }
  }
  function commitEdit(id) {
    const box = getEditingBox(id);
    if (!box) return;
    const tsEl = box.querySelector('[data-role="edit-ts"]');
    const whatEl = box.querySelector('[data-role="edit-what"]');
    const chipBox = box.querySelector('[data-role="edit-chips"]');
    const customEl = box.querySelector('[data-role="edit-custom-tag"]');
    const timeScope = box.querySelector('[data-role="edit-wheel"]') || box;
    const checked = validateTs(tsEl ? tsEl.value : '');
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
    const d = load();
    const entry = d.entries.find(e => e.id === id);
    if (entry) { entry.ts = checked.ts; entry.what = what; entry.tags = [tag]; save(d); }
    setSelectedDate(checked.ts.slice(0, 10));
    closeEditSheet();
    editingId = null;
    render();
  }
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
    if (sheetEditId === id) closeEditSheet();
    render();
  }

  // --- Current view summary ---
  function viewName(view = state.view) {
    return ({ day: '天', week: '周', month: '月', year: '年' })[view] || view;
  }
  function currentViewTotals() {
    if (state.view === 'day') return computeDay().totals;
    const { start, end } = periodRange();
    return summarizeRange(start, end);
  }
  function mdInline(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
  }
  function statsParts(totals) {
    const jp = formatPercent(totals.job, totals.total);
    const op = formatPercent(totals.other, totals.total);
    const up = formatPercent(totals.unrecorded, totals.total);
    return { jp, op, up };
  }
  function dataDateRange() {
    const entries = sortedEntries();
    if (!entries.length) return '无记录';
    return `${fmtTs(entries[0].ts)} - ${fmtTs(entries[entries.length - 1].ts)}`;
  }
  function detailDurationLabel(mins, isOngoing, unrecorded, pendingConfirm) {
    const label = fmtPlainMins(mins);
    const notes = [];
    if (pendingConfirm) notes.push('待确认');
    else if (unrecorded) notes.push('未记录');
    if (isOngoing) notes.push('进行中');
    return notes.length ? `${label}（${notes.join('，')}）` : label;
  }
  function currentViewDetailLines() {
    if (state.view === 'day') {
      const day = computeDay();
      if (!day.timeline.length) return ['- 无记录'];
      return day.timeline.map(({ e, mins, isOngoing, unrecorded, pendingConfirm, tag }) => {
        const safeWhat = mdInline(e.what) || '未填写';
        const safeTag = mdInline(tag || '未知');
        return `- ${hhmm(e.ts)} | ${detailDurationLabel(mins, isOngoing, unrecorded, pendingConfirm)} | ${safeWhat} | #${safeTag}`;
      });
    }
    const rows = summaryRows();
    if (!rows.length) return ['- 无记录'];
    return rows.map(row => {
      const totals = summarizeRange(row.rangeStart, row.rangeEnd);
      const { jp, op, up } = statsParts(totals);
      const totalText = totals.total ? fmtMins(totals.total) : '无记录';
      const pendingText = totals.pending ? ` / 待确认 ${fmtPlainMins(totals.pending)}` : '';
      return `- ${row.label}: ${totalText}；求职 ${jp} / 其他 ${op} / 未记录 ${up}${pendingText}`;
    });
  }
  function buildCurrentViewSummaryMarkdown() {
    const totals = currentViewTotals();
    const { jp, op, up } = statsParts(totals);
    const totalEntries = load().entries.length;
    return [
      '# 时间尺当前视图摘要',
      '',
      '## 元信息',
      `- 生成时间：${fmtDateTime(new Date())}`,
      `- 当前视图：${viewName()}`,
      `- 当前周期：${periodFullLabel()}`,
      `- 数据起止日期：${dataDateRange()}`,
      `- 总记录数：${totalEntries}`,
      '',
      '## 当前视图统计比例',
      `- 总计：${fmtPlainMins(totals.total)}`,
      `- 求职推进：${jp}（${fmtPlainMins(totals.job)}）`,
      `- 其他：${op}（${fmtPlainMins(totals.other)}）`,
      `- 未记录：${up}（${fmtPlainMins(totals.unrecorded)}）`,
      `- 待确认：${fmtPlainMins(totals.pending || 0)}`,
      '',
      '## 当前视图明细',
      ...currentViewDetailLines(),
      ''
    ].join('\n');
  }

  // --- Copy ---
  function setCopyFeedback(btn, ok, label, fallbackLabel) {
    if (!btn) return;
    btn.textContent = ok ? label : '复制失败';
    btn.classList.toggle('copied', ok);
    setTimeout(() => {
      btn.textContent = fallbackLabel;
      btn.classList.remove('copied');
    }, 2500);
  }
  function copyText(text, btn, label, fallbackLabel) {
    const done = ok => setCopyFeedback(btn, ok, label, fallbackLabel);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text)
        .then(() => done(true))
        .catch(() => done(legacyCopy(text)));
      return;
    }
    done(legacyCopy(text));
  }
  function copyJSON() {
    const json = JSON.stringify(load(), null, 2);
    copyText(json, document.getElementById('copy-btn'), '✓ 已复制', '复制');
  }
  function copyCurrentViewSummary() {
    copyText(buildCurrentViewSummaryMarkdown(), document.getElementById('summary-btn'), '✓ 已复制', '摘要');
  }
  function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
    return ok;
  }

  // --- Download JSON ---
  function downloadJSON() {
    const json = JSON.stringify(load(), null, 2);
    const now = new Date();
    const fname = `timelog-${now.getFullYear()}${p2(now.getMonth()+1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}.json`;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // --- Import JSON ---
  function importJSON() { document.getElementById('import-file').click(); }
  function handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      let imported;
      try { imported = JSON.parse(e.target.result); }
      catch { alert('文件解析失败，请确认是有效的 JSON 文件。'); return; }
      const checked = validateImportData(imported);
      if (!checked.ok) { alert(checked.msg); return; }
      const current = mergeImportedEntries(load(), imported.entries);
      save(current);
      render();
      alert(`导入完成，共 ${current.entries.length} 条记录。`);
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  // --- Share JSON ---
  function canUseSystemShare() {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  }
  function updateShareAvailability() {
    const btn = document.getElementById('share-btn');
    if (!btn) return;
    const supported = canUseSystemShare();
    btn.hidden = !supported;
    btn.setAttribute('aria-disabled', supported ? 'false' : 'true');
    if (supported) setButtonTip(btn, '打开系统分享面板，优先分享 JSON 文件；文件分享不可用时改为分享文本。', '分享 JSON 备份');
  }
  function shareJSON() {
    if (!canUseSystemShare()) return;
    const json = JSON.stringify(load(), null, 2);
    const now = new Date();
    const fname = `timelog-${now.getFullYear()}${p2(now.getMonth()+1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}.json`;
    if (navigator.canShare) {
      const file = new File([json], fname, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: '时间尺备份' }).catch(() => {});
        return;
      }
    }
    navigator.share({ title: '时间尺备份', text: json }).catch(() => {});
  }

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
      if (action === 'open-form') openForm();
      if (action === 'pick-form-tag') pickTag(el);
      if (action === 'save-entry') saveEntry();
      if (action === 'close-form') closeForm();
      if (action === 'start-edit') startEdit(el.dataset.id);
      if (action === 'pick-edit-tag') pickEditTag(el);
      if (action === 'toggle-edit-time') toggleEditTime(el);
      if (action === 'commit-edit') commitEdit(el.dataset.id || editingId);
      if (action === 'cancel-edit') cancelEdit();
      if (action === 'confirm-segment') confirmSegment(el.dataset.id, el.dataset.end);
      if (action === 'delete-entry') delEntry(el.dataset.id);
      if (action === 'drill') drill(el.dataset.date, el.dataset.view);
      if (action === 'copy-summary') copyCurrentViewSummary();
      if (action === 'copy-json') copyJSON();
      if (action === 'download-json') downloadJSON();
      if (action === 'import-json') importJSON();
      if (action === 'share-json') shareJSON();
      if (action === 'update-app') applyUpdate();
    });
    document.getElementById('import-file').addEventListener('change', handleImport);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { cancelEdit(); closeForm(); }
      if (e.key === 'Enter' && !e.isComposing && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) {
        const target = e.target;
        const canSaveNew = target instanceof HTMLElement
          && isFormOpen()
          && target.closest('.form-sheet-panel')
          && (target.id === 'form-what' || target.id === 'form-ctag');
        if (canSaveNew) {
          e.preventDefault();
          saveEntry();
          return;
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (editingId || sheetEditId) { commitEdit(editingId || sheetEditId); return; }
        if (isFormOpen()) saveEntry();
      }
    });
    window.addEventListener('resize', handleResponsiveResize, { passive: true });
    window.addEventListener('orientationchange', handleResponsiveResize, { passive: true });
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
  function init() {
    const today = todayStr();
    const lastOpen = localStorage.getItem(OPEN_DATE_KEY);
    const savedView = localStorage.getItem(VIEW_KEY);
    const savedDate = parseDateKey(localStorage.getItem(SELECTED_DATE_KEY));
    state.view = ['day', 'week', 'month', 'year'].includes(savedView) ? savedView : 'day';
    state.selectedDate = lastOpen === today && savedDate ? localDateKey(savedDate) : today;
    localStorage.setItem(OPEN_DATE_KEY, today);
    persistState();

    applyTheme(localStorage.getItem(THEME_KEY) || 'auto');
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    if (mq.addEventListener) mq.addEventListener('change', () => applyTheme(localStorage.getItem(THEME_KEY) || 'auto'));
    document.getElementById('hdr-date').textContent = dateLabel(new Date());
    render();
    setInterval(() => {
      if (!editingId && !sheetEditId && !isFormOpen()) render();
    }, 60000);
  }

  if (window.__TIMELOG_TEST__) {
    exposeTestApi();
  } else {
    registerActions();
    registerServiceWorker();
    init();
  }

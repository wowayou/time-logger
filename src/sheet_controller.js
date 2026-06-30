import { mountTimePicker, setTimeInputError, useCompactTimePicker } from './pickers.js';
import {
  addOneMinute,
  conflictMessage,
  ensureOpenPlaceholderAt,
  findTimeConflict,
  openPlaceholderForDate
} from './entry_model.js';
import {
  bucketForTag,
  countEntriesWithTag,
  migrateEntryTags,
  RECORD_MODE_KEY
} from './storage.js';
import { fmtMins, hhmm, minsBetweenDates, normalizeTimestamp, nowStr, todayStr, validateTsForMode } from './time.js';
import { bucketHint, renderFormSheet, renderTagPicker } from './ui.js';

export function createSheetController(deps) {
  let sheetScrollY = 0;
  let sheetTimeMounted = false;
  let sheetLastFocus = null;
  let sheetTrapController = null;
  let sheetResizeTimer = null;
  let formTag = '';
  let formBucket = 'job';
  let editBucket = 'job';
  let formRecordMode = 'log';
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

  function autosizeTextareas(scope = document) {
    scope.querySelectorAll('textarea.ta').forEach(textarea => {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.max(textarea.scrollHeight, 52)}px`;
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
    const mode = ['edit', 'help', 'config', 'import-shift', 'backup'].includes(requestedMode) ? requestedMode : 'new';
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
      if (isHistoryDate()) formRecordMode = 'log';
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
      bucket: mode === 'edit' ? editBucket : formBucket,
      defaultBucket: formBucket,
      recordMode: formRecordMode
    });
    sheet.hidden = false;
    lockBodyForSheet();
    if (mode === 'edit') {
      const tsEl = panel.querySelector('[data-role="edit-ts"]');
      mountTimePicker(panel.querySelector('[data-role="edit-wheel"]'), ts, v => {
        tsEl.value = v;
      });
      sheetTimeMounted = true;
    } else if (mode === 'new') {
      mountNewTimePicker(panel, ts);
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
    const mode = closeFormSheet();
    if (mode === 'edit') deps.render();
  }

  function openForm() {
    openFormSheet({ mode: 'new' });
  }

  function openBackupSheet() {
    openFormSheet({ mode: 'backup' });
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
    const changed = Boolean(deps.getSheetEditId() || getSheetMode() === 'edit');
    closeEditSheet();
    if (changed) deps.render();
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
    const placeholder = openPlaceholderForDate(d.entries, checked.ts.slice(0, 10));
    const conflict = findTimeConflict(d.entries, checked.ts, placeholder ? placeholder.id : '');
    if (conflict) {
      showInlineError(panel, conflictMessage(conflict, checked.ts, 'use-conflict-plus-new'));
      return;
    }
    if (ctag) rememberTag(ctag, formBucket, d.entries);
    if (planned) {
      d.entries.push({ id: deps.uid(), ts: checked.ts, what, tags: [tag], planned: true });
      deps.save(d);
      deps.setSelectedDate(checked.ts.slice(0, 10));
      closeForm();
      deps.render();
      return;
    }
    const nowTs = nowStr();
    let completed = null;
    if (placeholder) {
      placeholder.ts = checked.ts;
      placeholder.what = what;
      placeholder.tags = [tag];
      delete placeholder.longConfirm;
      delete placeholder.planned;
      completed = placeholder;
    } else {
      completed = { id: deps.uid(), ts: checked.ts, what, tags: [tag] };
      d.entries.push(completed);
    }
    if (checked.ts.slice(0, 10) === todayStr()) ensureOpenPlaceholderAt(d.entries, nowTs, completed.id, deps.uid);
    deps.save(d);
    deps.setSelectedDate(checked.ts.slice(0, 10));
    closeForm();
    deps.render();
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
      deps.save(d);
    }
    deps.setSelectedDate(checked.ts.slice(0, 10));
    closeEditSheet();
    deps.render();
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
    openBackupSheet,
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
    saveEntry,
    switchActivity,
    autosizeTextareas,
    updateMainlineHint,
    syncCustomDraft,
    toggleStartTime,
    saveTagConfig,
    handleResponsiveResize,
    getEditingBox
  };
}

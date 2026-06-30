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

  function defaultBucketFromEntries() {
    const entries = deps.load().entries;
    const dateKey = deps.state.selectedDate || todayStr();
    const last = [...entries].reverse().find(entry => !entry.planned && entry.ts.slice(0, 10) === dateKey);
    if (!last) return 'job';
    return bucketForTag((last.tags || [])[0] || '', deps.loadConfig());
  }

  function defaultPlanTimestamp() {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return normalizeTimestamp(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`);
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
      deps.setEditingId(null);
      deps.setSheetEditId(null);
      formTag = '';
      formBucket = defaultBucketFromEntries();
      formRecordMode = loadRecordModePref();
    } else if (mode === 'edit') {
      deps.setEditingId(null);
      deps.setSheetEditId(id);
      sheetTimeMounted = false;
      editBucket = bucketForTag((entry.tags || [])[0] || '', deps.loadConfig());
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
    const changed = Boolean(deps.getEditingId() || deps.getSheetEditId() || getSheetMode() === 'edit');
    closeEditSheet();
    deps.setEditingId(null);
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
    if (title) title.textContent = formRecordMode === 'plan' ? '计划 · 安排接下来要做的事' : `记一条 · ${deps.state.selectedDate === todayStr() ? '刚才这一阵' : '补记'}`;
    if (what) what.textContent = formRecordMode === 'plan' ? '写下计划要做什么' : (deps.state.selectedDate === todayStr() ? '写下刚才做了什么' : '写下这一段做了什么');
    const tsEl = panel.querySelector('#form-ts');
    if (tsEl) {
      tsEl.value = formRecordMode === 'plan' ? defaultPlanTimestamp() : deps.defaultFormTs();
      mountNewTimePicker(panel, tsEl.value);
    }
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

  function rememberTag(tag, bucket) {
    deps.rememberTagForBucket(tag, bucket);
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
    if (ctag) rememberTag(ctag, formBucket);
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

  function getEditingBox(id = deps.getEditingId()) {
    return Array.from(document.querySelectorAll('.entry.editing, .form-sheet-panel'))
      .find(el => el.dataset.id === String(id));
  }

  function pickEditTag(el) {
    pickTag(el);
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
    const entry = deps.load().entries.find(e => e.id === id);
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
    const d = deps.load();
    const conflict = findTimeConflict(d.entries, checked.ts, id);
    if (conflict) {
      showInlineError(box, conflictMessage(conflict, checked.ts, 'use-conflict-plus-edit'));
      return;
    }
    if (ctag) rememberTag(ctag, editBucket);
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
    deps.setEditingId(null);
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

  function addConfigChip() {
    const list = document.querySelector('[data-role="config-chips"]');
    if (!list) return;
    const div = document.createElement('div');
    div.className = 'cfg-row';
    div.innerHTML = '<input class="inp cfg-name" type="text" value="" aria-label="标签名称"><select class="inp cfg-bucket" aria-label="桶"><option value="maintain">维持</option><option value="leak">漏损</option></select><label class="cfg-long"><input type="checkbox" class="cfg-long-ok"> longOk</label><button class="mini-btn" type="button" data-action="remove-config-chip">替换</button>';
    list.appendChild(div);
    div.querySelector('.cfg-name').focus();
  }

  function removeConfigChip(el) {
    const row = el.closest('.cfg-row');
    if (!row) return;
    const name = (row.querySelector('.cfg-name') || {}).value || row.dataset.originalName || '';
    const count = countEntriesWithTag(deps.load().entries, name);
    if (!count) {
      row.remove();
      return;
    }
    if (row.querySelector('.cfg-migrate')) return;
    const config = deps.loadConfig();
    const select = document.createElement('select');
    select.className = 'inp cfg-migrate';
    select.setAttribute('aria-label', '迁移到');
    select.dataset.original = name;
    select.innerHTML = `<option value="">选择迁移目标（${count} 条）</option>${config.chips.filter(chip => chip.name !== name).map(chip => `<option value="${chip.name}">${chip.name}</option>`).join('')}<option value="__keep__">保留文字、脱离配置</option>`;
    row.dataset.pendingRemove = '1';
    row.appendChild(select);
    const nameInput = row.querySelector('.cfg-name');
    if (nameInput) nameInput.readOnly = true;
  }

  function removeMainlineName(el) {
    const name = el.dataset.name || '';
    const count = countEntriesWithTag(deps.load().entries, name);
    if (count && !confirm(`主线「${name}」有 ${count} 条记录。移除后这些记录会变为孤儿标签。继续？`)) return;
    const panel = document.querySelector('#form-sheet .form-sheet-panel');
    const row = el.closest('.cfg-mainline-row');
    if (row) row.remove();
    if (panel) {
      const list = panel.querySelector('.cfg-mainline-list');
      if (list && !list.querySelector('.cfg-mainline-row')) list.innerHTML = '<div class="form-hint">无</div>';
    }
    if (configSnapshot) configSnapshot.mainline = configSnapshot.mainline.filter(item => item !== name);
  }

  function saveTagConfig() {
    const panel = document.querySelector('#form-sheet .form-sheet-panel');
    const rows = Array.from(panel.querySelectorAll('.cfg-row'));
    const rowStates = rows.map(row => ({
      originalName: row.dataset.originalName || row.querySelector('.cfg-name').value.trim(),
      name: row.querySelector('.cfg-name').value.trim(),
      bucket: row.querySelector('.cfg-bucket').value,
      longOk: row.querySelector('.cfg-long-ok').checked,
      pendingRemove: row.dataset.pendingRemove === '1',
      migrateTo: (row.querySelector('.cfg-migrate') || {}).value || ''
    })).filter(chip => chip.name);
    const finalChips = rowStates.filter(chip => !chip.pendingRemove);
    if (!finalChips.length) {
      showInlineError(panel, '至少保留一个维持/漏损 chip。', 'config-error');
      return;
    }
    const snapshot = configSnapshot || deps.loadConfig();
    const d = deps.load();
    const mainlineRows = Array.from(panel.querySelectorAll('.cfg-mainline-row'));
    const mainline = mainlineRows.map(row => row.querySelector('span') && row.querySelector('span').textContent).filter(Boolean);
    for (const chip of rowStates.filter(item => item.pendingRemove)) {
      const count = countEntriesWithTag(d.entries, chip.originalName);
      if (count && !chip.migrateTo) {
        showInlineError(panel, `「${chip.originalName}」有 ${count} 条记录，替换前请选择迁移目标。`, 'config-error');
        return;
      }
      if (chip.migrateTo && chip.migrateTo !== '__keep__') migrateEntryTags(d.entries, chip.originalName, chip.migrateTo);
    }
    for (const chip of finalChips) {
      if (chip.originalName && chip.originalName !== chip.name && countEntriesWithTag(d.entries, chip.originalName)) {
        migrateEntryTags(d.entries, chip.originalName, chip.name);
      }
    }
    const nextConfig = {
      ...deps.loadConfig(),
      mainline,
      chips: finalChips.map(chip => ({ name: chip.name, bucket: chip.bucket, longOk: chip.longOk }))
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
    toggleEditTime,
    commitEdit,
    saveEntry,
    switchActivity,
    autosizeTextareas,
    updateMainlineHint,
    toggleStartTime,
    addConfigChip,
    removeConfigChip,
    removeMainlineName,
    saveTagConfig,
    handleResponsiveResize,
    getEditingBox
  };
}

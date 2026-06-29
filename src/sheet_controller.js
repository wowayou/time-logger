import { mountTimePicker, setTimeInputError, useCompactTimePicker } from './pickers.js';
import {
  addOneMinute,
  conflictMessage,
  ensureOpenPlaceholderAt,
  findTimeConflict,
  openPlaceholderForDate
} from './entry_model.js';
import { fmtMins, hhmm, minsBetweenDates, normalizeTimestamp, nowStr, todayStr, validateTs } from './time.js';
import { renderFormSheet } from './ui.js';

export function createSheetController(deps) {
  let sheetScrollY = 0;
  let sheetTimeMounted = false;
  let sheetLastFocus = null;
  let sheetTrapController = null;
  let sheetResizeTimer = null;
  let formTag = '';

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
    const mountEl = panel ? panel.querySelector('#form-wheel-mount') : null;
    if (!tsEl) return;
    const startTs = normalizeTimestamp(ts) || deps.defaultFormTs();
    tsEl.value = startTs;
    paintPrevSegment(panel, startTs);
    const section = panel.querySelector('[data-role="start-time-section"]');
    if (!mountEl || (section && section.hidden)) return;
    mountTimePicker(mountEl, startTs, v => {
      tsEl.value = v;
      paintPrevSegment(panel, v);
    });
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

  function openFormSheet(opts) {
    const requestedMode = opts && opts.mode;
    const mode = ['edit', 'help', 'config', 'import-shift'].includes(requestedMode) ? requestedMode : 'new';
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
    } else if (mode === 'edit') {
      deps.setEditingId(null);
      deps.setSheetEditId(id);
      sheetTimeMounted = false;
      deps.render();
    }
    const sheet = document.getElementById('form-sheet');
    const panel = sheet.querySelector('.form-sheet-panel');
    const ts = mode === 'edit' ? entry.ts : (opts && opts.ts) || deps.defaultFormTs();
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
      importShiftHours: opts && opts.importShiftHours,
      importShiftHint: opts && opts.importShiftHint,
      targetDate: deps.state.selectedDate,
      isToday: deps.state.selectedDate === todayStr()
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
      panel.querySelector('#form-what').value = '';
      panel.querySelector('#form-ctag').value = '';
      panel.querySelectorAll('#form-chips .chip').forEach(c => c.classList.remove('sel'));
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
      const section = panel.querySelector('[data-role="start-time-section"]');
      if (section && section.hidden) return;
    }
    const mountEl = mode === 'edit'
      ? panel.querySelector('[data-role="edit-wheel"]')
      : mode === 'new' ? document.getElementById('form-wheel-mount') : null;
    if (!mountEl || mountEl.dataset.pickerCompact === compact) return;
    const tsEl = mode === 'edit'
      ? panel.querySelector('[data-role="edit-ts"]')
      : document.getElementById('form-ts');
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
    document.querySelectorAll('#form-chips .chip').forEach(c => c.classList.remove('sel'));
    if (wasSelected) {
      formTag = '';
      return;
    }
    el.classList.add('sel');
    formTag = el.dataset.tag || '';
    document.getElementById('form-ctag').value = '';
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
    const input = mode === 'edit' ? panel.querySelector('[data-role="edit-ts"]') : document.getElementById('form-ts');
    const mount = mode === 'edit' ? panel.querySelector('[data-role="edit-wheel"]') : document.getElementById('form-wheel-mount');
    if (input) input.value = nextTs;
    if (mode === 'new') paintPrevSegment(panel, nextTs);
    const startSection = mode === 'new' ? panel.querySelector('[data-role="start-time-section"]') : null;
    if (mount && !(startSection && startSection.hidden)) {
      mountTimePicker(mount, nextTs, v => {
        if (input) input.value = v;
        if (mode === 'new') paintPrevSegment(panel, v);
      });
      setTimeInputError(mount, '');
    }
    clearInlineError(panel);
  }

  function editConflictEntry(id) {
    closeFormSheet({ restoreFocus: false });
    openEditSheet(id);
  }

  function maybeRememberMainline(tag) {
    deps.addMainlineTag(tag);
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
    const near = compact ? config.mainline.find(name => compactTagText(name) === compact && name !== value) : '';
    hint.textContent = near
      ? `可能已有相近主线「${near}」。留空可直接选历史 chip。`
      : '自定义标签默认进入「主线」；与固定 chip 同名时按 chip 归类。';
  }

  function saveEntry() {
    const panel = document.querySelector('#form-sheet .form-sheet-panel');
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
    const d = deps.load();
    const placeholder = openPlaceholderForDate(d.entries, checked.ts.slice(0, 10));
    const conflict = findTimeConflict(d.entries, checked.ts, placeholder ? placeholder.id : '');
    if (conflict) {
      showInlineError(panel, conflictMessage(conflict, checked.ts, 'use-conflict-plus-new'));
      return;
    }
    if (ctag) maybeRememberMainline(ctag);
    const nowTs = nowStr();
    let completed = null;
    if (placeholder) {
      placeholder.ts = checked.ts;
      placeholder.what = what;
      placeholder.tags = [tag];
      delete placeholder.longConfirm;
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
    const d = deps.load();
    const conflict = findTimeConflict(d.entries, checked.ts, id);
    if (conflict) {
      showInlineError(box, conflictMessage(conflict, checked.ts, 'use-conflict-plus-edit'));
      return;
    }
    const entry = d.entries.find(e => e.id === id);
    if (ctag) maybeRememberMainline(ctag);
    if (entry) { entry.ts = checked.ts; entry.what = what; entry.tags = [tag]; deps.save(d); }
    deps.setSelectedDate(checked.ts.slice(0, 10));
    closeEditSheet();
    deps.setEditingId(null);
    deps.render();
  }

  function toggleStartTime(el) {
    const panel = el.closest('.form-sheet-panel');
    if (!panel) return;
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
    div.innerHTML = '<input class="inp cfg-name" type="text" value="" aria-label="标签名称"><select class="inp cfg-bucket" aria-label="桶"><option value="maintain">维持</option><option value="leak">漏损</option></select><label class="cfg-long"><input type="checkbox" class="cfg-long-ok"> longOk</label><button class="mini-btn" type="button" data-action="remove-config-chip">删除</button>';
    list.appendChild(div);
    div.querySelector('.cfg-name').focus();
  }

  function removeConfigChip(el) {
    const row = el.closest('.cfg-row');
    if (row) row.remove();
  }

  function saveTagConfig() {
    const panel = document.querySelector('#form-sheet .form-sheet-panel');
    const rows = Array.from(panel.querySelectorAll('.cfg-row'));
    const chips = rows.map(row => ({
      name: row.querySelector('.cfg-name').value.trim(),
      bucket: row.querySelector('.cfg-bucket').value,
      longOk: row.querySelector('.cfg-long-ok').checked
    })).filter(chip => chip.name);
    if (!chips.length) {
      showInlineError(panel, '至少保留一个维持/漏损 chip。', 'config-error');
      return;
    }
    const existing = deps.loadConfig();
    deps.saveConfig({ ...existing, chips });
    closeForm();
    deps.render();
  }

  return {
    openForm,
    openFormSheet,
    isFormOpen,
    getSheetMode,
    closeForm,
    closeFormSheet,
    closeEditSheet,
    startEdit,
    cancelEdit,
    pickTag,
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
    saveTagConfig,
    handleResponsiveResize,
    getEditingBox
  };
}

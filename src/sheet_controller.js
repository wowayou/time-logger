// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
import { mountTimePicker, setTimeInputError, useCompactTimePicker } from './pickers.js';
import {
  addOneMinute,
  cloneEntries,
  findTimeConflict,
  intervalEditContext,
  normalizeEntries,
  overnightContinuationContext,
  openPlaceholderForDate,
  planIntervalEdit,
  planOvernightContinuation,
  planSegmentSplit
} from './entry_model.js';
import { isPlaceholderEntry } from './stats.js';
import { t } from './i18n.js';
import {
  BUCKETS,
  defaultMotto,
  tagKey,
  RESERVED_UNKNOWN_TAG,
  bucketForTag,
  canonicalTagName,
  countEntriesWithTag,
  countEntriesWithExactTag,
  countEntriesNeedingRetag,
  appendLocaleDefaultTags,
  previewLocaleDefaultTags,
  renameMainlineTag,
  setCurrentMainline as storageSetCurrentMainline,
  setMainlineLongOk,
  migrateEntryTags,
  RECORD_MODE_KEY
} from './storage.js';
import {
  defaultPlannedTimestamp,
  entryModeForDate,
  fmtMins,
  hhmm,
  minsBetweenDates,
  normalizeTimestamp,
  nowStr,
  todayStr,
  validateTs,
  validateTsForMode
} from './time.js';
import { bucketHint, renderConfigRowDraft, renderFormSheet, renderTagPicker } from './ui.js';

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
  let formTargetDate = '';
  let formDateMode = null;
  let formBackfill = false;
  let formBackfillEnd = '';
  let formBackfillKind = 'fill';
  let formSourceId = '';
  let formFrozenStart = '';
  let formFrozenEnd = '';
  let formOvernightContext = null;
  let formOvernightEndMode = 'today';
  let formBaseEntries = [];
  let formPlanIds = [];
  let lastPreviewSignature = '';
  let editEndMode = 'fixed';
  let configDefaultsPreview = null;
  let configRawAtOpen = '';
  // 导航栈：二级页若从容器 sheet（更多 / 备份与导入 / 高级）下钻进入，取消/保存回到
  // 上一层而非整层关闭。v84 从单个布尔升级为**栈**——「更多 → 备份与导入 → 导入检查」
  // 现在有两层，布尔只记得住一层，关掉导入检查会一路关到底。
  const CONTAINER_MODES = ['more', 'backup', 'advanced'];
  const SUB_MODES = ['config', 'help', 'import-shift', 'motto', 'backup', 'advanced'];
  let sheetStack = [];
  // R1：sheet 关闭走 class 驱动过渡；未收尾前的清理函数存这里，供重入保护调用。
  let sheetCloseCleanup = null;
  let sheetDismissDrag = null;

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
    return defaultPlannedTimestamp(formTargetDate || deps.state.selectedDate || todayStr());
  }

  function isHistoryDate(dateKey = formTargetDate || deps.state.selectedDate) {
    return entryModeForDate(dateKey).kind === 'history';
  }

  function getFormWheelMount(panel) {
    if (!panel) return null;
    const overnight = panel.querySelector('[data-role="overnight-time-row"]');
    if (overnight) return overnight.querySelector('[data-role="form-wheel-mount"]');
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
    if (endLabel && settlement.endTs) endLabel.textContent = settlement.isNow ? t('form.now') : (settlement.isDayEnd ? '24:00' : hhmm(settlement.endTs));
    if (durationLabel && settlement.endTs) durationLabel.textContent = fmtMins(minsBetweenDates(new Date(startTs), new Date(settlement.endTs)));
  }

  function mountNewTimePicker(panel, ts) {
    const tsEl = panel ? panel.querySelector('#form-ts') : null;
    const mountEl = getFormWheelMount(panel);
    if (!tsEl) return;
    const startTs = normalizeTimestamp(ts) || (formRecordMode === 'plan' ? defaultPlanTimestamp() : deps.defaultFormTs());
    tsEl.value = startTs;
    if (formRecordMode !== 'plan' && !formOvernightContext) paintPrevSegment(panel, startTs);
    if (!mountEl) return;
    if (formRecordMode === 'plan' || !(panel.querySelector('[data-role="start-time-section"]') || {}).hidden) {
      mountTimePicker(mountEl, startTs, v => {
        tsEl.value = v;
        if (formOvernightContext) refreshOvernightPreview(panel);
        else if (formRecordMode !== 'plan') paintPrevSegment(panel, v);
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
    if (s && e && e > s) durLabel.textContent = t('form.durTotal', { dur: fmtMins(minsBetweenDates(new Date(s), new Date(e))) });
    else durLabel.textContent = s && e && e <= s ? t('form.endBeforeStart') : '';
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
    if (startMount) mountTimePicker(startMount, s, v => {
      startTsEl.value = v;
      paintBackfillDuration(panel);
      refreshSplitPreview(panel);
    });
    if (endMount) mountTimePicker(endMount, e, v => {
      endTsEl.value = v;
      paintBackfillDuration(panel);
      refreshSplitPreview(panel);
    });
    refreshSplitPreview(panel);
  }

  function resetPlanIds() {
    formPlanIds = [deps.uid(), deps.uid(), deps.uid(), deps.uid()];
  }

  function planIdFactory() {
    let index = 0;
    return () => formPlanIds[index++] || formPlanIds[formPlanIds.length - 1];
  }

  function selectedTag(panel, prefix, fallback = RESERVED_UNKNOWN_TAG) {
    const custom = panel && panel.querySelector(prefix === 'edit' ? '[data-role="edit-custom-tag"]' : '#form-ctag');
    const root = panel && panel.querySelector(prefix === 'edit' ? '[data-role="edit-chips"]' : '#form-chips');
    const selected = root && root.querySelector('.chip.sel');
    return (custom && custom.value.trim()) || (selected && selected.dataset.tag) || (root ? RESERVED_UNKNOWN_TAG : fallback) || RESERVED_UNKNOWN_TAG;
  }

  function paintTransactionPreview(panel, plan) {
    const preview = panel ? panel.querySelector('[data-role="interval-preview"]') : null;
    const limits = panel ? panel.querySelector('[data-role="edit-limits"], [data-role="backfill-limits"], [data-role="overnight-limits"]') : null;
    if (limits) {
      const c = plan && (plan.context || plan.constraints);
      if (c && plan && (plan.kind === 'overnight-continuation' || plan.kind === 'overnight-day-end')) {
        limits.textContent = t('form.overnightLimits', { start: hhmm(c.startMin || formOvernightContext.startTs), end: hhmm(c.hardEndTs || formOvernightContext.hardEndTs) });
      } else if (c) {
        const timeLabel = value => value && c.dayEndTs && value === c.dayEndTs ? '24:00' : hhmm(value);
        limits.textContent = t('form.intervalLimits', { startMin: timeLabel(c.startMin), startMax: timeLabel(c.startMax), startReason: c.startReason, endMin: timeLabel(c.endMin), endMax: timeLabel(c.endMax), endReason: c.endReason });
      } else if (formFrozenStart && formFrozenEnd) {
        limits.textContent = t('form.splitLimits', { start: hhmm(formFrozenStart), end: hhmm(formFrozenEnd) });
      }
    }
    if (!preview) return;
    preview.replaceChildren();
    const headline = document.createElement('div');
    headline.className = 'preview-head';
    if (!plan || !plan.ok) {
      headline.textContent = plan && plan.message || t('form.needValidRange');
      headline.classList.add('is-error');
      preview.appendChild(headline);
      return;
    }
    if (plan.kind === 'overnight-continuation') {
      headline.textContent = t('form.overnightToToday');
    } else if (plan.kind === 'overnight-day-end') {
      headline.textContent = t('form.overnightDayEnd');
    } else if (plan.kind === 'segment-split') {
      headline.textContent = plan.mode === 'whole'
        ? t('form.splitWhole')
        : (plan.mode === 'edge' ? t('form.splitEdge') : t('form.splitInner'));
    } else {
      headline.textContent = t('form.boundaryAfterSave');
    }
    preview.appendChild(headline);
    const roleNames = {
      previous: t('part.previous'), current: t('part.current'), next: t('part.next'),
      before: t('part.before'), new: t('part.new'), after: t('part.after'),
      'overnight-yesterday': t('part.overnightYesterday'), 'overnight-today': t('part.overnightToday')
    };
    (plan.preview || []).forEach(part => {
      const row = document.createElement('div');
      row.className = `preview-row preview-${part.role}`;
      const role = document.createElement('span');
      role.className = 'preview-role';
      role.textContent = roleNames[part.role] || part.role;
      const time = document.createElement('span');
      time.className = 'preview-time';
      const endLabel = part.endTs.slice(0, 10) !== part.startTs.slice(0, 10) && part.endTs.slice(11) === '00:00'
        ? '24:00'
        : hhmm(part.endTs);
      time.textContent = `${hhmm(part.startTs)}-${endLabel}`;
      const label = document.createElement('span');
      label.className = 'preview-label';
      label.textContent = part.label || t('entry.unrecordedLabel');
      row.append(role, time, label);
      preview.appendChild(row);
    });
  }

  function buildEditPlan(panel, entries = formBaseEntries) {
    const id = panel && panel.dataset.id;
    const tsEl = panel && panel.querySelector('[data-role="edit-ts"]');
    const endEl = panel && panel.querySelector('[data-role="edit-end-ts"]');
    const modeEl = panel && panel.querySelector('[data-role="edit-end-mode"]');
    const whatEl = panel && panel.querySelector('[data-role="edit-what"]');
    if (!id || !tsEl || !endEl || !modeEl) return null;
    const original = entries.find(item => item.id === id);
    const tag = selectedTag(panel, 'edit', original && (original.tags || [])[0]);
    return planIntervalEdit(entries, {
      id,
      startTs: tsEl.value,
      endTs: endEl.value,
      endMode: modeEl.value,
      what: whatEl ? whatEl.value.trim() : '',
      tags: [tag]
    }, {
      todayKey: todayStr(),
      nowTs: nowStr(),
      createId: planIdFactory()
    });
  }

  function refreshEditPreview(panel, entries = formBaseEntries, remember = true) {
    const plan = buildEditPlan(panel, entries);
    if (!plan) return null;
    paintTransactionPreview(panel, plan);
    if (remember && plan.ok) lastPreviewSignature = plan.resultSignature;
    return plan;
  }

  function buildSplitPlan(panel, entries = formBaseEntries) {
    const startEl = panel && panel.querySelector('#form-ts');
    const endEl = panel && panel.querySelector('#form-end-ts');
    const whatEl = panel && panel.querySelector('#form-what');
    if (!startEl || !endEl) return null;
    return planSegmentSplit(entries, {
      sourceId: formSourceId,
      frozenStart: formFrozenStart,
      frozenEnd: formFrozenEnd,
      startTs: startEl.value,
      endTs: endEl.value,
      what: whatEl ? whatEl.value.trim() : '',
      tags: [selectedTag(panel, 'form')]
    }, { createId: planIdFactory() });
  }

  function refreshSplitPreview(panel, entries = formBaseEntries, remember = true) {
    const plan = buildSplitPlan(panel, entries);
    if (!plan) return null;
    paintTransactionPreview(panel, plan);
    if (remember && plan.ok) lastPreviewSignature = plan.resultSignature;
    return plan;
  }

  function overnightMode(panel) {
    const input = panel && panel.querySelector('[data-role="overnight-end-mode"]');
    return input && input.value === 'day-end' ? 'day-end' : 'today';
  }

  function buildOvernightPlan(panel, entries = formBaseEntries) {
    if (!formOvernightContext) return null;
    const startEl = panel && panel.querySelector('#form-ts');
    const whatEl = panel && panel.querySelector('#form-what');
    if (!startEl) return null;
    const startTs = normalizeTimestamp(startEl.value);
    const what = whatEl ? whatEl.value.trim() : '';
    const tags = [selectedTag(panel, 'form')];
    if (overnightMode(panel) === 'day-end' && startTs && startTs < formOvernightContext.midnightTs) {
      const source = entries.find(entry => entry.id === formOvernightContext.sourceId);
      const laterLogged = entries.some(entry => !entry.planned
        && entry.ts.slice(0, 10) === formOvernightContext.yesterdayKey
        && entry.ts > formOvernightContext.startTs);
      if (!source || !isPlaceholderEntry(source) || source.ts !== formOvernightContext.startTs || laterLogged) {
        return { ok: false, reason: 'stale', message: t('txn.staleOvernight') };
      }
      const plan = planSegmentSplit(entries, {
        sourceId: formOvernightContext.sourceId,
        frozenStart: formOvernightContext.startTs,
        frozenEnd: formOvernightContext.midnightTs,
        startTs,
        endTs: formOvernightContext.midnightTs,
        what,
        tags
      }, { createId: planIdFactory() });
      if (!plan.ok) return plan;
      return {
        ...plan,
        kind: 'overnight-day-end',
        preview: [{
          role: 'overnight-yesterday',
          label: what || tags[0] || t('entry.unrecordedLabel'),
          startTs,
          endTs: formOvernightContext.midnightTs
        }],
        durationMins: minsBetweenDates(new Date(startTs), new Date(formOvernightContext.midnightTs))
      };
    }
    return planOvernightContinuation(entries, {
      viewedDate: formTargetDate,
      sourceId: formOvernightContext.sourceId,
      frozenStart: formOvernightContext.startTs,
      startTs,
      what,
      tags
    }, { todayKey: todayStr(), nowTs: nowStr(), createId: planIdFactory() });
  }

  function refreshOvernightPreview(panel, entries = formBaseEntries, remember = true) {
    if (!panel || !formOvernightContext) return null;
    const startEl = panel.querySelector('#form-ts');
    const modeEl = panel.querySelector('[data-role="overnight-end-mode"]');
    const dayEndButton = panel.querySelector('[data-action="pick-overnight-end-mode"][data-mode="day-end"]');
    const startTs = normalizeTimestamp(startEl && startEl.value);
    const canStopAtDayEnd = Boolean(startTs && startTs < formOvernightContext.midnightTs);
    if (dayEndButton) dayEndButton.hidden = !canStopAtDayEnd;
    if (!canStopAtDayEnd && modeEl) {
      modeEl.value = 'today';
      formOvernightEndMode = 'today';
    }
    panel.querySelectorAll('[data-action="pick-overnight-end-mode"]').forEach(button => {
      const selected = button.dataset.mode === overnightMode(panel);
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const plan = buildOvernightPlan(panel, entries);
    paintTransactionPreview(panel, plan);
    const summary = panel.querySelector('[data-role="overnight-summary"]');
    if (summary && plan && plan.ok) {
      const startLabel = startTs < formOvernightContext.midnightTs ? t('form.continueYesterday', { time: hhmm(startTs) }) : t('form.continueToday', { time: hhmm(startTs) });
      const endTs = plan.kind === 'overnight-day-end' ? formOvernightContext.midnightTs : plan.context.hardEndTs;
      const endLabel = plan.kind === 'overnight-day-end' ? t('form.onlyToDayEnd') : t('form.toTodayEnd', { time: hhmm(endTs) });
      summary.textContent = `${startLabel} · ${endLabel} · ${fmtMins(plan.durationMins)}`;
    } else if (summary) {
      summary.textContent = plan && plan.message || t('form.needValidStart');
    }
    if (remember && plan && plan.ok) lastPreviewSignature = plan.resultSignature;
    return plan;
  }

  function updateEditRangeLabel(panel) {
    const label = panel && panel.querySelector('[data-role="edit-start-label"]');
    const startEl = panel && panel.querySelector('[data-role="edit-ts"]');
    const endEl = panel && panel.querySelector('[data-role="edit-end-ts"]');
    const modeEl = panel && panel.querySelector('[data-role="edit-end-mode"]');
    if (!label || !startEl || !endEl || !modeEl) return;
    label.textContent = t('form.rangeLabel', { start: hhmm(startEl.value), end: modeEl.value === 'now' ? t('form.rangeUntilNow') : hhmm(endEl.value) });
  }

  function mountEditIntervalPickers(panel) {
    const startEl = panel.querySelector('[data-role="edit-ts"]');
    const endEl = panel.querySelector('[data-role="edit-end-ts"]');
    const startMount = panel.querySelector('[data-role="edit-start-wheel"]');
    const endMount = panel.querySelector('[data-role="edit-end-wheel"]');
    if (!startEl || !endEl || !startMount) return;
    mountTimePicker(startMount, startEl.value, value => {
      startEl.value = value;
      updateEditRangeLabel(panel);
      refreshEditPreview(panel);
    });
    if (endMount) mountTimePicker(endMount, endEl.value, value => {
      endEl.value = value;
      updateEditRangeLabel(panel);
      refreshEditPreview(panel);
    });
    updateEditRangeLabel(panel);
    refreshEditPreview(panel);
    sheetTimeMounted = true;
  }

  // v43: 面板不再随键盘缩放（结构性根除 P16–P23 整类跳变，见 docs/postmortems.md）。
  // .form-sheet / .form-sheet-panel 几何全程恒定，键盘只是盖住底部；这里只把「被
  // 键盘遮挡的高度」写成 --kb 供正文 scroll-padding 用，焦点控件靠原生滚动避开键盘。
  // 因此不存在任何随键盘开合而移动的东西——iOS 那个迟到/稀疏的 vv 事件只影响 --kb
  // 的滚动内边距（最坏让焦点控件晚一拍滚上来），永不产生面板跳变。
  function writeKeyboardInset() {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height));
    document.documentElement.style.setProperty('--kb', `${kb}px`);
    window.__vvlog?.(`--kb=${kb}`);
  }

  function clearKeyboardInset() {
    document.documentElement.style.removeProperty('--kb');
  }

  function onSheetFocusIn(e) {
    const sheet = document.getElementById('form-sheet');
    if (!sheet || sheet.hidden) return;
    const to = e.target;
    if (!(to instanceof HTMLElement) || !sheet.contains(to)) return;
    if (to.tagName !== 'TEXTAREA' && to.tagName !== 'INPUT') return;
    // 把焦点控件滚到键盘上方。这是滚动、不是几何变更——即便 iOS 的 vv/键盘事件迟到，
    // 最坏也只是晚一拍把控件滚上来，绝不会像旧方案那样让整个面板跳。
    requestAnimationFrame(() => to.scrollIntoView({ block: 'center' }));
  }

  function attachVisualViewport() {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (vv) {
      writeKeyboardInset();
      vv.addEventListener('resize', writeKeyboardInset);
    }
    document.addEventListener('focusin', onSheetFocusIn);
  }

  function detachVisualViewport() {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (vv) vv.removeEventListener('resize', writeKeyboardInset);
    document.removeEventListener('focusin', onSheetFocusIn);
    clearKeyboardInset();
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

  function autosizeTextareas(scope = document) {
    // Grow to fit content, but CAP the height so one long note can't swallow the
    // whole panel. cap 用稳定的 innerHeight（v43：面板定高、正文可滚，不再读随键盘
    // 缩放的 vv.height——否则键盘一开 cap 就缩、textarea 重排造成内容位移）。超过 cap
    // 后 textarea 内部滚动（overflow-y auto below）。
    const viewH = (typeof window !== 'undefined' ? window.innerHeight : 0) || 0;
    const cap = viewH ? Math.max(120, Math.round(viewH * 0.4)) : 260;
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
      const selected = btn.dataset.bucket === formBucket;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
    panel.querySelectorAll('[data-role="record-mode-seg"] button').forEach(btn => {
      const selected = btn.dataset.mode === formRecordMode;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
  }

  function openFormSheet(opts) {
    // R1 重入保护：上一个 sheet 的关闭动画还没播完就要开新的（如 editConflictEntry
    // 关了立刻重开），先把旧的立即收尾，避免它稍后的 transitionend/兜底定时器把刚
    // 打开的新内容又清空、又 hidden 掉。
    if (sheetCloseCleanup) sheetCloseCleanup();
    const requestedMode = opts && opts.mode;
    const mode = ['edit', 'help', 'config', 'import-shift', 'more', 'delete-confirm', 'motto', 'backup', 'advanced'].includes(requestedMode) ? requestedMode : 'new';
    const id = opts && opts.id;
    const loaded = deps.load();
    const entry = mode === 'edit' ? loaded.entries.find(e => e.id === id) : null;
    if (mode === 'edit' && !entry) return;
    sheetLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (mode === 'new') {
      deps.state.view = 'day';
      deps.persistState();
      deps.setSheetEditId(null);
      formTag = '';
      formBucket = defaultBucketFromEntries();
      formTargetDate = deps.state.selectedDate || todayStr();
      formDateMode = entryModeForDate(formTargetDate);
      formRecordMode = formDateMode.forcedMode || loadRecordModePref();
      formBackfill = Boolean(opts && opts.backfill);
      formBackfillEnd = (opts && opts.endTs) || '';
      formBackfillKind = (opts && opts.backfillKind) === 'split' ? 'split' : 'fill';
      formSourceId = (opts && opts.sourceId) || '';
      formFrozenStart = normalizeTimestamp((opts && opts.ts) || '');
      formFrozenEnd = normalizeTimestamp((opts && opts.endTs) || '');
      formBaseEntries = cloneEntries(loaded.entries);
      resetPlanIds();
      lastPreviewSignature = '';
      formOvernightEndMode = 'today';
      formOvernightContext = null;
      // Backfilling a known past gap is always an "already happened" record;
      // a leaked plan-mode pref would force a future ts and silently fail to save.
      if (isHistoryDate() || formBackfill) formRecordMode = 'log';
      if (!formBackfill) {
        const overnight = overnightContinuationContext(loaded.entries, formTargetDate, {
          todayKey: todayStr(),
          nowTs: nowStr()
        });
        if (overnight.ok) formOvernightContext = overnight;
      }
    } else if (mode === 'edit') {
      deps.setSheetEditId(id);
      sheetTimeMounted = false;
      editBucket = safeBucket(bucketForTag((entry.tags || [])[0] || '', deps.loadConfig()));
      formBaseEntries = cloneEntries(loaded.entries);
      resetPlanIds();
      lastPreviewSignature = '';
      const context = intervalEditContext(formBaseEntries, id, { todayKey: todayStr(), nowTs: nowStr() });
      editEndMode = context.ok && context.canUseNow && (!context.next || entry.ongoing) ? 'now' : 'fixed';
      deps.render();
    } else if (mode === 'config') {
      // SPEC-007/D18：默认标签预览是一次性的——每次重开 config sheet 都清掉，
      // 只有显式点「添加本语言的默认标签」那一次才带着它重开。
      configDefaultsPreview = (opts && opts.defaultsPreview) || null;
      configRawAtOpen = deps.readConfigRaw();
    }
    const sheet = document.getElementById('form-sheet');
    const panel = sheet.querySelector('.form-sheet-panel');
    const ts = mode === 'edit'
      ? entry.ts
      : (opts && opts.ts) || (formOvernightContext && formOvernightContext.startTs)
        || (formRecordMode === 'plan' ? defaultPlanTimestamp() : deps.defaultFormTs());
    const prevMode = sheet.hidden ? '' : (panel.dataset.mode || '');
    if (opts && opts.restore) {
      // 从返回栈恢复：这一层已经在关闭时弹出，别再压回去。
    } else if (prevMode === mode) {
      // 原地重渲染同一层（切主题/切语言/开关启动诊断/设为当前主线都走这条）：栈不动。
      // 少了这一条，每按一次开关就会往栈里压一层，返回时要按同样多次才出得来。
    } else if (SUB_MODES.includes(mode) && CONTAINER_MODES.includes(prevMode)) {
      sheetStack.push(prevMode);
    } else {
      // 新开一条路径（记一条/编辑/删除确认/直接开更多），旧的返回栈作废。
      sheetStack = [];
    }
    panel.dataset.mode = mode;
    // v43: 只有会召唤软键盘的表单（新建/编辑/标签设置）用定高高 sheet——内容从顶部流下、
    // 焦点控件滚到键盘上方，面板几何不随键盘变。不弹键盘的短 sheet（更多/说明/导入平移）
    // 保持内容自适应 bottom sheet，避免短菜单底部空一截。
    // motto 也召唤软键盘（单行 input），同走 v43 定高 tall 规则。
    panel.classList.toggle('tall', mode === 'new' || mode === 'edit' || mode === 'config' || mode === 'motto');
    if (mode === 'edit') panel.dataset.id = id;
    else delete panel.dataset.id;
    panel.innerHTML = renderFormSheet({
      mode,
      entry,
      config: deps.loadConfig(),
      entries: loaded.entries,
      importShiftHours: opts && opts.importShiftHours,
      importShiftHint: opts && opts.importShiftHint,
      importEarlyError: opts && opts.importEarlyError,
      targetDate: mode === 'new' ? formTargetDate : deps.state.selectedDate,
      isToday: (mode === 'new' ? formTargetDate : deps.state.selectedDate) === todayStr(),
      isHistoryDay: mode === 'new' ? formDateMode.kind === 'history' : isHistoryDate(deps.state.selectedDate),
      backfill: Boolean(opts && opts.backfill),
      backfillKind: formBackfillKind,
      bucket: mode === 'edit' ? editBucket : formBucket,
      defaultBucket: formBucket,
      recordMode: formRecordMode,
      recordModeLocked: mode === 'new' && Boolean(formDateMode && formDateMode.forcedMode),
      overnightContext: mode === 'new' ? formOvernightContext : null,
      overnightEndMode: formOvernightEndMode,
      planOutsideWindow: mode === 'edit' && Boolean(entry && entry.planned)
        && !validateTsForMode(entry.ts, { planned: true }).ok,
      isLegacyOrigin: (mode === 'more' || mode === 'backup') && Boolean(deps.isLegacyOrigin && deps.isLegacyOrigin()),
      intervalContext: mode === 'edit'
        ? intervalEditContext(formBaseEntries, id, { todayKey: todayStr(), nowTs: nowStr() })
        : null,
      editEndMode,
      deletePlan: opts && opts.deletePlan,
      deleteEntry: opts && opts.deleteEntry,
      deleteStale: Boolean(opts && opts.deleteStale),
      defaultsPreview: configDefaultsPreview
    });
    // v43: 面板几何恒定，开合键盘不再改 sheet 尺寸；lockBodyForSheet 锁滚动 + 起初
    // 写一次 --kb 供正文 scroll-padding。
    lockBodyForSheet();
    sheet.hidden = false;
    if (mode === 'more' && window.__vvlog) {
      // P24 取证：真机开「更多」时把分享按钮的自渲染状态打进 HUD——若这里报 hidden=false
      // disp=flex 而屏幕上没有，则页面外抑制实锤（cosmetic filter / VPN 过滤），代码侧已尽。
      const sb = panel.querySelector('#backup-send-btn');
      window.__vvlog(sb
        ? `more: send-btn hidden=${sb.hasAttribute('hidden')} disp=${getComputedStyle(sb).display} navShare=${typeof navigator.share}`
        : 'more: send-btn ABSENT');
    }
    if (mode === 'edit') {
      // R3：计划编辑（无 edit-time-section 包装，始终展开）照旧立即挂载；常规编辑
      // 折叠为触发行，点击才挂载（toggleEditStartTime / expandEditTimeSection）。
      const editSection = panel.querySelector('[data-role="edit-time-section"]');
      const editWheel = panel.querySelector('[data-role="edit-wheel"]');
      if (editWheel && !editSection) {
        const tsEl = panel.querySelector('[data-role="edit-ts"]');
        mountTimePicker(editWheel, ts, v => {
          tsEl.value = v;
        });
        sheetTimeMounted = true;
      } else {
        sheetTimeMounted = false;
      }
    } else if (mode === 'new') {
      if (formBackfill) mountBackfillPickers(panel, ts, formBackfillEnd);
      else {
        mountNewTimePicker(panel, ts);
        if (formOvernightContext) refreshOvernightPreview(panel);
      }
      const whatEl = panel.querySelector('#form-what');
      const ctagEl = panel.querySelector('#form-ctag');
      if (whatEl) whatEl.value = '';
      if (ctagEl) ctagEl.value = '';
      deps.renderChrome();
    }
    autosizeTextareas(panel);
    trapFocus(sheet);
    requestAnimationFrame(() => {
      // 打开后延迟一帧聚焦面板，给读屏一个稳定的 dialog 起点；但这一帧到来前用户
      // 可能已经点进输入框、甚至正按保存。此时再无条件抢焦点，会在 pointerdown 与
      // click 之间换掉激活目标，让快速连续操作的第二次点击偶发消失。
      if (sheet.hidden || sheet.classList.contains('sheet-closing') || sheet.contains(document.activeElement)) return;
      panel.setAttribute('tabindex', '-1');
      panel.focus({ preventScroll: true });
    });
  }

  // v43: 面板不再随键盘缩放后，关闭无需再等键盘 settle（旧 P14/P16 的二次重排源于
  // 关闭时面板还在追踪键盘几何——现在几何恒定，关就是关）。blur 收键盘 → 同步关闭渲染。
  function teardownNow(run) {
    const active = document.activeElement;
    if (active && typeof active.blur === 'function') active.blur();
    run();
  }

  function prefersReducedMotion() {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // R1：关闭时的最终收尾——真正隐藏 + 清空内容。既用于动画播完之后，也用于
  // reduced-motion/重入时的立即收尾，两条路径共享同一份清理逻辑。
  function finishSheetClose(sheet, panel) {
    sheet.hidden = true;
    sheet.classList.remove('sheet-closing', 'sheet-dragging', 'sheet-drag-dismiss');
    panel.style.removeProperty('transform');
    panel.style.removeProperty('transition');
    const backdrop = sheet.querySelector('.form-sheet-backdrop');
    if (backdrop) {
      backdrop.style.removeProperty('opacity');
      backdrop.style.removeProperty('transition');
    }
    sheetDismissDrag = null;
    panel.innerHTML = '';
    delete panel.dataset.id;
    delete panel.dataset.mode;
  }

  // R1：sheet 关闭改「class 驱动过渡 + transitionend 后置 hidden」，不再是旧版的
  // 瞬断——挂 .sheet-closing 让面板/遮罩过渡到 @starting-style 那套收起态，播完
  // （或 320ms 兜底，防止某些环境不派发 transitionend）再真正 hidden + 清空。
  // 若上一次关闭动画还没收尾就又被关一次（如 editConflictEntry 的「关了立刻重开」），
  // 先立即收尾旧的，不留悬空定时器/监听器。
  function animateSheetClose(sheet, panel) {
    if (sheetCloseCleanup) sheetCloseCleanup();
    sheet.classList.add('sheet-closing');
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      panel.removeEventListener('transitionend', onEnd);
      sheetCloseCleanup = null;
      finishSheetClose(sheet, panel);
    };
    const onEnd = e => { if (e.target === panel && e.propertyName === 'transform') cleanup(); };
    panel.addEventListener('transitionend', onEnd);
    const timer = setTimeout(cleanup, 320);
    sheetCloseCleanup = cleanup;
  }

  function closeFormSheet(opts = {}) {
    const restoreFocus = opts.restoreFocus !== false;
    const sheet = document.getElementById('form-sheet');
    const panel = sheet ? sheet.querySelector('.form-sheet-panel') : null;
    const wasOpen = Boolean(sheet && panel && !sheet.hidden && !sheet.classList.contains('sheet-closing'));
    const mode = wasOpen ? panel.dataset.mode || '' : '';
    if (sheetTrapController) {
      sheetTrapController.abort();
      sheetTrapController = null;
    }
    if (wasOpen) {
      if (prefersReducedMotion()) finishSheetClose(sheet, panel);
      else animateSheetClose(sheet, panel);
      unlockBodyForSheet();
    }
    deps.setSheetEditId(null);
    sheetTimeMounted = false;
    formTargetDate = '';
    formDateMode = null;
    formBackfill = false;
    formBackfillEnd = '';
    formBackfillKind = 'fill';
    formSourceId = '';
    formFrozenStart = '';
    formFrozenEnd = '';
    formOvernightContext = null;
    formOvernightEndMode = 'today';
    formBaseEntries = [];
    formPlanIds = [];
    lastPreviewSignature = '';
    editEndMode = 'fixed';
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
    if (mode === 'edit') {
      // R3：折叠中的常规编辑没有挂载任何 picker，跨断点/旋转屏幕时无需重挂。
      const editSection = panel.querySelector('[data-role="edit-time-section"]');
      if (editSection && editSection.hidden) return;
      const intervalStart = panel.querySelector('[data-role="edit-start-wheel"]');
      if (intervalStart) {
        if (intervalStart.dataset.pickerCompact === compact) return;
        mountEditIntervalPickers(panel);
        return;
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
    if (sheetStack.length) {
      // 二级页返回上一层：先 blur 让键盘收起预测在旧 DOM 上跑完，再原地重渲染。
      const back = sheetStack.pop();
      const active = document.activeElement;
      if (active && typeof active.blur === 'function') active.blur();
      openFormSheet({ mode: back, restore: true });
      return;
    }
    // Cancel/backdrop/Esc with the keyboard up had the same two-jump close as
    // the save paths (P14/P16); settle first, then tear down in one frame.
    teardownNow(() => {
      const mode = closeFormSheet();
      if (mode === 'edit') deps.render();
    });
  }

  function registerSheetDismissGesture() {
    const sheet = document.getElementById('form-sheet');
    if (!sheet) return;
    const resetInlineDrag = panel => {
      const backdrop = sheet.querySelector('.form-sheet-backdrop');
      sheet.classList.remove('sheet-dragging');
      panel.style.transform = 'translateY(0)';
      if (backdrop) backdrop.style.opacity = '1';
      const cleanup = () => {
        panel.removeEventListener('transitionend', cleanup);
        panel.style.removeProperty('transform');
        if (backdrop) backdrop.style.removeProperty('opacity');
      };
      if (prefersReducedMotion()) cleanup();
      else panel.addEventListener('transitionend', cleanup);
    };
    sheet.addEventListener('pointerdown', event => {
      const panel = event.target.closest('.form-sheet-panel');
      // v84：备份/高级二级页与「更多」同为短 sheet，抓手下拉关闭一视同仁（它们
      // 关闭时回到上一层，正是下拉手势的自然语义）。
      if (!panel || !['more', 'backup', 'advanced'].includes(panel.dataset.mode) || window.innerWidth >= 720) return;
      const grabber = panel.querySelector('.sh-grab');
      const hit = grabber && grabber.getBoundingClientRect();
      if (event.pointerType === 'mouse' || !hit
        || event.clientX < hit.left || event.clientX > hit.right
        || event.clientY < hit.top || event.clientY > hit.bottom) return;
      sheetDismissDrag = {
        panel,
        pointerId: event.pointerId,
        startY: event.clientY,
        lastY: event.clientY,
        lastAt: performance.now(),
        velocity: 0,
        dy: 0
      };
      sheet.classList.add('sheet-dragging');
      try { panel.setPointerCapture?.(event.pointerId); } catch {}
    });
    sheet.addEventListener('pointermove', event => {
      const drag = sheetDismissDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const now = performance.now();
      const dy = Math.max(0, event.clientY - drag.startY);
      const elapsed = Math.max(1, now - drag.lastAt);
      drag.velocity = (event.clientY - drag.lastY) / elapsed;
      drag.lastY = event.clientY;
      drag.lastAt = now;
      drag.dy = dy;
      drag.panel.style.transform = `translateY(${dy}px)`;
      const backdrop = sheet.querySelector('.form-sheet-backdrop');
      if (backdrop) backdrop.style.opacity = String(Math.max(0, 1 - dy / 240));
      event.preventDefault();
    });
    const finish = event => {
      const drag = sheetDismissDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      sheetDismissDrag = null;
      try { drag.panel.releasePointerCapture?.(event.pointerId); } catch {}
      const dismiss = drag.dy >= 72 || (drag.dy >= 24 && drag.velocity > 0.55);
      if (!dismiss) {
        resetInlineDrag(drag.panel);
        return;
      }
      sheet.classList.remove('sheet-dragging');
      sheet.classList.add('sheet-drag-dismiss');
      drag.panel.style.removeProperty('transform');
      const backdrop = sheet.querySelector('.form-sheet-backdrop');
      if (backdrop) backdrop.style.removeProperty('opacity');
      closeForm();
    };
    sheet.addEventListener('pointerup', finish);
    sheet.addEventListener('pointercancel', finish);
  }

  function openForm() {
    openFormSheet({ mode: 'new' });
  }

  function openMoreSheet(opts = {}) {
    openFormSheet({ mode: 'more', ...opts });
  }

  function openBackupSheet() {
    openFormSheet({ mode: 'backup' });
  }

  function openAdvancedSheet() {
    openFormSheet({ mode: 'advanced' });
  }

  function toggleLongReview() {
    const { config, raw } = deps.loadConfigSnapshot();
    if (config.longReview === true) delete config.longReview;
    else config.longReview = true;
    const panel = document.querySelector('#form-sheet .form-sheet-panel');
    const write = deps.saveConfigChecked(config, raw);
    if (!write.ok) {
      showInlineError(panel, write.reason === 'concurrent' ? t('toast.concurrentWrite') : t('config.quota'), 'advanced-error');
      return;
    }
    deps.render();
    openFormSheet({ mode: 'advanced' });
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
    teardownNow(() => {
      const changed = Boolean(deps.getSheetEditId() || getSheetMode() === 'edit');
      closeEditSheet();
      if (changed) deps.render();
    });
  }

  function pickTag(el) {
    const wasSelected = el.classList.contains('sel');
    const panel = el.closest('.form-sheet-panel');
    const chipRoot = panel ? panel.querySelector('#form-chips, [data-role="edit-chips"]') : null;
    if (chipRoot) chipRoot.querySelectorAll('.chip').forEach(c => {
      c.classList.remove('sel');
      c.setAttribute('aria-pressed', 'false');
    });
    if (wasSelected) {
      formTag = '';
      if (panel && panel.dataset.mode === 'edit') refreshEditPreview(panel);
      if (panel && panel.dataset.mode === 'new' && formBackfill) refreshSplitPreview(panel);
      if (panel && panel.dataset.mode === 'new' && formOvernightContext) refreshOvernightPreview(panel);
      return;
    }
    el.classList.add('sel');
    el.setAttribute('aria-pressed', 'true');
    formTag = el.dataset.tag || '';
    if (el.dataset.bucket) {
      if (panel && panel.dataset.mode === 'edit') editBucket = el.dataset.bucket;
      else formBucket = el.dataset.bucket;
      refreshFormTagArea(panel);
      const editSeg = panel ? panel.querySelector('[data-role="edit-bucket-seg"]') : null;
      if (editSeg) {
        editSeg.querySelectorAll('button').forEach(btn => {
          const selected = btn.dataset.bucket === editBucket;
          btn.classList.toggle('active', selected);
          btn.setAttribute('aria-pressed', String(selected));
        });
      }
    }
    const custom = panel ? panel.querySelector('#form-ctag, [data-role="edit-custom-tag"]') : null;
    if (custom) custom.value = '';
    if (panel && panel.dataset.mode === 'edit') refreshEditPreview(panel);
    if (panel && panel.dataset.mode === 'new' && formBackfill) refreshSplitPreview(panel);
    if (panel && panel.dataset.mode === 'new' && formOvernightContext) refreshOvernightPreview(panel);
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
      if (seg) seg.querySelectorAll('button').forEach(btn => {
        const selected = btn.dataset.bucket === bucket;
        btn.classList.toggle('active', selected);
        btn.setAttribute('aria-pressed', String(selected));
      });
      const hint = panel.querySelector('[data-role="mainline-hint"]');
      if (hint) hint.textContent = bucketHint(bucket);
      const custom = panel.querySelector('#form-ctag, [data-role="edit-custom-tag"]');
      if (custom) custom.value = '';
    }
    if (panel && panel.dataset.mode === 'edit') refreshEditPreview(panel);
    if (panel && panel.dataset.mode === 'new' && formBackfill) refreshSplitPreview(panel);
    if (panel && panel.dataset.mode === 'new' && formOvernightContext) refreshOvernightPreview(panel);
  }

  function pickRecordMode(el) {
    const panel = el.closest('.form-sheet-panel');
    if (!formDateMode || formDateMode.kind !== 'today' || formOvernightContext) return;
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
      const selected = btn.dataset.mode === formRecordMode;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
    const title = panel.querySelector('#form-sheet-title');
    const what = panel.querySelector('.form-sheet-what');
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(formTargetDate || '');
    const daySummary = m ? t('form.daySummary', { m: Number(m[2]), d: Number(m[3]) }) : t('form.thisDay');
    if (title) title.textContent = formRecordMode === 'plan' ? t('form.titlePlan', { day: daySummary }) : t('form.titleLog', { when: formTargetDate === todayStr() ? t('form.whenJustNow') : t('form.whenBackfill') });
    if (what) what.textContent = formRecordMode === 'plan' ? t('form.hintPlan') : (formTargetDate === todayStr() ? t('form.hintToday') : t('form.hintOtherDay'));
    const whatLabel = panel.querySelector('[data-role="what-label"]');
    if (whatLabel) whatLabel.textContent = formRecordMode === 'plan' ? t('form.whatLabelPlan') : t('form.whatLabelLog');
    const whatInput = panel.querySelector('#form-what');
    if (whatInput) whatInput.setAttribute('placeholder', formRecordMode === 'plan' ? t('form.whatPlaceholderPlan') : t('form.whatPlaceholderLog'));
    const tsEl = panel.querySelector('#form-ts');
    if (tsEl) {
      tsEl.value = formRecordMode === 'plan' ? defaultPlanTimestamp() : deps.defaultFormTs();
      mountNewTimePicker(panel, tsEl.value);
    }
    deps.renderChrome();
  }

  function pickOvernightEndMode(el) {
    const panel = el.closest('.form-sheet-panel');
    if (!panel || !formOvernightContext) return;
    const mode = el.dataset.mode === 'day-end' ? 'day-end' : 'today';
    const startTs = normalizeTimestamp((panel.querySelector('#form-ts') || {}).value);
    if (mode === 'day-end' && (!startTs || startTs >= formOvernightContext.midnightTs)) return;
    formOvernightEndMode = mode;
    const input = panel.querySelector('[data-role="overnight-end-mode"]');
    if (input) input.value = mode;
    refreshOvernightPreview(panel);
  }

  function clearInlineError(scope, role = 'conflict-error') {
    const err = scope ? scope.querySelector(`[data-role="${role}"]`) : null;
    if (!err) return;
    err.hidden = true;
    err.innerHTML = '';
  }

  // v84：`focusEl` 是「出问题的那一行」。标签设置的错误条挂在正文**末尾**，只把错误条
  // 滚进视野等于把用户甩到整页最底部，离出错的行十万八千里（维护者真机反馈）。给了
  // 目标就滚目标并聚焦它，错误文案照旧显示——它是同一屏里的说明，不是导航目标。
  function showInlineError(scope, message, role = 'conflict-error', focusEl = null) {
    const err = scope ? scope.querySelector(`[data-role="${role}"]`) : null;
    if (!err) return;
    err.textContent = String(message || '');
    err.hidden = false;
    // ④ A blocked ✓ must give feedback the user can actually see; the panel body
    // scrolls and the iOS keyboard can hide the lower half, so pull it into view.
    const target = focusEl || err;
    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    if (focusEl && typeof focusEl.focus === 'function') focusEl.focus({ preventScroll: true });
  }

  function showConflictError(scope, conflict, ts, plusAction) {
    const err = scope ? scope.querySelector('[data-role="conflict-error"]') : null;
    if (!err) return;
    err.replaceChildren();
    const what = String(conflict && conflict.what || t('txn.deleteEmptyWhat')).replace(/\s+/g, ' ').slice(0, 36);
    err.append(document.createTextNode(t('form.conflictSameMoment', { what })));
    const edit = document.createElement('button');
    edit.className = 'mini-btn';
    edit.type = 'button';
    edit.dataset.action = 'edit-conflict-entry';
    edit.dataset.id = String(conflict && conflict.id || '');
    edit.textContent = t('form.conflictEdit');
    const plus = document.createElement('button');
    plus.className = 'mini-btn';
    plus.type = 'button';
    plus.dataset.action = plusAction;
    plus.dataset.ts = ts;
    plus.textContent = t('form.conflictPlusOne');
    err.append(edit, plus);
    err.hidden = false;
    if (typeof err.scrollIntoView === 'function') err.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function useConflictPlusMinute(el) {
    const panel = el.closest('.form-sheet-panel');
    const mode = panel && panel.dataset.mode;
    const nextTs = addOneMinute(el.dataset.ts || '');
    const input = mode === 'edit' ? panel.querySelector('[data-role="edit-ts"]') : panel.querySelector('#form-ts');
    const mount = mode === 'edit'
      ? panel.querySelector('[data-role="edit-wheel"], [data-role="edit-start-wheel"]')
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
    if (mode === 'edit') {
      updateEditRangeLabel(panel);
      refreshEditPreview(panel);
    }
  }

  function editConflictEntry(id) {
    closeFormSheet({ restoreFocus: false });
    openEditSheet(id);
  }

  function compactTagText(value) {
    return String(value || '').toLowerCase().replace(/[\s·._-]+/g, '');
  }

  function updateMainlineHint(input) {
    const box = input.closest('.form-sheet-panel');
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
      hint.textContent = t('form.tagSameBucket', { name: value, bucket: BUCKETS[sameName.bucket] });
      return;
    }
    const near = compact ? config.mainline.find(name => compactTagText(name) === compact && name !== value) : '';
    hint.textContent = near
      ? t('form.tagNear', { name: near })
      : bucketHint(bucket);
  }

  function syncCustomDraft(input) {
    const panel = input.closest('.form-sheet-panel');
    if (!panel) return;
    const isEdit = panel.dataset.mode === 'edit';
    const chipRoot = panel.querySelector('#form-chips, [data-role="edit-chips"]');
    if (!chipRoot) return;
    formTag = '';
    chipRoot.innerHTML = renderTagPicker(isEdit ? 'edit' : 'form', input.value.trim(), deps.loadConfig(), isEdit ? editBucket : formBucket);
    if (isEdit) refreshEditPreview(panel);
    else if (formBackfill) refreshSplitPreview(panel);
    else if (formOvernightContext) refreshOvernightPreview(panel);
  }

  function rememberTag(tag, bucket, entries) {
    return deps.rememberCustomTagForBucket(tag, safeBucket(bucket), entries);
  }

  // 自定义标签与记录是跨两个 localStorage key 的一次用户动作。记录先落库，再记住
  // 标签；若第二步因配额失败，就把记录回滚到写前快照并留在表单里，避免新标签掉进
  // 「未记录」桶。覆盖旧值通常不增加占用，正好是配额已满时最可靠的补偿写。
  function rememberTagOrRollback(tag, bucket, entries, beforeData, scope, writtenRaw) {
    if (!tag || rememberTag(tag, bucket, entries)) return true;
    // 配置写入失败时，只在数据仍是本次写入版本上回滚；无条件 save() 会抹掉
    // 另一标签页在两次写入之间追加的记录。
    const rollback = deps.saveChecked(beforeData, writtenRaw);
    if (!rollback.ok) {
      showInlineError(scope, t('io.importRollbackFailed'));
      return false;
    }
    showInlineError(scope, t('form.tagConfigQuota'));
    return false;
  }

  function saveOvernightEntry(panel) {
    const timeScope = getFormWheelMount(panel) || panel;
    const startTs = normalizeTimestamp((panel.querySelector('#form-ts') || {}).value);
    if (!startTs) {
      setTimeInputError(timeScope, t('form.needStartTime'));
      return;
    }
    setTimeInputError(timeScope, '');
    const whatEl = panel.querySelector('#form-what');
    const what = whatEl ? whatEl.value.trim() : '';
    if (!what) { if (whatEl) whatEl.focus(); return; }
    const ctagEl = panel.querySelector('#form-ctag');
    const ctag = ctagEl ? ctagEl.value.trim() : '';
    const tag = canonicalTagName(ctag || formTag || RESERVED_UNKNOWN_TAG, deps.loadConfig());
    const expected = buildOvernightPlan(panel, formBaseEntries);
    if (!expected || !expected.ok) {
      showInlineError(panel, expected && expected.message || t('form.overnightUnsavable'));
      paintTransactionPreview(panel, expected);
      return;
    }
    const { data: d, raw } = deps.loadSnapshot();
    const beforeData = { ...d, entries: cloneEntries(d.entries) };
    const latest = buildOvernightPlan(panel, d.entries);
    if (!latest || !latest.ok) {
      showInlineError(panel, latest && latest.message || t('form.boundaryChanged'));
      paintTransactionPreview(panel, latest);
      return;
    }
    if (lastPreviewSignature && latest.resultSignature !== lastPreviewSignature) {
      formBaseEntries = cloneEntries(d.entries);
      refreshOvernightPreview(panel, formBaseEntries, true);
      showInlineError(panel, t('form.previewRecomputed'));
      return;
    }
    d.entries = latest.resultEntries;
    const write = deps.saveChecked(d, raw);
    if (!write.ok) {
      showInlineError(panel, write.reason === 'concurrent' ? t('toast.concurrentWrite') : t('form.quotaForm'));
      return;
    }
    if (!rememberTagOrRollback(ctag, formBucket, d.entries, beforeData, panel, write.raw)) return;
    const staysYesterday = latest.kind === 'overnight-day-end' && startTs < formOvernightContext.midnightTs;
    deps.setSelectedDate(staysYesterday ? formOvernightContext.yesterdayKey : formOvernightContext.todayKey);
    teardownNow(() => { closeForm(); deps.render(); });
  }

  function saveEntry() {
    const panel = document.querySelector('#form-sheet .form-sheet-panel');
    if (formBackfill) { saveBackfill(panel); return; }
    if (formOvernightContext) { saveOvernightEntry(panel); return; }
    const timeScope = getFormWheelMount(panel) || panel;
    const planned = formRecordMode === 'plan';
    const checked = validateTsForMode(document.getElementById('form-ts').value, {
      planned
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
    const tag = canonicalTagName(ctag || formTag || RESERVED_UNKNOWN_TAG, deps.loadConfig());
    const { data: d, raw } = deps.loadSnapshot();
    const beforeData = { ...d, entries: cloneEntries(d.entries) };
    let placeholder = openPlaceholderForDate(d.entries, checked.ts.slice(0, 10));
    // v87：占位条只有在**新起点不晚于它**时才可以复用（复用＝把它的 ts 挪到新起点）。
    // 往前挪是对的：占位条代表「从这一刻起还没记」，新记录起得更早就把它整个盖住，
    // 前一条记录相应截短。往**后**挪则是把 [占位点, 新起点) 这段「确实没记」静默改写
    // 成前一条记录的标签——尾占位停在 06:48、你把起点改成 12:00，那 5 小时就凭空
    // 变成了前一条的桶（实测：09:00 写代码/10:00 占位，起点改 11:00 后 09:00-11:00
    // 全成了「写代码·主线」）。这是 D13 硬约束③「不得悄悄修改原始时间线」，而且
    // 改的是主线时长——最不该被夸大的那个数。晚于占位点时不复用，新建条目、把占位条
    // 留在原地，那段如实保持未记录。
    if (placeholder && checked.ts > placeholder.ts) placeholder = null;
    // v88：**计划从不复用占位条**（下面的 planned 分支是 push 一条新记录），所以也
    // 不能把占位条从冲突检测里排除掉——排除了就会在同一时刻并存两条，而「同刻唯一」
    // 是 findTimeConflict、导入的 byTime 映射、事务 planner 的 duplicateTimestamp
    // 共同依赖的前提。正常路径够不到（计划必须晚于 now+5min，占位条在 now 之前），
    // 导入他机备份或改系统时钟能造出来。
    if (planned) placeholder = null;
    const conflict = findTimeConflict(d.entries, checked.ts, placeholder ? placeholder.id : '');
    if (conflict) {
      // A record can land exactly on an empty placeholder stranded in the
      // middle of the day (openPlaceholderForDate only finds the tail one).
      // Fill that placeholder in place instead of blocking it as a self-conflict.
      if (!planned && isPlaceholderEntry(conflict)) {
        placeholder = conflict;
      } else {
        showConflictError(panel, conflict, checked.ts, 'use-conflict-plus-new');
        return;
      }
    }
    if (planned) {
      d.entries.push({ id: deps.uid(), ts: checked.ts, what, tags: [tag], planned: true });
      // v88：计划保存此前是**唯一**不过 normalizeEntries 的表单写入路径，于是「今天
      // 恒有尾占位」这条不变量会在「今天最后一条是真实记录 + 本次只加了一条计划」时
      // 破掉：FAB 随之从「续 hh:mm 起」退化成「补记 hh:mm+1 起」。计划条不参与
      // coalesce，走一遍只会补回占位条，不会动已有记录。
      normalizeEntries(d, { todayKey: todayStr(), createId: deps.uid });
      const write = deps.saveChecked(d, raw);
      if (!write.ok) {
        showInlineError(panel, write.reason === 'concurrent' ? t('toast.concurrentWrite') : t('form.quotaForm'));
        return;
      }
      if (!rememberTagOrRollback(ctag, formBucket, d.entries, beforeData, panel, write.raw)) return;
      deps.setSelectedDate(checked.ts.slice(0, 10));
      teardownNow(() => { closeForm(); deps.render(); });
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
    const write = deps.saveChecked(d, raw);
    if (!write.ok) {
      showInlineError(panel, write.reason === 'concurrent' ? t('toast.concurrentWrite') : t('form.quotaForm'));
      return;
    }
    if (!rememberTagOrRollback(ctag, formBucket, d.entries, beforeData, panel, write.raw)) return;
    deps.setSelectedDate(checked.ts.slice(0, 10));
    teardownNow(() => { closeForm(); deps.render(); });
  }

  // Bounded backfill into a segment: plan [start, end) as the new label and
  // restore the segment's original label at end through planSegmentSplit.
  function saveBackfill(panel) {
    const startScope = (panel && panel.querySelector('[data-role="backfill-start-mount"]')) || panel;
    const endScope = (panel && panel.querySelector('[data-role="backfill-end-mount"]')) || panel;
    const startChecked = validateTs(document.getElementById('form-ts').value);
    if (!startChecked.ok) { setTimeInputError(startScope, startChecked.msg); return; }
    setTimeInputError(startScope, '');
    const endChecked = validateTs(document.getElementById('form-end-ts').value);
    if (!endChecked.ok) { setTimeInputError(endScope, endChecked.msg); return; }
    if (endChecked.ts <= startChecked.ts) { setTimeInputError(endScope, t('form.endAfterStart')); return; }
    setTimeInputError(endScope, '');
    const what = document.getElementById('form-what').value.trim();
    if (!what) { document.getElementById('form-what').focus(); return; }
    const ctag = document.getElementById('form-ctag').value.trim();
    const tag = canonicalTagName(ctag || formTag || RESERVED_UNKNOWN_TAG, deps.loadConfig());
    const expected = buildSplitPlan(panel, formBaseEntries);
    if (!expected || !expected.ok) {
      showInlineError(panel, expected && expected.message || t('form.backfillUnsavable'));
      paintTransactionPreview(panel, expected);
      return;
    }
    const { data: d, raw } = deps.loadSnapshot();
    const beforeData = { ...d, entries: cloneEntries(d.entries) };
    const latest = planSegmentSplit(d.entries, {
      sourceId: formSourceId,
      frozenStart: formFrozenStart,
      frozenEnd: formFrozenEnd,
      startTs: startChecked.ts,
      endTs: endChecked.ts,
      what,
      tags: [tag]
    }, { createId: planIdFactory() });
    if (!latest.ok) {
      showInlineError(panel, latest.message || t('form.sourceChanged'));
      paintTransactionPreview(panel, latest);
      return;
    }
    if (lastPreviewSignature && latest.resultSignature !== lastPreviewSignature) {
      formBaseEntries = cloneEntries(d.entries);
      lastPreviewSignature = latest.resultSignature;
      paintTransactionPreview(panel, latest);
      showInlineError(panel, t('form.previewRecomputed'));
      return;
    }
    d.entries = latest.resultEntries;
    const write = deps.saveChecked(d, raw);
    if (!write.ok) {
      showInlineError(panel, write.reason === 'concurrent' ? t('toast.concurrentWrite') : t('form.quotaForm'));
      return;
    }
    if (!rememberTagOrRollback(ctag, formBucket, d.entries, beforeData, panel, write.raw)) return;
    deps.setSelectedDate(startChecked.ts.slice(0, 10));
    teardownNow(() => { closeForm(); deps.render(); });
  }

  function getEditingBox(id = deps.getSheetEditId()) {
    return Array.from(document.querySelectorAll('.form-sheet-panel'))
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
    const { data: d, raw } = deps.loadSnapshot();
    const beforeData = { ...d, entries: cloneEntries(d.entries) };
    const entry = d.entries.find(e => e.id === id);
    const planned = Boolean(entry && entry.planned);
    const normalizedInputTs = normalizeTimestamp(tsEl ? tsEl.value : '');
    const checked = planned && entry && normalizedInputTs === entry.ts
      ? { ok: true, ts: normalizedInputTs }
      : validateTsForMode(tsEl ? tsEl.value : '', { planned });
    if (!checked.ok) {
      // R3：折叠态下报错要先展开触发行，否则错误文案落在看不见的容器里。
      expandEditTimeSection(box);
      const timeScope = box.querySelector('[data-role="edit-wheel"]') || box;
      setTimeInputError(timeScope, checked.msg);
      const focusEl = timeScope.querySelector('[data-role="text"], [data-role="date"]');
      if (focusEl) focusEl.focus();
      return;
    }
    setTimeInputError(box.querySelector('[data-role="edit-wheel"]') || box, '');
    const what = whatEl ? whatEl.value.trim() : '';
    if (!what) { if (whatEl) whatEl.focus(); return; }
    const sel = chipBox ? chipBox.querySelector('.chip.sel') : null;
    const ctag = customEl ? customEl.value.trim() : '';
    // v85：敲 `sleep` 而 config 里是 `Sleep` 时，记录存权威拼写——否则时间轴显示
    // `#sleep`、设置页显示 `Sleep`，同一个标签两副面孔。
    const tag = canonicalTagName(ctag || (sel ? sel.dataset.tag : RESERVED_UNKNOWN_TAG), deps.loadConfig());
    const conflict = findTimeConflict(d.entries, checked.ts, id);
    if (conflict) {
      showConflictError(box, conflict, checked.ts, 'use-conflict-plus-edit');
      return;
    }
    const endEl = box.querySelector('[data-role="edit-end-ts"]');
    const endModeEl = box.querySelector('[data-role="edit-end-mode"]');
    if (entry && !planned && endEl && endModeEl) {
      const expected = buildEditPlan(box, formBaseEntries);
      if (!expected || !expected.ok) {
        showInlineError(box, expected && expected.message || t('form.rangeUnsavable'));
        paintTransactionPreview(box, expected);
        return;
      }
      const latest = planIntervalEdit(d.entries, {
        id,
        startTs: checked.ts,
        endTs: endEl.value,
        endMode: endModeEl.value,
        what,
        tags: [tag]
      }, {
        todayKey: todayStr(),
        nowTs: nowStr(),
        createId: planIdFactory()
      });
      if (!latest.ok) {
        showInlineError(box, latest.message || t('form.boundaryChanged'));
        paintTransactionPreview(box, latest);
        return;
      }
      if (lastPreviewSignature && latest.resultSignature !== lastPreviewSignature) {
        formBaseEntries = cloneEntries(d.entries);
        lastPreviewSignature = latest.resultSignature;
        paintTransactionPreview(box, latest);
        showInlineError(box, t('form.previewRecomputed'));
        return;
      }
      d.entries = latest.resultEntries;
      const write = deps.saveChecked(d, raw);
      if (!write.ok) {
        showInlineError(box, write.reason === 'concurrent' ? t('toast.concurrentWrite') : t('form.quotaForm'));
        return;
      }
      if (!rememberTagOrRollback(ctag, editBucket, d.entries.filter(item => item.id !== id), beforeData, box, write.raw)) return;
    } else if (entry) {
      entry.ts = checked.ts;
      entry.what = what;
      entry.tags = [tag];
      if (planned) entry.planned = true;
      else delete entry.planned;
      normalizeEntries(d, { todayKey: todayStr(), createId: deps.uid });
      const write = deps.saveChecked(d, raw);
      if (!write.ok) {
        showInlineError(box, write.reason === 'concurrent' ? t('toast.concurrentWrite') : t('form.quotaForm'));
        return;
      }
      if (!rememberTagOrRollback(ctag, editBucket, d.entries.filter(item => item.id !== id), beforeData, box, write.raw)) return;
    }
    deps.setSelectedDate(checked.ts.slice(0, 10));
    teardownNow(() => { closeEditSheet(); deps.render(); });
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

  // R3：常规编辑的时间触发行展开——挂载 picker（若还没挂过）+ 揭开容器 + 更新
  // aria-expanded。commitEdit 校验失败时也调这个，确保折叠态下报错不会悄无声息。
  function expandEditTimeSection(panel) {
    const section = panel.querySelector('[data-role="edit-time-section"]');
    const intervalStart = panel.querySelector('[data-role="edit-start-wheel"]');
    if (section && intervalStart) {
      if (section.hidden) section.hidden = false;
      const trigger = panel.querySelector('[data-action="toggle-edit-start-time"]');
      if (trigger) trigger.setAttribute('aria-expanded', 'true');
      if (!sheetTimeMounted) mountEditIntervalPickers(panel);
      return;
    }
    const editWheel = panel.querySelector('[data-role="edit-wheel"]');
    const tsEl = panel.querySelector('[data-role="edit-ts"]');
    if (!section || !editWheel || !tsEl) return;
    if (!section.hidden) return;
    section.hidden = false;
    const trigger = panel.querySelector('[data-action="toggle-edit-start-time"]');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    mountTimePicker(editWheel, tsEl.value, v => { tsEl.value = v; });
    sheetTimeMounted = true;
  }

  function toggleEditStartTime(el) {
    const panel = el.closest('.form-sheet-panel');
    if (!panel) return;
    const section = panel.querySelector('[data-role="edit-time-section"]');
    if (!section) return;
    if (section.hidden) {
      expandEditTimeSection(panel);
      requestAnimationFrame(() => {
        const focusEl = section.querySelector('[data-role="text"], [data-role="date"], button, input, [tabindex]:not([tabindex="-1"])');
        if (focusEl) focusEl.focus({ preventScroll: true });
      });
    } else {
      section.hidden = true;
      el.setAttribute('aria-expanded', 'false');
    }
  }

  function pickEditEndMode(el) {
    const panel = el.closest('.form-sheet-panel');
    if (!panel || panel.dataset.mode !== 'edit') return;
    editEndMode = el.dataset.mode === 'now' ? 'now' : 'fixed';
    const modeEl = panel.querySelector('[data-role="edit-end-mode"]');
    const picker = panel.querySelector('[data-role="edit-end-picker"]');
    if (modeEl) modeEl.value = editEndMode;
    if (picker) picker.hidden = editEndMode === 'now';
    panel.querySelectorAll('[data-role="edit-end-mode-seg"] button').forEach(btn => {
      const selected = btn.dataset.mode === editEndMode;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
    if (editEndMode === 'fixed') {
      const endEl = panel.querySelector('[data-role="edit-end-ts"]');
      const mount = panel.querySelector('[data-role="edit-end-wheel"]');
      if (endEl && mount) mountTimePicker(mount, endEl.value, value => {
        endEl.value = value;
        updateEditRangeLabel(panel);
        refreshEditPreview(panel);
      });
    }
    updateEditRangeLabel(panel);
    refreshEditPreview(panel);
  }

  function handleFormInput(target) {
    const panel = target && target.closest && target.closest('.form-sheet-panel');
    if (!panel) return;
    if (panel.dataset.mode === 'edit') refreshEditPreview(panel);
    if (panel.dataset.mode === 'new' && formBackfill) refreshSplitPreview(panel);
    if (panel.dataset.mode === 'new' && formOvernightContext) refreshOvernightPreview(panel);
  }

  // SPEC-007：三组行（主线 / 维持 / 偏航）在同一个 saveTagConfig 里一起提交。
  // 主线行只有名称与 longOk（改桶/删除明确不做）；chip 行的桶来自分段控件的
  // .active 按钮而不是原生 <select>。历史迁移与 config 写入必须在**同一次
  // load()** 的对象图上完成（CLAUDE.md 写路径红线）。
  function readConfigRows(panel, kind) {
    // v82：待删除的行不参与改名/重名/桶判定——它保留在 DOM 里只是为了「撤销」，
    // 语义上已经不在这份配置里了。
    return Array.from(panel.querySelectorAll(`.cfg-row[data-kind="${kind}"]:not([data-pending-delete="1"])`)).map(row => {
      const seg = row.querySelector('.cfg-bucket-seg button.active');
      return {
        // v84：把行元素与输入框带出来——校验失败时要滚到**出问题的那一行**，
        // 而不是滚到挂在正文末尾的错误条（那会把用户甩到整页最底部）。
        el: row,
        input: row.querySelector('.cfg-name'),
        originalName: row.dataset.originalName || '',
        // v83：草稿行（还没落库过）没有 originalName，空名时的处置与已有行相反。
        isNew: row.dataset.new === '1',
        name: row.querySelector('.cfg-name').value.trim(),
        bucket: seg ? seg.dataset.bucket : '',
        longOk: row.querySelector('.cfg-long-ok').checked
      };
    });
  }

  // v85：两个名字只差大小写就是同一个标签，所以重名判定按 tagKey 折叠。返回第一组
  // 冲突（一次只处理一组——两组同时冲突时，解完一组再看下一组，比一次弹两个问题清楚）。
  function findNameClash(rows) {
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        if (tagKey(rows[i].name) === tagKey(rows[j].name)) return { rows: [rows[i], rows[j]] };
      }
    }
    return null;
  }

  /**
   * 合并计划：谁并进谁。**只有已落库的行才能当来源**——草稿行（还没保存过）与已有
   * 标签同名不是「要合并」，是「别建这个」，那种情况退回普通重名错误。
   * 方向判据：① 恰好一边被改名（用户把它改成了另一个的名字）→ 被改名的那个是来源；
   * ② 两边都没动（存量就是 `sleep` + `Sleep` 并存）→ 记录多的留下，少的并进去，
   * 平手取行序靠前的留下。签名带上条数，确认前后数据变了就要求重新确认。
   */
  function planTagMerge(clash, entries) {
    const [first, second] = clash.rows;
    const renamed = clash.rows.filter(row => row.originalName && tagKey(row.originalName) !== tagKey(row.name));
    let source = null;
    let target = null;
    if (renamed.length === 1) {
      source = renamed[0];
      target = clash.rows.find(row => row !== source);
    } else if (renamed.length === 0) {
      // 方向按**逐字**计数——两行折叠后属于同一个标签，用同一性计数会得出相同的数字，
      // 分不出谁该留下。用得多的那种拼写留下。
      const firstCount = countEntriesWithExactTag(entries, first.originalName);
      const secondCount = countEntriesWithExactTag(entries, second.originalName);
      target = secondCount > firstCount ? second : first;
      source = target === first ? second : first;
    }
    if (!source || !target || !source.originalName) return null;
    // 显示的是「会被改写多少条」，不是「来源名下有多少条」——已经是目标拼写的那些
    // 不动，算进去会夸大后果。
    const count = countEntriesNeedingRetag(entries, source.originalName, target.name);
    return {
      source,
      target,
      count,
      from: source.originalName,
      to: target.name,
      signature: `${source.originalName}→${target.name}#${count}`
    };
  }

  // 合并是**破坏性**动作（源标签消失、它的记录改归属），所以不能像普通校验那样只报
  // 一句话就算完：这里给出确切结果与一个显式的「合并」按钮，点了才执行。
  function showMergePrompt(panel, plan) {
    const box = panel.querySelector('[data-role="config-error"]');
    if (!box) return;
    box.replaceChildren();
    const text = document.createElement('div');
    text.textContent = t('config.mergePrompt', { from: plan.from, to: plan.to, n: plan.count });
    const actions = document.createElement('div');
    actions.className = 'cfg-defaults-actions';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'cell-action';
    confirm.dataset.action = 'confirm-tag-merge';
    confirm.dataset.signature = plan.signature;
    confirm.textContent = t('config.mergeConfirm');
    actions.appendChild(confirm);
    box.append(text, actions);
    box.hidden = false;
    if (plan.source.el && typeof plan.source.el.scrollIntoView === 'function') {
      plan.source.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function saveTagConfig(opts = {}) {
    const panel = document.querySelector('#form-sheet .form-sheet-panel');
    // 本次保存要被并掉的那一行（如果有）：它不参与改名、也不进最终的 config。
    let mergeSourceRow = null;
    let mergeTargetName = '';
    // v83：点了「新建标签」又没写名字的草稿行等于没建过，直接忽略；已有行的空名
    // 仍是错误（见下）。两者判据不同是有意的：前者从未落库，后者一旦丢掉就是删除。
    const mainlineRows = readConfigRows(panel, 'mainline').filter(row => row.name || !row.isNew);
    const chipRows = readConfigRows(panel, 'chip')
      .filter(row => row.name || !row.isNew)
      .filter(row => row.bucket === 'maintain' || row.bucket === 'leak');
    // v82：名称清空不再等于「悄悄删掉这一行」。那个隐式手势既不可发现，又会在
    // chip 有记录时静默把历史打成孤儿标签（统计当场变化）；删除现在只有一个显式
    // 入口，且只对零记录标签开放，所以空名一律当输入错误拦下。
    const all = [...mainlineRows, ...chipRows];
    const blank = all.find(row => !row.name);
    if (blank) {
      showInlineError(panel, t('config.emptyName'), 'config-error', blank.input);
      return;
    }
    // 「未知」是 unrecorded 桶的保留名（`bucketForTag` 直接判它未记录）：叫这个名字
    // 的标签会显示在某个桶的分组里、却按未记录统计。新建与改名同一处拦下。
    const reserved = all.find(row => row.name === RESERVED_UNKNOWN_TAG);
    if (reserved) {
      showInlineError(panel, t('config.reservedName', { name: RESERVED_UNKNOWN_TAG }), 'config-error', reserved.input);
      return;
    }
    const { data: d, raw } = deps.loadSnapshot();
    const beforeData = { ...d, entries: cloneEntries(d.entries) };
    // v85：重名判定跨三组一起做（主线与 chip 之间同名同样是冲突），且判据是 tagKey——
    // `sleep` 与 `Sleep` 是同一个标签。判严之后必须同时给出**出口**，否则本来就同时
    // 存有两种拼写的存量 config 会在每次保存时被拦死：出口就是合并。
    const clash = findNameClash(all);
    if (clash) {
      const plan = planTagMerge(clash, d.entries);
      if (!plan) {
        showInlineError(panel, t('config.duplicateName', { name: clash.rows[1].name }), 'config-error', clash.rows[1].input);
        return;
      }
      if (opts.confirmMerge !== plan.signature) {
        showMergePrompt(panel, plan);
        return;
      }
      mergeSourceRow = plan.source;
      mergeTargetName = plan.to;
    }
    // 删除的最终判据按**最新** load() 复算：sheet 打开期间另一个标签页给这个标签
    // 记了一条，删除就必须被拦下（渲染时的零记录判据已经过期）。
    const removedNames = Array.from(panel.querySelectorAll('.cfg-row[data-pending-delete="1"]'))
      .map(row => row.dataset.originalName || '')
      .filter(Boolean);
    const stillUsed = removedNames.find(name => countEntriesWithTag(d.entries, name));
    if (stillUsed) {
      // 待删除行的输入是 disabled，聚焦不了，只滚到行本身。标签名是用户输入，
      // 不能拼进选择器（引号/反斜杠会把它拆掉），按属性值逐个比对更稳。
      const row = Array.from(panel.querySelectorAll('.cfg-row[data-pending-delete="1"]'))
        .find(item => item.dataset.originalName === stillUsed);
      showInlineError(panel, t('config.deleteHasEntries', { name: stillUsed }), 'config-error');
      if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    let nextConfig = deps.loadConfig();
    // v85：合并——把来源标签的记录迁到目标名下，来源行随后不进最终 config。
    // 与改名共用 migrateEntryTags，同样落在**这一次** load() 的对象图上。
    if (mergeSourceRow) {
      migrateEntryTags(d.entries, mergeSourceRow.originalName, mergeTargetName);
    }
    // 主线改名：先算 config 变换，再在**同一张** entries 图上迁移历史。
    for (const row of mainlineRows) {
      if (row === mergeSourceRow) continue;
      if (row.originalName && row.originalName !== row.name) {
        nextConfig = renameMainlineTag(nextConfig, row.originalName, row.name);
        if (countEntriesWithTag(d.entries, row.originalName)) {
          migrateEntryTags(d.entries, row.originalName, row.name);
        }
      }
    }
    for (const chip of chipRows) {
      if (chip === mergeSourceRow) continue;
      if (chip.originalName && chip.originalName !== chip.name && countEntriesWithTag(d.entries, chip.originalName)) {
        migrateEntryTags(d.entries, chip.originalName, chip.name);
      }
    }
    // v83：主线数组直接按行重建——行序即 config.mainline 序，所以改名（行内新名）、
    // 删除（行不在）、新建（行在末尾）三件事一次落齐，新建的主线名因此排在历史末尾
    // 而**不会**顶掉当前主线（要当前得显式点「设为当前」）。残留的 mainlineLongOk
    // 由 normalizeConfig 清掉；chips 本就按行整体重建。
    nextConfig = {
      ...nextConfig,
      mainline: mainlineRows.filter(row => row !== mergeSourceRow).map(row => row.name),
      chips: chipRows.filter(chip => chip !== mergeSourceRow)
        .map(chip => ({ name: chip.name, bucket: chip.bucket, longOk: chip.longOk }))
    };
    // longOk 必须在主线数组定稿之后再写：setMainlineLongOk 只认已在 mainline 里的名字，
    // 新建行在上一步之前还不在其中。
    for (const row of mainlineRows) {
      if (row === mergeSourceRow) continue;
      nextConfig = setMainlineLongOk(nextConfig, row.name, row.longOk);
    }
    // 标签设置是长表单：若另一个标签页在打开期间写过 config，旧行状态不能继续
    // 参与这次重建，否则会静默抹掉对方的改名/分桶。先做一次便宜的前置检查，
    // 保存后再由 saveConfigChecked() 复核一次。
    if (deps.readConfigRaw() !== configRawAtOpen) {
      showInlineError(panel, t('toast.concurrentWrite'), 'config-error');
      return;
    }
    const write = deps.saveChecked(d, raw);
    if (!write.ok) {
      showInlineError(panel, write.reason === 'concurrent' ? t('toast.concurrentWrite') : t('config.quota'), 'config-error');
      return;
    }
    const configWrite = deps.saveConfigChecked(nextConfig, configRawAtOpen);
    if (!configWrite.ok) {
      // 配置写入失败时只在数据仍保持本次写入的原始值时回滚。无条件 save()
      // 会把另一标签页在这段窗口里追加的记录一起抹掉，反而制造第二次覆盖。
      const rollback = deps.saveChecked(beforeData, write.raw);
      if (!rollback.ok) {
        showInlineError(panel, t('io.importRollbackFailed'), 'config-error');
        return;
      }
      showInlineError(panel, configWrite.reason === 'concurrent' ? t('toast.concurrentWrite') : t('config.quota'), 'config-error');
      return;
    }
    // 删除生效后，还挂着的「撤销删除记录」会把引用这个标签的记录放回来——那条记录
    // 会当场变成孤儿标签（统计掉进未记录）。与跨标签页修改同一处理：撤销失效。
    if (removedNames.length && deps.cancelPendingUndo) deps.cancelPendingUndo();
    closeForm();
    deps.render();
  }

  // 「设为当前」立即落库并重开 sheet——它不产生记录变化，也不该被「保存」按钮
  // 的成败牵连；重开是为了让置顶顺序与徽章即时反映新状态。
  function setCurrentMainline(name) {
    const panel = document.querySelector('#form-sheet .form-sheet-panel');
    const { config, raw } = deps.loadConfigSnapshot();
    const write = deps.saveConfigChecked(storageSetCurrentMainline(config, name), raw);
    if (!write.ok) {
      showInlineError(panel, write.reason === 'concurrent' ? t('toast.concurrentWrite') : t('config.quota'), 'config-error');
      return;
    }
    openFormSheet({ mode: 'config' });
    deps.render();
  }

  // v82：删除是**待生效**状态而不是立刻抹掉那一行——行留在原地、变灰、按钮翻成
  // 「撤销」，所以这一步永远可逆，也不需要额外的确认弹层：真正的确认是 sheet 头部
  // 的「保存」，「取消」则整单作废。
  function toggleConfigRowDelete(btn) {
    const row = btn.closest('.cfg-row');
    if (!row) return;
    const wasPending = row.dataset.pendingDelete === '1';
    const name = row.dataset.originalName || '';
    if (wasPending) delete row.dataset.pendingDelete;
    else row.dataset.pendingDelete = '1';
    btn.textContent = wasPending ? t('cfg.delete') : t('cfg.undoDelete');
    btn.setAttribute('aria-label', wasPending
      ? t('cfg.deleteAria', { name })
      : t('cfg.undoDeleteAria', { name }));
    // 待删除行的输入全部禁用：既是视觉状态，也让 Tab 跳过一行已经不算数的控件。
    row.querySelectorAll('input, .cfg-bucket-seg button, .cfg-set-current')
      .forEach(el => { el.disabled = !wasPending; });
  }

  // v83：新建一行草稿标签。整张 sheet 不重渲染——重渲染会丢掉用户在别的行里
  // 还没保存的改名/勾选（同 v82 的待删除态，全部改动一起在「保存」落库）。
  function addConfigRow(btn) {
    const group = btn.closest('.cell-group');
    if (!group) return;
    btn.insertAdjacentHTML('beforebegin', renderConfigRowDraft(
      btn.dataset.kind || 'chip',
      btn.dataset.bucket || 'maintain',
      deps.loadConfig().longReview === true
    ));
    const input = btn.previousElementSibling && btn.previousElementSibling.querySelector('.cfg-name');
    if (input) {
      input.focus();
      if (typeof input.scrollIntoView === 'function') input.scrollIntoView({ block: 'nearest' });
    }
  }

  // 草稿行从未落库，所以「移除」就是把行拿掉——没有可撤销的东西，不必走 v82 的
  // 待删除态。
  function removeConfigDraftRow(btn) {
    const row = btn.closest('.cfg-row[data-new="1"]');
    if (row) row.remove();
  }

  function pickConfigBucket(btn) {
    const row = btn.closest('.cfg-row');
    const seg = btn.closest('.cfg-bucket-seg');
    if (!row || !seg) return;
    seg.querySelectorAll('button').forEach(item => {
      const on = item === btn;
      item.classList.toggle('active', on);
      item.setAttribute('aria-pressed', String(on));
    });
    // 竖脊即时跟随：结构与控件说同一件事。
    row.dataset.b = btn.dataset.bucket;
  }

  // D18 新增范围：给存量 config 一个拿到本语言默认标签的出口。只追加、同名跳过、
  // 先预览再落库；绝不做成自动行为或切语言时的弹窗（那会违反 SPEC-014 §1.5）。
  function previewLocaleDefaults() {
    openFormSheet({ mode: 'config', defaultsPreview: previewLocaleDefaultTags(deps.loadConfig()) });
  }

  function applyLocaleDefaults() {
    const panel = document.querySelector('#form-sheet .form-sheet-panel');
    const { config, raw } = deps.loadConfigSnapshot();
    const write = deps.saveConfigChecked(appendLocaleDefaultTags(config), raw);
    if (!write.ok) {
      showInlineError(panel, write.reason === 'concurrent' ? t('toast.concurrentWrite') : t('config.quota'), 'config-error');
      return;
    }
    openFormSheet({ mode: 'config' });
    deps.render();
  }

  function cancelLocaleDefaults() {
    openFormSheet({ mode: 'config' });
  }

  // 阶段格言（v69，C13）：三态归一化在 storage.normalizeConfig 里做（trim/60 字上限/
  // 恰等于默认→未设置），这里只负责把输入原样交给 saveConfig。空串会被保留为
  // 「显式隐藏」。
  function saveMotto() {
    const input = document.querySelector('#form-sheet [data-role="motto-input"]');
    if (!input) { closeForm(); return; }
    const { config, raw } = deps.loadConfigSnapshot();
    config.motto = input.value;
    const panel = input.closest('.form-sheet-panel');
    const write = deps.saveConfigChecked(config, raw);
    if (!write.ok) {
      showInlineError(panel, write.reason === 'concurrent' ? t('toast.concurrentWrite') : t('config.quota'), 'motto-error');
      return;
    }
    closeForm();
    deps.render();
  }

  function resetMottoInput() {
    const input = document.querySelector('#form-sheet [data-role="motto-input"]');
    if (!input) return;
    input.value = defaultMotto();
    input.focus();
  }

  registerSheetDismissGesture();

  return {
    openForm,
    openFormSheet,
    openBackupSheet,
    openAdvancedSheet,
    toggleLongReview,
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
    pickOvernightEndMode,
    useConflictPlusMinute,
    editConflictEntry,
    pickEditTag,
    commitEdit,
    saveEntry,
    autosizeTextareas,
    updateMainlineHint,
    syncCustomDraft,
    toggleStartTime,
    toggleEditStartTime,
    pickEditEndMode,
    handleFormInput,
    saveTagConfig,
    setCurrentMainline,
    pickConfigBucket,
    toggleConfigRowDelete,
    addConfigRow,
    removeConfigDraftRow,
    previewLocaleDefaults,
    applyLocaleDefaults,
    cancelLocaleDefaults,
    saveMotto,
    resetMottoInput,
    handleResponsiveResize
  };
}

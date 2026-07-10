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
  isPlaceholderEntry,
  normalizeEntries,
  openPlaceholderForDate,
  planIntervalEdit,
  planSegmentSplit
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
  let formTag = '';
  let formBucket = 'job';
  let editBucket = 'job';
  let formRecordMode = 'log';
  let formBackfill = false;
  let formBackfillEnd = '';
  let formBackfillKind = 'fill';
  let formSourceId = '';
  let formFrozenStart = '';
  let formFrozenEnd = '';
  let formBaseEntries = [];
  let formPlanIds = [];
  let lastPreviewSignature = '';
  let editEndMode = 'fixed';
  let configSnapshot = null;
  // 导航栈：config/help/import-shift 若从「更多」下钻进入，取消/保存回「更多」而非整层关闭。
  let returnToMore = false;
  // R1：sheet 关闭走 class 驱动过渡；未收尾前的清理函数存这里，供重入保护调用。
  let sheetCloseCleanup = null;

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

  function selectedTag(panel, prefix, fallback = '未知') {
    const custom = panel && panel.querySelector(prefix === 'edit' ? '[data-role="edit-custom-tag"]' : '#form-ctag');
    const root = panel && panel.querySelector(prefix === 'edit' ? '[data-role="edit-chips"]' : '#form-chips');
    const selected = root && root.querySelector('.chip.sel');
    return (custom && custom.value.trim()) || (selected && selected.dataset.tag) || (root ? '未知' : fallback) || '未知';
  }

  function paintTransactionPreview(panel, plan) {
    const preview = panel ? panel.querySelector('[data-role="interval-preview"]') : null;
    const limits = panel ? panel.querySelector('[data-role="edit-limits"], [data-role="backfill-limits"]') : null;
    if (limits) {
      const c = plan && (plan.context || plan.constraints);
      if (c) {
        const timeLabel = value => value && c.dayEndTs && value === c.dayEndTs ? '24:00' : hhmm(value);
        limits.textContent = `开始 ${timeLabel(c.startMin)}-${timeLabel(c.startMax)}（${c.startReason}）；结束 ${timeLabel(c.endMin)}-${timeLabel(c.endMax)}（${c.endReason}）`;
      } else if (formFrozenStart && formFrozenEnd) {
        limits.textContent = `最小 ${hhmm(formFrozenStart)}（原段起点）；最大 ${hhmm(formFrozenEnd)}（原段终点）`;
      }
    }
    if (!preview) return;
    preview.replaceChildren();
    const headline = document.createElement('div');
    headline.className = 'preview-head';
    if (!plan || !plan.ok) {
      headline.textContent = plan && plan.message || '请选择有效的起止时间。';
      headline.classList.add('is-error');
      preview.appendChild(headline);
      return;
    }
    if (plan.kind === 'segment-split') {
      headline.textContent = plan.mode === 'whole'
        ? '整段改为'
        : (plan.mode === 'edge' ? '贴边后为两段' : '切分后为三段');
    } else {
      headline.textContent = '保存后的边界';
    }
    preview.appendChild(headline);
    const roleNames = {
      previous: '前一段', current: '本段', next: '后一段',
      before: '前段', new: '新段', after: '后段'
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
      label.textContent = part.label || '未记录';
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

  function updateEditRangeLabel(panel) {
    const label = panel && panel.querySelector('[data-role="edit-start-label"]');
    const startEl = panel && panel.querySelector('[data-role="edit-ts"]');
    const endEl = panel && panel.querySelector('[data-role="edit-end-ts"]');
    const modeEl = panel && panel.querySelector('[data-role="edit-end-mode"]');
    if (!label || !startEl || !endEl || !modeEl) return;
    label.textContent = `${hhmm(startEl.value)}-${modeEl.value === 'now' ? '至今' : hhmm(endEl.value)}`;
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
    const mode = ['edit', 'help', 'config', 'import-shift', 'more', 'delete-confirm'].includes(requestedMode) ? requestedMode : 'new';
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
      formRecordMode = loadRecordModePref();
      formBackfill = Boolean(opts && opts.backfill);
      formBackfillEnd = (opts && opts.endTs) || '';
      formBackfillKind = (opts && opts.backfillKind) === 'split' ? 'split' : 'fill';
      formSourceId = (opts && opts.sourceId) || '';
      formFrozenStart = normalizeTimestamp((opts && opts.ts) || '');
      formFrozenEnd = normalizeTimestamp((opts && opts.endTs) || '');
      formBaseEntries = cloneEntries(loaded.entries);
      resetPlanIds();
      lastPreviewSignature = '';
      // Backfilling a known past gap is always an "already happened" record;
      // a leaked plan-mode pref would force a future ts and silently fail to save.
      if (isHistoryDate() || formBackfill) formRecordMode = 'log';
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
    const prevMode = sheet.hidden ? '' : (panel.dataset.mode || '');
    if (mode === 'config' || mode === 'help' || mode === 'import-shift') {
      if (prevMode === 'more') returnToMore = true;
      else if (prevMode !== mode) returnToMore = false;
    } else {
      returnToMore = false;
    }
    panel.dataset.mode = mode;
    // v43: 只有会召唤软键盘的表单（新建/编辑/标签设置）用定高高 sheet——内容从顶部流下、
    // 焦点控件滚到键盘上方，面板几何不随键盘变。不弹键盘的短 sheet（更多/说明/导入平移）
    // 保持内容自适应 bottom sheet，避免短菜单底部空一截。
    panel.classList.toggle('tall', mode === 'new' || mode === 'edit' || mode === 'config');
    if (mode === 'edit') panel.dataset.id = id;
    else delete panel.dataset.id;
    panel.innerHTML = renderFormSheet({
      mode,
      entry,
      config: deps.loadConfig(),
      entries: loaded.entries,
      importShiftHours: opts && opts.importShiftHours,
      importShiftHint: opts && opts.importShiftHint,
      targetDate: deps.state.selectedDate,
      isToday: deps.state.selectedDate === todayStr(),
      isHistoryDay: isHistoryDate(),
      backfill: Boolean(opts && opts.backfill),
      backfillKind: formBackfillKind,
      bucket: mode === 'edit' ? editBucket : formBucket,
      defaultBucket: formBucket,
      recordMode: formRecordMode,
      intervalContext: mode === 'edit'
        ? intervalEditContext(formBaseEntries, id, { todayKey: todayStr(), nowTs: nowStr() })
        : null,
      editEndMode,
      deletePlan: opts && opts.deletePlan,
      deleteEntry: opts && opts.deleteEntry,
      deleteStale: Boolean(opts && opts.deleteStale)
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
    sheet.classList.remove('sheet-closing');
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
    formBackfill = false;
    formBackfillEnd = '';
    formBackfillKind = 'fill';
    formSourceId = '';
    formFrozenStart = '';
    formFrozenEnd = '';
    formBaseEntries = [];
    formPlanIds = [];
    lastPreviewSignature = '';
    editEndMode = 'fixed';
    configSnapshot = null;
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
    if (returnToMore) {
      // 二级页返回「更多」：先 blur 让键盘收起预测在旧 DOM 上跑完，再原地重渲染。
      returnToMore = false;
      const active = document.activeElement;
      if (active && typeof active.blur === 'function') active.blur();
      openMoreSheet();
      return;
    }
    // Cancel/backdrop/Esc with the keyboard up had the same two-jump close as
    // the save paths (P14/P16); settle first, then tear down in one frame.
    teardownNow(() => {
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
      const selected = btn.dataset.mode === formRecordMode;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-pressed', String(selected));
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

  function showInlineError(scope, message, role = 'conflict-error') {
    const err = scope ? scope.querySelector(`[data-role="${role}"]`) : null;
    if (!err) return;
    err.textContent = String(message || '');
    err.hidden = false;
    // ④ A blocked ✓ must give feedback the user can actually see; the panel body
    // scrolls and the iOS keyboard can hide the lower half, so pull it into view.
    if (typeof err.scrollIntoView === 'function') {
      err.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function showConflictError(scope, conflict, ts, plusAction) {
    const err = scope ? scope.querySelector('[data-role="conflict-error"]') : null;
    if (!err) return;
    err.replaceChildren();
    const what = String(conflict && conflict.what || '未填写').replace(/\s+/g, ' ').slice(0, 36);
    err.append(document.createTextNode(`同一时刻已有“${what}”。`));
    const edit = document.createElement('button');
    edit.className = 'mini-btn';
    edit.type = 'button';
    edit.dataset.action = 'edit-conflict-entry';
    edit.dataset.id = String(conflict && conflict.id || '');
    edit.textContent = '编辑那条';
    const plus = document.createElement('button');
    plus.className = 'mini-btn';
    plus.type = 'button';
    plus.dataset.action = plusAction;
    plus.dataset.ts = ts;
    plus.textContent = '用+1min';
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
      hint.textContent = `「${value}」已是${BUCKETS[sameName.bucket]}标签，记录时仍按${BUCKETS[sameName.bucket]}归类。`;
      return;
    }
    const near = compact ? config.mainline.find(name => compactTagText(name) === compact && name !== value) : '';
    hint.textContent = near
      ? `可能已有相近标签「${near}」。留空可直接选历史 chip。`
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
        showConflictError(panel, conflict, checked.ts, 'use-conflict-plus-new');
        return;
      }
    }
    if (ctag) rememberTag(ctag, formBucket, d.entries);
    if (planned) {
      d.entries.push({ id: deps.uid(), ts: checked.ts, what, tags: [tag], planned: true });
      if (!deps.save(d)) {
        showInlineError(panel, '本机存储空间不足，表单内容仍保留；请先导出备份并清理空间。');
        return;
      }
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
    if (!deps.save(d)) {
      showInlineError(panel, '本机存储空间不足，表单内容仍保留；请先导出备份并清理空间。');
      return;
    }
    deps.setSelectedDate(checked.ts.slice(0, 10));
    teardownNow(() => { closeForm(); deps.render(); });
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
    const expected = buildSplitPlan(panel, formBaseEntries);
    if (!expected || !expected.ok) {
      showInlineError(panel, expected && expected.message || '这段时间无法补录，请检查起止时间。');
      paintTransactionPreview(panel, expected);
      return;
    }
    const d = deps.load();
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
      showInlineError(panel, latest.message || '原段已经变化，请重新确认。');
      paintTransactionPreview(panel, latest);
      return;
    }
    if (lastPreviewSignature && latest.resultSignature !== lastPreviewSignature) {
      formBaseEntries = cloneEntries(d.entries);
      lastPreviewSignature = latest.resultSignature;
      paintTransactionPreview(panel, latest);
      showInlineError(panel, '数据已变化，预览已按最新记录重新计算；请再次确认。');
      return;
    }
    d.entries = latest.resultEntries;
    if (!deps.save(d)) {
      showInlineError(panel, '本机存储空间不足，表单内容仍保留；请先导出备份并清理空间。');
      return;
    }
    if (ctag) rememberTag(ctag, formBucket, d.entries);
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
    const d = deps.load();
    const entry = d.entries.find(e => e.id === id);
    const planned = Boolean(entry && entry.planned);
    const checked = validateTsForMode(tsEl ? tsEl.value : '', {
      planned,
      dateKey: (tsEl && tsEl.value || '').slice(0, 10) || deps.state.selectedDate
    });
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
    const tag = ctag || (sel ? sel.dataset.tag : '未知');
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
        showInlineError(box, expected && expected.message || '这组起止时间无法保存。');
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
        showInlineError(box, latest.message || '记录边界已经变化，请重新确认。');
        paintTransactionPreview(box, latest);
        return;
      }
      if (lastPreviewSignature && latest.resultSignature !== lastPreviewSignature) {
        formBaseEntries = cloneEntries(d.entries);
        lastPreviewSignature = latest.resultSignature;
        paintTransactionPreview(box, latest);
        showInlineError(box, '数据已变化，预览已按最新记录重新计算；请再次确认。');
        return;
      }
      d.entries = latest.resultEntries;
      if (!deps.save(d)) {
        showInlineError(box, '本机存储空间不足，表单内容仍保留；请先导出备份并清理空间。');
        return;
      }
      if (ctag) rememberTag(ctag, editBucket, d.entries.filter(item => item.id !== id));
    } else if (entry) {
      entry.ts = checked.ts;
      entry.what = what;
      entry.tags = [tag];
      if (planned) entry.planned = true;
      else delete entry.planned;
      normalizeEntries(d, { todayKey: todayStr(), createId: deps.uid });
      if (!deps.save(d)) {
        showInlineError(box, '本机存储空间不足，表单内容仍保留；请先导出备份并清理空间。');
        return;
      }
      if (ctag) rememberTag(ctag, editBucket, d.entries.filter(item => item.id !== id));
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
    const mainlineCollision = rowStates.find(chip => snapshot.mainline.includes(chip.name));
    if (mainlineCollision) {
      showInlineError(panel, `“${mainlineCollision.name}”已经是主线标签，不能同时作为 chip。`, 'config-error');
      return;
    }
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
    if (!deps.save(d)) {
      showInlineError(panel, '本机存储空间不足，配置页内容仍保留；请先导出备份并清理空间。', 'config-error');
      return;
    }
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
    saveEntry,
    autosizeTextareas,
    updateMainlineHint,
    syncCustomDraft,
    toggleStartTime,
    toggleEditStartTime,
    pickEditEndMode,
    handleFormInput,
    saveTagConfig,
    handleResponsiveResize,
    getEditingBox
  };
}

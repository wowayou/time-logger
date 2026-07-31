// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
import { formatPercent, sortedEntriesFrom } from './stats.js';
import { t } from './i18n.js';
import { fmtDateTime, fmtMins, fmtPlainMins, fmtTs, hhmm, p2 } from './time.js';

// SPEC-012：sheet 关闭走 class 驱动的收起动画（sheet_controller.js
// animateSheetClose），最长 320ms 兜底才真正 hidden。这里的值必须和那个兜底
// 时长一致——这是时序协调，不是硬同步；将来 animateSheetClose 的动画时长若
// 改变，这个常量需要跟着改。
const SHEET_CLOSE_MS = 320;

function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createIoActions(deps) {
  let importShiftMinutes = 0;
  let pendingImport = null;
  let importResolutions = {};

  function viewName(view = deps.state.view) {
    return ({ day: t('period.day'), week: t('period.week'), month: t('period.month'), year: t('period.year') })[view] || view;
  }

  function currentViewTotals() {
    if (deps.state.view === 'day') return deps.computeDay().totals;
    const { start, end } = deps.periodRange();
    return deps.summarizeRange(start, end);
  }

  function mdInline(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
  }

  function statsParts(totals) {
    const jp = formatPercent(totals.job, totals.total);
    const mp = formatPercent(totals.maintain, totals.total);
    const lp = formatPercent(totals.leak, totals.total);
    const up = formatPercent(totals.unrecorded, totals.total);
    return { jp, mp, lp, up };
  }

  function dataDateRange() {
    const entries = sortedEntriesFrom(deps.load().entries);
    if (!entries.length) return t('io.noEntries');
    return `${fmtTs(entries[0].ts)} - ${fmtTs(entries[entries.length - 1].ts)}`;
  }

  function detailDurationLabel(mins, isOngoing, unrecorded, pendingConfirm) {
    const label = fmtPlainMins(mins);
    const notes = [];
    if (pendingConfirm) notes.push(t('io.notePending'));
    else if (unrecorded) notes.push(t('io.noteUnrecorded'));
    if (isOngoing) notes.push(t('io.noteOngoing'));
    return notes.length ? t('io.noteWrap', { label, notes: notes.join(t('io.noteJoin')) }) : label;
  }

  function currentViewDetailLines() {
    if (deps.state.view === 'day') {
      const day = deps.computeDay();
      if (!day.timeline.length) return [t('io.noLoggedRows')];
      return day.timeline.map(({ e, start, mins, isOngoing, unrecorded, pendingConfirm, tag }) => {
        const safeWhat = mdInline(e.what) || t('io.emptyWhat');
        const safeTag = mdInline(tag || t('tag.unknown'));
        return `- ${hhmm(start || e.ts)} | ${detailDurationLabel(mins, isOngoing, unrecorded, pendingConfirm)} | ${safeWhat} | #${safeTag}`;
      });
    }
    const rows = deps.summaryRows();
    if (!rows.length) return [t('io.noRows')];
    return rows.map(row => {
      const totals = deps.summarizeRange(row.rangeStart, row.rangeEnd);
      const { jp, mp, lp, up } = statsParts(totals);
      const totalText = totals.total ? fmtMins(totals.total) : t('io.noEntries');
      const pendingText = totals.pending ? t('io.rowPending', { dur: fmtPlainMins(totals.pending) }) : '';
      return t('io.rollupRow', { label: row.label, total: totalText, jp, mp, lp, up, pending: pendingText });
    });
  }

  function currentViewPlanLines() {
    if (deps.state.view !== 'day') return [];
    const day = deps.computeDay();
    return day.planned.map(entry => {
      const safeWhat = mdInline(entry.what) || t('io.emptyWhat');
      const safeTag = mdInline((entry.tags || [])[0] || t('tag.unknown'));
      return t('io.planRow', { time: hhmm(entry.ts), what: safeWhat, tag: safeTag });
    });
  }

  function buildCurrentViewSummaryMarkdown() {
    const totals = currentViewTotals();
    const { jp, mp, lp, up } = statsParts(totals);
    const totalEntries = deps.load().entries.length;
    const planLines = currentViewPlanLines();
    return [
      t('io.summaryTitle'),
      '',
      t('io.summaryMetaHead'),
      t('io.summaryGeneratedAt', { value: fmtDateTime(new Date()) }),
      t('io.summaryView', { value: viewName() }),
      t('io.summaryPeriod', { value: deps.periodFullLabel() }),
      t('io.summaryDataRange', { value: dataDateRange() }),
      t('io.summaryTotalEntries', { value: totalEntries }),
      '',
      t('io.summaryRatioHead'),
      t('io.summaryTotal', { value: fmtPlainMins(totals.total) }),
      t('io.summaryJob', { pct: jp, dur: fmtPlainMins(totals.job) }),
      t('io.summaryMaintain', { pct: mp, dur: fmtPlainMins(totals.maintain) }),
      t('io.summaryLeak', { pct: lp, dur: fmtPlainMins(totals.leak) }),
      t('io.summaryUnrecorded', { pct: up, dur: fmtPlainMins(totals.unrecorded) }),
      t('io.summaryPending', { value: fmtPlainMins(totals.pending || 0) }),
      '',
      t('io.summaryDetailHead'),
      ...currentViewDetailLines(),
      ...(planLines.length ? ['', t('io.summaryPlanHead'), ...planLines] : []),
      ''
    ].join('\n');
  }

  function setCopyFeedback(btn, ok, label, fallbackLabel) {
    if (!btn) return;
    const labelEl = btn.querySelector('[data-role="cell-label"]') || btn;
    labelEl.textContent = ok ? label : t('io.copyFailed');
    btn.classList.toggle('copied', ok);
    setTimeout(() => {
      labelEl.textContent = fallbackLabel;
      btn.classList.remove('copied');
    }, 2500);
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

  function resolvedTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
      return '';
    }
  }

  function exportMeta() {
    return {
      exportedAt: new Date().toISOString(),
      sourceTimezoneOffsetMinutes: new Date().getTimezoneOffset(),
      sourceTimeZone: resolvedTimeZone()
    };
  }

  function exportData() {
    const d = deps.load();
    const firstUsedDate = deps.readFirstUsedDate();
    return {
      ...d,
      version: 1,
      meta: exportMeta(),
      config: deps.loadConfig(),
      // 起始日只在存在时写入：空串会被 validateImportData 判为非法日期。
      ...(firstUsedDate ? { firstUsedDate } : {}),
      entries: sortedEntriesFrom(d.entries).map(entry => ({ ...entry }))
    };
  }

  function backupFileName() {
    const now = new Date();
    return `timelog-${now.getFullYear()}${p2(now.getMonth()+1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}.json`;
  }

  function copyJSON() {
    const json = JSON.stringify(exportData(), null, 2);
    copyText(json, document.getElementById('copy-btn'), t('io.copied'), t('io.copyJsonLabel'));
  }

  function copyCurrentViewSummary() {
    copyText(buildCurrentViewSummaryMarkdown(), document.getElementById('summary-btn'), t('io.copied'), t('io.copySummaryLabel'));
  }

  function bootDiagTime(epochMs) {
    const d = new Date(epochMs);
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }

  function bootDiagGap(gapMin) {
    if (!Number.isFinite(gapMin)) return t('diag.first');
    if (gapMin < 60) return `${gapMin}min`;
    return `${Math.floor(gapMin / 60)}h${p2(gapMin % 60)}m`;
  }

  // 启动诊断样本只含计时/布尔/缓存命中数/固定枚举 SW 态（storage.appendBootDiagSample
  // 的口径），这里只做排版；UA 有助于区分 Safari 与主屏 PWA 的行为差异，一并带上。
  function copyBootDiagnostics() {
    const { samples } = deps.readBootDiag();
    const lines = samples.map(s => [
      bootDiagTime(s.at),
      `v${s.ver || '?'}`,
      t('diag.gap', { value: bootDiagGap(s.gapMin) }),
      s.nav || 'navigate',
      t('diag.swControlled', { value: s.controlled ? t('diag.yes') : t('diag.no') }),
      s.sw ? t('diag.swState', { value: s.sw }) : '',
      t('diag.persisted', { value: s.persisted === true ? t('diag.yes') : s.persisted === false ? t('diag.no') : t('tag.unknown') }),
      s.cache ? t('diag.cache', { name: s.cache, files: s.cacheFiles, sets: s.cacheCount > 1 ? t('diag.cacheSets', { n: s.cacheCount }) : '' }) : t('diag.cacheNone'),
      `html ${s.htmlMs}ms`,
      t('diag.module', { ms: s.moduleMs }),
      Number.isFinite(s.fcpMs) && s.fcpMs >= 0 ? t('diag.fcp', { ms: s.fcpMs }) : '',
      t('diag.ready', { ms: s.readyMs }),
      s.standalone ? 'standalone' : t('diag.browser'),
      s.snapshot ? t('diag.snapshotHit') : t('diag.snapshotMiss')
    ].filter(Boolean).join(' · '));
    const text = [
      t('diag.title', { n: samples.length }),
      `- UA: ${navigator.userAgent}`,
      '',
      ...lines
    ].join('\n');
    copyText(text, document.getElementById('boot-diag-copy-btn'), t('io.copied'), t('io.copyBootDiagLabel'));
  }

  function backupArtifact() {
    const json = JSON.stringify(exportData(), null, 2);
    const fname = backupFileName();
    let file = null;
    try { file = new File([json], fname, { type: 'application/json' }); } catch {}
    return { json, fname, file };
  }

  function directDownloadBackup({ json, fname }) {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function prefersSystemFileSave() {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua)
      || (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints) > 1);
  }

  function canShareFile(file) {
    if (!file || !canUseSystemShare() || typeof navigator.canShare !== 'function') return false;
    try { return Boolean(navigator.canShare({ files: [file] })); } catch { return false; }
  }

  async function downloadJSON() {
    const artifact = backupArtifact();
    const btn = document.getElementById('backup-download-btn');
    // iOS Safari/主屏 PWA 对 Blob + a.download 可能只发起请求却不真正落盘，页面也
    // 没有完成事件可核实。文件分享面板能让用户明确选择「存储到文件」及目标目录。
    if (prefersSystemFileSave() && canShareFile(artifact.file)) {
      try {
        await navigator.share({ files: [artifact.file], title: t('io.backupShareTitle', { name: artifact.fname }) });
        setCopyFeedback(btn, true, t('io.saveDone'), t('io.saveLabel'));
        return;
      } catch (error) {
        // 用户取消代表明确不保存，不能偷偷回退成一个去向不明的浏览器下载。
        if (isShareCancellation(error)) return;
      }
    }
    directDownloadBackup(artifact);
    setCopyFeedback(btn, true, t('io.saveCheckDownloads'), t('io.saveLabel'));
  }

  function parseImportShiftHours(raw) {
    const value = String(raw || '').trim();
    if (!value) return 0;
    const hours = Number(value);
    return Number.isFinite(hours) ? Math.round(hours * 60) : 0;
  }

  function formatShiftHours(minutes) {
    const hours = minutes / 60;
    return Number.isInteger(hours) ? String(hours) : String(Number(hours.toFixed(2)));
  }

  function sourceOffsetMinutes(imported) {
    const value = imported && imported.meta && imported.meta.sourceTimezoneOffsetMinutes;
    const offset = Number(value);
    return Number.isFinite(offset) ? offset : null;
  }

  function timezoneOffsetLabel(offsetMinutes) {
    const utcOffset = -offsetMinutes;
    const sign = utcOffset >= 0 ? '+' : '-';
    const abs = Math.abs(utcOffset);
    const hours = Math.floor(abs / 60);
    const minutes = abs % 60;
    return `UTC${sign}${hours}${minutes ? `:${p2(minutes)}` : ''}`;
  }

  function suggestedShiftMinutes(imported) {
    const sourceOffset = sourceOffsetMinutes(imported);
    if (sourceOffset === null) return 0;
    return sourceOffset - new Date().getTimezoneOffset();
  }

  function importShiftHint(imported, suggestedMinutes) {
    const sourceOffset = sourceOffsetMinutes(imported);
    if (sourceOffset === null) {
      return t('io.shiftNoMeta');
    }
    const currentOffset = new Date().getTimezoneOffset();
    const sourceZone = imported.meta && imported.meta.sourceTimeZone ? ` ${imported.meta.sourceTimeZone}` : '';
    const base = t('io.shiftBase', { source: timezoneOffsetLabel(sourceOffset), zone: sourceZone, current: timezoneOffsetLabel(currentOffset) });
    if (!suggestedMinutes) return t('io.shiftNone', { base });
    return t('io.shiftSuggested', { base, hours: formatShiftHours(suggestedMinutes) });
  }

  function importJSON() {
    pendingImport = null;
    importShiftMinutes = 0;
    importResolutions = {};
    const fileInput = document.getElementById('import-file');
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
  }

  function cancelImportShift() {
    pendingImport = null;
    importShiftMinutes = 0;
    importResolutions = {};
    deps.closeForm();
  }

  function importConflictSide(label, entry) {
    const side = document.createElement('div');
    side.className = 'import-conflict-side';
    const role = document.createElement('div');
    role.className = 'import-conflict-role';
    role.textContent = label;
    const what = document.createElement('div');
    what.className = 'import-conflict-what';
    what.textContent = entry && entry.what ? entry.what : t('io.emptyWhatFull');
    const tag = entry && Array.isArray(entry.tags) && entry.tags[0] ? entry.tags[0] : t('io.noteUnrecorded');
    const meta = document.createElement('div');
    meta.className = 'import-conflict-meta';
    meta.textContent = t('io.conflictMeta', { ts: entry && entry.ts ? fmtTs(entry.ts) : t('io.unknownTime'), tag, planned: entry && entry.planned ? t('io.plannedSuffix') : '' });
    side.append(role, what, meta);
    return side;
  }

  function paintImportPlan(plan) {
    const summary = document.querySelector('#form-sheet [data-role="import-summary"]');
    const error = document.querySelector('#form-sheet [data-role="import-error"]');
    const confirm = document.getElementById('import-confirm-btn');
    const conflicts = plan && plan.conflicts || [];
    const resolvedCount = conflicts.filter(conflict => {
      const resolution = importResolutions[conflict.key];
      return resolution && resolution.signature === conflict.signature;
    }).length;
    const blocked = conflicts.length > resolvedCount;
    if (summary) {
      summary.classList.toggle('is-error', blocked);
      summary.textContent = !plan
        ? ''
        : conflicts.length
          ? t('io.conflictProgress', { n: conflicts.length, done: resolvedCount })
          : t('io.importablePlan', { imported: plan.imported || 0, skipped: plan.skipped || 0 });
    }
    if (confirm) {
      confirm.disabled = blocked;
      confirm.setAttribute('aria-disabled', String(blocked));
    }
    if (!error) return;
    error.replaceChildren();
    if (!conflicts.length) {
      error.hidden = true;
      return;
    }
    const intro = document.createElement('div');
    intro.className = 'import-conflict-intro';
    intro.textContent = t('io.conflictIntro');
    const list = document.createElement('div');
    list.className = 'import-conflict-list';
    conflicts.forEach((conflict, index) => {
      const card = document.createElement('section');
      card.className = 'import-conflict-card';
      const title = document.createElement('div');
      title.className = 'import-conflict-title';
      title.textContent = t('io.conflictTitle', { n: index + 1, kind: conflict.type === 'id' ? t('io.conflictTitleId') : t('io.conflictTitleTime') });
      const actions = document.createElement('div');
      actions.className = 'import-conflict-actions';
      actions.setAttribute('role', 'group');
      actions.setAttribute('aria-label', t('io.conflictActionsAria', { n: index + 1 }));
      const selected = importResolutions[conflict.key];
      [
        ['local', t('io.keepLocal')],
        ['incoming', t('io.useIncoming')],
        ['merge', t('io.mergeText')]
      ].forEach(([action, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.action = 'resolve-import-conflict';
        button.dataset.key = conflict.key;
        button.dataset.resolution = action;
        button.textContent = label;
        const active = selected && selected.signature === conflict.signature && selected.action === action;
        button.classList.toggle('active', Boolean(active));
        button.setAttribute('aria-pressed', String(Boolean(active)));
        actions.appendChild(button);
      });
      card.append(
        title,
        importConflictSide(t('io.sideIncoming'), conflict.incoming),
        importConflictSide(t('io.sideLocal'), conflict.local),
        actions
      );
      if (selected && selected.signature === conflict.signature && selected.action === 'merge') {
        const note = document.createElement('div');
        note.className = 'import-conflict-merge-note';
        note.textContent = t('io.mergeNote');
        card.appendChild(note);
      }
      list.appendChild(card);
    });
    error.append(intro, list);
    error.hidden = false;
  }

  function importPlan(imported, shiftMinutes) {
    return deps.mergeImportedEntries(deps.load(), imported.entries, { shiftMinutes });
  }

  function previewImportShift(raw) {
    if (!pendingImport) return;
    importShiftMinutes = parseImportShiftHours(raw);
    importResolutions = {};
    paintImportPlan(importPlan(pendingImport, importShiftMinutes));
  }

  function resolveImportConflict(key, action) {
    if (!pendingImport || !['local', 'incoming', 'merge'].includes(action)) return;
    const plan = importPlan(pendingImport, importShiftMinutes);
    const conflict = (plan.conflicts || []).find(item => item.key === key);
    if (!conflict) return;
    importResolutions[key] = { action, signature: conflict.signature };
    paintImportPlan(plan);
  }

  function applyImportedData(imported, shiftMinutes) {
    const current = deps.load();
    const plan = deps.mergeImportedEntries(current, imported.entries, { shiftMinutes, resolutions: importResolutions });
    if (!plan.ok) {
      const latest = deps.mergeImportedEntries(current, imported.entries, { shiftMinutes });
      importResolutions = {};
      paintImportPlan(latest);
      const error = document.querySelector('#form-sheet [data-role="import-error"]');
      if (error && plan.resolutionError) {
        const message = document.createElement('div');
        message.className = 'import-resolution-error';
        message.textContent = plan.resolutionError;
        error.prepend(message);
        error.hidden = false;
      }
      return false;
    }
    const currentConfig = deps.loadConfig();
    const nextConfig = deps.mergeImportedConfig(currentConfig, imported.config);
    if (!deps.save(plan.data)) {
      const error = document.querySelector('#form-sheet [data-role="import-error"]');
      if (error) {
        error.textContent = t('io.importQuota');
        error.hidden = false;
      }
      return false;
    }
    try {
      deps.saveConfig(nextConfig);
    } catch {
      deps.save(current);
      const error = document.querySelector('#form-sheet [data-role="import-error"]');
      if (error) {
        error.textContent = t('io.configSaveFailed');
        error.hidden = false;
      }
      return false;
    }
    // 记录与 config 都已落库后才接起始日：它单调不减且纯展示，失败不需要回滚。
    deps.adoptImportedFirstUsedDate(imported.firstUsedDate);
    deps.render();
    // SPEC-012：不在这里亮 toast——调用方（confirmImportShift）先关表单 sheet，
    // 等关闭动画收尾之后再显示，避免正在滑出的 sheet（z-index 更高）盖住 toast。
    return {
      imported: plan.imported,
      skipped: plan.skipped,
      resolvedConflicts: plan.resolvedConflicts || 0
    };
  }

  function confirmImportShift() {
    const input = document.getElementById('import-shift-hours');
    importShiftMinutes = parseImportShiftHours(input ? input.value : '0');
    const imported = pendingImport;
    if (!imported) return;
    const result = applyImportedData(imported, importShiftMinutes);
    if (!result) return;
    pendingImport = null;
    importResolutions = {};
    deps.closeForm();
    const message = t('io.importDone', { imported: result.imported, skipped: result.skipped, conflicts: result.resolvedConflicts });
    // SPEC-012：sheet 关闭动画播完（或 reduced-motion 下没有动画）之后才亮 toast，
    // 让它出现在一个干净的、没有 sheet 遮挡的屏幕上；而不是和 v73 一样在 sheet
    // 还在滑出时就亮起、被半透明遮罩盖过去。
    if (prefersReducedMotion()) deps.showInfoToast(message);
    else setTimeout(() => deps.showInfoToast(message), SHEET_CLOSE_MS);
  }

  function handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      let imported;
      try { imported = JSON.parse(e.target.result); }
      catch {
        deps.openFormSheet({ mode: 'import-shift', importEarlyError: t('io.parseFailed') });
        return;
      }
      const checked = deps.validateImportData(imported);
      if (!checked.ok) {
        deps.openFormSheet({ mode: 'import-shift', importEarlyError: checked.msg });
        return;
      }
      pendingImport = imported;
      importShiftMinutes = suggestedShiftMinutes(imported);
      importResolutions = {};
      deps.openFormSheet({
        mode: 'import-shift',
        importShiftHours: formatShiftHours(importShiftMinutes),
        importShiftHint: importShiftHint(imported, importShiftMinutes)
      });
      requestAnimationFrame(() => paintImportPlan(importPlan(imported, importShiftMinutes)));
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function canUseSystemShare() {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  }

  function isShareCancellation(error) {
    return Boolean(error && error.name === 'AbortError');
  }

  async function shareJSON() {
    // v43: 分享按钮常显（不再靠能力检测 reveal——那套在 footer→更多 迁移后时序丢失，
    // iOS 上卡在隐藏态，P24）。无 Web Share 能力时回退下载完整备份，保证永远不是死按钮。
    const artifact = backupArtifact();
    if (!canUseSystemShare()) {
      directDownloadBackup(artifact);
      return;
    }
    const btn = document.getElementById('backup-send-btn');
    if (canShareFile(artifact.file)) {
      try {
        await navigator.share({ files: [artifact.file], title: t('io.backupShareTitle', { name: artifact.fname }) });
        setCopyFeedback(btn, true, t('io.shareDone'), t('io.shareLabel'));
        return;
      } catch (error) {
        if (isShareCancellation(error)) return;
      }
    }
    try {
      await navigator.share({ title: t('io.backupShareTitle', { name: artifact.fname }), text: artifact.json });
      setCopyFeedback(btn, true, t('io.shareDone'), t('io.shareLabel'));
      return;
    } catch (error) {
      if (isShareCancellation(error)) return;
    }
    directDownloadBackup(artifact);
    setCopyFeedback(btn, true, t('io.downloadDone'), t('io.shareLabel'));
  }

  return {
    copyBootDiagnostics,
    copyCurrentViewSummary,
    copyJSON,
    downloadJSON,
    importJSON,
    cancelImportShift,
    confirmImportShift,
    handleImport,
    previewImportShift,
    resolveImportConflict,
    shareJSON
  };
}

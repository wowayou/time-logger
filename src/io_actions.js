// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
import { formatPercent, sortedEntriesFrom } from './stats.js';
import { fmtDateTime, fmtMins, fmtPlainMins, fmtTs, hhmm, p2 } from './time.js';

export function createIoActions(deps) {
  let importShiftMinutes = 0;
  let pendingImport = null;

  function viewName(view = deps.state.view) {
    return ({ day: '天', week: '周', month: '月', year: '年' })[view] || view;
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
    if (deps.state.view === 'day') {
      const day = deps.computeDay();
      if (!day.timeline.length) return ['- 无已发生记录'];
      return day.timeline.map(({ e, start, mins, isOngoing, unrecorded, pendingConfirm, tag }) => {
        const safeWhat = mdInline(e.what) || '未填写';
        const safeTag = mdInline(tag || '未知');
        return `- ${hhmm(start || e.ts)} | ${detailDurationLabel(mins, isOngoing, unrecorded, pendingConfirm)} | ${safeWhat} | #${safeTag}`;
      });
    }
    const rows = deps.summaryRows();
    if (!rows.length) return ['- 无记录'];
    return rows.map(row => {
      const totals = deps.summarizeRange(row.rangeStart, row.rangeEnd);
      const { jp, mp, lp, up } = statsParts(totals);
      const totalText = totals.total ? fmtMins(totals.total) : '无记录';
      const pendingText = totals.pending ? ` / 待确认 ${fmtPlainMins(totals.pending)}` : '';
      return `- ${row.label}: ${totalText}；主线 ${jp} / 维持 ${mp} / 漏损 ${lp} / 未记录 ${up}${pendingText}`;
    });
  }

  function currentViewPlanLines() {
    if (deps.state.view !== 'day') return [];
    const day = deps.computeDay();
    return day.planned.map(entry => {
      const safeWhat = mdInline(entry.what) || '未填写';
      const safeTag = mdInline((entry.tags || [])[0] || '未知');
      return `- ${hhmm(entry.ts)} | 计划 | ${safeWhat} | #${safeTag}`;
    });
  }

  function buildCurrentViewSummaryMarkdown() {
    const totals = currentViewTotals();
    const { jp, mp, lp, up } = statsParts(totals);
    const totalEntries = deps.load().entries.length;
    const planLines = currentViewPlanLines();
    return [
      '# 时间尺当前视图摘要',
      '',
      '## 元信息',
      `- 生成时间：${fmtDateTime(new Date())}`,
      `- 当前视图：${viewName()}`,
      `- 当前周期：${deps.periodFullLabel()}`,
      `- 数据起止日期：${dataDateRange()}`,
      `- 总记录数：${totalEntries}`,
      '',
      '## 当前视图统计比例',
      `- 总计：${fmtPlainMins(totals.total)}`,
      `- 主线：${jp}（${fmtPlainMins(totals.job)}）`,
      `- 维持：${mp}（${fmtPlainMins(totals.maintain)}）`,
      `- 漏损：${lp}（${fmtPlainMins(totals.leak)}）`,
      `- 未记录：${up}（${fmtPlainMins(totals.unrecorded)}）`,
      `- 待确认：${fmtPlainMins(totals.pending || 0)}`,
      '',
      '## 当前视图明细',
      ...currentViewDetailLines(),
      ...(planLines.length ? ['', '## 计划', ...planLines] : []),
      ''
    ].join('\n');
  }

  function setCopyFeedback(btn, ok, label, fallbackLabel) {
    if (!btn) return;
    btn.textContent = ok ? label : '复制失败';
    btn.classList.toggle('copied', ok);
    setTimeout(() => {
      btn.textContent = fallbackLabel;
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
    return {
      ...d,
      version: 1,
      meta: exportMeta(),
      config: deps.loadConfig(),
      entries: sortedEntriesFrom(d.entries).map(entry => ({ ...entry }))
    };
  }

  function backupFileName() {
    const now = new Date();
    return `timelog-${now.getFullYear()}${p2(now.getMonth()+1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}.json`;
  }

  function copyJSON() {
    const json = JSON.stringify(exportData(), null, 2);
    copyText(json, document.getElementById('copy-btn'), '✓ 已复制', '复制 JSON 备份');
  }

  function copyCurrentViewSummary() {
    copyText(buildCurrentViewSummaryMarkdown(), document.getElementById('summary-btn'), '✓ 已复制', '复制当前视图摘要');
  }

  function downloadJSON() {
    const json = JSON.stringify(exportData(), null, 2);
    const fname = backupFileName();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
      return '这个备份没有时区元信息，默认不平移；需要对齐双设备壁钟时可手动填写。';
    }
    const currentOffset = new Date().getTimezoneOffset();
    const sourceZone = imported.meta && imported.meta.sourceTimeZone ? ` ${imported.meta.sourceTimeZone}` : '';
    const base = `源设备 ${timezoneOffsetLabel(sourceOffset)}${sourceZone}，当前设备 ${timezoneOffsetLabel(currentOffset)}。`;
    if (!suggestedMinutes) return `${base} 默认不平移。`;
    return `${base} 已建议 ${formatShiftHours(suggestedMinutes)} 小时，可按需要改为 0。`;
  }

  function importJSON() {
    pendingImport = null;
    importShiftMinutes = 0;
    const fileInput = document.getElementById('import-file');
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
  }

  function cancelImportShift() {
    pendingImport = null;
    importShiftMinutes = 0;
    deps.closeForm();
  }

  function applyImportedData(imported, shiftMinutes) {
    const current = deps.mergeImportedEntries(deps.load(), imported.entries, { shiftMinutes });
    if (imported.config) {
      const currentConfig = deps.loadConfig();
      deps.saveConfig({
        mainline: [...currentConfig.mainline, ...(imported.config.mainline || [])],
        chips: [...currentConfig.chips, ...(imported.config.chips || [])]
      });
    }
    deps.save(current);
    deps.render();
    alert(`导入完成，共 ${current.entries.length} 条记录。`);
  }

  function confirmImportShift() {
    const input = document.getElementById('import-shift-hours');
    importShiftMinutes = parseImportShiftHours(input ? input.value : '0');
    const imported = pendingImport;
    pendingImport = null;
    deps.closeForm();
    if (!imported) return;
    applyImportedData(imported, importShiftMinutes);
  }

  function handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      let imported;
      try { imported = JSON.parse(e.target.result); }
      catch { alert('文件解析失败，请确认是有效的 JSON 文件。'); return; }
      const checked = deps.validateImportData(imported);
      if (!checked.ok) { alert(checked.msg); return; }
      pendingImport = imported;
      importShiftMinutes = suggestedShiftMinutes(imported);
      deps.openFormSheet({
        mode: 'import-shift',
        importShiftHours: formatShiftHours(importShiftMinutes),
        importShiftHint: importShiftHint(imported, importShiftMinutes)
      });
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function canUseSystemShare() {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  }

  function updateShareAvailability() {
    // id/data-action 去尽 "share" 令牌（backup-send-btn / send-backup）：本地双引擎
    // 复现证明代码渲染可见，真机仍消失＝页面外装饰性抑制；v41 保留子串 "share" 未规避，
    // 子串匹配的 cosmetic filter 照样命中（P24）。
    const btn = document.getElementById('backup-send-btn');
    if (!btn) return;
    const supported = canUseSystemShare();
    btn.hidden = !supported;
    btn.setAttribute('aria-disabled', supported ? 'false' : 'true');
  }

  function openMoreSheet() {
    deps.openFormSheet({
      mode: 'more',
      shareSupported: canUseSystemShare()
    });
  }

  function shareJSON() {
    if (!canUseSystemShare()) return;
    const json = JSON.stringify(exportData(), null, 2);
    const fname = backupFileName();
    if (navigator.canShare) {
      const file = new File([json], fname, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: `时间尺完整备份 ${fname}` }).catch(() => {});
        return;
      }
    }
    navigator.share({ title: `时间尺完整备份 ${fname}`, text: json }).catch(() => {});
  }

  return {
    buildCurrentViewSummaryMarkdown,
    copyCurrentViewSummary,
    copyJSON,
    downloadJSON,
    importJSON,
    cancelImportShift,
    confirmImportShift,
    handleImport,
    updateShareAvailability,
    openMoreSheet,
    shareJSON,
    exportData
  };
}

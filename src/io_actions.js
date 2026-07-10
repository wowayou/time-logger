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
    const labelEl = btn.querySelector('[data-role="cell-label"]') || btn;
    labelEl.textContent = ok ? label : '复制失败';
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
        await navigator.share({ files: [artifact.file], title: `时间尺完整备份 ${artifact.fname}` });
        setCopyFeedback(btn, true, '已完成存储', '存储备份');
        return;
      } catch (error) {
        // 用户取消代表明确不保存，不能偷偷回退成一个去向不明的浏览器下载。
        if (isShareCancellation(error)) return;
      }
    }
    directDownloadBackup(artifact);
    setCopyFeedback(btn, true, '请在下载项确认', '存储备份');
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

  function paintImportPlan(plan) {
    const summary = document.querySelector('#form-sheet [data-role="import-summary"]');
    const error = document.querySelector('#form-sheet [data-role="import-error"]');
    if (summary) {
      summary.textContent = plan
        ? `将导入 ${plan.imported || 0} 条，跳过 ${plan.skipped || 0} 条，冲突 ${(plan.conflicts || []).length} 条。`
        : '';
    }
    if (!error) return;
    error.replaceChildren();
    const conflicts = plan && plan.conflicts || [];
    if (!conflicts.length) {
      error.hidden = true;
      return;
    }
    const intro = document.createElement('div');
    intro.textContent = '存在冲突，本次导入尚未写入：';
    const list = document.createElement('ul');
    conflicts.slice(0, 8).forEach(conflict => {
      const item = document.createElement('li');
      item.textContent = conflict.message;
      list.appendChild(item);
    });
    if (conflicts.length > 8) {
      const item = document.createElement('li');
      item.textContent = `另有 ${conflicts.length - 8} 条冲突`;
      list.appendChild(item);
    }
    error.append(intro, list);
    error.hidden = false;
  }

  function importPlan(imported, shiftMinutes) {
    return deps.mergeImportedEntries(deps.load(), imported.entries, { shiftMinutes });
  }

  function applyImportedData(imported, shiftMinutes) {
    const current = deps.load();
    const plan = deps.mergeImportedEntries(current, imported.entries, { shiftMinutes });
    paintImportPlan(plan);
    if (!plan.ok) return false;
    const currentConfig = deps.loadConfig();
    const nextConfig = deps.mergeImportedConfig(currentConfig, imported.config);
    if (!deps.save(plan.data)) {
      const error = document.querySelector('#form-sheet [data-role="import-error"]');
      if (error) {
        error.textContent = '本机存储空间不足，导入没有执行；表单和原数据均已保留。';
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
        error.textContent = '标签配置保存失败，记录导入已回滚。';
        error.hidden = false;
      }
      return false;
    }
    deps.render();
    alert(`导入完成：新增 ${plan.imported} 条，跳过 ${plan.skipped} 条，冲突 0 条。`);
    return true;
  }

  function confirmImportShift() {
    const input = document.getElementById('import-shift-hours');
    importShiftMinutes = parseImportShiftHours(input ? input.value : '0');
    const imported = pendingImport;
    if (!imported) return;
    if (!applyImportedData(imported, importShiftMinutes)) return;
    pendingImport = null;
    deps.closeForm();
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
      requestAnimationFrame(() => paintImportPlan(importPlan(imported, importShiftMinutes)));
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function canUseSystemShare() {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  }

  function openMoreSheet() {
    deps.openFormSheet({ mode: 'more' });
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
        await navigator.share({ files: [artifact.file], title: `时间尺完整备份 ${artifact.fname}` });
        setCopyFeedback(btn, true, '已分享备份', '分享备份');
        return;
      } catch (error) {
        if (isShareCancellation(error)) return;
      }
    }
    try {
      await navigator.share({ title: `时间尺完整备份 ${artifact.fname}`, text: artifact.json });
      setCopyFeedback(btn, true, '已分享备份', '分享备份');
      return;
    } catch (error) {
      if (isShareCancellation(error)) return;
    }
    directDownloadBackup(artifact);
    setCopyFeedback(btn, true, '已下载备份', '分享备份');
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
    openMoreSheet,
    shareJSON,
    exportData
  };
}

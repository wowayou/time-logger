import { formatPercent, sortedEntriesFrom } from './stats.js';
import { fmtDateTime, fmtMins, fmtPlainMins, fmtTs, hhmm, p2 } from './time.js';
import { setButtonTip } from './ui.js';

export function createIoActions(deps) {
  let importShiftMinutes = 0;

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
      if (!day.timeline.length) return ['- 无记录'];
      return day.timeline.map(({ e, mins, isOngoing, unrecorded, pendingConfirm, tag }) => {
        const safeWhat = mdInline(e.what) || '未填写';
        const safeTag = mdInline(tag || '未知');
        return `- ${hhmm(e.ts)} | ${detailDurationLabel(mins, isOngoing, unrecorded, pendingConfirm)} | ${safeWhat} | #${safeTag}`;
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

  function buildCurrentViewSummaryMarkdown() {
    const totals = currentViewTotals();
    const { jp, mp, lp, up } = statsParts(totals);
    const totalEntries = deps.load().entries.length;
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

  function exportData() {
    const d = deps.load();
    return { ...d, config: deps.loadConfig(), entries: sortedEntriesFrom(d.entries).map(entry => ({ ...entry })) };
  }

  function backupFileName() {
    const now = new Date();
    return `timelog-${now.getFullYear()}${p2(now.getMonth()+1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}.json`;
  }

  function copyJSON() {
    const json = JSON.stringify(exportData(), null, 2);
    copyText(json, document.getElementById('copy-btn'), '✓ 已复制', '复制');
  }

  function copyCurrentViewSummary() {
    copyText(buildCurrentViewSummaryMarkdown(), document.getElementById('summary-btn'), '✓ 已复制', '摘要');
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

  function importJSON() {
    deps.openFormSheet({ mode: 'import-shift' });
  }

  function cancelImportShift() {
    deps.closeForm();
  }

  function confirmImportShift() {
    const input = document.getElementById('import-shift-hours');
    importShiftMinutes = parseImportShiftHours(input ? input.value : '0');
    deps.closeForm();
    const fileInput = document.getElementById('import-file');
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
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
      const current = deps.mergeImportedEntries(deps.load(), imported.entries, { shiftMinutes: importShiftMinutes });
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
    };
    reader.readAsText(file);
    event.target.value = '';
  }

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
    shareJSON,
    exportData
  };
}

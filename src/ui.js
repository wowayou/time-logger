import { fmtMins, hhmm, normalizeTimestamp } from './time.js';
import { formatPercent } from './stats.js';
import { SEEDS } from './storage.js';

export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function iconSvg(name) {
  const icons = {
    edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
    trash: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path>',
    check: '<path d="M20 6 9 17l-5-5"></path>',
    undo: '<path d="M9 14 4 9l5-5"></path>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[name] || ''}</svg>`;
}

export function setButtonTip(el, text, ariaLabel) {
  if (!el) return;
  el.dataset.tip = text;
  if (ariaLabel) el.setAttribute('aria-label', ariaLabel);
}

export function renderRuler(totals, hasItems, view) {
  const el = document.getElementById('ruler');
  if (!hasItems || !totals.total) {
    el.innerHTML = `<p class="muted-note">${view === 'day' ? '这一天还没有记录' : '这个范围还没有可统计记录'}</p>`;
    return;
  }
  const jp = formatPercent(totals.job, totals.total);
  const op = formatPercent(totals.other, totals.total);
  const up = formatPercent(totals.unrecorded, totals.total);
  el.innerHTML = `
    <div class="ruler-bar">
      <div style="flex:${totals.job};background:var(--accent)"></div>
      <div style="flex:${totals.other};background:var(--green)"></div>
      <div style="flex:${totals.unrecorded};background:var(--track)"></div>
    </div>
    <div class="ruler-text">
      <span><span class="dot" style="background:var(--accent)"></span>求职推进 ${jp}</span>
      <span><span class="dot" style="background:var(--green)"></span>其他 ${op}</span>
      <span><span class="dot" style="background:var(--track)"></span>未记录 ${up}</span>
      ${totals.pending ? `<span>待确认 ${fmtMins(totals.pending)}</span>` : ''}
      <span>${fmtMins(totals.total)}</span>
    </div>`;
}

export function timelineDurationLabel(mins, isOngoing, unrecorded, pendingConfirm) {
  if (pendingConfirm) return isOngoing ? `待确认 · 进行中 · ${fmtMins(mins)}` : `待确认 · ${fmtMins(mins)}`;
  if (unrecorded) return isOngoing ? '未记录（进行中）' : '未记录';
  return isOngoing ? `${fmtMins(mins)}（进行中）` : fmtMins(mins);
}

export function confirmSegmentLabel(startTs, endTs) {
  return normalizeTimestamp(startTs) && normalizeTimestamp(endTs) ? `确认 ${hhmm(startTs)}-${hhmm(endTs)}` : '确认这段';
}

export function renderTimeline(items, opts = {}) {
  const { editingId = null, sheetEditId = null, renderEditForm: renderEdit = renderEditForm } = opts;
  const el = document.getElementById('timeline');
  if (!items.length) {
    el.innerHTML = '<div class="empty-tip">点击上方「+ 记一条」开始记录，或切换日期查看历史。</div>';
    return;
  }
  el.innerHTML = [...items].reverse().map(({ e, mins, isOngoing, unrecorded, pendingConfirm, confirmable, tag, endTs }) => {
    if (editingId === e.id) return renderEdit(e);
    const tagClass = tag === '求职推进' ? '' : ' e-tag-g';
    const entryClass = sheetEditId === e.id ? 'entry sheet-editing' : 'entry';
    const durStr = timelineDurationLabel(mins, isOngoing, unrecorded, pendingConfirm);
    const confirmText = confirmSegmentLabel(e.ts, endTs);
    return `<div class="${entryClass}" data-id="${esc(e.id)}">
      <div class="e-body">
        <div class="e-time">${hhmm(e.ts)}</div>
        <div class="e-what">${esc(e.what)}</div>
        <div class="e-meta">
          ${tag ? `<span class="e-tag${tagClass}">#${esc(tag)}</span>` : ''}
          <span class="e-dur">${durStr}</span>
          ${confirmable ? `<button class="mini-btn" type="button" data-action="confirm-segment" data-id="${esc(e.id)}" data-end="${esc(endTs)}" data-tip="确认后按这个标签统计；相邻时间变化会自动失效。" aria-label="${esc(confirmText)}">${esc(confirmText)}</button>` : ''}
        </div>
      </div>
      <div class="e-btns">
        <button class="icon-btn" type="button" data-action="start-edit" data-id="${esc(e.id)}" data-tip="编辑记录" aria-label="编辑记录">${iconSvg('edit')}</button>
        <button class="icon-btn dbtn" type="button" data-action="delete-entry" data-id="${esc(e.id)}" data-tip="删除记录" aria-label="删除记录">${iconSvg('trash')}</button>
      </div>
    </div>`;
  }).join('');
}

export function renderSummaryRows(rows) {
  const el = document.getElementById('timeline');
  const html = rows.map(row => {
    const { totals } = row;
    const jp = formatPercent(totals.job, totals.total);
    const op = formatPercent(totals.other, totals.total);
    const up = formatPercent(totals.unrecorded, totals.total);
    return `<button class="sum-row" type="button" data-action="drill" data-date="${esc(row.key)}" data-view="${esc(row.targetView)}" data-tip="打开这一段的明细视图。" aria-label="打开 ${esc(row.label)} 明细">
      <div class="sum-top">
        <span class="sum-name">${esc(row.label)}</span>
        <span class="sum-total">${totals.total ? fmtMins(totals.total) : '无记录'}</span>
      </div>
      <div class="ruler-bar" style="margin-bottom:8px">
        <div style="flex:${totals.job};background:var(--accent)"></div>
        <div style="flex:${totals.other};background:var(--green)"></div>
        <div style="flex:${totals.unrecorded};background:var(--track)"></div>
      </div>
      <div class="sum-meta">
        <span>求职 ${jp}</span>
        <span>其他 ${op}</span>
        <span>未记录 ${up}</span>
        ${totals.pending ? `<span>待确认 ${fmtMins(totals.pending)}</span>` : ''}
      </div>
    </button>`;
  }).join('');
  el.innerHTML = `<div class="summary-list">${html || '<div class="empty-tip">没有可显示的汇总。</div>'}</div>`;
}

export function renderEditForm(e) {
  const tag = (e.tags || [])[0] || '';
  const isSeed = SEEDS.includes(tag);
  const tagClass = tag === '求职推进' ? '' : ' e-tag-g';
  const chips = SEEDS.map(t =>
    `<button class="chip${t === tag ? ' sel' : ''}" type="button" data-action="pick-edit-tag" data-tag="${esc(t)}" aria-label="选择标签：${esc(t)}">${esc(t)}</button>`
  ).join('');
  return `<div class="entry editing" data-id="${esc(e.id)}">
    <div class="e-body">
      <div class="edit-context">
        <div class="e-time">${hhmm(e.ts)}</div>
        <div class="e-what">${esc(e.what)}</div>
        <div class="e-meta">
          ${tag ? `<span class="e-tag${tagClass}">#${esc(tag)}</span>` : ''}
        </div>
      </div>
      <div class="fl">
        <div class="fl-label">时间（可改，补录用）</div>
        <input type="hidden" data-role="edit-ts" value="${esc(e.ts)}">
        <div data-role="edit-wheel"></div>
      </div>
      <div class="fl"><input type="text" class="inp edit-what-input" data-role="edit-what" value="${esc(e.what)}" placeholder="做了什么"></div>
      <div class="chips" data-role="edit-chips" style="margin-bottom:7px">${chips}</div>
      <input type="text" class="inp edit-tag-input" data-role="edit-custom-tag" value="${isSeed ? '' : esc(tag)}" placeholder="自定义标签">
      <div class="form-btns edit-actions">
        <button class="icon-btn save-btn" type="button" data-action="commit-edit" data-id="${esc(e.id)}" data-tip="保存修改" aria-label="保存修改">${iconSvg('check')}</button>
        <button class="icon-btn cancel-btn" type="button" data-action="cancel-edit" data-tip="取消编辑" aria-label="取消编辑">${iconSvg('undo')}</button>
      </div>
    </div>
  </div>`;
}

export function renderFormSheet(opts) {
  const mode = opts && opts.mode === 'edit' ? 'edit' : 'new';
  const e = opts && opts.entry;
  const isEdit = mode === 'edit';
  const tag = isEdit ? ((e.tags || [])[0] || '') : '';
  const isSeed = SEEDS.includes(tag);
  const chipAction = isEdit ? 'pick-edit-tag' : 'pick-form-tag';
  const chips = SEEDS.map(t =>
    `<button class="chip${t === tag ? ' sel' : ''}" type="button" data-action="${chipAction}" data-tag="${esc(t)}" aria-label="选择标签：${esc(t)}">${esc(t)}</button>`
  ).join('');
  const title = isEdit ? '编辑' : '记一条';
  const summary = isEdit
    ? `${hhmm(e.ts)}${tag ? ` · #${esc(tag)}` : ''}`
    : '记录新的时间去向';
  const whatText = isEdit ? (esc(e.what) || '未填写') : '补录或记录当前时刻';
  const saveAction = isEdit ? 'commit-edit' : 'save-entry';
  const saveId = isEdit ? ` data-id="${esc(e.id)}"` : '';
  const saveTip = isEdit ? '保存修改' : '保存记录';
  const saveLabel = isEdit ? '保存修改' : '保存时间记录';
  const tsInput = isEdit
    ? `<input type="hidden" data-role="edit-ts" value="${esc(e.ts)}">`
    : '<input type="hidden" id="form-ts">';
  const wheelMount = isEdit ? '<div data-role="edit-wheel"></div>' : '<div id="form-wheel-mount"></div>';
  const whatInput = isEdit
    ? `<input type="text" class="inp edit-what-input" data-role="edit-what" value="${esc(e.what)}" placeholder="做了什么">`
    : '<input type="text" class="inp" id="form-what" placeholder="写邮件 / 刷手机 / 准备面试…">';
  const chipWrap = isEdit
    ? `<div class="chips" data-role="edit-chips">${chips}</div>`
    : `<div class="chips" id="form-chips">${chips}</div>`;
  const customInput = isEdit
    ? `<input type="text" class="inp edit-tag-input" data-role="edit-custom-tag" value="${isSeed ? '' : esc(tag)}" placeholder="自定义标签">`
    : '<input type="text" class="inp" id="form-ctag" placeholder="自定义标签（可选，留空用上面选的）">';
  return `
    <div class="form-sheet-head">
      <div class="form-sheet-summary">
        <div class="form-sheet-title" id="form-sheet-title">${title} · ${summary}</div>
        <div class="form-sheet-what">${whatText}</div>
      </div>
      <div class="form-sheet-actions">
        <button class="icon-btn cancel-btn" type="button" data-action="${isEdit ? 'cancel-edit' : 'close-form'}" data-tip="${isEdit ? '取消编辑' : '取消记录'}" aria-label="${isEdit ? '取消编辑' : '取消新增记录'}">${iconSvg('undo')}</button>
        <button class="icon-btn save-btn" type="button" data-action="${saveAction}"${saveId} data-tip="${saveTip}" aria-label="${saveLabel}">${iconSvg('check')}</button>
      </div>
    </div>
    <div class="form-sheet-body">
      <div class="fl">
        <div class="fl-label">时间（可改，补录用）</div>
        ${tsInput}
        ${wheelMount}
      </div>
      <div class="fl">
        <div class="fl-label">做了什么</div>
        ${whatInput}
      </div>
      <div class="fl">
        <div class="fl-label">标签</div>
        ${chipWrap}
      </div>
      <div class="fl">
        <div class="fl-label">自定义标签</div>
        ${customInput}
      </div>
    </div>`;
}

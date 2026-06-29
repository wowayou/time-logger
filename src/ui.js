import { fmtMins, hhmm, normalizeTimestamp } from './time.js';
import { formatPercent } from './stats.js';
import {
  BUCKETS,
  BUCKET_ORDER,
  bucketForTag,
  chipGroups,
  loadConfig
} from './storage.js';

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
    undo: '<path d="M9 14 4 9l5-5"></path>',
    plus: '<path d="M12 5v14"></path><path d="M5 12h14"></path>',
    help: '<path d="M9.1 9a3 3 0 1 1 5.8 1c-.6 1.3-2.1 1.7-2.7 2.8"></path><path d="M12 17h.01"></path>',
    settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"></path><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 0 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 0 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 0 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1a2 2 0 0 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z"></path>'
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
  const parts = bucketParts(totals);
  el.innerHTML = `
    <div class="ruler-bar">
      ${parts.map(part => `<div style="flex:${part.value};background:var(${part.color})"></div>`).join('')}
    </div>
    <div class="ruler-text">
      ${parts.map(part => `<span><span class="dot" style="background:var(${part.color})"></span>${part.label} ${part.percent}</span>`).join('')}
      ${totals.pending ? `<span>待确认 ${fmtMins(totals.pending)}</span>` : ''}
      <span>${fmtMins(totals.total)}</span>
    </div>`;
}

export function bucketParts(totals) {
  const colors = {
    job: '--accent',
    maintain: '--maintain',
    leak: '--leak',
    unrecorded: '--track'
  };
  return BUCKET_ORDER.map(bucket => ({
    bucket,
    label: BUCKETS[bucket],
    value: totals[bucket] || 0,
    color: colors[bucket],
    percent: formatPercent(totals[bucket] || 0, totals.total)
  }));
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
    const tagClass = ` e-tag-${bucketForTag(tag)}`;
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
    const parts = bucketParts(totals);
    return `<button class="sum-row" type="button" data-action="drill" data-date="${esc(row.key)}" data-view="${esc(row.targetView)}" data-tip="打开这一段的明细视图。" aria-label="打开 ${esc(row.label)} 明细">
      <div class="sum-top">
        <span class="sum-name">${esc(row.label)}</span>
        <span class="sum-total">${totals.total ? fmtMins(totals.total) : '无记录'}</span>
      </div>
      <div class="ruler-bar" style="margin-bottom:8px">
        ${parts.map(part => `<div style="flex:${part.value};background:var(${part.color})"></div>`).join('')}
      </div>
      <div class="sum-meta">
        ${parts.map(part => `<span>${part.label} ${part.percent}</span>`).join('')}
        ${totals.pending ? `<span>待确认 ${fmtMins(totals.pending)}</span>` : ''}
      </div>
    </button>`;
  }).join('');
  el.innerHTML = `<div class="summary-list">${html || '<div class="empty-tip">没有可显示的汇总。</div>'}</div>`;
}

export function renderEditForm(e) {
  const tag = (e.tags || [])[0] || '';
  const config = loadConfig();
  const isKnownPickerTag = config.mainline.includes(tag) || config.chips.some(chip => chip.name === tag);
  const tagClass = ` e-tag-${bucketForTag(tag, config)}`;
  const chips = renderTagPicker('edit', tag, config);
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
      <div class="fl"><textarea class="inp ta edit-what-input" data-role="edit-what" rows="2" placeholder="做了什么">${esc(e.what)}</textarea></div>
      <div data-role="edit-chips" style="margin-bottom:7px">${chips}</div>
      <input type="text" class="inp edit-tag-input" data-role="edit-custom-tag" value="${isKnownPickerTag ? '' : esc(tag)}" placeholder="自定义主线标签">
      <div class="form-inline-error" data-role="conflict-error" hidden></div>
      <div class="form-btns edit-actions">
        <button class="icon-btn save-btn" type="button" data-action="commit-edit" data-id="${esc(e.id)}" data-tip="保存修改" aria-label="保存修改">${iconSvg('check')}</button>
        <button class="icon-btn cancel-btn" type="button" data-action="cancel-edit" data-tip="取消编辑" aria-label="取消编辑">${iconSvg('undo')}</button>
      </div>
    </div>
  </div>`;
}

export function renderFormSheet(opts) {
  if (opts && opts.mode === 'help') return renderHelpSheet();
  if (opts && opts.mode === 'config') return renderConfigSheet(opts.config || loadConfig());
  const mode = opts && opts.mode === 'edit' ? 'edit' : 'new';
  const e = opts && opts.entry;
  const isEdit = mode === 'edit';
  const tag = isEdit ? ((e.tags || [])[0] || '') : '';
  const config = loadConfig();
  const isKnownPickerTag = config.mainline.includes(tag) || config.chips.some(chip => chip.name === tag);
  const chips = renderTagPicker(isEdit ? 'edit' : 'form', tag, config);
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
    ? `<textarea class="inp ta edit-what-input" data-role="edit-what" rows="2" placeholder="做了什么">${esc(e.what)}</textarea>`
    : '<textarea class="inp ta" id="form-what" rows="2" placeholder="写邮件 / 刷手机 / 准备面试…"></textarea>';
  const chipWrap = isEdit
    ? `<div data-role="edit-chips">${chips}</div>`
    : `<div id="form-chips">${chips}</div>`;
  const customInput = isEdit
    ? `<input type="text" class="inp edit-tag-input" data-role="edit-custom-tag" list="mainline-tags" value="${isKnownPickerTag ? '' : esc(tag)}" placeholder="自定义主线标签">`
    : '<input type="text" class="inp" id="form-ctag" list="mainline-tags" placeholder="自定义主线标签（可选）">';
  const datalist = `<datalist id="mainline-tags">${config.mainline.map(name => `<option value="${esc(name)}"></option>`).join('')}</datalist>`;
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
        <div class="fl-label">自定义主线标签</div>
        ${customInput}
        ${datalist}
        <div class="form-hint" data-role="mainline-hint">自定义标签默认进入「主线」；与固定 chip 同名时按 chip 归类。</div>
      </div>
      <div class="form-inline-error" data-role="conflict-error" hidden></div>
    </div>`;
}

export function renderTagPicker(prefix, selectedTag, config = loadConfig()) {
  const action = prefix === 'edit' ? 'pick-edit-tag' : 'pick-form-tag';
  const groups = chipGroups(config);
  const mainline = config.mainline.map(name => ({ name, bucket: 'job' }));
  const section = (label, items) => items.length ? `
    <div class="chip-group">
      <div class="chip-group-label">${esc(label)}</div>
      <div class="chips">
        ${items.map(item => `<button class="chip chip-${item.bucket}${item.name === selectedTag ? ' sel' : ''}" type="button" data-action="${action}" data-tag="${esc(item.name)}" aria-label="选择标签：${esc(item.name)}">${esc(item.name)}</button>`).join('')}
      </div>
    </div>` : '';
  return [
    section('主线', mainline),
    section('维持', groups.maintain),
    section('漏损', groups.leak)
  ].join('');
}

export function renderHelpSheet() {
  return `
    <div class="form-sheet-head">
      <div class="form-sheet-summary">
        <div class="form-sheet-title" id="form-sheet-title">说明</div>
        <div class="form-sheet-what">打点模型、本地备份、4 桶统计</div>
      </div>
      <div class="form-sheet-actions">
        <button class="icon-btn cancel-btn" type="button" data-action="close-form" data-tip="关闭说明" aria-label="关闭说明">${iconSvg('undo')}</button>
      </div>
    </div>
    <div class="form-sheet-body help-body">
      <section><h2>怎么记</h2><p>点「+ 记一条」或「切换活动」只记录开始时刻；上一条到下一条之间的时间归上一条。</p></section>
      <section><h2>4 桶</h2><p>主线=求职推进和自定义主线；维持=睡觉、吃饭、通勤等必要消耗；漏损=逃避娱乐；未记录=未知、孤儿标签和待确认长段。</p></section>
      <section><h2>3 小时确认</h2><p>超过 3 小时的非睡觉片段先进入未记录；确认后才按标签统计。睡觉默认 longOk，不要求确认。</p></section>
      <section><h2>备份与合并</h2><p>复制、下载、分享、导入都是完整 JSON 备份；摘要只导出当前视图，适合贴给 AI。</p></section>
      <section><h2>双设备时区</h2><p>时间按设备壁钟保存，不做自动转换。导入时可整体平移 ±N 小时来对齐。</p></section>
    </div>`;
}

export function renderConfigSheet(config = loadConfig()) {
  const row = (chip, index) => `
    <div class="cfg-row" data-index="${index}">
      <input class="inp cfg-name" type="text" value="${esc(chip.name)}" aria-label="标签名称">
      <select class="inp cfg-bucket" aria-label="桶">
        <option value="maintain"${chip.bucket === 'maintain' ? ' selected' : ''}>维持</option>
        <option value="leak"${chip.bucket === 'leak' ? ' selected' : ''}>漏损</option>
      </select>
      <label class="cfg-long"><input type="checkbox" class="cfg-long-ok"${chip.longOk ? ' checked' : ''}> longOk</label>
      <button class="mini-btn" type="button" data-action="remove-config-chip">删除</button>
    </div>`;
  return `
    <div class="form-sheet-head">
      <div class="form-sheet-summary">
        <div class="form-sheet-title" id="form-sheet-title">标签配置</div>
        <div class="form-sheet-what">4 桶固定；修改 chip 后会影响历史统计归类</div>
      </div>
      <div class="form-sheet-actions">
        <button class="icon-btn cancel-btn" type="button" data-action="close-form" data-tip="取消配置" aria-label="取消配置">${iconSvg('undo')}</button>
        <button class="icon-btn save-btn" type="button" data-action="save-tag-config" data-tip="保存配置" aria-label="保存标签配置">${iconSvg('check')}</button>
      </div>
    </div>
    <div class="form-sheet-body config-body">
      <div class="form-hint">主线历史：${config.mainline.map(esc).join('、') || '无'}</div>
      <div class="cfg-list" data-role="config-chips">${config.chips.map(row).join('')}</div>
      <button class="btn-sec cfg-add" type="button" data-action="add-config-chip">+ 添加维持/漏损 chip</button>
      <div class="form-inline-error" data-role="config-error" hidden></div>
    </div>`;
}

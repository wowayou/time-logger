// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
import { fmtMins, hhmm, localDateTimeKey, normalizeTimestamp } from './time.js';
import { formatPercent } from './stats.js';
import {
  BUCKETS,
  BUCKET_ORDER,
  THEME_KEY,
  bucketForTag,
  chipGroups,
  countEntriesWithTag,
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
    // 新发现：「···」更多按钮此前是裸文本字形，与本图标体系并存。三个零长度、
    // round linecap 的描边线段各画成一个圆点——沿用现有 stroke-based 渲染管线
    // （.icon-btn svg 全局 fill:none/stroke-linecap:round），无需给这一个图标开 fill 例外。
    more: '<path d="M5 12h.01"></path><path d="M12 12h.01"></path><path d="M19 12h.01"></path>'
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
    const text = (hasItems && !totals.total && view === 'day')
      ? '今日有计划，不计入统计'
      : (view === 'day' ? '这一天还没有记录' : '这个范围还没有可统计记录');
    el.innerHTML = `<p class="muted-note">${text}</p>`;
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
  if (unrecorded) return isOngoing ? '未记录·进行中' : '未记录';
  return isOngoing ? `${fmtMins(mins)}（进行中）` : fmtMins(mins);
}

export function confirmSegmentLabel(startTs, endTs) {
  return normalizeTimestamp(startTs) && normalizeTimestamp(endTs) ? `确认 ${hhmm(startTs)}-${hhmm(endTs)}` : '确认这段';
}


export function renderTimeline(items, opts = {}) {
  const { sheetEditId = null, plannedItems = [] } = opts;
  const el = document.getElementById('timeline');
  const planned = (plannedItems || []).map(e => ({
    e,
    start: new Date(e.ts),
    mins: 0,
    isOngoing: false,
    unrecorded: false,
    pendingConfirm: false,
    confirmable: false,
    tag: (e.tags || [])[0] || '未知',
    endTs: '',
    planned: true
  }));
  const allItems = [...items, ...planned];
  if (!allItems.length) {
    el.innerHTML = '<div class="empty-tip">点击上方「+ 记一条」开始记录，或切换日期查看历史。</div>';
    return;
  }
  el.innerHTML = [...allItems].reverse().map(({ e, start, end, mins, isOngoing, unrecorded, pendingConfirm, confirmable, tag, endTs, planned: isPlanned }) => {
    if (isPlanned) {
      const displayTag = (e.tags || [])[0] || '未知';
      const tagClass = ` e-tag-${bucketForTag(displayTag)}`;
      return `<div class="entry planned" data-id="${esc(e.id)}">
        <div class="e-body">
          <div class="e-time">${hhmm(e.ts)}</div>
          <div class="e-what">${esc(e.what || '未填写')}</div>
          <div class="e-meta">
            <span class="e-tag e-tag-planned${tagClass}">计划·#${esc(displayTag)}</span>
          </div>
        </div>
        <div class="e-btns">
          <button class="icon-btn save-btn" type="button" data-action="confirm-planned" data-id="${esc(e.id)}" data-tip="标记为已发生" aria-label="标记计划为已发生">${iconSvg('check')}</button>
          <button class="icon-btn" type="button" data-action="start-edit" data-id="${esc(e.id)}" data-tip="编辑计划" aria-label="编辑计划">${iconSvg('edit')}</button>
          <button class="icon-btn dbtn" type="button" data-action="delete-entry" data-id="${esc(e.id)}" data-tip="删除计划" aria-label="删除计划">${iconSvg('trash')}</button>
        </div>
      </div>`;
    }
    if (!e) {
      const gapTs = localDateTimeKey(start);
      const gapEnd = localDateTimeKey(end);
      return `<div class="entry gap" data-gap-ts="${esc(gapTs)}">
        <div class="e-body">
          <div class="e-time">${hhmm(start)}</div>
          <div class="e-what">这一段还没记，要补吗？</div>
          <div class="e-meta">
            <span class="e-tag e-tag-unrecorded">#未记录</span>
            <span class="e-dur">${fmtMins(mins)}</span>
            <button class="mini-btn" type="button" data-action="backfill-seg" data-ts="${esc(gapTs)}" data-end="${esc(gapEnd)}" data-tip="在这段未记录时间补一条；结束会自动接回原状态。" aria-label="补录这段未记录时间">补一下</button>
          </div>
        </div>
      </div>`;
    }
    const isPlaceholder = typeof e.what === 'string' && e.what.trim() === '';
    // Only the live now-segment reads "进行中"; a middle/past placeholder (e.g.
    // left by a smart delete) is honestly just "未记录".
    const activePlaceholder = isPlaceholder && isOngoing;
    const displayTag = isPlaceholder ? '未记录' : tag;
    const tagClass = ` e-tag-${isPlaceholder ? 'unrecorded' : bucketForTag(tag)}`;
    const entryClass = `entry${isPlaceholder ? ' placeholder' : ''}${sheetEditId === e.id ? ' sheet-editing' : ''}`;
    const durStr = timelineDurationLabel(mins, isOngoing, unrecorded || isPlaceholder, pendingConfirm);
    const confirmText = confirmSegmentLabel(e.ts, endTs);
    const startLabel = start ? hhmm(start) : hhmm(e.ts);
    const segStartTs = start ? localDateTimeKey(start) : e.ts;
    const segEndTs = end ? localDateTimeKey(end) : '';
    const splitLabel = (isPlaceholder || unrecorded) ? '补一下' : '切一刀';
    const splitBtn = segEndTs
      ? `<button class="mini-btn" type="button" data-action="backfill-seg" data-ts="${esc(segStartTs)}" data-end="${esc(segEndTs)}" data-tip="在这段里补录或切分一段；结束自动接回原标签。" aria-label="在这段里补录或切分">${splitLabel}</button>`
      : '';
    return `<div class="${entryClass}" data-id="${esc(e.id)}">
      <div class="e-body">
        <div class="e-time">${startLabel}</div>
        <div class="e-what">${esc(isPlaceholder ? (activePlaceholder ? '进行中·还没记' : '未记录') : e.what)}</div>
        <div class="e-meta">
          ${displayTag ? `<span class="e-tag${tagClass}">#${esc(displayTag)}</span>` : ''}
          <span class="e-dur">${durStr}</span>
          ${confirmable ? `<button class="mini-btn" type="button" data-action="confirm-segment" data-id="${esc(e.id)}" data-end="${esc(endTs)}" data-tip="确认后按这个标签统计；相邻时间变化会自动失效。" aria-label="${esc(confirmText)}">${esc(confirmText)}</button>` : ''}
          ${splitBtn}
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

export function bucketHint(bucket) {
  if (bucket === 'maintain') return '自定义标签将归入「维持」；与固定 chip 同名时按 chip 归类。';
  if (bucket === 'leak') return '自定义标签将归入「漏损」；与固定 chip 同名时按 chip 归类。';
  return '自定义标签将归入「主线」；与固定 chip 同名时按 chip 归类。';
}

export function renderBucketSeg(prefix, selectedBucket) {
  const action = prefix === 'edit' ? 'pick-edit-bucket' : 'pick-form-bucket';
  const buckets = ['job', 'maintain', 'leak'];
  return `<div class="seg bucket-seg" data-role="${prefix}-bucket-seg" role="group" aria-label="归类桶">
    ${buckets.map(bucket => `<button type="button" data-action="${action}" data-bucket="${bucket}" class="${bucket === selectedBucket ? 'active' : ''}" aria-label="${esc(BUCKETS[bucket])}">${esc(BUCKETS[bucket])}</button>`).join('')}
  </div>`;
}

export function renderRecordModeSeg(selectedMode = 'log') {
  return `<div class="seg record-mode-seg" data-role="record-mode-seg" role="group" aria-label="记录模式">
    <button type="button" data-action="pick-record-mode" data-mode="log" class="${selectedMode === 'log' ? 'active' : ''}" aria-label="记录已发生">已发生</button>
    <button type="button" data-action="pick-record-mode" data-mode="plan" class="${selectedMode === 'plan' ? 'active' : ''}" aria-label="记录计划中">计划中</button>
  </div>`;
}

// C 语法 sheet 头：抓手条 + 左取消/右完成文字按钮 + 居中标题。
// 可见文字按钮不加 data-tip（红线：文字按钮不强制 tooltip）。
export function sheetHead({ title, cancelText, cancelAction, cancelAria, doneText = '', doneAction = '', doneAria = '', doneId = '' }) {
  const done = doneText
    ? `<button class="sh-done" type="button" data-action="${doneAction}"${doneId} aria-label="${esc(doneAria || doneText)}">${esc(doneText)}</button>`
    : '<span class="sh-spacer" aria-hidden="true"></span>';
  return `
    <div class="sh-grab" aria-hidden="true"></div>
    <div class="form-sheet-head sh-head">
      <button class="sh-cancel" type="button" data-action="${cancelAction}" aria-label="${esc(cancelAria || cancelText)}">${esc(cancelText)}</button>
      <div class="sh-title" id="form-sheet-title">${title}</div>
      ${done}
    </div>`;
}

const cellChevron = '<span class="cell-chevron" aria-hidden="true">›</span>';

// 与 sw.js CACHE / manifest version 同步（project_audit.py 校验）；真机核对版本用。
export const APP_VERSION = '46';

export function renderMoreSheet(opts = {}) {
  let themePref = 'auto';
  try { themePref = localStorage.getItem(THEME_KEY) || 'auto'; } catch {}
  const themeBtn = (value, label) =>
    `<button type="button" data-action="theme" data-theme="${value}" class="${themePref === value ? 'active' : ''}" aria-label="主题：${label}">${label}</button>`;
  return `
    ${sheetHead({ title: '更多', cancelText: '关闭', cancelAction: 'close-form', cancelAria: '关闭更多菜单' })}
    <div class="form-sheet-body more-body">
      <div class="cell-group">
        <button class="cell-btn" id="summary-btn" type="button" data-action="copy-summary" aria-label="复制当前视图摘要">复制当前视图摘要${cellChevron}</button>
      </div>
      <div class="form-hint">摘要只含当前视图，可贴给 AI；下面四项均为完整 JSON 备份，全部在本机完成。</div>
      <div class="cell-group">
        <button class="cell-btn" id="copy-btn" type="button" data-action="copy-json" aria-label="复制完整 JSON 备份">复制 JSON 备份${cellChevron}</button>
        <button class="cell-btn" type="button" data-action="download-json" aria-label="下载 JSON 备份">下载备份${cellChevron}</button>
        <button class="cell-btn" type="button" data-action="import-json" aria-label="导入 JSON 备份">导入备份${cellChevron}</button>
        <button class="cell-btn" id="backup-send-btn" type="button" data-action="send-backup" aria-label="分享 JSON 备份">分享备份${cellChevron}</button>
      </div>
      <div class="cell-group">
        <button class="cell-btn" type="button" data-action="open-tag-config" aria-label="配置标签">标签高级设置${cellChevron}</button>
        <div class="cell-row"><span>主题</span>
          <div class="seg theme-seg" id="theme-seg" role="group" aria-label="主题">
            ${themeBtn('auto', '自动')}${themeBtn('light', '亮色')}${themeBtn('dark', '暗色')}
          </div>
        </div>
        <button class="cell-btn" type="button" data-action="open-help" aria-label="打开说明">说明${cellChevron}</button>
      </div>
      <div class="app-version">时间尺 v${APP_VERSION}</div>
    </div>`;
}

export function renderFormSheet(opts) {
  if (opts && opts.mode === 'help') return renderHelpSheet();
  if (opts && opts.mode === 'config') return renderConfigSheet(opts.config || loadConfig(), opts);
  if (opts && opts.mode === 'import-shift') return renderImportShiftDialog(opts);
  if (opts && opts.mode === 'more') return renderMoreSheet(opts);
  const mode = opts && opts.mode === 'edit' ? 'edit' : 'new';
  const e = opts && opts.entry;
  const isEdit = mode === 'edit';
  const isToday = !opts || opts.isToday !== false;
  const isHistoryDay = Boolean(opts && opts.isHistoryDay);
  const targetDate = opts && opts.targetDate;
  const daySummary = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetDate || '');
    return m ? `${Number(m[2])}月${Number(m[3])}日` : '这一天';
  })();
  const tag = isEdit ? ((e.tags || [])[0] || '') : '';
  const config = loadConfig();
  const bucket = opts && opts.bucket ? opts.bucket : (isEdit ? bucketForTag(tag, config) : (opts && opts.defaultBucket) || 'job');
  const recordMode = opts && opts.recordMode ? opts.recordMode : 'log';
  const isPlan = !isEdit && !isHistoryDay && recordMode === 'plan';
  const isBackfill = !isEdit && Boolean(opts && opts.backfill);
  const isEditPlanned = isEdit && e && e.planned;
  const isKnownPickerTag = config.mainline.includes(tag) || config.chips.some(chip => chip.name === tag);
  const bucketSeg = renderBucketSeg(isEdit ? 'edit' : 'form', bucket);
  const chips = renderTagPicker(isEdit ? 'edit' : 'form', tag, config, bucket);
  const recordModeSeg = isEdit || isHistoryDay || isBackfill ? '' : renderRecordModeSeg(recordMode);
  const title = isEdit ? '编辑' : (isBackfill ? '补录' : (isPlan ? '计划' : (isToday ? '记一条' : '补记')));
  const summary = isEdit
    ? `${hhmm(e.ts)}${tag ? ` · #${esc(tag)}` : ''}`
    : (isBackfill ? daySummary : (isPlan ? daySummary : (isToday ? '刚才这一阵' : daySummary)));
  const whatText = isEdit
    ? (esc(e.what) || '未填写')
    : (isBackfill ? '写下这一段做了什么' : (isPlan ? '写下计划要做什么' : (isToday ? '写下刚才做了什么' : '写下这一段做了什么')));
  const whatFieldLabel = isPlan || isEditPlanned ? '计划做什么' : '做了什么';
  const whatPlaceholder = isPlan || isEditPlanned ? '准备面试 / 写方案…' : (isEdit ? '做了什么' : '写邮件 / 刷手机 / 准备面试…');
  const saveAction = isEdit ? 'commit-edit' : 'save-entry';
  const saveId = isEdit ? ` data-id="${esc(e.id)}"` : '';
  const saveLabel = isEdit ? '保存修改' : '保存时间记录';
  const tsInput = isEdit
    ? `<input type="hidden" data-role="edit-ts" value="${esc(e.ts)}">`
    : '<input type="hidden" id="form-ts">';
  const whatInput = isEdit
    ? `<textarea class="inp ta edit-what-input" data-role="edit-what" rows="2" placeholder="${esc(whatPlaceholder)}">${esc(e.what)}</textarea>`
    : `<textarea class="inp ta" id="form-what" rows="2" placeholder="${esc(whatPlaceholder)}"></textarea>`;
  const chipWrap = isEdit
    ? `<div data-role="edit-chips">${chips}</div>`
    : `<div id="form-chips">${chips}</div>`;
  const customInput = isEdit
    ? `<input type="text" class="inp edit-tag-input" data-role="edit-custom-tag" list="mainline-tags" value="${isKnownPickerTag ? '' : esc(tag)}" placeholder="自定义标签">`
    : '<input type="text" class="inp" id="form-ctag" list="mainline-tags" placeholder="自定义标签（可选）">';
  const datalist = `<datalist id="mainline-tags">${config.mainline.map(name => `<option value="${esc(name)}"></option>`).join('')}</datalist>`;
  const tagBlock = `
      <div class="fl">
        <div class="fl-label">归类</div>
        ${bucketSeg}
      </div>
      <div class="fl">
        <div class="fl-label">标签</div>
        ${chipWrap}
      </div>
      <div class="fl">
        <div class="fl-label">自定义标签</div>
        ${customInput}
        ${datalist}
        <div class="form-hint" data-role="mainline-hint">${bucketHint(bucket)}</div>
      </div>`;
  // R3：常规编辑（非计划）的时间滚轮默认折叠为触发行——多数编辑只改文字/标签，
  // 常驻展开的滚轮是噪音；点触发行才展开，与新建态「开始时间」触发行形态一致。
  // 计划编辑（isEditPlanned）沿用「计划时间（可改）」始终展开，改动概率高、无需折叠。
  const editStartLabel = e && normalizeTimestamp(e.ts) ? hhmm(e.ts) : '--:--';
  const editTimeSection = isEditPlanned
    ? `
      <div class="fl">
        <div class="fl-label">计划时间（可改）</div>
        ${tsInput}
        <div data-role="edit-wheel"></div>
      </div>
      <div class="form-inline-error" data-role="conflict-error" hidden></div>`
    : `
      <div class="fl">
        <div class="fl-label">开始时间</div>
        ${tsInput}
        <div class="form-time-row" data-role="edit-time-row">
          <button class="start-time-trigger" type="button" data-action="toggle-edit-start-time" aria-expanded="false" aria-label="修改开始时间"><span data-role="edit-start-label">${esc(editStartLabel)}</span></button>
        </div>
        <div class="fl start-time-section" data-role="edit-time-section" hidden>
          <div data-role="edit-wheel"></div>
        </div>
      </div>
      <div class="form-inline-error" data-role="conflict-error" hidden></div>`;
  const editBody = `
      ${editTimeSection}
      <div class="fl">
        <div class="fl-label">${whatFieldLabel}</div>
        ${whatInput}
      </div>
      ${tagBlock}
      ${isEdit ? `<button class="cell-danger" type="button" data-action="delete-entry" data-id="${esc(e.id)}" aria-label="删除这条${isEditPlanned ? '计划' : '记录'}">删除这条${isEditPlanned ? '计划' : '记录'}</button>` : ''}`;
  const backfillTimeSection = `
      <input type="hidden" id="form-ts">
      <input type="hidden" id="form-end-ts">
      <div class="fl backfill-time">
        <div class="fl-label">开始</div>
        <div data-role="backfill-start-mount"></div>
      </div>
      <div class="fl backfill-time">
        <div class="fl-label">结束</div>
        <div data-role="backfill-end-mount"></div>
        <div class="form-hint" data-role="backfill-duration"></div>
      </div>
      <div class="form-hint">在这段里补录/切分一段；结束之后自动接回原来的状态，其它段不受影响。</div>
      <div class="form-inline-error" data-role="conflict-error" hidden></div>`;
  const logTimeSection = `
      ${recordModeSeg}
      <input type="hidden" id="form-ts">
      <div class="form-time-row"${isPlan ? ' hidden' : ''} data-role="log-time-row">
        <button class="start-time-trigger" type="button" data-action="toggle-start-time" aria-expanded="false" aria-label="修改起点时间"><span data-role="start-time-label">--:--</span></button>
        <span class="form-time-arrow">→ <span data-role="end-label">现在</span> · 已 <span data-role="duration-label">--</span></span>
      </div>
      <div class="fl${isPlan ? '' : ' hidden'}" data-role="plan-time-row">
        <div class="fl-label">计划时间</div>
        <div data-role="form-wheel-mount"></div>
        <div class="form-hint">计划是未来的事；要记现在或过去的，切到「已发生」。</div>
      </div>
      <div class="form-inline-error" data-role="conflict-error" hidden></div>
      <div class="fl start-time-section" data-role="start-time-section" hidden>
        <div data-role="form-wheel-mount"></div>
      </div>`;
  const newBody = `
      ${isBackfill ? backfillTimeSection : logTimeSection}
      <div class="fl">
        <div class="fl-label" data-role="what-label">${whatFieldLabel}</div>
        ${whatInput}
      </div>
      ${tagBlock}`;
  return `
    ${sheetHead({
      title: `${title} · ${summary}`,
      cancelText: '取消',
      cancelAction: isEdit ? 'cancel-edit' : 'close-form',
      cancelAria: isEdit ? '取消编辑' : '取消新增记录',
      doneText: '完成',
      doneAction: saveAction,
      doneAria: saveLabel,
      doneId: saveId
    })}
    <div class="form-sheet-body">
      <div class="form-sheet-what form-lede">${whatText}</div>
      ${isEdit ? editBody : newBody}
    </div>`;
}

export function renderTagPicker(prefix, selectedTag, config = loadConfig(), bucketFilter = '') {
  const action = prefix === 'edit' ? 'pick-edit-tag' : 'pick-form-tag';
  const groups = chipGroups(config);
  const mainline = config.mainline.map(name => ({ name, bucket: 'job' }));
  const chipBtn = item => `<button class="chip chip-${item.bucket}${item.name === selectedTag ? ' sel' : ''}" type="button" data-action="${action}" data-tag="${esc(item.name)}" data-bucket="${item.bucket}" aria-label="选择标签：${esc(item.name)}">${esc(item.name)}</button>`;
  const draftName = String(selectedTag || '').trim();
  const known = !draftName || config.mainline.includes(draftName) || config.chips.some(chip => chip.name === draftName);
  const draftBucket = bucketFilter === 'maintain' || bucketFilter === 'leak' ? bucketFilter : 'job';
  const draftChip = !known
    ? `<button class="chip chip-${draftBucket} sel chip-draft" type="button" tabindex="-1" data-tag="${esc(draftName)}" aria-label="将记为新标签：${esc(draftName)}">${esc(draftName)}</button>`
    : '';
  const emptyHint = '<div class="form-hint">这个桶还没有可选标签，可直接写自定义标签。</div>';
  const chipsRow = items => `<div class="chips">${draftChip}${items.map(chipBtn).join('')}</div>`;
  if (bucketFilter === 'job') return (mainline.length || draftChip) ? chipsRow(mainline) : emptyHint;
  if (bucketFilter === 'maintain') return (groups.maintain.length || draftChip) ? chipsRow(groups.maintain) : emptyHint;
  if (bucketFilter === 'leak') return (groups.leak.length || draftChip) ? chipsRow(groups.leak) : emptyHint;
  const all = [...mainline, ...groups.maintain, ...groups.leak];
  if (!all.length && !draftChip) return '<div class="form-hint">还没有可选标签，可直接写自定义标签。</div>';
  const parts = [];
  if (draftChip) parts.push(`<div class="chips">${draftChip}</div>`);
  if (mainline.length) parts.push(`<div class="chips">${mainline.map(chipBtn).join('')}</div>`);
  if (groups.maintain.length) parts.push(`<div class="chip-group-label">维持</div><div class="chips">${groups.maintain.map(chipBtn).join('')}</div>`);
  if (groups.leak.length) parts.push(`<div class="chip-group-label">漏损</div><div class="chips">${groups.leak.map(chipBtn).join('')}</div>`);
  return parts.join('');
}

export function renderHelpSheet() {
  return `
    ${sheetHead({ title: '说明', cancelText: '关闭', cancelAction: 'close-form', cancelAria: '关闭说明' })}
    <div class="form-sheet-body help-body">
      <section><h2>怎么记</h2><p>点「+ 记一条」或「切换活动」记录刚才这一阵；卡片右侧铅笔改内容、标签和开始时间，垃圾桶智能删除（两侧同标签自动愈合，否则转未记录）；空隙卡「补一下」、段落卡「补一下/切一刀」做有界补录或切分。</p></section>
      <section><h2>4 桶</h2><p>先选归类桶，再选标签：主线=求职推进和自定义主线；维持=睡觉、吃饭、通勤等必要消耗；漏损=逃避娱乐；未记录=未知、孤儿标签和待确认长段。</p></section>
      <section><h2>计划</h2><p>计划条不计入 4 桶统计；时间到了可点「发生了」转为已发生记录。</p></section>
      <section><h2>3 小时确认</h2><p>超过 3 小时的非睡觉片段先进入未记录；确认后才按标签统计。睡觉默认 longOk，不要求确认。</p></section>
      <section><h2>备份与合并</h2><p>右上角「···」更多菜单含复制、下载、分享、导入完整 JSON；摘要只导出当前视图，适合贴给 AI。</p></section>
      <section><h2>双设备时区</h2><p>时间按设备壁钟保存，不做自动转换。导入时可整体平移 ±N 小时来对齐。</p></section>
      <section><h2>屏幕与隐私</h2><p>本应用不会主动保持屏幕常亮；数据只存在本机浏览器。</p></section>
    </div>`;
}

export function renderImportShiftDialog(opts = {}) {
  const value = opts.importShiftHours !== undefined ? opts.importShiftHours : '0';
  const hint = opts.importShiftHint || '导入前可把所有时间整体平移。例：iPhone 记在 UTC+8、电脑 UTC-5，填 -13；留空或 0 不平移。';
  return `
    ${sheetHead({ title: '导入时区平移', cancelText: '取消', cancelAction: 'cancel-import-shift', cancelAria: '取消导入', doneText: '导入', doneAction: 'confirm-import-shift', doneAria: '确认导入' })}
    <div class="form-sheet-body import-shift-body">
      <div class="form-hint">${esc(hint)}</div>
      <div class="fl">
        <div class="fl-label">平移小时数</div>
        <input type="number" class="inp" id="import-shift-hours" value="${esc(value)}" step="0.25" inputmode="decimal">
      </div>
    </div>`;
}

export function renderConfigSheet(config = loadConfig(), opts = {}) {
  const entries = opts.entries || [];
  // 每个 chip 一个两行式 cell：第一行名称输入 + 桶 select，第二行 longOk 勾选
  // 与记录条数说明。cell-group 供 inset 底和 hairline 分隔（与更多菜单同语法）。
  const row = chip => {
    const count = countEntriesWithTag(entries, chip.name);
    return `<div class="cfg-row" data-original-name="${esc(chip.name)}">
      <div class="cfg-line">
        <input class="inp cfg-name" type="text" value="${esc(chip.name)}" aria-label="标签名称">
        <select class="inp cfg-bucket" aria-label="桶">
          <option value="maintain"${chip.bucket === 'maintain' ? ' selected' : ''}>维持</option>
          <option value="leak"${chip.bucket === 'leak' ? ' selected' : ''}>漏损</option>
        </select>
      </div>
      <div class="cfg-sub">
        <label class="cfg-long"><input type="checkbox" class="cfg-long-ok"${chip.longOk ? ' checked' : ''}> 超长段免确认</label>
        ${count ? `<span class="cfg-count">${count} 条记录</span>` : ''}
      </div>
    </div>`;
  };
  const section = (bucket, title) => {
    const chips = config.chips.filter(chip => chip.bucket === bucket);
    return `<section class="cfg-section">
      <div class="chip-group-label">${title}</div>
      <div class="cfg-list cell-group" data-role="config-chips">${chips.map(row).join('')}</div>
    </section>`;
  };
  const mainlineHint = config.mainline.length
    ? `<div class="form-hint">主线历史：${config.mainline.map(name => {
      const count = countEntriesWithTag(entries, name);
      return count ? `${esc(name)}（${count} 条）` : esc(name);
    }).join('、')}</div>` : '';
  return `
    ${sheetHead({ title: '标签高级设置', cancelText: '取消', cancelAction: 'close-form', cancelAria: '取消配置', doneText: '保存', doneAction: 'save-tag-config', doneAria: '保存标签配置' })}
    <div class="form-sheet-body config-body">
      <div class="form-hint">改名会同步迁移历史记录。录入时先选桶；自定义标签在同桶第二次使用后自动固定。内置标签不会在这里删除，可改名、改桶或设置超长段免确认。</div>
      ${mainlineHint}
      ${section('maintain', '维持标签')}
      ${section('leak', '漏损标签')}
      <div class="form-inline-error" data-role="config-error" hidden></div>
    </div>`;
}

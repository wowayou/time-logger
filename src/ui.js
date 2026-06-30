import { fmtMins, hhmm, localDateTimeKey, normalizeTimestamp } from './time.js';
import { formatPercent } from './stats.js';
import {
  BUCKETS,
  BUCKET_ORDER,
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
    undo: '<path d="M9 14 4 9l5-5"></path>',
    plus: '<path d="M12 5v14"></path><path d="M5 12h14"></path>',
    help: '<path d="M9.1 9a3 3 0 1 1 5.8 1c-.6 1.3-2.1 1.7-2.7 2.8"></path><path d="M12 17h.01"></path>',
    close: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
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
  el.innerHTML = [...allItems].reverse().map(({ e, start, mins, isOngoing, unrecorded, pendingConfirm, confirmable, tag, endTs, planned: isPlanned }) => {
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
      return `<div class="entry gap" data-gap-ts="${esc(gapTs)}">
        <div class="e-body">
          <div class="e-time">${hhmm(start)}</div>
          <div class="e-what">这一段还没记，要补吗？</div>
          <div class="e-meta">
            <span class="e-tag e-tag-unrecorded">#未记录</span>
            <span class="e-dur">${fmtMins(mins)}</span>
            <button class="mini-btn" type="button" data-action="backfill-gap" data-ts="${esc(gapTs)}" data-tip="在这段未记录时间补一条；结束会自动接到下一条记录。" aria-label="补录这段未记录时间">补一下</button>
          </div>
        </div>
      </div>`;
    }
    const isPlaceholder = typeof e.what === 'string' && e.what.trim() === '';
    const displayTag = isPlaceholder ? '未记录' : tag;
    const tagClass = ` e-tag-${isPlaceholder ? 'unrecorded' : bucketForTag(tag)}`;
    const entryClass = `entry${isPlaceholder ? ' placeholder' : ''}${sheetEditId === e.id ? ' sheet-editing' : ''}`;
    const durStr = timelineDurationLabel(mins, isOngoing, unrecorded || isPlaceholder, pendingConfirm);
    const confirmText = confirmSegmentLabel(e.ts, endTs);
    const startLabel = start ? hhmm(start) : hhmm(e.ts);
    return `<div class="${entryClass}" data-id="${esc(e.id)}">
      <div class="e-body">
        <div class="e-time">${startLabel}</div>
        <div class="e-what">${esc(isPlaceholder ? '进行中·还没记' : e.what)}</div>
        <div class="e-meta">
          ${displayTag ? `<span class="e-tag${tagClass}">#${esc(displayTag)}</span>` : ''}
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

export function renderBackupSheet(opts = {}) {
  const shareSupported = Boolean(opts.shareSupported);
  return `
    <div class="form-sheet-head">
      <div class="form-sheet-summary">
        <div class="form-sheet-title" id="form-sheet-title">备份</div>
        <div class="form-sheet-what">完整 JSON 备份与导入</div>
      </div>
      <div class="form-sheet-actions">
        <button class="icon-btn cancel-btn" type="button" data-action="close-form" data-tip="关闭备份" aria-label="关闭备份">${iconSvg('close')}</button>
      </div>
    </div>
    <div class="form-sheet-body backup-sheet-body">
      <div class="backup-sheet-btns">
        <button class="copy-btn" id="copy-btn" type="button" data-action="copy-json" aria-label="复制完整 JSON 备份">复制 JSON</button>
        <button class="copy-btn" type="button" data-action="download-json" aria-label="下载 JSON 备份">下载</button>
        <button class="copy-btn" type="button" data-action="import-json" aria-label="导入 JSON 备份">导入</button>
        <button class="copy-btn" id="share-btn" type="button" data-action="share-json" aria-label="分享 JSON 备份"${shareSupported ? '' : ' hidden'}>分享</button>
      </div>
    </div>`;
}

export function renderFormSheet(opts) {
  if (opts && opts.mode === 'help') return renderHelpSheet();
  if (opts && opts.mode === 'config') return renderConfigSheet(opts.config || loadConfig(), opts);
  if (opts && opts.mode === 'import-shift') return renderImportShiftDialog(opts);
  if (opts && opts.mode === 'backup') return renderBackupSheet(opts);
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
  const isEditPlanned = isEdit && e && e.planned;
  const isKnownPickerTag = config.mainline.includes(tag) || config.chips.some(chip => chip.name === tag);
  const bucketSeg = renderBucketSeg(isEdit ? 'edit' : 'form', bucket);
  const chips = renderTagPicker(isEdit ? 'edit' : 'form', tag, config, bucket);
  const recordModeSeg = isEdit || isHistoryDay ? '' : renderRecordModeSeg(recordMode);
  const title = isEdit ? '编辑' : (isPlan ? '计划' : (isToday ? '记一条' : '补记'));
  const summary = isEdit
    ? `${hhmm(e.ts)}${tag ? ` · #${esc(tag)}` : ''}`
    : (isPlan ? daySummary : (isToday ? '刚才这一阵' : daySummary));
  const whatText = isEdit
    ? (esc(e.what) || '未填写')
    : (isPlan ? '写下计划要做什么' : (isToday ? '写下刚才做了什么' : '写下这一段做了什么'));
  const whatFieldLabel = isPlan || isEditPlanned ? '计划做什么' : '做了什么';
  const whatPlaceholder = isPlan || isEditPlanned ? '准备面试 / 写方案…' : (isEdit ? '做了什么' : '写邮件 / 刷手机 / 准备面试…');
  const saveAction = isEdit ? 'commit-edit' : 'save-entry';
  const saveId = isEdit ? ` data-id="${esc(e.id)}"` : '';
  const saveTip = isEdit ? '保存修改' : '保存记录';
  const saveLabel = isEdit ? '保存修改' : '保存时间记录';
  const tsInput = isEdit
    ? `<input type="hidden" data-role="edit-ts" value="${esc(e.ts)}">`
    : '<input type="hidden" id="form-ts">';
  const wheelMount = isEdit ? '<div data-role="edit-wheel"></div>' : '<div id="form-wheel-mount"></div>';
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
  const editBody = `
      <div class="fl">
        <div class="fl-label">时间（可改，补录用）</div>
        ${tsInput}
        ${wheelMount}
      </div>
      <div class="form-inline-error" data-role="conflict-error" hidden></div>
      <div class="fl">
        <div class="fl-label">${whatFieldLabel}</div>
        ${whatInput}
      </div>
      ${tagBlock}`;
  const newBody = `
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
      </div>
      <div class="fl">
        <div class="fl-label" data-role="what-label">${whatFieldLabel}</div>
        ${whatInput}
      </div>
      ${tagBlock}`;
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
      ${isEdit ? editBody : newBody}
    </div>`;
}

export function renderTagPicker(prefix, selectedTag, config = loadConfig(), bucketFilter = '') {
  const action = prefix === 'edit' ? 'pick-edit-tag' : 'pick-form-tag';
  const groups = chipGroups(config);
  const mainline = config.mainline.map(name => ({ name, bucket: 'job' }));
  const chipBtn = item => `<button class="chip chip-${item.bucket}${item.name === selectedTag ? ' sel' : ''}" type="button" data-action="${action}" data-tag="${esc(item.name)}" data-bucket="${item.bucket}" aria-label="选择标签：${esc(item.name)}">${esc(item.name)}</button>`;
  if (bucketFilter === 'job') {
    if (!mainline.length) return '<div class="form-hint">这个桶还没有可选标签，可直接写自定义标签。</div>';
    return `<div class="chips">${mainline.map(chipBtn).join('')}</div>`;
  }
  if (bucketFilter === 'maintain') {
    if (!groups.maintain.length) return '<div class="form-hint">这个桶还没有可选标签，可直接写自定义标签。</div>';
    return `<div class="chips">${groups.maintain.map(chipBtn).join('')}</div>`;
  }
  if (bucketFilter === 'leak') {
    if (!groups.leak.length) return '<div class="form-hint">这个桶还没有可选标签，可直接写自定义标签。</div>';
    return `<div class="chips">${groups.leak.map(chipBtn).join('')}</div>`;
  }
  const all = [...mainline, ...groups.maintain, ...groups.leak];
  if (!all.length) return '<div class="form-hint">还没有可选标签，可直接写自定义标签。</div>';
  const parts = [];
  if (mainline.length) parts.push(`<div class="chips">${mainline.map(chipBtn).join('')}</div>`);
  if (groups.maintain.length) parts.push(`<div class="chip-group-label">维持</div><div class="chips">${groups.maintain.map(chipBtn).join('')}</div>`);
  if (groups.leak.length) parts.push(`<div class="chip-group-label">漏损</div><div class="chips">${groups.leak.map(chipBtn).join('')}</div>`);
  return parts.join('');
}

export function renderHelpSheet() {
  return `
    <div class="form-sheet-head">
      <div class="form-sheet-summary">
        <div class="form-sheet-title" id="form-sheet-title">说明</div>
        <div class="form-sheet-what">打点模型、本地备份、4 桶统计</div>
      </div>
      <div class="form-sheet-actions">
        <button class="icon-btn cancel-btn" type="button" data-action="close-form" data-tip="关闭说明" aria-label="关闭说明">${iconSvg('close')}</button>
      </div>
    </div>
    <div class="form-sheet-body help-body">
      <section><h2>怎么记</h2><p>点「+ 记一条」记录刚才这一阵，或切换「计划中」安排未来事项；保存后自动开一段未记录的进行中。</p></section>
      <section><h2>4 桶</h2><p>先选归类桶，再选标签：主线=求职推进和自定义主线；维持=睡觉、吃饭、通勤等必要消耗；漏损=逃避娱乐；未记录=未知、孤儿标签和待确认长段。</p></section>
      <section><h2>计划</h2><p>计划条不计入 4 桶统计；时间到了可点「发生了」转为已发生记录。</p></section>
      <section><h2>3 小时确认</h2><p>超过 3 小时的非睡觉片段先进入未记录；确认后才按标签统计。睡觉默认 longOk，不要求确认。</p></section>
      <section><h2>备份与合并</h2><p>底栏「备份」含复制、下载、分享、导入完整 JSON；摘要只导出当前视图，适合贴给 AI。</p></section>
      <section><h2>双设备时区</h2><p>时间按设备壁钟保存，不做自动转换。导入时可整体平移 ±N 小时来对齐。</p></section>
      <section><h2>屏幕与隐私</h2><p>本应用不会主动保持屏幕常亮；数据只存在本机浏览器。</p></section>
    </div>`;
}

export function renderImportShiftDialog(opts = {}) {
  const value = opts.importShiftHours !== undefined ? opts.importShiftHours : '0';
  const hint = opts.importShiftHint || '导入前可把所有时间整体平移。例：iPhone 记在 UTC+8、电脑 UTC-5，填 -13；留空或 0 不平移。';
  return `
    <div class="form-sheet-head">
      <div class="form-sheet-summary">
        <div class="form-sheet-title" id="form-sheet-title">导入时区平移</div>
        <div class="form-sheet-what">按小时整体移动导入记录的时间</div>
      </div>
      <div class="form-sheet-actions">
        <button class="icon-btn cancel-btn" type="button" data-action="cancel-import-shift" data-tip="取消导入" aria-label="取消导入">${iconSvg('undo')}</button>
        <button class="icon-btn save-btn" type="button" data-action="confirm-import-shift" data-tip="确认导入" aria-label="确认导入">${iconSvg('check')}</button>
      </div>
    </div>
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
  const row = chip => {
    const count = countEntriesWithTag(entries, chip.name);
    return `<div class="cfg-row" data-original-name="${esc(chip.name)}">
      <div class="cfg-row-left">
        <input class="inp cfg-name" type="text" value="${esc(chip.name)}" aria-label="标签名称">
        <label class="cfg-long"><input type="checkbox" class="cfg-long-ok"${chip.longOk ? ' checked' : ''}> 超长段免确认</label>
        ${count ? `<span class="form-hint">${count} 条记录</span>` : ''}
      </div>
      <select class="inp cfg-bucket" aria-label="桶">
        <option value="maintain"${chip.bucket === 'maintain' ? ' selected' : ''}>维持</option>
        <option value="leak"${chip.bucket === 'leak' ? ' selected' : ''}>漏损</option>
      </select>
    </div>`;
  };
  const section = (bucket, title) => {
    const chips = config.chips.filter(chip => chip.bucket === bucket);
    return `<section class="cfg-section">
      <div class="chip-group-label">${title}</div>
      <div class="cfg-list" data-role="config-chips">${chips.map(row).join('')}</div>
    </section>`;
  };
  const mainlineHint = config.mainline.length
    ? `<div class="form-hint">主线历史：${config.mainline.map(name => {
      const count = countEntriesWithTag(entries, name);
      return count ? `${esc(name)}（${count} 条）` : esc(name);
    }).join('、')}</div>` : '';
  return `
    <div class="form-sheet-head">
      <div class="form-sheet-summary">
        <div class="form-sheet-title" id="form-sheet-title">标签高级设置</div>
        <div class="form-sheet-what">改名会同步迁移历史记录</div>
      </div>
      <div class="form-sheet-actions">
        <button class="icon-btn cancel-btn" type="button" data-action="close-form" data-tip="取消配置" aria-label="取消配置">${iconSvg('undo')}</button>
        <button class="icon-btn save-btn" type="button" data-action="save-tag-config" data-tip="保存配置" aria-label="保存标签配置">${iconSvg('check')}</button>
      </div>
    </div>
    <div class="form-sheet-body config-body">
      <div class="form-hint">录入时先选桶；自定义标签在同桶第二次使用后自动固定。内置标签不会在这里删除，可改名、改桶或设置超长段免确认。</div>
      ${mainlineHint}
      ${section('maintain', '维持标签')}
      ${section('leak', '漏损标签')}
      <div class="form-inline-error" data-role="config-error" hidden></div>
    </div>`;
}

// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
import { fmtMins, hhmm, localDateTimeKey, minsBetweenDates, normalizeTimestamp } from './time.js';
import { formatPercent } from './stats.js';
import { getLocale, t } from './i18n.js';
import {
  BUCKETS,
  BUCKET_ORDER,
  defaultMotto,
  THEME_KEY,
  bucketForTag,
  chipGroups,
  countEntriesWithTag,
  loadConfig,
  loadLocalePref,
  readBootDiag
} from './storage.js';

// SPEC-014 §1.6：隐私政策外链，按当前 locale 分流；绝对 URL——本页可能同时跑在
// 新旧两个 origin 上，站点静态页只发布在 time.eigentime.org 根下。
const PRIVACY_URL = {
  zh: 'https://time.eigentime.org/privacy/',
  en: 'https://time.eigentime.org/en/privacy/'
};

export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function iconSvg(name) {
  const icons = {
    edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
    trash: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path>',
    // 「···」更多按钮：三个零长度、round linecap 的描边线段各画成一个圆点——沿用
    // stroke-based 渲染管线（`.hdr-action-btn svg` 全局 fill:none/stroke-linecap:round）。
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
      ? t('hero.planOnly')
      : (view === 'day' ? t('hero.emptyDay') : t('hero.emptyRange'));
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
      ${totals.pending ? `<span>${t('hero.pending', { dur: fmtMins(totals.pending) })}</span>` : ''}
      <span>${fmtMins(totals.total)}</span>
    </div>`;
}

// R4（v47）：日视图尺子从「四桶清单」改「结论卡」——主线净时长是屏幕唯一大数字，
// 偏航（v69 前称漏损）为次要数字，比例条 + 百分比降为辅助。只用于 day 视图；周/月/年仍走 renderRuler。
export function renderDayHero(totals, hasItems, opts = {}) {
  const el = document.getElementById('ruler');
  const { isToday = false, asOf = '' } = opts;
  if (!hasItems || !totals.total) {
    const text = (hasItems && !totals.total) ? t('hero.planOnly') : t('hero.emptyDay');
    el.innerHTML = `<p class="muted-note">${text}</p>`;
    return;
  }
  const parts = bucketParts(totals);
  const bar = parts.map(part => {
    // 维持段 .55 透明度（设计稿：主线/偏航为焦点，维持退到背景）。
    const dim = part.bucket === 'maintain' ? ';opacity:0.55' : '';
    return `<div style="flex:${part.value};background:var(${part.color})${dim}"></div>`;
  }).join('');
  const aux = [
    t('hero.maintain', { dur: fmtMins(totals.maintain) }),
    t('hero.unrecorded', { dur: fmtMins(totals.unrecorded) }),
    totals.pending ? t('hero.pending', { dur: fmtMins(totals.pending) }) : '',
    isToday && asOf ? t('hero.asOf', { time: asOf }) : ''
  ].filter(Boolean).join(' · ');
  el.innerHTML = `
    <div class="day-hero">
      <div class="hero-nums">
        <div class="hero-cell">
          <div class="hero-label">${isToday ? t('hero.jobToday') : t('hero.job')}</div>
          <div class="hero-big">${fmtMins(totals.job)}</div>
        </div>
        <div class="hero-cell">
          <div class="hero-label">${t('hero.leak')}</div>
          <div class="hero-leak">${fmtMins(totals.leak)}</div>
        </div>
      </div>
      <div class="hero-bar">${bar}</div>
      <div class="hero-aux">${aux}</div>
    </div>`;
}

function bucketParts(totals) {
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

// v56 文案单职责：标题说状态、tag 说桶、这里只说时长——「未记录/进行中」不再在
// 时长里复读（旧版一行里「未记录」出现两次）。进行中用「已 X」，与 FAB 副文案同语。
function timelineDurationLabel(mins, isOngoing, pendingConfirm) {
  if (pendingConfirm) return isOngoing ? t('dur.pendingOngoing', { dur: fmtMins(mins) }) : t('dur.pending', { dur: fmtMins(mins) });
  return isOngoing ? t('dur.ongoing', { dur: fmtMins(mins) }) : fmtMins(mins);
}

function confirmSegmentLabel(startTs, endTs) {
  return normalizeTimestamp(startTs) && normalizeTimestamp(endTs) ? t('confirm.range', { start: hhmm(startTs), end: hhmm(endTs) }) : t('confirm.generic');
}


export function renderTimeline(items, opts = {}) {
  const { sheetEditId = null, plannedItems = [], isToday = false, nowLabel = '', readOnly = false } = opts;
  const el = document.getElementById('timeline');
  // v87：桶色竖脊每行都要问一次 bucketForTag；不带 config 的话每一行都会重新
  // 解析并归一化整份 config。整块时间轴共用同一份。
  const config = loadConfig();
  const planned = (plannedItems || []).map(e => ({
    e,
    start: new Date(e.ts),
    mins: 0,
    isOngoing: false,
    unrecorded: false,
    pendingConfirm: false,
    confirmable: false,
    tag: (e.tags || [])[0] || t('tag.unknown'),
    endTs: '',
    planned: true
  }));
  const allItems = [...items, ...planned];
  if (!allItems.length) {
    el.innerHTML = readOnly
      ? `<div class="empty-tip">${t('timeline.emptyOtherDay')}</div>`
      : `<div class="empty-tip">${t('timeline.emptyToday')}</div>`;
    return;
  }
  // R6（v47）：点整卡即编辑（删除在编辑 sheet 内）。卡片 div 带 data-action（click
  // 委托：closest 命中最近的 data-action，内部 meta 按钮如补/确认/标记已发生仍各管
  // 各的）+ role/tabindex/aria-label（键盘 Enter/Space 激活，a11y 不回退）。
  // gap/占位行点整卡=补录/编辑；v56 起行是连续日志容器里的三列网格：时间｜内容｜时长，
  // data-b 驱动左侧通高桶色竖脊（实=已发生、虚线=计划、灰=未记录）。
  // SPEC-002（v76）：readOnly（旧 origin 只读）时整条渲染路径退化——卡片不带
  // data-action/role/tabindex（click 委托与键盘 Enter/Space 都找不到锚点，等价于
  // 禁用点行编辑）、不渲染补一下/标记已发生/确认等 mini-btn，也不套 swipeWrap
  // （左滑轨道靠 begin() 里 `.entry[data-action="start-edit"]` 判据自然失效，这里
  // 干脆连不可用的按钮都不画）。浏览/摘要/导出等只读能力完全不受影响。
  const swipeWrap = (card, entry, kind) => `<div class="swipe-row" data-swipe-id="${esc(entry.id)}">
    <div class="swipe-actions" aria-hidden="true">
      <button class="swipe-action swipe-edit" type="button" data-action="start-edit" data-id="${esc(entry.id)}" tabindex="-1" aria-label="${t('timeline.editAria', { kind })}">${iconSvg('edit')}<span>${t('timeline.edit')}</span></button>
      <button class="swipe-action swipe-delete" type="button" data-action="request-delete" data-id="${esc(entry.id)}" tabindex="-1" aria-label="${t('timeline.deleteAria', { kind })}">${iconSvg('trash')}<span>${t('timeline.delete')}</span></button>
    </div>
    ${card}
  </div>`;
  const rows = [...allItems].reverse().map(({ e, start, end, mins, isOngoing, unrecorded, pendingConfirm, confirmable, tag, endTs, planned: isPlanned }) => {
    if (isPlanned) {
      const displayTag = (e.tags || [])[0] || t('tag.unknown');
      const interactiveAttrs = readOnly ? '' : ` data-action="start-edit" role="button" tabindex="0" aria-label="${esc(t('timeline.editPlanAria', { what: e.what || t('timeline.emptyWhat') }))}"`;
      const card = `<div class="entry planned" data-b="${bucketForTag(displayTag, config)}" data-id="${esc(e.id)}"${interactiveAttrs}>
        <div class="e-time">${hhmm(e.ts)}</div>
        <div class="e-body">
          <div class="e-what">${esc(e.what || t('timeline.emptyWhat'))}</div>
          <div class="e-meta">
            <span class="e-tag">#${esc(displayTag)}</span>
            ${readOnly ? '' : `<button class="mini-btn" type="button" data-action="confirm-planned" data-id="${esc(e.id)}" data-tip="${t('timeline.markDoneTip')}" aria-label="${t('timeline.markDoneAria')}">${t('timeline.markDone')}</button>`}
          </div>
        </div>
        <div class="e-dur">${t('timeline.planDur')}</div>
      </div>`;
      return readOnly ? card : swipeWrap(card, e, t('timeline.kindPlan'));
    }
    if (!e) {
      const gapTs = localDateTimeKey(start);
      const gapEnd = localDateTimeKey(end);
      const interactiveAttrs = readOnly ? '' : ` data-action="backfill-seg" data-kind="fill" data-ts="${esc(gapTs)}" data-end="${esc(gapEnd)}" role="button" tabindex="0" aria-label="${t('timeline.gapAria', { time: hhmm(start) })}"`;
      return `<div class="entry gap" data-b="unrecorded" data-gap-ts="${esc(gapTs)}"${interactiveAttrs}>
        <div class="e-time">${hhmm(start)}</div>
        <div class="e-body">
          <div class="e-what">${t('timeline.gapWhat')}</div>
          <div class="e-meta">
            <span class="e-tag">${t('timeline.gapTag')}</span>
            ${readOnly ? '' : `<span class="e-cta">${t('timeline.fillIn')}</span>`}
          </div>
        </div>
        <div class="e-dur">${fmtMins(mins)}</div>
      </div>`;
    }
    const isPlaceholder = typeof e.what === 'string' && e.what.trim() === '';
    // Only the live now-segment reads "还没记"; a middle/past placeholder (e.g.
    // left by a smart delete) is honestly just "未记录".
    const activePlaceholder = isPlaceholder && isOngoing;
    const displayTag = isPlaceholder ? t('timeline.unrecorded') : tag;
    const bucket = (isPlaceholder || unrecorded) ? 'unrecorded' : bucketForTag(tag, config);
    // v89：待核行**不加**行级 class。竖脊颜色在 v89 起恒等于桶（待核不再冒充未记录），
    // 提醒本身由时长列的「待核 · X」和行内「确认」按钮承担，已经是两个信号；再叠一层行底色
    // 既要重做双主题令牌，也会破坏 v56 定下的「竖脊＝唯一颜色语法」。曾有过一个 `pending-review`
    // 钩子，但它没有任何样式规则也没有用例，属死类，已删。
    const entryClass = `entry${isPlaceholder ? ' placeholder' : ''}${sheetEditId === e.id ? ' sheet-editing' : ''}`;
    const durStr = timelineDurationLabel(mins, isOngoing, pendingConfirm);
    const confirmText = confirmSegmentLabel(e.ts, endTs);
    const startLabel = start ? hhmm(start) : hhmm(e.ts);
    const segStartTs = start ? localDateTimeKey(start) : e.ts;
    const segEndTs = end ? localDateTimeKey(end) : '';
    // v56：行内动作只留指向缺口/待办的——未记录占位行保留「补一下」，
    // 可选的长段待核行保留「确认」与「补一下」，计划行保留「标记已发生」。已发生普通段的「切一刀」移入
    // 编辑 sheet（逐行常显的动作词＝换了位置的 card soup）。进行中的今日尾占位不放
    // 「补一下」——FAB「记一条·续 X 起」已是同一缺口的入口，三重冗余只留一个。
    const fillBtn = !readOnly && (isPlaceholder || unrecorded || pendingConfirm) && segEndTs && !activePlaceholder
      ? `<button class="mini-btn" type="button" data-action="backfill-seg" data-kind="${isPlaceholder ? 'fill' : 'split'}" data-source-id="${esc(e.id)}" data-ts="${esc(segStartTs)}" data-end="${esc(segEndTs)}" data-tip="${t('timeline.fillTip')}" aria-label="${t('timeline.fillAria')}">${t('timeline.fillIn')}</button>`
      : '';
    const cardLabel = isPlaceholder ? t('timeline.editGapAria') : t('timeline.editEntryAria', { what: esc(e.what) });
    const interactiveAttrs = readOnly ? '' : ` data-action="start-edit" role="button" tabindex="0" aria-label="${cardLabel}"`;
    const card = `<div class="${entryClass}" data-b="${bucket}" data-id="${esc(e.id)}"${interactiveAttrs}>
      <div class="e-time">${startLabel}</div>
      <div class="e-body">
        <div class="e-what">${esc(isPlaceholder ? (activePlaceholder ? t('timeline.notLoggedYet') : t('timeline.unrecorded')) : e.what)}</div>
        <div class="e-meta">
          ${displayTag ? `<span class="e-tag">#${esc(displayTag)}</span>` : ''}
          ${!readOnly && confirmable ? `<button class="mini-btn" type="button" data-action="confirm-segment" data-id="${esc(e.id)}" data-end="${esc(endTs)}" data-tip="${t('timeline.confirmTip')}" aria-label="${esc(confirmText)}">${esc(confirmText)}</button>` : ''}
          ${fillBtn}
        </div>
      </div>
      <div class="e-dur">${durStr}</div>
    </div>`;
    return (readOnly || isPlaceholder) ? card : swipeWrap(card, e, t('timeline.kindEntry'));
  });
  // v56「现在」一线：只在今天渲染——未来（计划）在上、现在一线、过去在下；倒序里
  // 计划块正好排最前，插在它之后。没有计划时它就是容器首行的时间锚。
  if (isToday) {
    rows.splice(planned.length, 0, `<div class="tl-now" role="separator" aria-label="${esc(t('timeline.nowAria', { time: nowLabel }))}"><span class="tl-now-dot"></span><span class="tl-now-label">${esc(t('timeline.now', { time: nowLabel }))}</span><span class="tl-now-line"></span></div>`);
  }
  el.innerHTML = `<div class="log">${rows.join('')}</div>`;
}

export function renderSummaryRows(rows) {
  const el = document.getElementById('timeline');
  const html = rows.map(row => {
    const { totals } = row;
    const parts = bucketParts(totals);
    return `<button class="sum-row" type="button" data-action="drill" data-date="${esc(row.key)}" data-view="${esc(row.targetView)}" data-tip="${t('summary.drillTip')}" aria-label="${esc(t('summary.drillAria', { label: row.label }))}">
      <div class="sum-top">
        <span class="sum-name">${esc(row.label)}</span>
        <span class="sum-total">${totals.total ? fmtMins(totals.total) : t('summary.noEntries')}</span>
      </div>
      <div class="ruler-bar" style="margin-bottom:8px">
        ${parts.map(part => `<div style="flex:${part.value};background:var(${part.color})"></div>`).join('')}
      </div>
      <div class="sum-meta">
        ${parts.map(part => `<span>${part.label} ${part.percent}</span>`).join('')}
        ${totals.pending ? `<span>${t('hero.pending', { dur: fmtMins(totals.pending) })}</span>` : ''}
      </div>
    </button>`;
  }).join('');
  el.innerHTML = `<div class="summary-list">${html || `<div class="empty-tip">${t('summary.empty')}</div>`}</div>`;
}

export function bucketHint(bucket) {
  if (bucket === 'maintain') return t('bucketHint.maintain');
  if (bucket === 'leak') return t('bucketHint.leak');
  return t('bucketHint.job');
}

function renderBucketSeg(prefix, selectedBucket) {
  const action = prefix === 'edit' ? 'pick-edit-bucket' : 'pick-form-bucket';
  const buckets = ['job', 'maintain', 'leak'];
  return `<div class="seg bucket-seg" data-role="${prefix}-bucket-seg" role="group" aria-label="${t('seg.bucketAria')}">
    ${buckets.map(bucket => `<button type="button" data-action="${action}" data-bucket="${bucket}" class="${bucket === selectedBucket ? 'active' : ''}" aria-pressed="${bucket === selectedBucket}" aria-label="${esc(BUCKETS[bucket])}">${esc(BUCKETS[bucket])}</button>`).join('')}
  </div>`;
}

function renderRecordModeSeg(selectedMode = 'log') {
  return `<div class="seg record-mode-seg" data-role="record-mode-seg" role="group" aria-label="${t('seg.recordModeAria')}">
    <button type="button" data-action="pick-record-mode" data-mode="log" class="${selectedMode === 'log' ? 'active' : ''}" aria-pressed="${selectedMode === 'log'}" aria-label="${t('seg.logAria')}">${t('seg.log')}</button>
    <button type="button" data-action="pick-record-mode" data-mode="plan" class="${selectedMode === 'plan' ? 'active' : ''}" aria-pressed="${selectedMode === 'plan'}" aria-label="${t('seg.planAria')}">${t('seg.plan')}</button>
  </div>`;
}

// C 语法 sheet 头：抓手条 + 左取消/右完成文字按钮 + 居中标题。
// 可见文字按钮不加 data-tip（红线：文字按钮不强制 tooltip）。
function sheetHead({ title, cancelText, cancelAction, cancelAria, doneText = '', doneAction = '', doneAria = '', doneId = '' }) {
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
export const APP_VERSION = '90';

function renderDeleteConfirmSheet(opts = {}) {
  const plan = opts.deletePlan || {};
  const entry = opts.deleteEntry || {};
  const isPlan = Boolean(entry.planned);
  const range = plan.startTs && plan.endTs
    ? `${hhmm(plan.startTs)}-${plan.endLabel || hhmm(plan.endTs)}`
    : hhmm(entry.ts || '');
  const resultClass = plan.outcome === 'join' ? 'is-join' : 'is-unrecorded';
  return `
    ${sheetHead({
      title: isPlan ? t('delete.titlePlan') : t('delete.titleEntry'),
      cancelText: t('delete.cancel'),
      cancelAction: 'cancel-delete',
      cancelAria: t('delete.cancelAria'),
      doneText: t('delete.done'),
      doneAction: 'confirm-delete',
      doneAria: isPlan ? t('delete.doneAriaPlan') : t('delete.doneAriaEntry'),
      doneId: ` data-id="${esc(entry.id || '')}"`
    })}
    <div class="form-sheet-body delete-confirm-body">
      ${opts.deleteStale ? `<div class="form-inline-error" role="alert">${t('delete.stale')}</div>` : ''}
      <div class="delete-target">
        <div class="delete-range">${esc(range)}</div>
        <div class="delete-what">${esc(entry.what || t('timeline.emptyWhat'))}</div>
        <div class="delete-tag">#${esc((entry.tags || [])[0] || t('timeline.unrecorded'))}</div>
      </div>
      <div class="delete-result ${resultClass}" role="status">
        <div class="fl-label">${t('delete.resultLabel')}</div>
        <p>${esc(plan.message || t('delete.fallbackMessage'))}</p>
      </div>
      <div class="form-inline-error" data-role="delete-error" hidden></div>
    </div>`;
}

// v84：「更多」瘦身——13 行 + 3 段说明压到 9 行，代价只有一层下钻。分组判据是**使用
// 频度与心智**：备份四项是同一件事的四种出口（一次去一个地方拿），启动诊断与修复
// 更新通道是运维动作（正常使用时不该出现在主菜单里）。两张二级页都走既有的返回栈，
// 「取消/Esc/点遮罩」回到「更多」而不是整层关闭。
function renderBackupSheet(opts = {}) {
  const isLegacyOrigin = Boolean(opts.isLegacyOrigin);
  return `
    ${sheetHead({ title: t('backup.title'), cancelText: t('more.close'), cancelAction: 'close-form', cancelAria: t('backup.closeAria') })}
    <div class="form-sheet-body more-body">
      <div class="form-hint">${t('more.backupHint')}</div>
      <div class="cell-group">
        <button class="cell-btn" id="copy-btn" type="button" data-action="copy-json" aria-label="${t('more.copyJsonAria')}"><span data-role="cell-label">${t('more.copyJson')}</span>${cellChevron}</button>
        <button class="cell-btn" id="backup-download-btn" type="button" data-action="download-json" aria-label="${t('more.saveAria')}"><span data-role="cell-label">${t('more.save')}</span>${cellChevron}</button>
        ${isLegacyOrigin ? '' : `<button class="cell-btn" type="button" data-action="import-json" aria-label="${t('more.importAria')}"><span data-role="cell-label">${t('more.import')}</span>${cellChevron}</button>`}
        <button class="cell-btn" id="backup-send-btn" type="button" data-action="send-backup" aria-label="${t('more.shareAria')}"><span data-role="cell-label">${t('more.share')}</span>${cellChevron}</button>
      </div>
    </div>`;
}

function renderAdvancedSheet(opts = {}) {
  const bootDiag = readBootDiag();
  const longReview = Boolean(opts.config && opts.config.longReview === true);
  return `
    ${sheetHead({ title: t('advanced.title'), cancelText: t('more.close'), cancelAction: 'close-form', cancelAria: t('advanced.closeAria') })}
    <div class="form-sheet-body more-body">
      <div class="cell-group">
        <button class="cell-btn" type="button" data-action="toggle-long-review" aria-pressed="${longReview}" aria-label="${t('advanced.longReviewAria', { state: longReview ? t('advanced.longReviewAriaOn') : t('advanced.longReviewAriaOff') })}"><span data-role="cell-label">${t('advanced.longReview', { state: longReview ? t('advanced.longReviewOn') : t('advanced.longReviewOff') })}</span>${cellChevron}</button>
      </div>
      <div class="form-hint">${t('advanced.longReviewHint')}</div>
      <div class="cell-group">
        <button class="cell-btn" id="repair-update-btn" type="button" data-action="repair-update-channel" aria-label="${t('more.repairAria')}"><span data-role="cell-label">${t('more.repair')}</span>${cellChevron}</button>
      </div>
      <div class="form-hint">${t('more.repairHint')}</div>
      <div class="cell-group">
        <button class="cell-btn" type="button" data-action="toggle-boot-diag" aria-pressed="${bootDiag.enabled}" aria-label="${t('more.bootDiagAria', { state: bootDiag.enabled ? t('more.bootDiagAriaOn') : t('more.bootDiagAriaOff') })}"><span data-role="cell-label">${t('more.bootDiag', { state: bootDiag.enabled ? t('more.bootDiagOn') : t('more.bootDiagOff') })}</span>${cellChevron}</button>
        ${bootDiag.enabled ? `<button class="cell-btn" id="boot-diag-copy-btn" type="button" data-action="copy-boot-diag" aria-label="${t('more.bootDiagCopyAria')}"><span data-role="cell-label">${t('more.bootDiagCopy')}</span>${cellChevron}</button>` : ''}
      </div>
      ${bootDiag.enabled ? `<div class="form-hint">${t('more.bootDiagHint')}</div>` : ''}
    </div>`;
}

function renderMoreSheet(opts = {}) {
  let themePref = 'auto';
  try { themePref = localStorage.getItem(THEME_KEY) || 'auto'; } catch {}
  const themeBtn = (value, label) =>
    `<button type="button" data-action="theme" data-theme="${value}" class="${themePref === value ? 'active' : ''}" aria-pressed="${themePref === value}" aria-label="${t('theme.aria', { label })}">${label}</button>`;
  // SPEC-014 §2：语言开关，紧邻主题，同款三选一 seg；'' ＝跟随系统。active 态
  // 按**存储的偏好**（loadLocalePref，'' 也算一种偏好）判定，不是按当前生效
  // locale——与主题的 themePref 判定同一逻辑。
  let localePref = '';
  try { localePref = loadLocalePref(); } catch {}
  const langBtn = (value, label) =>
    `<button type="button" data-action="set-locale" data-locale="${value}" class="${localePref === value ? 'active' : ''}" aria-pressed="${localePref === value}">${esc(label)}</button>`;
  // SPEC-002（v76）：横幅已改常驻不可关闭（无 dismissed 状态），旧 origin 不再需要
  // 「重开」入口；同一个 isLegacyOrigin 现在改用于收敛这个菜单里唯一的写路径入口——
  // 「导入备份」——只读态完全不渲染这个 cell，其余三项（复制/存储/分享）都是导出/
  // 读能力，照常保留。
  const isLegacyOrigin = Boolean(opts.isLegacyOrigin);
  const privacyHref = PRIVACY_URL[getLocale()] || PRIVACY_URL.zh;
  return `
    ${sheetHead({ title: t('more.title'), cancelText: t('more.close'), cancelAction: 'close-form', cancelAria: t('more.closeAria') })}
    <div class="form-sheet-body more-body">
      <div class="cell-group">
        <button class="cell-btn" id="summary-btn" type="button" data-action="copy-summary" aria-label="${t('more.copySummaryAria')}"><span data-role="cell-label">${t('more.copySummary')}</span>${cellChevron}</button>
      </div>
      <div class="cell-group">
        <button class="cell-btn" type="button" data-action="open-backup" aria-label="${t('more.backupGroupAria')}"><span data-role="cell-label">${t('more.backupGroup')}</span>${cellChevron}</button>
      </div>
      <div class="cell-group">
        <button class="cell-btn" type="button" data-action="open-tag-config" aria-label="${t('more.tagConfigAria')}">${t('more.tagConfig')}${cellChevron}</button>
        <button class="cell-btn" type="button" data-action="open-motto" aria-label="${t('more.mottoAria')}">${t('more.motto')}${cellChevron}</button>
        <div class="cell-row"><span>${t('more.theme')}</span>
          <div class="seg theme-seg" id="theme-seg" role="group" aria-label="${t('more.themeAria')}">
            ${themeBtn('auto', t('theme.auto'))}${themeBtn('light', t('theme.light'))}${themeBtn('dark', t('theme.dark'))}
          </div>
        </div>
        <div class="cell-row"><span>${t('more.language')}</span>
          <div class="seg theme-seg" id="language-seg" role="group" aria-label="${t('more.languageAria')}">
            ${langBtn('', t('more.languageAuto'))}${langBtn('zh', t('lang.zh'))}${langBtn('en', t('lang.en'))}
          </div>
        </div>
        <button class="cell-btn" type="button" data-action="open-help" aria-label="${t('more.helpAria')}">${t('more.help')}${cellChevron}</button>
        <a class="cell-btn" href="${privacyHref}" target="_blank" rel="noopener" aria-label="${t('more.privacyAria')}">${t('more.privacy')}${cellChevron}</a>
      </div>
      <div class="cell-group">
        <button class="cell-btn" type="button" data-action="open-advanced" aria-label="${t('more.advancedAria')}"><span data-role="cell-label">${t('more.advanced')}</span>${cellChevron}</button>
      </div>
      <div class="app-version">${t('more.appVersion', { version: APP_VERSION })}</div>
    </div>`;
}

// 阶段格言编辑（v69，C13）：input 预填当前生效文案（未设置＝默认），清空保存＝隐藏，
// 「恢复默认」回填默认句（保存时 storage 会把恰等于默认的值归一化回「未设置」）。
function renderMottoSheet(opts = {}) {
  const config = opts.config || loadConfig();
  const value = config.motto === undefined ? defaultMotto() : config.motto;
  return `
    ${sheetHead({ title: t('motto.title'), cancelText: t('motto.cancel'), cancelAction: 'close-form', cancelAria: t('motto.cancelAria'), doneText: t('motto.done'), doneAction: 'save-motto', doneAria: t('motto.doneAria') })}
    <div class="form-sheet-body motto-body">
      <div class="form-hint">${t('motto.hint')}</div>
      <div class="fl">
        <div class="fl-label">${t('motto.fieldLabel')}</div>
        <input type="text" class="inp" data-role="motto-input" maxlength="60" value="${esc(value)}" placeholder="${t('motto.placeholder')}" aria-label="${t('motto.inputAria')}">
      </div>
      <div class="form-hint">${t('motto.clearHint')}</div>
      <button class="cell-action" type="button" data-action="reset-motto-input" aria-label="${t('motto.resetAria')}">${t('motto.reset')}</button>
    </div>`;
}

export function renderFormSheet(opts) {
  if (opts && opts.mode === 'help') return renderHelpSheet();
  if (opts && opts.mode === 'motto') return renderMottoSheet(opts);
  if (opts && opts.mode === 'config') return renderConfigSheet(opts.config || loadConfig(), opts);
  if (opts && opts.mode === 'import-shift') return renderImportShiftDialog(opts);
  if (opts && opts.mode === 'more') return renderMoreSheet(opts);
  if (opts && opts.mode === 'backup') return renderBackupSheet(opts);
  if (opts && opts.mode === 'advanced') return renderAdvancedSheet(opts);
  if (opts && opts.mode === 'delete-confirm') return renderDeleteConfirmSheet(opts);
  const mode = opts && opts.mode === 'edit' ? 'edit' : 'new';
  const e = opts && opts.entry;
  const isEdit = mode === 'edit';
  const isToday = !opts || opts.isToday !== false;
  const isHistoryDay = Boolean(opts && opts.isHistoryDay);
  const targetDate = opts && opts.targetDate;
  const daySummary = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetDate || '');
    return m ? t('form.daySummary', { m: Number(m[2]), d: Number(m[3]) }) : t('form.thisDay');
  })();
  const tag = isEdit ? ((e.tags || [])[0] || '') : '';
  const config = loadConfig();
  const bucket = opts && opts.bucket ? opts.bucket : (isEdit ? bucketForTag(tag, config) : (opts && opts.defaultBucket) || 'job');
  const recordMode = opts && opts.recordMode ? opts.recordMode : 'log';
  const recordModeLocked = Boolean(opts && opts.recordModeLocked);
  const isBackfill = !isEdit && Boolean(opts && opts.backfill);
  const overnightContext = opts && opts.overnightContext || null;
  const isOvernight = !isEdit && !isBackfill && Boolean(overnightContext && overnightContext.ok);
  const isPlan = !isEdit && !isHistoryDay && recordMode === 'plan';
  const isSplit = isBackfill && opts && opts.backfillKind === 'split';
  const isEditPlanned = isEdit && e && e.planned;
  const isEditPlaceholder = isEdit && e && typeof e.what === 'string' && e.what.trim() === '';
  const intervalContext = opts && opts.intervalContext || null;
  const editEndMode = opts && opts.editEndMode === 'now' ? 'now' : 'fixed';
  const isKnownPickerTag = config.mainline.includes(tag) || config.chips.some(chip => chip.name === tag);
  const bucketSeg = renderBucketSeg(isEdit ? 'edit' : 'form', bucket);
  const chips = renderTagPicker(isEdit ? 'edit' : 'form', tag, config, bucket);
  const recordModeSeg = isEdit || isHistoryDay || isBackfill || recordModeLocked || isOvernight ? '' : renderRecordModeSeg(recordMode);
  const title = isEdit ? t('form.titleEdit') : (isBackfill ? (isSplit ? t('form.titleSplit') : t('form.titleBackfill')) : (isOvernight ? t('form.titleOvernight') : (isPlan ? t('form.titlePlanShort') : (isToday ? t('form.titleLogToday') : t('form.titleBackfillDay')))));
  const summary = isEdit
    ? `${hhmm(e.ts)}${tag ? ` · #${esc(tag)}` : ''}`
    : (isBackfill ? daySummary : (isOvernight ? t('form.subOvernight') : (isPlan ? daySummary : (isToday ? t('form.whenJustNow') : daySummary))));
  const whatText = isEdit
    ? (esc(e.what) || t('timeline.emptyWhat'))
    : (isBackfill || isOvernight ? t('form.hintOtherDay') : (isPlan ? t('form.hintPlan') : (isToday ? t('form.hintToday') : t('form.hintOtherDay'))));
  const whatFieldLabel = isPlan || isEditPlanned ? t('form.whatLabelPlan') : t('form.whatLabelLog');
  const whatPlaceholder = isPlan || isEditPlanned ? t('form.whatPlaceholderPlan') : (isEdit ? t('form.editWhatPlaceholder') : t('form.whatPlaceholderLog'));
  const saveAction = isEdit ? 'commit-edit' : 'save-entry';
  const saveId = isEdit ? ` data-id="${esc(e.id)}"` : '';
  const saveLabel = isEdit ? t('form.saveEdit') : t('form.saveNew');
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
    ? `<input type="text" class="inp edit-tag-input" data-role="edit-custom-tag" list="mainline-tags" value="${isKnownPickerTag ? '' : esc(tag)}" placeholder="${t('form.customTagPlaceholder')}">`
    : `<input type="text" class="inp" id="form-ctag" list="mainline-tags" placeholder="${t('form.customTagOptional')}">`;
  const datalist = `<datalist id="mainline-tags">${config.mainline.map(name => `<option value="${esc(name)}"></option>`).join('')}</datalist>`;
  const tagBlock = `
      <div class="fl">
        <div class="fl-label">${t('form.labelBucket')}</div>
        ${bucketSeg}
      </div>
      <div class="fl">
        <div class="fl-label">${t('form.labelTag')}</div>
        ${chipWrap}
      </div>
      <div class="fl">
        <div class="fl-label">${t('form.labelCustomTag')}</div>
        ${customInput}
        ${datalist}
        <div class="form-hint" data-role="mainline-hint">${bucketHint(bucket)}</div>
      </div>`;
  // R3：常规编辑（非计划）的时间滚轮默认折叠为触发行——多数编辑只改文字/标签，
  // 常驻展开的滚轮是噪音；点触发行才展开，与新建态「开始时间」触发行形态一致。
  // 计划编辑（isEditPlanned）沿用「计划时间（可改）」始终展开，改动概率高、无需折叠。
  const editStartLabel = e && normalizeTimestamp(e.ts) ? hhmm(e.ts) : '--:--';
  const editEndLabel = intervalContext && normalizeTimestamp(intervalContext.endTs) ? hhmm(intervalContext.endTs) : '--:--';
  const editTimeSection = isEditPlanned
    ? `
      <div class="fl">
        <div class="fl-label">${t('form.labelPlanTime')}</div>
        ${tsInput}
        <div data-role="edit-wheel"></div>
      </div>
      ${opts && opts.planOutsideWindow ? `<div class="form-hint plan-expired-hint">${t('form.planOutsideWindow')}</div>` : ''}
      <div class="form-inline-error" data-role="conflict-error" hidden></div>`
    : (isEditPlaceholder || !intervalContext ? `
      <div class="fl">
        <div class="fl-label">${t('form.labelStartTime')}</div>
        ${tsInput}
        <div class="form-time-row" data-role="edit-time-row">
          <button class="start-time-trigger" type="button" data-action="toggle-edit-start-time" aria-expanded="false" aria-label="${t('form.editStartAria')}"><span data-role="edit-start-label">${esc(editStartLabel)}</span></button>
        </div>
        <div class="fl start-time-section" data-role="edit-time-section" hidden>
          <div data-role="edit-wheel"></div>
        </div>
      </div>
      <div class="form-inline-error" data-role="conflict-error" hidden></div>` : `
      <div class="fl">
        <div class="fl-label">${t('form.labelStartEnd')}</div>
        ${tsInput}
        <input type="hidden" data-role="edit-end-ts" value="${esc(intervalContext.endTs)}">
        <input type="hidden" data-role="edit-end-mode" value="${esc(editEndMode)}">
        <div class="form-time-row" data-role="edit-time-row">
          <button class="start-time-trigger" type="button" data-action="toggle-edit-start-time" aria-expanded="false" aria-label="${t('form.editStartEndAria')}"><span data-role="edit-start-label">${esc(editStartLabel)}-${esc(editEndMode === 'now' ? t('form.endNow') : editEndLabel)}</span></button>
        </div>
        <div class="fl start-time-section interval-editor" data-role="edit-time-section" hidden>
          <div class="boundary-picker">
            <div class="fl-label">${t('form.labelStart')}</div>
            <div data-role="edit-start-wheel"></div>
          </div>
          ${intervalContext.canUseNow ? `<div class="seg end-mode-seg" data-role="edit-end-mode-seg" role="group" aria-label="${t('form.endModeAria')}">
            <button type="button" data-action="pick-edit-end-mode" data-mode="now" class="${editEndMode === 'now' ? 'active' : ''}" aria-pressed="${editEndMode === 'now'}">${t('form.endNow')}</button>
            <button type="button" data-action="pick-edit-end-mode" data-mode="fixed" class="${editEndMode === 'fixed' ? 'active' : ''}" aria-pressed="${editEndMode === 'fixed'}">${t('form.endFixed')}</button>
          </div>` : ''}
          <div class="boundary-picker" data-role="edit-end-picker"${editEndMode === 'now' ? ' hidden' : ''}>
            <div class="fl-label">${t('form.labelEnd')}</div>
            <div data-role="edit-end-wheel"></div>
          </div>
          <div class="boundary-limits" data-role="edit-limits"></div>
          <div class="interval-preview" data-role="interval-preview" aria-live="polite"></div>
        </div>
      </div>
      <div class="form-inline-error" data-role="conflict-error" hidden></div>`);
  const editBody = `
      ${editTimeSection}
      <div class="fl">
        <div class="fl-label">${whatFieldLabel}</div>
        ${whatInput}
      </div>
      ${tagBlock}
      ${isEdit && !isEditPlaceholder && !isEditPlanned && intervalContext && intervalContext.ok && intervalContext.endTs
        ? `<button class="cell-action" type="button" data-action="backfill-seg" data-kind="split" data-source-id="${esc(e.id)}" data-ts="${esc(e.ts)}" data-end="${esc(intervalContext.endTs)}" aria-label="${t('form.splitAria')}">${t('form.split')}</button>`
        : ''}
      ${isEdit && !isEditPlaceholder ? `<button class="cell-danger" type="button" data-action="request-delete" data-id="${esc(e.id)}" aria-label="${t('form.deleteThisAria', { kind: isEditPlanned ? t('form.kindPlan') : t('form.kindEntry') })}">${t('form.deleteThis', { kind: isEditPlanned ? t('form.kindPlan') : t('form.kindEntry') })}</button>` : ''}`;
  const backfillTimeSection = `
      <input type="hidden" id="form-ts">
      <input type="hidden" id="form-end-ts">
      <div class="fl backfill-time">
        <div class="fl-label">${t('form.labelStart')}</div>
        <div data-role="backfill-start-mount"></div>
      </div>
      <div class="fl backfill-time">
        <div class="fl-label">${t('form.labelEnd')}</div>
        <div data-role="backfill-end-mount"></div>
        <div class="form-hint" data-role="backfill-duration"></div>
      </div>
      <div class="boundary-limits" data-role="backfill-limits"></div>
      <div class="interval-preview" data-role="interval-preview" aria-live="polite"></div>
      <div class="form-inline-error" data-role="conflict-error" hidden></div>`;
  const logTimeSection = `
      ${recordModeSeg}
      <input type="hidden" id="form-ts">
      <div class="form-time-row"${isPlan ? ' hidden' : ''} data-role="log-time-row">
        <button class="start-time-trigger" type="button" data-action="toggle-start-time" aria-expanded="false" aria-label="${t('form.editStartPointAria')}"><span data-role="start-time-label">--:--</span></button>
        <span class="form-time-arrow">→ <span data-role="end-label">${t('form.arrowNow')}</span> · ${t('form.arrowDone')} <span data-role="duration-label">--</span></span>
      </div>
      <div class="fl"${isPlan ? '' : ' hidden'} data-role="plan-time-row">
        <div class="fl-label">${t('form.labelPlanTimePlain')}</div>
        <div data-role="form-wheel-mount"></div>
        <div class="form-hint">${t('form.planHint')}</div>
      </div>
      <div class="form-inline-error" data-role="conflict-error" hidden></div>
      <div class="fl start-time-section" data-role="start-time-section" hidden>
        <div data-role="form-wheel-mount"></div>
      </div>`;
  const overnightDuration = isOvernight
    ? fmtMins(minsBetweenDates(new Date(overnightContext.startTs), new Date(overnightContext.hardEndTs)))
    : '';
  const overnightTimeSection = isOvernight ? `
      <input type="hidden" id="form-ts">
      <input type="hidden" data-role="overnight-end-mode" value="${esc(opts && opts.overnightEndMode === 'day-end' ? 'day-end' : 'today')}">
      <div class="overnight-summary" data-role="overnight-summary" role="status">${esc(t('form.overnightSummary', { start: hhmm(overnightContext.startTs), end: hhmm(overnightContext.hardEndTs), dur: overnightDuration }))}</div>
      <div class="fl" data-role="overnight-time-row">
        <div class="fl-label">${t('form.labelStartTime')}</div>
        <div data-role="form-wheel-mount"></div>
      </div>
      <div class="seg end-mode-seg overnight-end-seg" role="group" aria-label="${t('form.overnightEndAria')}">
        <button type="button" data-action="pick-overnight-end-mode" data-mode="today" class="active" aria-pressed="true">${esc(t('form.overnightToToday2', { time: hhmm(overnightContext.hardEndTs) }))}</button>
        <button type="button" data-action="pick-overnight-end-mode" data-mode="day-end" aria-pressed="false">${t('form.overnightDayEnd2')}</button>
      </div>
      <div class="form-hint">${t('form.overnightHint')}</div>
      <div class="boundary-limits" data-role="overnight-limits"></div>
      <div class="interval-preview" data-role="interval-preview" aria-live="polite"></div>
      <div class="form-inline-error" data-role="conflict-error" hidden></div>` : '';
  const newBody = `
      ${isBackfill ? backfillTimeSection : (isOvernight ? overnightTimeSection : logTimeSection)}
      <div class="fl">
        <div class="fl-label" data-role="what-label">${whatFieldLabel}</div>
        ${whatInput}
      </div>
      ${tagBlock}`;
  return `
    ${sheetHead({
      title: `${title} · ${summary}`,
      cancelText: t('form.cancel'),
      cancelAction: isEdit ? 'cancel-edit' : 'close-form',
      cancelAria: isEdit ? t('form.cancelEditAria') : t('form.cancelNewAria'),
      doneText: t('form.done'),
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
  const chipBtn = item => `<button class="chip chip-${item.bucket}${item.name === selectedTag ? ' sel' : ''}" type="button" data-action="${action}" data-tag="${esc(item.name)}" data-bucket="${item.bucket}" aria-pressed="${item.name === selectedTag}" aria-label="${esc(t('chip.selectAria', { name: item.name }))}">${esc(item.name)}</button>`;
  const draftName = String(selectedTag || '').trim();
  const known = !draftName || config.mainline.includes(draftName) || config.chips.some(chip => chip.name === draftName);
  const draftBucket = bucketFilter === 'maintain' || bucketFilter === 'leak' ? bucketFilter : 'job';
  const draftChip = !known
    ? `<button class="chip chip-${draftBucket} sel chip-draft" type="button" tabindex="-1" data-tag="${esc(draftName)}" aria-label="${esc(t('chip.draftAria', { name: draftName }))}">${esc(draftName)}</button>`
    : '';
  const emptyHint = `<div class="form-hint">${t('chip.emptyBucketHint')}</div>`;
  const chipsRow = items => `<div class="chips">${draftChip}${items.map(chipBtn).join('')}</div>`;
  if (bucketFilter === 'job') return (mainline.length || draftChip) ? chipsRow(mainline) : emptyHint;
  if (bucketFilter === 'maintain') return (groups.maintain.length || draftChip) ? chipsRow(groups.maintain) : emptyHint;
  if (bucketFilter === 'leak') return (groups.leak.length || draftChip) ? chipsRow(groups.leak) : emptyHint;
  const all = [...mainline, ...groups.maintain, ...groups.leak];
  if (!all.length && !draftChip) return `<div class="form-hint">${t('chip.emptyAllHint')}</div>`;
  const parts = [];
  if (draftChip) parts.push(`<div class="chips">${draftChip}</div>`);
  if (mainline.length) parts.push(`<div class="chips">${mainline.map(chipBtn).join('')}</div>`);
  if (groups.maintain.length) parts.push(`<div class="chip-group-label">${t('chip.groupMaintain')}</div><div class="chips">${groups.maintain.map(chipBtn).join('')}</div>`);
  if (groups.leak.length) parts.push(`<div class="chip-group-label">${t('chip.groupLeak')}</div><div class="chips">${groups.leak.map(chipBtn).join('')}</div>`);
  return parts.join('');
}

function renderHelpSheet() {
  return `
    ${sheetHead({ title: t('help.title'), cancelText: t('more.close'), cancelAction: 'close-form', cancelAria: t('help.closeAria') })}
    <div class="form-sheet-body help-body">
      <section><h2>${t('help.h1')}</h2><p>${t('help.p1')}</p></section>
      <section><h2>${t('help.h2')}</h2><p>${t('help.p2a')}</p><p>${t('help.p2b')}</p></section>
      <section><h2>${t('help.h3')}</h2><p>${t('help.p3')}</p></section>
      <section><h2>${t('help.h4')}</h2><p>${t('help.p4')}</p></section>
      <section><h2>${t('help.h5')}</h2><p>${t('help.p5')}</p></section>
      <section><h2>${t('help.h6')}</h2><p>${t('help.p6')}</p></section>
      <section><h2>${t('help.h7')}</h2><p>${t('help.p7')}</p></section>
      <section><h2>${t('help.h8')}</h2><p>${t('help.p8')}</p></section>
    </div>`;
}

// SPEC-006 B：文件选完就解析/校验失败时，sheet 还没进入正常的平移检查态——
// 只显示错误与「关闭」，不给平移输入和「导入」按钮（没有可导入的数据）。
function renderImportEarlyErrorDialog(message) {
  return `
    ${sheetHead({ title: t('importUi.title'), cancelText: t('importUi.close'), cancelAction: 'cancel-import-shift', cancelAria: t('importUi.closeAria') })}
    <div class="form-sheet-body import-shift-body">
      <div class="import-conflicts" role="alert">${esc(message)}</div>
    </div>`;
}

function renderImportShiftDialog(opts = {}) {
  if (opts.importEarlyError) return renderImportEarlyErrorDialog(opts.importEarlyError);
  const value = opts.importShiftHours !== undefined ? opts.importShiftHours : '0';
  const hint = opts.importShiftHint || t('importUi.shiftHint');
  return `
    ${sheetHead({ title: t('importUi.title'), cancelText: t('importUi.cancel'), cancelAction: 'cancel-import-shift', cancelAria: t('importUi.cancelAria'), doneText: t('importUi.done'), doneAction: 'confirm-import-shift', doneAria: t('importUi.doneAria'), doneId: ' id="import-confirm-btn" disabled aria-disabled="true"' })}
    <div class="form-sheet-body import-shift-body">
      <div class="form-hint">${esc(hint)}</div>
      <div class="fl">
        <div class="fl-label">${t('importUi.shiftLabel')}</div>
        <input type="number" class="inp" id="import-shift-hours" value="${esc(value)}" step="0.25" inputmode="decimal">
      </div>
      <div class="import-summary" data-role="import-summary" aria-live="polite"></div>
      <div class="import-conflicts" data-role="import-error" role="alert" hidden></div>
    </div>`;
}

// v83：行内两个零件被草稿行（新建）与已有行共用，故提到模块层——草稿行由
// renderConfigRowDraft 生成并由 sheet_controller 插进 DOM，两条路径必须逐字同构，
// 否则保存时的 querySelector 会在其中一条上落空。
function cfgLongOkBox(checked, enabled = true) {
  return `<label class="cfg-long"${enabled ? '' : ' hidden'}>
    <input type="checkbox" class="cfg-long-ok"${checked ? ' checked' : ''} aria-label="${esc(t('cfg.longOk'))}">
    <span>${t('cfg.longOk')}</span>
  </label>`;
}

function cfgBucketSeg(bucket) {
  return `<div class="seg cfg-bucket-seg" role="group" aria-label="${esc(t('cfg.bucketAria'))}">
      <button type="button" data-action="cfg-pick-bucket" data-bucket="maintain" class="${bucket === 'maintain' ? 'active' : ''}" aria-pressed="${bucket === 'maintain'}">${t('cfg.maintain')}</button>
      <button type="button" data-action="cfg-pick-bucket" data-bucket="leak" class="${bucket === 'leak' ? 'active' : ''}" aria-pressed="${bucket === 'leak'}">${t('cfg.leak')}</button>
    </div>`;
}

/**
 * v83：一行「待新建」的标签。没有 data-original-name（＝还不存在于 config），
 * 因此保存时空名直接当作没建过，而不是像已有行那样报错。右槽是「移除」而不是
 * v82 的待删除态——从未落库的东西没有「撤销」可言，直接把行拿掉即可。
 * @param {string} kind 'mainline' | 'chip'
 * @param {string} bucket 'job' | 'maintain' | 'leak'
 */
export function renderConfigRowDraft(kind, bucket, longReview = false) {
  const isMainline = kind === 'mainline';
  const chipBucket = bucket === 'leak' ? 'leak' : 'maintain';
  return `<div class="cfg-row is-new" data-b="${isMainline ? 'job' : chipBucket}" data-kind="${isMainline ? 'mainline' : 'chip'}" data-new="1">
    <div class="cfg-line">
      <input class="inp cfg-name" type="text" value="" placeholder="${esc(t('cfg.newNamePlaceholder'))}" aria-label="${esc(t('cfg.nameAria'))}">
      ${isMainline ? '' : cfgBucketSeg(chipBucket)}
    </div>
    <div class="cfg-sub">${cfgLongOkBox(false, longReview)}<button class="mini-btn cfg-delete" type="button" data-action="cfg-remove-draft" aria-label="${esc(t('cfg.removeDraftAria'))}">${t('cfg.removeDraft')}</button></div>
  </div>`;
}

function renderConfigSheet(config = loadConfig(), opts = {}) {
  const entries = opts.entries || [];
  // SPEC-007：签名手法是把日视图的桶色竖脊带进设置行——结构即信息，不用读控件
  // 就知道这行属于哪个桶。data-b 与时间轴同源（styles.css 按它上色）。
  const countLine = name => {
    const count = countEntriesWithTag(entries, name);
    return count ? `<span class="cfg-count">${t('cfg.count', { n: count })}</span>` : '';
  };
  // v82：删除只对**零记录**的标签开放——SPEC-007 当初不做删除的理由是「历史记录
  // 会变成孤儿标签」，这个理由在没有任何记录引用它时并不成立（试错建出来的标签
  // 就卡在这里，永远删不掉）。所以右槽二选一：有记录→显示条数（不可删）；
  // 零记录→显示「删除」。判据同一个 countEntriesWithTag，保存时还会按最新
  // load() 复算一次，跨标签页新增的记录能把删除拦下。
  const countOrDelete = name => {
    const count = countEntriesWithTag(entries, name);
    if (count) return countLine(name);
    return `<button class="mini-btn cfg-delete" type="button" data-action="cfg-toggle-delete" aria-label="${esc(t('cfg.deleteAria', { name }))}">${t('cfg.delete')}</button>`;
  };

  // 主线：当前主线置顶（实色脊），历史名脊淡化；行尾「设为当前」。
  const mainlineRow = (name, index) => {
    const isCurrent = index === 0;
    return `<div class="cfg-row${isCurrent ? ' is-current' : ' is-history'}" data-b="job" data-kind="mainline" data-original-name="${esc(name)}">
      <div class="cfg-line">
        <input class="inp cfg-name" type="text" value="${esc(name)}" aria-label="${esc(t('cfg.nameAria'))}">
        ${isCurrent ? `<span class="cfg-badge">${t('cfg.currentBadge')}</span>`
          : `<button class="mini-btn cfg-set-current" type="button" data-action="set-current-mainline" data-name="${esc(name)}" aria-label="${esc(t('cfg.setCurrentAria', { name }))}">${t('cfg.setCurrent')}</button>`}
      </div>
      <div class="cfg-sub">${cfgLongOkBox((config.mainlineLongOk || []).includes(name), config.longReview === true)}${countOrDelete(name)}</div>
    </div>`;
  };

  // 维持/偏航：两段式分段控件替换原生 <select>——只有两个选项，segmented control
  // 比弹出式 select 更直接，且消灭 iOS 原生弹层的语言断裂（v78 之后尤其要紧：
  // 原生弹层不跟随应用语言，英文界面下会弹中文选项）。
  const chipRow = chip => `<div class="cfg-row" data-b="${chip.bucket}" data-kind="chip" data-original-name="${esc(chip.name)}">
    <div class="cfg-line">
      <input class="inp cfg-name" type="text" value="${esc(chip.name)}" aria-label="${esc(t('cfg.nameAria'))}">
      ${cfgBucketSeg(chip.bucket)}
    </div>
    <div class="cfg-sub">${cfgLongOkBox(chip.longOk, config.longReview === true)}${countOrDelete(chip.name)}</div>
  </div>`;

  // v83：每组底部一个「新建标签」，与 v82 的删除配成对——此前这张 sheet 能改名、
  // 改桶、设当前、删除，唯独不能建，而建是唯一还只能靠「先去记一条」的动作。
  // 空组仍留那句空态提示（说明标签也会在记录时自动长出来），但组本身不再是空盒。
  const addBtn = (kind, bucket, title) => `<button class="cell-btn cfg-add" type="button" data-action="cfg-add-row" data-kind="${kind}" data-bucket="${bucket}" aria-label="${esc(t('cfg.addTagAria', { group: title }))}"><span data-role="cell-label">${t('cfg.addTag')}</span></button>`;
  const section = (title, rowsHtml, kind, bucket, hint) => `<section class="cfg-section">
    <div class="chip-group-label">${title}</div>
    <div class="cfg-list cell-group">${rowsHtml}${addBtn(kind, bucket, title)}</div>
    ${rowsHtml ? '' : `<div class="form-hint cfg-empty">${t('cfg.emptySection')}</div>`}
    ${hint ? `<div class="form-hint">${hint}</div>` : ''}
  </section>`;

  const chipsOf = bucket => config.chips.filter(chip => chip.bucket === bucket).map(chipRow).join('');
  const preview = opts.defaultsPreview;

  return `
    ${sheetHead({ title: t('cfg.title'), cancelText: t('cfg.cancel'), cancelAction: 'close-form', cancelAria: t('cfg.cancelAria'), doneText: t('cfg.done'), doneAction: 'save-tag-config', doneAria: t('cfg.doneAria') })}
    <div class="form-sheet-body config-body">
      <div class="form-hint">${t('cfg.renameHint')}</div>
      ${section(t('cfg.sectionMainline'), config.mainline.map(mainlineRow).join(''), 'mainline', 'job', t('cfg.mainlineHint'))}
      ${section(t('cfg.sectionMaintain'), chipsOf('maintain'), 'chip', 'maintain')}
      ${section(t('cfg.sectionLeak'), chipsOf('leak'), 'chip', 'leak')}
      <div class="cell-group">
        <button class="cell-btn" type="button" data-action="preview-locale-defaults" aria-label="${esc(t('cfg.addDefaultsAria'))}"><span data-role="cell-label">${t('cfg.addDefaults')}</span>${cellChevron}</button>
      </div>
      ${preview ? `<div class="cfg-defaults-preview" data-role="defaults-preview">
        ${preview.additions.length ? `<div class="form-hint" data-role="defaults-additions">${t('cfg.addDefaultsPreview', { n: preview.additions.length, list: preview.additions.map(chip => esc(chip.name)).join(t('cfg.listJoin')) })}</div>` : `<div class="form-hint" data-role="defaults-none">${t('cfg.addDefaultsNone')}</div>`}
        ${preview.skipped.length ? `<div class="form-hint" data-role="defaults-skipped">${t('cfg.addDefaultsSkipped', { n: preview.skipped.length, list: preview.skipped.map(esc).join(t('cfg.listJoin')) })}</div>` : ''}
        ${preview.additions.length ? `<div class="cfg-defaults-actions">
          <button class="cell-action" type="button" data-action="apply-locale-defaults">${t('cfg.addDefaultsApply')}</button>
          <button class="cell-action" type="button" data-action="cancel-locale-defaults">${t('cfg.addDefaultsCancel')}</button>
        </div>` : ''}
      </div>` : ''}
      <div class="form-inline-error" data-role="config-error" hidden></div>
    </div>`;
}

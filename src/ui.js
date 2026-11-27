// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
import { fmtMins, fmtPlainMins, hhmm, localDateTimeKey, minsBetweenDates, normalizeTimestamp, parseDateKey, shortDateLabel } from './time.js';
import { dayHeatCells, formatPercent, tagShares, weekHeatCells } from './stats.js';
import { getLocale, plural, t, tList } from './i18n.js';
import {
  BUCKETS,
  BUCKET_ORDER,
  defaultMotto,
  THEME_KEY,
  TIMELINE_DENSITY_KEY,
  normalizeTimelineDensity,
  bucketForTag,
  canonicalTagName,
  chipGroups,
  configuredBucketForTag,
  countEntriesWithTag,
  loadConfig,
  loadLocalePref,
  loadQuotes,
  previewLocaleDefaultTags,
  readUiPreference,
  readBootDiag
} from './storage.js';

// SPEC-014 §1.6：隐私政策外链，按当前 locale 分流；绝对 URL——本页可能同时跑在
// 新旧两个 origin 上，站点静态页只发布在 time.eigentime.org 根下。
const PRIVACY_URL = {
  zh: 'https://time.eigentime.org/privacy/',
  en: 'https://time.eigentime.org/en/privacy/'
};

// D35 → D36: the app links only to our static support page. Payment providers
// and the thank-you card live there; no verification or tracking in the app.
const SUPPORT_URL = {
  zh: 'https://time.eigentime.org/support/?from=time-logger',
  en: 'https://time.eigentime.org/en/support/?from=time-logger'
};

// D36（v1.7.0）：主题句库是运行时资产 packs/<id>-<locale>.txt（进 sw.js FILES，离线
// 可读；支持页下载同一批文件）。id 与展示顺序只在这里定义；标题写成 t('…') 字面调用，
// 让 audit 的「词条被引用」检查看得见，也随界面语言即时取词。
export const QUOTE_PACKS = [
  { id: 'focus', title: () => t('quotes.packFocus') },
  { id: 'rest', title: () => t('quotes.packRest') },
  { id: 'restart', title: () => t('quotes.packRestart') }
];

export function quotePackPath(id, locale = getLocale()) {
  return `./packs/${id}-${locale}.txt`;
}

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
  const changed = el.dataset.tip !== text;
  el.dataset.tip = text;
  if (ariaLabel) el.setAttribute('aria-label', ariaLabel);
  if (changed && el.dataset.tipReady) placeTooltip(el);
}

// v1.15.0 tooltip 不出界：气泡默认以按钮为中心展开，贴边的按钮（「···」、年、下一段…）会
// 伸出视口；而且悬停时宽度就已生效（只是 800ms 后才可见），隐藏的盒子照样撑宽页面。
// 打开前量出气泡的真实宽度，水平平移进 [TIP_EDGE, 视口宽 − TIP_EDGE]，写进 --tip-dx，
// 并标记 data-tip-ready；CSS 只给已定位的按钮展开气泡——布局变了而指针没动、没有
// pointerover 可接时，宁可不显示也不撑宽页面。量宽度用 data-tip-measure 临时套上与显示
// 时相同的宽度规则（styles.css），同步读完即撤，中间不渲染；canvas 估算在 WebKit 中文
// 回退字体下会窄约 15px（实测），不可靠。
const TIP_EDGE = 8;

export function placeTooltip(btn) {
  if (!(btn instanceof HTMLElement) || !btn.dataset.tip) return;
  btn.setAttribute('data-tip-measure', '');
  const style = getComputedStyle(btn, '::after');
  const width = (parseFloat(style.width) || 0) + (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  btn.removeAttribute('data-tip-measure');
  // 可用宽度：html 自身宽度与 clientWidth 取小——scrollbar-gutter: stable 预留滚动条槽时，
  // Chromium 的 clientWidth 仍报整个视口宽（实测 1280 vs 1265）。
  const root = document.documentElement;
  const vw = Math.min(root.clientWidth || window.innerWidth, root.getBoundingClientRect().width || Infinity);
  const rect = btn.getBoundingClientRect();
  const left = rect.left + rect.width / 2 - width / 2;
  const lo = TIP_EDGE;
  const hi = vw - TIP_EDGE - width;
  const dx = left < lo ? lo - left : (left > hi ? hi - left : 0);
  btn.style.setProperty('--tip-dx', `${Math.round(dx)}px`);
  btn.dataset.tipReady = '1';
}

// 渲染或视口变化后，按新布局重算**已定位过**的按钮（正悬停着的气泡跟着挪，不会消失）。
export function refreshTooltipPlacement(root = document) {
  root.querySelectorAll('button[data-tip-ready]').forEach(placeTooltip);
}

// v1.8.0：周/月/年总览与日视图同一张结论卡——主线大数字 + 偏航次要数字 + 比例条 +
// 辅助行。旧版是「比例条 + 四桶百分比 + 总时长」平铺，总时长挤在图例末尾换行；四桶
// 分钟仍是权威值，百分比不再上卡（明细行保留）。
export function renderRuler(totals, hasItems, view, opts = {}) {
  const el = document.getElementById('ruler');
  if (!hasItems || !totals.total) {
    const text = (hasItems && !totals.total && view === 'day')
      ? t('hero.planOnly')
      : (view === 'day' ? t('hero.emptyDay') : t('hero.emptyRange'));
    el.innerHTML = `<p class="muted-note">${text}</p>`;
    return;
  }
  el.innerHTML = heroCard(totals, t('hero.job'), [t('hero.total', { dur: fmtMins(totals.total) })], periodVisual(view, opts));
}

// R4（v47）：日视图尺子从「四桶清单」改「结论卡」——主线净时长是屏幕唯一大数字，
// 偏航（v69 前称漏损）为次要数字，比例条 + 百分比降为辅助。v1.8.0 起周/月/年经 renderRuler
// 共用同一张 heroCard，只是标签与辅助行末项不同（「截至」换成「共」）。
export function renderDayHero(totals, hasItems, opts = {}) {
  const el = document.getElementById('ruler');
  const { isToday = false, asOf = '', segments = [], dayStart = null, now = new Date(), visual = 'ratio' } = opts;
  if (!hasItems || !totals.total) {
    const text = (hasItems && !totals.total) ? t('hero.planOnly') : t('hero.emptyDay');
    el.innerHTML = `<p class="muted-note">${text}</p>`;
    return;
  }
  const detail = visual === 'detail' && dayStart ? dayHeatHtml(dayHeatCells(heatSpans(segments), dayStart, now)) : '';
  el.innerHTML = heroCard(totals, isToday ? t('hero.jobToday') : t('hero.job'), [isToday && asOf ? t('hero.asOf', { time: asOf }) : ''], { visual, kind: 'heat', detail });
}

// v1.13.0 首屏卡片的图形切换（维护者看过对比图选定）：比例条 ⇄ 分布图，日 / 周为热力格、
// 月 / 年为按标签分的环形图；日周月年共用一个选择（timelog.heroVisual，默认比例）。
// 规则只在 stats.js（dayHeatCells / weekHeatCells / tagShares），这里只出模板。
// 分布图是装饰性的（aria-hidden）：数字、明细行与图例文字仍是可读真源。
function heatSpans(segments) {
  return (segments || [])
    .filter(seg => seg && seg.start instanceof Date && seg.end instanceof Date)
    .map(seg => ({ start: seg.start, end: seg.end, bucket: seg.unrecorded ? 'unrecorded' : seg.bucket }));
}
function heatCell(c) {
  return c.future
    ? '<i class="fut"></i>'
    : `<i data-b="${c.bucket}"${c.level ? ` data-l="${c.level}"` : ''}${c.now ? ' class="now"' : ''}></i>`;
}
const HEAT_AXIS = '<div class="hh-axis"><span>00</span><span>06</span><span>12</span><span><span>18</span><span>24</span></span></div>';
// 日：一列＝1 小时，列内 4 格＝4 个刻钟，6 小时一组（v1.11.0 B1）。
function dayHeatHtml(cells) {
  const groups = [0, 1, 2, 3].map(g => `<div class="hh-grp">${Array.from({ length: 6 }, (_, i) => {
    const h = g * 6 + i;
    return `<div class="hh-col">${cells.slice(h * 4, h * 4 + 4).map(heatCell).join('')}</div>`;
  }).join('')}</div>`).join('');
  return `<div class="hero-heat hh-day" aria-hidden="true"><div class="hh-row">${groups}</div>${HEAT_AXIS}</div>`;
}
// 周：一行＝1 天，一格＝1 小时，6 小时一组；行首是星期。
function weekHeatHtml(cells, weekStart) {
  const names = tList('date.weekdayNarrow');
  const rows = Array.from({ length: 7 }, (_, r) => {
    const day = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + r);
    const row = cells.slice(r * 24, r * 24 + 24);
    const groups = [0, 1, 2, 3].map(g => `<div class="hh-grp">${row.slice(g * 6, g * 6 + 6).map(heatCell).join('')}</div>`).join('');
    return `<span class="hh-lab">${esc(names[day.getDay()] || '')}</span><div class="hh-row">${groups}</div>`;
  }).join('');
  return `<div class="hero-heat hh-week" aria-hidden="true">${rows}<span></span>${HEAT_AXIS}</div>`;
}
// 月 / 年：按标签分的环形图。同桶标签用同一色系、越小越浅；图例列占时最多的 6 块。
const TAG_RING_SHADES = [100, 72, 50, 34, 24];
const TAG_RING_LEGEND = 6;
function tagRingHtml(shares) {
  const { total, slices } = shares;
  if (!total || !slices.length) return '';
  const color = slice => slice.bucket === 'unrecorded'
    ? 'var(--track)'
    : `color-mix(in srgb, var(${bucketColorVar(slice.bucket)}) ${TAG_RING_SHADES[Math.min(slice.rank, TAG_RING_SHADES.length - 1)]}%, var(--card))`;
  let acc = 0;
  const stops = slices.map(slice => {
    const from = acc / total * 360;
    acc += slice.mins;
    return `${color(slice)} ${from.toFixed(2)}deg ${(acc / total * 360).toFixed(2)}deg`;
  }).join(', ');
  const top = [...slices].sort((a, b) => b.mins - a.mins);
  const rest = top.length - TAG_RING_LEGEND;
  const legend = top.slice(0, TAG_RING_LEGEND).map(slice => {
    const name = slice.bucket === 'unrecorded' ? t('bucket.unrecorded') : slice.tag;
    return `<div class="tr-item"><b style="background:${color(slice)}"></b><span class="tr-name">${esc(name)}</span><span class="tr-val">${esc(fmtPlainMins(slice.mins))} · ${esc(formatPercent(slice.mins, total))}</span></div>`;
  }).join('') + (rest > 0 ? `<div class="tr-item tr-rest"><b></b><span class="tr-name">${esc(t('hero.tagsRest', { n: rest }))}</span><span></span></div>` : '');
  return `<div class="hero-ring"><div class="tr-ring" aria-hidden="true" style="background:conic-gradient(${stops})"></div><div class="tr-legend">${legend}</div></div>`;
}
function bucketColorVar(bucket) {
  return { job: '--accent', maintain: '--maintain', leak: '--leak' }[bucket] || '--track';
}
function periodVisual(view, opts) {
  const { segments = [], rangeStart = null, now = new Date(), visual = 'ratio' } = opts;
  if (view === 'week') {
    const detail = visual === 'detail' && rangeStart ? weekHeatHtml(weekHeatCells(heatSpans(segments), rangeStart, now), rangeStart) : '';
    return { visual, kind: 'heat', detail };
  }
  if (view === 'month' || view === 'year') {
    return { visual, kind: 'tags', detail: visual === 'detail' ? tagRingHtml(tagShares(segments)) : '' };
  }
  return null;
}

// 结论卡上的桶分钟恰为 0 时写「0min」而不是「<1min」——后者暗示有过一点时长。
function heroCard(totals, label, extraAux, switchable = null) {
  const parts = bucketParts(totals);
  const bar = parts.map(part => {
    // 维持段 .55 透明度（设计稿：主线/偏航为焦点，维持退到背景）。
    const dim = part.bucket === 'maintain' ? ';opacity:0.55' : '';
    return `<div style="flex:${part.value};background:var(${part.color})${dim}"></div>`;
  }).join('');
  const aux = [
    t('hero.maintain', { dur: fmtPlainMins(totals.maintain) }),
    t('hero.unrecorded', { dur: fmtPlainMins(totals.unrecorded) }),
    totals.pending ? t('hero.pending', { dur: fmtMins(totals.pending) }) : '',
    ...extraAux
  ].filter(Boolean).join(' · ');
  return `
    <div class="day-hero">
      <div class="hero-nums">
        <div class="hero-cell">
          <div class="hero-label">${label}</div>
          <div class="hero-big">${fmtPlainMins(totals.job)}</div>
        </div>
        <div class="hero-cell">
          <div class="hero-label">${t('hero.leak')}</div>
          <div class="hero-leak">${fmtPlainMins(totals.leak)}</div>
        </div>
        ${switchable ? heroSwitch(switchable) : ''}
      </div>
      ${switchable && switchable.visual === 'detail' && switchable.detail
        ? `<div class="hero-visual" data-action="toggle-hero-visual">${switchable.detail}</div>`
        : `<div class="hero-bar"${switchable ? ' data-action="toggle-hero-visual"' : ''}>${bar}</div>`}
      <div class="hero-aux">${aux}</div>
    </div>`;
}

// 右上角状态标签：写「当前显示的是什么」，点它或点图形区就切换；读屏名说明现在和下一步。
function heroSwitch({ visual, kind, detail }) {
  const detailName = kind === 'tags' ? t('hero.visualTags') : t('hero.visualHeat');
  const showingDetail = visual === 'detail' && detail;
  const current = showingDetail ? detailName : t('hero.visualRatio');
  const next = showingDetail ? t('hero.visualRatio') : detailName;
  return `<button class="hero-switch" type="button" data-action="toggle-hero-visual" aria-label="${esc(t('hero.switchAria', { current, next }))}">${esc(current)}<span aria-hidden="true"> ⇄</span></button>`;
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

// v1.8.3「全文」布局的尺子刻度：整小时一道长刻线，余下每一刻钟一道短刻线（四舍五入，
// 凑满 4 道进位成 1 小时）。没有满格，任何时长都画得下；不到 8 分钟一道都不画。
function timelineTicks(mins) {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  let hours = Math.floor(m / 60);
  let quarters = Math.round((m % 60) / 15);
  if (quarters === 4) { hours += 1; quarters = 0; }
  return { hours, quarters };
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


// v1.4.0「现在」条：把日视图里那条**进行中的已发生段**（尾点是真实记录、结算到
// 此刻）提到顶部一眼可见——「正在做：X · 已 Ymin」。计时能力早已在（时长由下一条
// 派生、FAB 副文案也报「已 Ymin」），缺的只是**在做什么**这一眼在长列表里要滚到底
// 才看得到；本条只把既有派生数据前置，不新增字段、不加真计时器、不碰统计。只对
// 今天、且尾段是非空 what 的已发生段显示；未记录尾段沿用 FAB「续 X 起」入口，不重复。
// 点整条＝编辑该段（复用 start-edit，data-id 走既有点击委托）。
export function renderNowStrip(items, isToday, config = loadConfig()) {
  const el = document.getElementById('now-strip');
  if (!el) return;
  const ongoing = isToday
    ? (items || []).find(it => it.isOngoing && it.e && typeof it.e.what === 'string' && it.e.what.trim() !== '')
    : null;
  if (!ongoing) {
    el.hidden = true;
    el.innerHTML = '';
    el.removeAttribute('data-action');
    el.removeAttribute('data-id');
    el.removeAttribute('data-b');
    el.removeAttribute('aria-label');
    return;
  }
  const tag = (ongoing.e.tags || [])[0] || t('tag.unknown');
  const bucket = bucketForTag(tag, config);
  const dur = fmtMins(ongoing.mins);
  const what = ongoing.e.what;
  el.hidden = false;
  el.dataset.action = 'start-edit';
  el.dataset.id = ongoing.e.id;
  el.dataset.b = bucket;
  el.setAttribute('aria-label', t('nowStrip.doingAria', { what, dur }));
  el.innerHTML = `<span class="now-label">${esc(t('nowStrip.label'))}</span><span class="now-what">${esc(what)}</span><span class="now-dur">${esc(t('dur.ongoing', { dur }))}</span>`;
}


export function renderTimeline(items, opts = {}) {
  const { sheetEditId = null, plannedItems = [], isToday = false, nowLabel = '', readOnly = false, config = loadConfig(), density = 'full' } = opts;
  const el = document.getElementById('timeline');
  const layout = normalizeTimelineDensity(density);
  // v1.8.3 尺子刻度（取代 v1.8.2 的 4h 满格时长条）：只在「全文」布局画（行高随正文变，
  // 竖脊长短不再代表时长，时长交给数字和刻度）。刻度绝对、无上限，跨天同样多即同样长。
  // 纯装饰（aria-hidden），时长数字仍是可读真源；计划没有时长，不画。
  const durTicks = mins => {
    if (layout !== 'full') return '';
    const { hours, quarters } = timelineTicks(mins);
    if (!hours && !quarters) return '';
    return `<div class="e-ticks" aria-hidden="true">${'<i class="h"></i>'.repeat(hours)}${'<i class="q"></i>'.repeat(quarters)}</div>`;
  };
  // 桶色竖脊共用本帧配置，与统计同源；独立调用时才在上面读一次默认配置。
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
      // v1.8.1：有「标记已发生」时不再显示「计划」二字——虚线竖脊与「现在」线上方的位置
      // 已表达，单行等高行里把宽度留给正文；只读页没有动作，仍显示「计划」。读屏名不变。
      const card = `<div class="entry planned" data-b="${bucketForTag(displayTag, config)}" data-id="${esc(e.id)}" style="--mins:0"${interactiveAttrs}>
        <div class="e-time">${hhmm(e.ts)}</div>
        <div class="e-body">
          <div class="e-what">${esc(e.what || t('timeline.emptyWhat'))}</div>
          <span class="e-tag">#${esc(displayTag)}</span>
        </div>
        <div class="e-side">
          ${readOnly ? `<div class="e-dur">${t('timeline.planDur')}</div>` : `<div class="e-meta"><button class="mini-btn" type="button" data-action="confirm-planned" data-id="${esc(e.id)}" aria-label="${t('timeline.markDoneAria')}">${t('timeline.markDone')}</button></div>`}
        </div>
      </div>`;
      return readOnly ? card : swipeWrap(card, e, t('timeline.kindPlan'));
    }
    if (!e) {
      const gapTs = localDateTimeKey(start);
      const gapEnd = localDateTimeKey(end);
      const interactiveAttrs = readOnly ? '' : ` data-action="backfill-seg" data-kind="fill" data-ts="${esc(gapTs)}" data-end="${esc(gapEnd)}" role="button" tabindex="0" aria-label="${t('timeline.gapAria', { time: hhmm(start) })}"`;
      return `<div class="entry gap" data-b="unrecorded" data-gap-ts="${esc(gapTs)}" style="--mins:${Math.round(mins)}"${interactiveAttrs}>
        <div class="e-time">${hhmm(start)}</div>
        <div class="e-body">
          <div class="e-what">${t('timeline.gapWhat')}</div>
          <span class="e-tag">${t('timeline.gapTag')}</span>
        </div>
        <div class="e-side">
          <div class="e-dur">${fmtMins(mins)}</div>
          ${durTicks(mins)}
          ${readOnly ? '' : `<span class="e-cta">${t('timeline.fillIn')}</span>`}
        </div>
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
      ? `<button class="mini-btn" type="button" data-action="backfill-seg" data-kind="${isPlaceholder ? 'fill' : 'split'}" data-source-id="${esc(e.id)}" data-ts="${esc(segStartTs)}" data-end="${esc(segEndTs)}" aria-label="${t('timeline.fillAria')}">${t('timeline.fillIn')}</button>`
      : '';
    const cardLabel = isPlaceholder ? t('timeline.editGapAria') : t('timeline.editEntryAria', { what: esc(e.what) });
    const interactiveAttrs = readOnly ? '' : ` data-action="start-edit" role="button" tabindex="0" aria-label="${cardLabel}"`;
    // v1.8.1：单行等高——正文与 #标签 同一行，时长与动作链接在右列。「确认」可见文字
    // 只留动词，完整区间仍在读屏名里。
    const confirmBtn = !readOnly && confirmable
      ? `<button class="mini-btn" type="button" data-action="confirm-segment" data-id="${esc(e.id)}" data-end="${esc(endTs)}" aria-label="${esc(confirmText)}">${t('timeline.confirmShort')}</button>`
      : '';
    const card = `<div class="${entryClass}" data-b="${bucket}" data-id="${esc(e.id)}" style="--mins:${Math.round(mins)}"${interactiveAttrs}>
      <div class="e-time">${startLabel}</div>
      <div class="e-body">
        <div class="e-what">${esc(isPlaceholder ? (activePlaceholder ? t('timeline.notLoggedYet') : t('timeline.unrecorded')) : e.what)}</div>
        ${displayTag ? `<span class="e-tag">#${esc(displayTag)}</span>` : ''}
      </div>
      <div class="e-side">
        <div class="e-dur">${durStr}</div>
        ${durTicks(mins)}
        ${confirmBtn || fillBtn ? `<div class="e-meta">${confirmBtn}${fillBtn}</div>` : ''}
      </div>
    </div>`;
    return (readOnly || isPlaceholder) ? card : swipeWrap(card, e, t('timeline.kindEntry'));
  });
  // v56「现在」一线：只在今天渲染——未来（计划）在上、现在一线、过去在下；倒序里
  // 计划块正好排最前，插在它之后。没有计划时它就是容器首行的时间锚。
  if (isToday) {
    rows.splice(planned.length, 0, `<div class="tl-now" role="separator" aria-label="${esc(t('timeline.nowAria', { time: nowLabel }))}"><span class="tl-now-dot"></span><span class="tl-now-label">${esc(t('timeline.now', { time: nowLabel }))}</span><span class="tl-now-line"></span></div>`);
  }
  // v1.8.1：行布局由「更多」里的偏好决定；--mins 只在「按时长」模式下参与行高。
  el.innerHTML = `<div class="log" data-density="${esc(layout)}">${rows.join('')}</div>`;
}

export function renderSummaryRows(rows) {
  const el = document.getElementById('timeline');
  const html = rows.map(row => {
    const { totals } = row;
    const attrs = `type="button" data-action="drill" data-date="${esc(row.key)}" data-view="${esc(row.targetView)}" data-tip="${t('summary.drillTip')}" aria-label="${esc(t('summary.drillAria', { label: row.label }))}"`;
    // v1.8.0：没有可统计时长的日/月只占一行——不再画空条和一排「0%」。仍是同一个
    // 可下钻按钮，行数与顺序不变。
    if (!totals.total) {
      return `<button class="sum-row is-empty" ${attrs}>
      <div class="sum-top">
        <span class="sum-name">${esc(row.label)}</span>
        <span class="sum-total">${t('summary.noEntries')}</span>
      </div>
    </button>`;
    }
    const parts = bucketParts(totals);
    return `<button class="sum-row" ${attrs}>
      <div class="sum-top">
        <span class="sum-name">${esc(row.label)}</span>
        <span class="sum-total">${fmtMins(totals.total)}</span>
      </div>
      <div class="ruler-bar">
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
export const APP_VERSION = '1.15.5';

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
      <div class="form-inline-error" data-role="advanced-error" hidden></div>
    </div>`;
}

function renderMoreSheet(opts = {}) {
  const themePref = readUiPreference(THEME_KEY) || 'auto';
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
  const densityPref = normalizeTimelineDensity(readUiPreference(TIMELINE_DENSITY_KEY));
  const densityBtn = (value, label) =>
    `<button type="button" data-action="set-density" data-density="${value}" class="${densityPref === value ? 'active' : ''}" aria-pressed="${densityPref === value}" aria-label="${esc(t('density.aria', { label }))}">${esc(label)}</button>`;
  const isLegacyOrigin = Boolean(opts.isLegacyOrigin);
  const privacyHref = PRIVACY_URL[getLocale()] || PRIVACY_URL.zh;
  return `
    ${sheetHead({ title: t('more.title'), cancelText: t('more.close'), cancelAction: 'close-form', cancelAria: t('more.closeAria') })}
    <div class="form-sheet-body more-body">
      <div class="cell-group">
        <button class="cell-btn" id="summary-btn" type="button" data-action="copy-summary" aria-label="${t('more.copySummaryAria')}"><span data-role="cell-label">${t('more.copySummary')}</span>${cellChevron}</button>
        <button class="cell-btn" type="button" data-action="open-analytics" aria-label="${t('more.analyticsAria')}"><span data-role="cell-label">${t('more.analytics')}</span>${cellChevron}</button>
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
        <div class="cell-row"><span>${t('more.timeline')}</span>
          <div class="seg theme-seg" id="density-seg" role="group" aria-label="${t('more.timelineAria')}">
            ${densityBtn('full', t('density.full'))}${densityBtn('single', t('density.single'))}${densityBtn('scaled', t('density.scaled'))}
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
      <div class="cell-group">
        <a class="cell-btn" href="${SUPPORT_URL[getLocale()]}" target="_blank" rel="noopener" aria-label="${t('more.supportAria')}">${t('more.support')}${cellChevron}</a>
      </div>
      <div class="form-hint">${t('more.supportHint')}</div>
      <div class="app-version">${t('more.appVersion', { version: APP_VERSION })}</div>
    </div>`;
}

// 阶段格言编辑（v69，C13）：input 预填当前生效文案（未设置＝默认），清空保存＝隐藏，
// 「恢复默认」回填默认句（保存时 storage 会把恰等于默认的值归一化回「未设置」）。
// v1.5.0（D31）：格言位置二选一——单句格言（v69 原样保留）或文字轮播（导入的句子
// 每天按顺序显示一句）。两块面板都常驻 DOM，切换只动 hidden，未保存的输入互不丢失；
// 「完成」按当前选中的模式保存，另一模式的已存内容保持不动。
function renderMottoSheet(opts = {}) {
  const config = opts.config || loadConfig();
  const value = config.motto === undefined ? defaultMotto() : config.motto;
  // Editable text and its CAS baseline must share the controller's snapshot.
  const lib = opts.quotes || loadQuotes();
  const mode = lib.enabled ? 'quote' : 'motto';
  const modeBtn = (key, label) => `<button type="button" data-action="pick-motto-mode" data-mode="${key}" class="${mode === key ? 'active' : ''}" aria-pressed="${mode === key}">${label}</button>`;
  return `
    ${sheetHead({ title: t('motto.title'), cancelText: t('motto.cancel'), cancelAction: 'close-form', cancelAria: t('motto.cancelAria'), doneText: t('motto.done'), doneAction: 'save-motto', doneAria: t('motto.doneAria') })}
    <div class="form-sheet-body motto-body">
      <div class="seg motto-mode-seg" data-role="motto-mode-seg" role="group" aria-label="${t('motto.modeAria')}">
        ${modeBtn('motto', t('motto.modeSingle'))}
        ${modeBtn('quote', t('motto.modeQuotes'))}
      </div>
      <div class="motto-pane" data-role="motto-single"${mode === 'motto' ? '' : ' hidden'}>
        <div class="form-hint">${t('motto.hint')}</div>
        <div class="fl">
          <div class="fl-label">${t('motto.fieldLabel')}</div>
          <input type="text" class="inp" data-role="motto-input" maxlength="60" value="${esc(value)}" placeholder="${t('motto.placeholder')}" aria-label="${t('motto.inputAria')}">
        </div>
        <div class="form-hint">${t('motto.clearHint')}</div>
        <button class="cell-action" type="button" data-action="reset-motto-input" aria-label="${t('motto.resetAria')}">${t('motto.reset')}</button>
      </div>
      <div class="motto-pane" data-role="motto-quotes"${mode === 'quote' ? '' : ' hidden'}>
        <div class="form-hint">${t('quotes.hint')}</div>
        <div class="fl">
          <div class="fl-label">${t('quotes.fieldLabel')}</div>
          <textarea class="inp ta quotes-input" data-role="quotes-input" rows="6" placeholder="${esc(t('quotes.placeholder'))}" aria-label="${t('quotes.inputAria')}">${esc(lib.items.join('\n'))}</textarea>
          <div class="form-hint quotes-count" data-role="quotes-count" aria-live="polite"></div>
        </div>
        <button class="cell-action" type="button" data-action="pick-quotes-file">${t('quotes.importFile')}</button>
        <input type="file" data-role="quotes-file" accept=".txt,.md,.markdown,text/plain,text/markdown" hidden>
        ${opts.isLegacyOrigin ? '' : renderQuotePacks()}
        <div class="form-hint">${t('quotes.rules')}</div>
      </div>
      <div class="form-inline-error" data-role="motto-error" hidden></div>
    </div>`;
}

// D36（v1.7.0）：主题句库一键追加到草稿。旧 origin 只读（SPEC-002），不渲染这组新入口；
// 面板里不出现赞助、支持页或支付平台（D35 边界不变）。
function renderQuotePacks() {
  const rows = QUOTE_PACKS.map(pack => {
    const title = pack.title();
    return `<button class="cell-btn" type="button" data-action="add-quote-pack" data-pack="${pack.id}" aria-label="${esc(t('quotes.packAddAria', { title }))}"><span>${esc(title)}</span><span class="quote-pack-add" aria-hidden="true">${t('quotes.packAdd')}</span></button>`;
  }).join('');
  return `
        <div class="quote-packs" role="group" aria-labelledby="quote-packs-label">
          <div class="fl-label" id="quote-packs-label">${t('quotes.packsLabel')}</div>
          <div class="form-hint">${t('quotes.packsHint')}</div>
          <div class="cell-group">${rows}</div>
          <div class="form-hint quote-pack-status" data-role="quote-pack-status" aria-live="polite"></div>
        </div>`;
}

// ── v1.3.0 时间分析页（v1.5.1 前名「时间拨号盘」，版式仍是拨号盘式圆键）────────────────────────────────
// 纯渲染：model 由 sheet_controller.buildAnalyticsModel 用 stats.js 的
// comparePeriods / periodTrend / tagMinutes / summarizeEntries 算好后注入，
// 这里只把数字/百分比/趋势排进拨号盘 DOM。不碰事件（走 app.js 委托）、
// 不读 storage、不算业务逻辑。
const ANALYTICS_PAGE = 12;
const analyticsDiscClass = { job: 'job', maintain: 'maintain', leak: 'leak', unrecorded: 'unrec' };

// 圆内数字：短、同质。>=1h 用 h（四舍五入），否则分钟——精度留给「复制本期摘要」摘要。
function analyticsDiscNum(mins) {
  const h = Math.round(mins / 60);
  if (h >= 1000) return `${(h / 1000).toFixed(1)}<span class="u">kh</span>`;
  if (h >= 1) return `${h}<span class="u">h</span>`;
  return `${Math.round(mins)}<span class="u">m</span>`;
}

// 全量键：前 4 格＝四桶（含未记录），其余按时长降序续排标签。覆盖率不进网格。
function analyticsKeys(model) {
  const total = model.total || 0;
  const buckets = model.buckets || {};
  const keys = BUCKET_ORDER.map(bucket => ({
    key: 'b:' + bucket,
    bucket,
    kind: 'bucket',
    name: BUCKETS[bucket],
    mins: buckets[bucket] || 0,
    cap: t('analytics.capBucket', { name: BUCKETS[bucket], pct: formatPercent(buckets[bucket] || 0, total) })
  }));
  (model.tags || []).forEach(tag => keys.push({
    key: 't:' + tag.name,
    bucket: tag.bucket,
    kind: 'tag',
    name: tag.name,
    mins: tag.mins,
    cap: t('analytics.capTag', { name: esc(tag.name) })
  }));
  return keys;
}

function analyticsPageCount(keys) {
  return Math.max(1, Math.ceil(keys.length / ANALYTICS_PAGE));
}

// v1.8.1：柱宽封顶并整组居中——只有两三期时不再铺成两块无标注的大色块；最近一期
// 实色、更早的压浅，下方一行说明这是什么（此前已完成的 N 期，右为最近）。
function analyticsSpark(series, name) {
  if (!series || series.length < 2) return '';
  const max = Math.max(...series, 1);
  const n = series.length, gap = 3, w = 100;
  const bw = Math.min((w - gap * (n - 1)) / n, 9);
  const offset = (w - (bw * n + gap * (n - 1))) / 2;
  const bars = series.map((v, i) => {
    const h = Math.max(2, v / max * 38);
    const dim = i === n - 1 ? '' : ' class="past"';
    return `<rect${dim} x="${(offset + i * (bw + gap)).toFixed(2)}" y="${(40 - h).toFixed(2)}" width="${bw.toFixed(2)}" height="${h.toFixed(2)}" rx="1"/>`;
  }).join('');
  const caption = t('analytics.sparkCaption', { n, name });
  return `<svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="${esc(caption)}">${bars}</svg>
        <div class="an-spark-cap" aria-hidden="true">${esc(caption)}</div>`;
}

// v1.9.0 累计（只在「全部」）：这个桶/标签首次、最近出现的日子与出现过的天数。
function analyticsActivityLine(activity) {
  if (!activity) return '';
  if (!activity.days) return `<div class="an-activity">${esc(t('analytics.activityNone'))}</div>`;
  const first = parseDateKey(activity.first);
  const last = parseDateKey(activity.last);
  const vars = {
    days: activity.days,
    first: first ? shortDateLabel(first) : activity.first,
    last: last ? shortDateLabel(last) : activity.last
  };
  const text = plural(activity.days, { one: t('analytics.activityOne', vars), other: t('analytics.activityOther', vars) });
  return `<div class="an-activity">${esc(text)}</div>`;
}

// v1.9.0 常态：此前可比周期（同样走到这一点）的中位数；不足三期或本期记录不足时不显示。
function analyticsBaselineLine(baseline) {
  if (!baseline || baseline.verdict === 'insufficient') return '';
  const median = fmtMins(baseline.median);
  const basis = baseline.matched
    ? t('analytics.baselineMatched', { n: baseline.periods, dur: median })
    : t('analytics.baselineWhole', { n: baseline.periods, dur: median });
  let verdict;
  if (baseline.verdict === 'near') verdict = t('analytics.baselineNear');
  else if (baseline.verdict === 'above') verdict = t('analytics.baselineAbove', { dur: fmtMins(baseline.diff) });
  else verdict = t('analytics.baselineBelow', { dur: fmtMins(-baseline.diff) });
  return `<div class="an-baseline">${esc(verdict)}<span class="an-baseline-basis">${esc(basis)}</span></div>`;
}

// 顶部结论区：选中键的时长（大字）+ 占比 + 对比上期 delta + 常态 + 趋势 spark（v1.9.0 起标签也有）。
function renderAnalyticsDisplay(model, keys) {
  const total = model.total || 0;
  const selected = keys.find(k => k.key === model.selectedKey) || keys[0];
  const pct = formatPercent(selected.mins, total);
  const isAll = model.view === 'all';
  let subline;
  if (isAll) {
    subline = model.selectedKey === model.defaultKey
      ? t('analytics.sublineAll', { name: esc(selected.name), pct })
      : t('analytics.sublineAllReselect', { name: esc(selected.name), pct });
  } else {
    subline = model.selectedKey === model.defaultKey
      ? t('analytics.subline', { name: esc(selected.name), pct })
      : t('analytics.sublineReselect', { name: esc(selected.name), pct });
  }

  let delta;
  if (isAll) {
    delta = '';
  } else if (!model.comparable) {
    delta = t('analytics.deltaInsufficient');
  } else {
    const d = selected.kind === 'bucket'
      ? (model.deltaByBucket[selected.bucket] || 0)
      : (model.deltaByTag[selected.name] || 0);
    if (Math.abs(d) < 1) delta = t('analytics.deltaFlat');
    else if (d > 0) delta = t('analytics.deltaUp', { dur: fmtMins(d) });
    else delta = t('analytics.deltaDown', { dur: fmtMins(-d) });
  }

  let trendLine = '';
  let sparkHtml = '';
  if (model.trend) {
    const tr = model.trend;
    // 方向由近半/前半均值定，runLength 只数末尾连续同向的期数：最后一期回落时方向
    // 仍可能是 up 而 runLength 为 0。不足 2 期不说「连续 N 期」（v1.5.6）。
    const name = esc(selected.name);
    const run = tr.runLength;
    if (tr.direction === 'up') trendLine = run >= 2 ? t('analytics.trendUp', { name, n: run }) : t('analytics.trendUpLately', { name });
    else if (tr.direction === 'down') trendLine = run >= 2 ? t('analytics.trendDown', { name, n: run }) : t('analytics.trendDownLately', { name });
    else if (tr.direction === 'flat') trendLine = t('analytics.trendFlat', { name });
    sparkHtml = analyticsSpark(tr.comparableSeries, selected.name);
  }

  return `
    <div class="an-display" data-role="an-display">
      <div class="an-headline" aria-live="polite">${fmtMins(selected.mins)}</div>
      <div class="an-subline">${subline}</div>
      ${delta ? `<div class="an-delta">${delta}</div>` : ''}
      ${analyticsBaselineLine(model.baseline)}
      ${analyticsActivityLine(model.activity)}
      ${trendLine ? `<div class="an-trend">${trendLine}</div>` : ''}
      <div class="an-coverage">${t('analytics.coverage', { fraction: coverageDaysLabel(model.coverage.logged, model.coverage.days), total: fmtMins(total) })}</div>
      ${sparkHtml ? `<div class="an-spark an-spark-${selected.bucket}">${sparkHtml}</div>` : ''}
    </div>`;
}

function renderAnalyticsPad(model, keys) {
  const pages = analyticsPageCount(keys);
  const page = Math.min(Math.max(0, model.page || 0), pages - 1);
  const slice = keys.slice(page * ANALYTICS_PAGE, page * ANALYTICS_PAGE + ANALYTICS_PAGE);
  const total = model.total || 0;
  const tiles = slice.map(k => {
    const disc = analyticsDiscClass[k.bucket] || '';
    const sel = k.key === model.selectedKey ? ' sel' : '';
    const aria = t('analytics.tileAria', { name: k.name, dur: fmtMins(k.mins), pct: formatPercent(k.mins, total) });
    return `<button class="an-tile${sel}" type="button" data-action="analytics-pick" data-key="${esc(k.key)}" aria-pressed="${k.key === model.selectedKey}" aria-label="${esc(aria)}">
      <span class="an-disc ${disc}"><span class="an-big">${analyticsDiscNum(k.mins)}</span></span>
      <span class="an-cap">${k.cap}</span>
    </button>`;
  }).join('');

  const dots = Array.from({ length: pages }, (_, i) =>
    `<button class="an-dot${i === page ? ' on' : ''}" type="button" data-action="analytics-page" data-page="${i}" aria-label="${esc(t('analytics.pageAria', { n: i + 1 }))}"></button>`
  ).join('');
  const pager = pages <= 1 ? '' : `
    <div class="an-pager">
      <button class="an-arrow" type="button" data-action="analytics-page" data-page="${page - 1}" ${page === 0 ? 'disabled aria-disabled="true"' : ''} aria-label="${esc(t('analytics.prevPage'))}">‹</button>
      <div class="an-dots">${dots}</div>
      <button class="an-arrow" type="button" data-action="analytics-page" data-page="${page + 1}" ${page >= pages - 1 ? 'disabled aria-disabled="true"' : ''} aria-label="${esc(t('analytics.nextPage'))}">›</button>
    </div>`;

  return `
    <div class="an-padwrap">
      <div class="an-pad" data-role="an-pad" role="group" aria-label="${esc(t('analytics.title'))}">${tiles}</div>
    </div>
    ${pager}`;
}

// v1.9.0 事项排行：选中键（桶/标签）或关键词范围内，按「标签 + 正文」归并的时长排行。
// 只出现一次的事项整行就是「查看那天」；出现多次的点开列出日期，每个日期都能跳过去。
// 列表部分单独包在 [data-role=an-items-list]，输入关键词时只重渲它，输入框不丢焦点。
const ANALYTICS_ITEMS_PREVIEW = 8;

function analyticsItemDate(dateKey) {
  const d = parseDateKey(dateKey);
  return d ? shortDateLabel(d) : dateKey;
}

function analyticsItemRow(item, index, model, maxMins) {
  const text = item.text || t('analytics.itemNoText');
  const showTag = Boolean(model.itemsQuery) || model.itemsScopeKind === 'bucket';
  const tagPart = showTag ? `#${item.tag}` : '';
  const width = maxMins > 0 ? Math.max(2, Math.round(item.mins / maxMins * 100)) : 0;
  const bar = `<span class="an-item-bar an-item-bar-${esc(item.bucket)}" aria-hidden="true"><i style="width:${width}%"></i></span>`;
  const dur = fmtMins(item.mins);
  if (item.count === 1) {
    const date = analyticsItemDate(item.occurrences[0].date);
    const meta = [tagPart, date].filter(Boolean).join(' · ');
    const aria = t('analytics.itemDrillAria', { text, meta, dur });
    return `<li class="an-item">
      <button class="an-item-row" type="button" data-action="drill" data-date="${esc(item.occurrences[0].date)}" data-view="day" aria-label="${esc(aria)}">
        <span class="an-item-text">${esc(text)}</span><span class="an-item-dur">${esc(dur)}</span>
        <span class="an-item-meta">${esc(meta)}</span>${bar}
      </button>
    </li>`;
  }
  const open = model.openItemKey === item.key;
  const countLabel = t('analytics.itemCount', { n: item.count });
  const meta = [tagPart, countLabel].filter(Boolean).join(' · ');
  const aria = t('analytics.itemExpandAria', { text, meta, dur });
  const occ = open ? `<ul class="an-occ">${item.occurrences.map(o => {
    const date = analyticsItemDate(o.date);
    const odur = fmtMins(o.mins);
    const times = o.count > 1 ? ` ${t('analytics.itemCount', { n: o.count })}` : '';
    return `<li><button class="an-occ-row" type="button" data-action="drill" data-date="${esc(o.date)}" data-view="day" aria-label="${esc(t('analytics.occDrillAria', { date, dur: odur }))}"><span>${esc(date)}</span><span>${esc(odur)}${esc(times)}</span></button></li>`;
  }).join('')}</ul>` : '';
  return `<li class="an-item${open ? ' open' : ''}">
      <button class="an-item-row" type="button" data-action="analytics-item" data-index="${index}" aria-expanded="${open}" aria-label="${esc(aria)}">
        <span class="an-item-text">${esc(text)}</span><span class="an-item-dur">${esc(dur)}</span>
        <span class="an-item-meta">${esc(meta)}<span class="an-item-caret" aria-hidden="true"></span></span>${bar}
      </button>${occ}
    </li>`;
}

export function renderAnalyticsItemsList(model) {
  const items = model.items || [];
  const total = items.reduce((n, item) => n + item.mins, 0);
  const records = items.reduce((n, item) => n + item.count, 0);
  let caption;
  if (model.itemsQuery) {
    caption = items.length
      ? plural(records, {
        one: t('analytics.itemsQueryCaptionOne', { q: model.itemsQuery, dur: fmtMins(total), n: records }),
        other: t('analytics.itemsQueryCaptionOther', { q: model.itemsQuery, dur: fmtMins(total), n: records })
      })
      : t('analytics.itemsQueryEmpty', { q: model.itemsQuery });
  } else if (model.itemsScopeKind === 'none') {
    caption = t('analytics.itemsUnrecorded');
  } else {
    caption = items.length
      ? plural(items.length, {
        one: t('analytics.itemsCaptionOne', { name: model.itemsScopeName, n: items.length }),
        other: t('analytics.itemsCaptionOther', { name: model.itemsScopeName, n: items.length })
      })
      : t('analytics.itemsEmpty', { name: model.itemsScopeName });
  }
  const shown = model.itemsExpanded ? items : items.slice(0, ANALYTICS_ITEMS_PREVIEW);
  const maxMins = items.length ? items[0].mins : 0;
  const rows = shown.map((item, i) => analyticsItemRow(item, i, model, maxMins)).join('');
  const more = items.length > ANALYTICS_ITEMS_PREVIEW
    ? `<button class="an-items-more" type="button" data-action="analytics-items-toggle" aria-expanded="${Boolean(model.itemsExpanded)}">${esc(model.itemsExpanded ? t('analytics.itemsLess') : t('analytics.itemsAll', { n: items.length }))}</button>`
    : '';
  return `<div class="an-items-cap" aria-live="polite">${esc(caption)}</div>
    ${rows ? `<ol class="an-items-ol">${rows}</ol>` : ''}
    ${more}`;
}

function renderAnalyticsItems(model) {
  return `<section class="an-items" aria-labelledby="an-items-head">
      <h3 class="an-items-head" id="an-items-head">${esc(t('analytics.itemsHead'))}</h3>
      <input class="inp an-query" type="search" data-role="an-query" value="${esc(model.itemsQuery || '')}" placeholder="${esc(t('analytics.queryPlaceholder'))}" aria-label="${esc(t('analytics.queryAria'))}" autocomplete="off" enterkeyhint="search">
      <div data-role="an-items-list">${renderAnalyticsItemsList(model)}</div>
    </section>`;
}

function renderAnalyticsPeriodSeg(view) {
  const btn = (value, label) =>
    `<button type="button" data-action="analytics-period" data-period="${value}" class="${view === value ? 'active' : ''}" aria-pressed="${view === value}">${esc(label)}</button>`;
  return `<div class="an-period seg" role="group" aria-label="${esc(t('analytics.title'))}">
    ${btn('week', t('period.week'))}${btn('month', t('period.month'))}${btn('year', t('period.year'))}${btn('all', t('analytics.periodAll'))}
  </div>`;
}

// 可刷新部分（区间切换/选键/翻页）包在 [data-role=analytics-content] 里，
// sheet_controller.refreshAnalytics 只替换它，不重建整张 sheet。
export function renderAnalyticsContent(model) {
  const keys = analyticsKeys(model);
  return `
    ${renderAnalyticsPeriodSeg(model.view)}
    <div class="an-period-label">${esc(model.periodLabel || '')}</div>
    ${renderAnalyticsDisplay(model, keys)}
    ${renderAnalyticsPad(model, keys)}
    ${renderAnalyticsItems(model)}`;
}

export function renderAnalyticsSheet(model) {
  return `
    ${sheetHead({ title: t('analytics.title'), cancelText: t('analytics.close'), cancelAction: 'close-form', cancelAria: t('analytics.closeAria') })}
    <div class="form-sheet-body analytics-body">
      <div data-role="analytics-content">${renderAnalyticsContent(model)}</div>
      <div class="an-call-wrap">
        <button class="an-call" type="button" data-action="analytics-summary" aria-label="${esc(t('analytics.callAria'))}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1l-2.3 2.2z"/></svg>
        </button>
        <div class="an-call-label" data-role="an-call-label">${t('analytics.call')}</div>
      </div>
    </div>`;
}

export function renderFormSheet(opts) {
  if (opts && opts.mode === 'help') return renderHelpSheet();
  if (opts && opts.mode === 'motto') return renderMottoSheet(opts);
  if (opts && opts.mode === 'analytics') return renderAnalyticsSheet(opts.analytics || {});
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
  // v1.15.5：今天「已发生」的普通新建里，标题「记一条 · 刚才这一阵」、字段名「做了什么」
  // 与占位例句已说清要写什么，说明行只是第三遍复述，却把归类与常用标签往键盘下推约
  // 32px。只在这一种表单里隐藏；编辑（显示原正文）、计划、补录、过夜续记的说明行含义
  // 不同，照常显示。切到「计划」时由 sheet_controller.pickRecordMode 恢复。
  const hideLede = !isEdit && !isBackfill && !isOvernight && !isPlan && isToday;
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
    : `<div class="draft-note" data-role="draft-note" role="status" hidden>
        <span>${t('form.draftRestored')}</span>
        <button class="mini-btn" type="button" data-action="discard-draft" aria-label="${esc(t('form.draftDiscardAria'))}">${t('form.draftDiscard')}</button>
      </div>
      <textarea class="inp ta" id="form-what" rows="2" placeholder="${esc(whatPlaceholder)}"></textarea>
      <div class="auto-tag-note" data-role="auto-tag-note" role="status" hidden>
        <span data-role="auto-tag-text"></span>
        <button class="mini-btn" type="button" data-action="clear-auto-tag"></button>
      </div>
      <div class="what-suggest" data-role="what-suggest" role="group" aria-label="${esc(t('form.whatSuggestAria'))}" hidden></div>`;
  const chipWrap = isEdit
    ? `<div data-role="edit-chips">${chips}</div>`
    : `<div id="form-chips">${chips}</div>`;
  const customInput = isEdit
    ? `<input type="text" class="inp edit-tag-input" data-role="edit-custom-tag" list="tag-suggestions" value="${isKnownPickerTag ? '' : esc(tag)}" placeholder="${t('form.customTagPlaceholder')}">`
    : `<input type="text" class="inp" id="form-ctag" list="tag-suggestions" placeholder="${t('form.customTagOptional')}">`;
  // v1.5.0：联想只列**所选桶**的标签。旧版无论选哪个桶都联想主线名——在「维持」下
  // 顺手点中一个主线名，记录会静默记进主线（已登记标签从不改桶），联想本身就在引路。
  const datalist = `<datalist id="tag-suggestions">${renderTagSuggestions(config, bucket)}</datalist>`;
  const tagBlock = `
      <div class="fl">
        <div class="fl-label">${t('form.labelBucket')}</div>
        ${bucketSeg}
      </div>
      <div class="fl">
        <div class="fl-label">${t('form.labelTag')}</div>
        ${chipWrap}
        <div class="form-hint" data-role="no-tag-hint" hidden></div>
      </div>
      <div class="fl">
        <div class="fl-label">${t('form.labelCustomTag')}</div>
        ${customInput}
        ${datalist}
        <div class="form-hint" data-role="mainline-hint">${bucketHint(bucket)}</div>
        <div class="tag-owner-warn" data-role="tag-bucket-warn" role="status" hidden>
          <span data-role="tag-bucket-warn-text"></span>
          <button class="mini-btn" type="button" data-action="adopt-tag-bucket"></button>
        </div>
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
  // v1.5.0：切一刀 / 补一下先给「结果」再给「选择」——原段一行 + 按时长比例的切分条 +
  // 逐段文字行在上，一行四列的段内区间选择器在下。旧版是两整块带日期列的滚轮（各带一
  // 个对段内切分毫无意义的「现在」）占掉大半屏，切完长什么样只剩一段文字。比例条是
  // 文字行的图示（aria-hidden），可读信息仍以文字行为准。
  const backfillTimeSection = `
      <input type="hidden" id="form-ts">
      <input type="hidden" id="form-end-ts">
      <div class="cut-overview" data-role="cut-overview">
        <div class="cut-source" data-role="cut-source"></div>
        <div class="cut-bar" data-role="cut-bar" aria-hidden="true"></div>
        <div class="cut-scale" aria-hidden="true">
          <span data-role="cut-scale-start"></span>
          <span class="cut-scale-dur" data-role="backfill-duration"></span>
          <span data-role="cut-scale-end"></span>
        </div>
      </div>
      <div class="interval-preview" data-role="interval-preview" aria-live="polite"></div>
      <div class="fl backfill-time" data-role="backfill-range-mount"></div>
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
      <div class="form-sheet-what form-lede"${hideLede ? ' hidden' : ''}>${whatText}</div>
      ${isEdit ? editBody : newBody}
    </div>`;
}

// v1.10.0「做了什么」联想：最多三条历史事项，点一下填入正文并选回它上次用的标签。
export function renderWhatSuggestions(items) {
  return items.map((item, i) => {
    const tag = item.tag ? `<span class="what-sug-tag">#${esc(item.tag)}</span>` : '';
    const aria = item.tag ? t('form.whatSuggestPickTag', { text: item.text, tag: item.tag }) : t('form.whatSuggestPick', { text: item.text });
    return `<button class="what-sug" type="button" data-action="pick-what-suggestion" data-index="${i}" aria-label="${esc(aria)}"><span class="what-sug-text">${esc(item.text)}</span>${tag}</button>`;
  }).join('');
}

export function renderTagSuggestions(config, bucket) {
  const names = bucket === 'maintain' || bucket === 'leak'
    ? config.chips.filter(chip => chip.bucket === bucket).map(chip => chip.name)
    : config.mainline;
  return names.map(name => `<option value="${esc(name)}"></option>`).join('');
}

export function renderTagPicker(prefix, selectedTag, config = loadConfig(), bucketFilter = '') {
  const action = prefix === 'edit' ? 'pick-edit-tag' : 'pick-form-tag';
  const groups = chipGroups(config);
  const mainline = config.mainline.map(name => ({ name, bucket: 'job' }));
  const draftName = String(selectedTag || '').trim();
  // v1.14.0：自定义输入只差大小写（敲 sleep、设置里是 Sleep）时点亮那个已登记 chip，
  // 不再另画一个草稿——保存时本来就按 canonicalTagName 存成 Sleep（v85 同一性按 tagKey）。
  // 逐字相同的优先：存量里并存的 sleep 与 Sleep 各点各的，不会一点亮两个。
  const allNames = [...config.mainline, ...config.chips.map(chip => chip.name)];
  const shownName = !draftName || allNames.includes(draftName) ? draftName : canonicalTagName(draftName, config);
  const chipBtn = item => `<button class="chip chip-${item.bucket}${shownName && item.name === shownName ? ' sel' : ''}" type="button" data-action="${action}" data-tag="${esc(item.name)}" data-bucket="${item.bucket}" aria-pressed="${Boolean(shownName) && item.name === shownName}" aria-label="${esc(t('chip.selectAria', { name: item.name }))}">${esc(item.name)}</button>`;
  // 「已知」＝本栏（所选桶）里就有这个 chip，会直接高亮它、不另画草稿。v1.5.0 前是「任
  // 意桶里有」，于是在「维持」里敲一个主线名时本栏什么都不显示。
  const listed = name => (bucketFilter === 'job' ? config.mainline.includes(name)
    : bucketFilter ? config.chips.some(chip => chip.name === name && chip.bucket === bucketFilter)
      : config.mainline.includes(name) || config.chips.some(chip => chip.name === name));
  const known = !draftName || listed(shownName);
  // v1.5.0：输入的名字已是**别的桶**的标签（大小写不敏感）时，草稿 chip 用它真正归属
  // 的桶色——在「维持」一栏里冒出一个主线色的 chip，与下方的归属提醒互相印证。
  const owner = known ? '' : configuredBucketForTag(draftName, config);
  const draftBucket = owner || (bucketFilter === 'maintain' || bucketFilter === 'leak' ? bucketFilter : 'job');
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
  // tabindex keeps native summary controls in the sheet's keyboard focus trap.
  const faq = (question, answer) => `<details><summary class="cell-btn" tabindex="0"><span>${question}</span>${cellChevron}</summary>
    <p>${answer}</p></details>`;
  return `
    ${sheetHead({ title: t('help.title'), cancelText: t('more.close'), cancelAction: 'close-form', cancelAria: t('help.closeAria') })}
    <div class="form-sheet-body help-body">
      <section><h2>${t('help.startTitle')}</h2><p>${t('help.start')}</p><p>${t('help.edit')}</p><p>${t('help.migrate')}</p></section>
      <div class="cell-group help-topics">
      ${faq(t('help.bucketsQ'), t('help.bucketsA'))}
      ${faq(t('help.timeQ'), t('help.timeA'))}
      ${faq(t('help.reviewQ'), t('help.reviewA'))}
      ${faq(t('help.backupQ'), t('help.backupA'))}
      </div>
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
      <div class="import-detail" data-role="import-detail"></div>
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

// SPEC-017：标签总数达到这个数才给筛选框；历史主线达到这个数才折叠。少的时候
// 一眼就能看全，多一个控件只是噪音。
export const CFG_SEARCH_MIN_TAGS = 12;
export const CFG_HISTORY_FOLD_MIN = 3;

/**
 * 「N 条记录 / N entries」：英文按单复数换词尾（1 entry），中文两形同值。标签设置的
 * 条数、chip 读屏名称与合并提示共用这一处。
 * @param {number} n
 */
export function entriesCountLabel(n) {
  return plural(n, { one: t('cfg.countOne', { n }), other: t('cfg.countOther', { n }) });
}

/**
 * 时间分析的「记录覆盖 X/Y 天」：英文按分母 Y 换词尾（1/1 day），中文两形同值。
 * 结论区与复制的本期摘要共用这一处。
 * @param {number} logged
 * @param {number} days
 */
export function coverageDaysLabel(logged, days) {
  return plural(days, {
    one: t('analytics.coverageDaysOne', { logged, days }),
    other: t('analytics.coverageDaysOther', { logged, days })
  });
}

/**
 * SPEC-017：chip 面的读屏名称。模板首渲与 sheet_controller 的即时同步共用这一处，
 * 免得两边各拼一套、说法渐渐不一致。
 */
export function configChipLabel({ name, was = '', count = 0, isNew = false, current = false, dirty = false, pendingDelete = false }) {
  const parts = [name];
  if (was) parts.push(t('cfg.wasName', { name: was }));
  if (current) parts.push(t('cfg.currentBadge'));
  parts.push(isNew ? t('cfg.stateNew') : (count ? entriesCountLabel(count) : t('cfg.noEntries')));
  if (pendingDelete) parts.push(t('cfg.statePendingDelete'));
  else if (dirty) parts.push(t('cfg.stateEdited'));
  return parts.join(t('cfg.ariaJoin'));
}

// SPEC-017：标签云里的一个标签＝一个 chip 面 + 一张就地展开的编辑卡。收起时只有
// chip 面可见；编辑控件始终留在这一行的 DOM 里（hidden），所以 saveTagConfig /
// 暂存抓取回填读到的仍是每行自己的控件，保存事务一个字都不用改。chip 面上的
// 暂存状态（原名→新名、小点、删除线）由 sheet_controller.syncConfigRowFace 按控件
// 现值即时改写，这里只给初始态。
function cfgChipFace({ name, count = 0, isNew = false, current = false, open = false }) {
  const label = configChipLabel({ name: name || t('cfg.newNamePlaceholder'), count, isNew, current });
  return `<button class="cfg-chip" type="button" data-action="cfg-toggle-row" aria-expanded="${open}" aria-label="${esc(label)}">
      <span class="cfg-chip-dot" aria-hidden="true"></span>
      <span class="cfg-chip-was" aria-hidden="true" hidden></span>
      <span class="cfg-chip-name${name ? '' : ' is-empty'}" aria-hidden="true">${esc(name || t('cfg.newNamePlaceholder'))}</span>
      <span class="cfg-chip-meta" aria-hidden="true">${isNew ? esc(t('cfg.newShort')) : (count ? count : '')}</span>
      ${cellChevron}
    </button>`;
}

function cfgWasLine() {
  return '<div class="form-hint cfg-was" data-role="cfg-was" hidden></div>';
}

/**
 * v83：一行「待新建」的标签。没有 data-original-name（＝还不存在于 config），
 * 因此保存时空名直接当作没建过，而不是像已有行那样报错。右槽是「移除」而不是
 * v82 的待删除态——从未落库的东西没有「撤销」可言，直接把行拿掉即可。
 * SPEC-017：草稿一出生就是展开的（它要被命名），收起时若仍是空名就直接移除。
 * @param {string} kind 'mainline' | 'chip'
 * @param {string} bucket 'job' | 'maintain' | 'leak'
 */
export function renderConfigRowDraft(kind, bucket, longReview = false) {
  const isMainline = kind === 'mainline';
  const chipBucket = bucket === 'leak' ? 'leak' : 'maintain';
  return `<div class="cfg-row is-new is-open" data-b="${isMainline ? 'job' : chipBucket}" data-kind="${isMainline ? 'mainline' : 'chip'}" data-new="1" data-count="0">
    ${cfgChipFace({ name: '', isNew: true, open: true })}
    <div class="cfg-editor">
      <div class="cfg-line">
        <input class="inp cfg-name" type="text" value="" placeholder="${esc(t('cfg.newNamePlaceholder'))}" aria-label="${esc(t('cfg.nameAria'))}">
        ${isMainline ? '' : cfgBucketSeg(chipBucket)}
      </div>
      <div class="cfg-sub">${cfgLongOkBox(false, longReview)}<button class="mini-btn cfg-delete" type="button" data-action="cfg-remove-draft" aria-label="${esc(t('cfg.removeDraftAria'))}">${t('cfg.removeDraft')}</button></div>
    </div>
  </div>`;
}

function renderConfigSheet(config = loadConfig(), opts = {}) {
  const entries = opts.entries || [];
  // SPEC-007：签名手法是把日视图的桶色竖脊带进设置行——结构即信息，不用读控件
  // 就知道这行属于哪个桶。data-b 与时间轴同源（styles.css 按它上色）。
  const countLine = name => {
    const count = countEntriesWithTag(entries, name);
    return count ? `<span class="cfg-count">${entriesCountLabel(count)}</span>` : '';
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

  // 主线：当前主线排第一（accent 浅底 chip），其余是历史；历史的编辑卡里给「设为当前」。
  // data-original-* 记下打开时的值，chip 面据此判断「改过没有」。
  const mainlineRow = (name, index) => {
    const isCurrent = index === 0;
    const longOk = (config.mainlineLongOk || []).includes(name);
    const count = countEntriesWithTag(entries, name);
    return `<div class="cfg-row${isCurrent ? ' is-current' : ' is-history'}" data-b="job" data-kind="mainline" data-original-name="${esc(name)}" data-original-long-ok="${longOk ? 1 : 0}" data-count="${count}">
      ${cfgChipFace({ name, count, current: isCurrent })}
      <div class="cfg-editor" hidden>
        <div class="cfg-line">
          <input class="inp cfg-name" type="text" value="${esc(name)}" aria-label="${esc(t('cfg.nameAria'))}">
          ${isCurrent ? `<span class="cfg-badge">${t('cfg.currentBadge')}</span>`
            : `<button class="mini-btn cfg-set-current" type="button" data-action="set-current-mainline" data-name="${esc(name)}" aria-label="${esc(t('cfg.setCurrentAria', { name }))}">${t('cfg.setCurrent')}</button>`}
        </div>
        ${cfgWasLine()}
        <div class="cfg-sub">${cfgLongOkBox(longOk, config.longReview === true)}${countOrDelete(name)}</div>
      </div>
    </div>`;
  };

  // 维持/偏航：两段式分段控件替换原生 <select>——只有两个选项，segmented control
  // 比弹出式 select 更直接，且消灭 iOS 原生弹层的语言断裂（v78 之后尤其要紧：
  // 原生弹层不跟随应用语言，英文界面下会弹中文选项）。
  const chipRow = chip => {
    const count = countEntriesWithTag(entries, chip.name);
    return `<div class="cfg-row" data-b="${chip.bucket}" data-kind="chip" data-original-name="${esc(chip.name)}" data-original-bucket="${chip.bucket}" data-original-long-ok="${chip.longOk ? 1 : 0}" data-count="${count}">
      ${cfgChipFace({ name: chip.name, count })}
      <div class="cfg-editor" hidden>
        <div class="cfg-line">
          <input class="inp cfg-name" type="text" value="${esc(chip.name)}" aria-label="${esc(t('cfg.nameAria'))}">
          ${cfgBucketSeg(chip.bucket)}
        </div>
        ${cfgWasLine()}
        <div class="cfg-sub">${cfgLongOkBox(chip.longOk, config.longReview === true)}${countOrDelete(chip.name)}</div>
      </div>
    </div>`;
  };

  // v83：每组末尾一个「新建标签」，与 v82 的删除配成对——此前这张 sheet 能改名、
  // 改桶、设当前、删除，唯独不能建，而建是唯一还只能靠「先去记一条」的动作。
  // 空组仍留那句空态提示（说明标签也会在记录时自动长出来），但组本身不再是空盒。
  // SPEC-017：它是标签云里最后一个（虚线）chip。
  const addBtn = (kind, bucket, title) => `<button class="cfg-add" type="button" data-action="cfg-add-row" data-kind="${kind}" data-bucket="${bucket}" aria-label="${esc(t('cfg.addTagAria', { group: title }))}">${t('cfg.addTag')}</button>`;
  const section = (title, rowsHtml, kind, bucket, hint, opts2 = {}) => `<section class="cfg-section" data-bucket="${bucket}">
    <div class="chip-group-label">${title}</div>
    <div class="cfg-list${opts2.folded ? ' is-folded' : ''}">${rowsHtml}${addBtn(kind, bucket, title)}</div>
    ${rowsHtml ? '' : `<div class="form-hint cfg-empty">${t('cfg.emptySection')}</div>`}
    ${hint ? `<div class="form-hint">${hint}</div>` : ''}
  </section>`;

  const chipsOf = bucket => config.chips.filter(chip => chip.bucket === bucket).map(chipRow).join('');
  // SPEC-017：历史主线多了就收进一个折叠钮——日常只关心当前主线。折叠只藏「没动过、
  // 没展开」的历史行（CSS 判据），有暂存改动的行收起时照样露在外面。
  const historyCount = Math.max(0, config.mainline.length - 1);
  const foldHistory = historyCount >= CFG_HISTORY_FOLD_MIN;
  const mainlineRowsHtml = config.mainline.map((name, index) => {
    const row = mainlineRow(name, index);
    if (index !== 0 || !foldHistory) return row;
    return `${row}<button class="cfg-fold" type="button" data-action="cfg-toggle-history" aria-expanded="false">${esc(t('cfg.historyFold', { n: historyCount }))}${cellChevron}</button>`;
  }).join('');
  const totalTags = config.mainline.length + config.chips.length;
  const preview = opts.defaultsPreview;
  // v1.5.1：只有确实缺默认标签（删过、或切过界面语言）时才给入口，并直接说出缺哪几个。
  // 旧版常驻一个「添加本语言的默认标签」，平时点进去只会说「都已存在」——像个僵尸按钮。
  const missingDefaults = previewLocaleDefaultTags(config).additions;

  return `
    ${sheetHead({ title: t('cfg.title'), cancelText: t('cfg.cancel'), cancelAction: 'close-form', cancelAria: t('cfg.cancelAria'), doneText: t('cfg.done'), doneAction: 'save-tag-config', doneAria: t('cfg.doneAria') })}
    <div class="form-sheet-body config-body">
      <div class="form-hint">${t('cfg.renameHint')}</div>
      ${totalTags >= CFG_SEARCH_MIN_TAGS ? `<input class="inp cfg-search" type="search" data-role="cfg-search" placeholder="${esc(t('cfg.searchPlaceholder'))}" aria-label="${esc(t('cfg.searchAria'))}" autocomplete="off" enterkeyhint="search">
      <div class="form-hint cfg-no-match" data-role="cfg-no-match" hidden>${t('cfg.noMatch')}</div>` : ''}
      ${section(t('cfg.sectionMainline'), mainlineRowsHtml, 'mainline', 'job', t('cfg.mainlineHint'), { folded: foldHistory })}
      ${section(t('cfg.sectionMaintain'), chipsOf('maintain'), 'chip', 'maintain')}
      ${section(t('cfg.sectionLeak'), chipsOf('leak'), 'chip', 'leak')}
      ${missingDefaults.length && !preview ? `<div class="cell-group">
        <button class="cell-btn" type="button" data-action="preview-locale-defaults" aria-label="${esc(t('cfg.addDefaultsAria', { list: missingDefaults.map(chip => chip.name).join(t('cfg.listJoin')) }))}"><span data-role="cell-label">${esc(t('cfg.addDefaults', { n: missingDefaults.length, list: missingDefaults.slice(0, 3).map(chip => chip.name).join(t('cfg.listJoin')) + (missingDefaults.length > 3 ? t('cfg.listMore') : '') }))}</span>${cellChevron}</button>
      </div>` : ''}
      ${preview ? `<div class="cfg-defaults-preview" data-role="defaults-preview">
        ${preview.additions.length ? `<div class="form-hint" data-role="defaults-additions">${t('cfg.addDefaultsPreview', { n: preview.additions.length, list: preview.additions.map(chip => esc(chip.name)).join(t('cfg.listJoin')) })}</div>` : `<div class="form-hint" data-role="defaults-none">${t('cfg.addDefaultsNone')}</div>`}
        ${preview.skipped.length ? `<div class="form-hint" data-role="defaults-skipped">${t('cfg.addDefaultsSkipped', { n: preview.skipped.length, list: preview.skipped.map(esc).join(t('cfg.listJoin')) })}</div>` : ''}
        ${preview.additions.length ? `<div class="cfg-defaults-actions">
          <button class="cell-action" type="button" data-action="cancel-locale-defaults">${t('cfg.addDefaultsCancel')}</button>
          <button class="cell-action" type="button" data-action="apply-locale-defaults">${t('cfg.addDefaultsApply')}</button>
        </div>` : ''}
      </div>` : ''}
      <div class="form-inline-error" data-role="config-error" hidden></div>
    </div>`;
}

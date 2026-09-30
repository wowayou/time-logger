// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
import { t, tList } from './i18n.js';
import { addDays, localDateKey, normalizeTimestamp, nowStr, p2, parseDateKey, todayStr } from './time.js';
import { setButtonTip } from './ui.js';

const ITEM_H = 40;
const PAD = 80;
// 区间滚轮比单点滚轮矮一截（160 vs 200px，上下各露一行半）：一个选择器同时摆两端，
// 高度省下来留给上方的切分条与逐段预览。pad＝(容器高 − 行高) / 2，须与 .range-wheel 同步。
const RANGE_PAD = 60;
const DAYS_BACK = 90;
const DAYS_FWD = 7;
const MAX_WINDOW_DAYS = 800;
let wheelSequence = 0;

export function setTimeInputError(scope, msg) {
  if (!scope) return;
  let err = scope.querySelector('[data-role="time-error"]');
  if (!err && msg) {
    err = document.createElement('div');
    err.className = 'dt-error';
    err.dataset.role = 'time-error';
    scope.appendChild(err);
  }
  if (!err) return;
  err.textContent = msg || '';
  err.hidden = !msg;
  // ④ Keep a blocked-save reason visible above the iOS keyboard / scroll fold.
  if (msg && typeof err.scrollIntoView === 'function') {
    err.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function dateItemFor(d) {
  const y = d.getFullYear(), mo = d.getMonth() + 1, da = d.getDate();
  const dow = tList('date.weekdayNarrow')[d.getDay()] || '';
  return { val: `${y}-${p2(mo)}-${p2(da)}`, label: t('picker.wheelDayLabel', { m: mo, d: da, wd: dow }) };
}

// ⑤ The wheel only lists a finite date window (default ±90/+7). If the value the
// picker opens on falls outside it, the old findIndex→-1→Math.max(0,-1)=0 silently
// rewrote the entry's date to the window's first day on save. So the window must
// always span the opened value: extend back/forward to cover `anchor`, capped at
// MAX_WINDOW_DAYS so a wildly far date can't generate thousands of rows (the far
// edge is pinned as the boundary item instead).
function buildDateItems(anchor = '') {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let back = DAYS_BACK;
  let fwd = DAYS_FWD;
  const anchorDate = /^\d{4}-\d{2}-\d{2}$/.test(anchor) ? parseDateKey(anchor) : null;
  let pinBack = null;
  let pinFwd = null;
  if (anchorDate) {
    const diffDays = Math.round((anchorDate - today) / 86400000);
    if (diffDays < -back) {
      if (-diffDays <= MAX_WINDOW_DAYS) back = -diffDays;
      else pinBack = anchorDate; // beyond cap: pin as a single boundary row
    }
    if (diffDays > fwd) {
      if (diffDays <= MAX_WINDOW_DAYS) fwd = diffDays;
      else pinFwd = anchorDate;
    }
  }
  const items = [];
  if (pinBack) items.push(dateItemFor(pinBack));
  for (let i = back; i >= -fwd; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    items.push(dateItemFor(d));
  }
  if (pinFwd) items.push(dateItemFor(pinFwd));
  return items;
}

export function useCompactTimePicker() {
  return document.documentElement.clientWidth < 720;
}

export function mountTimePicker(mountEl, initialValue, onChangeCb) {
  const coarse = useCompactTimePicker();
  if (mountEl) mountEl.dataset.pickerCompact = coarse ? '1' : '0';
  if (coarse) mountWheel(mountEl, initialValue, onChangeCb);
  else mountDesktopTimePicker(mountEl, initialValue, onChangeCb);
}

function makeWheelCol(items, initIdx, onSelect, extraClass, ariaLabel, pad = PAD) {
  const col = document.createElement('div');
  col.className = 'wheel-col' + (extraClass ? ' ' + extraClass : '');
  col.tabIndex = 0;
  col.setAttribute('role', 'listbox');
  col.setAttribute('aria-label', ariaLabel);
  const colId = `wheel-${wheelSequence += 1}`;

  const inner = document.createElement('div');
  inner.style.paddingTop = pad + 'px';
  inner.style.paddingBottom = pad + 'px';

  items.forEach((item, idx) => {
    const el = document.createElement('div');
    el.className = 'wheel-item';
    el.id = `${colId}-${idx}`;
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', String(idx === initIdx));
    el.tabIndex = -1;
    el.textContent = item.label;
    el.addEventListener('click', () => col.scrollTo({ top: idx * ITEM_H, behavior: 'smooth' }));
    inner.appendChild(el);
  });
  col.appendChild(inner);

  function getIdx() {
    return Math.min(Math.max(Math.round(col.scrollTop / ITEM_H), 0), items.length - 1);
  }
  function paintSelection(index) {
    Array.from(inner.children).forEach((item, itemIndex) => {
      const selected = itemIndex === index;
      item.classList.toggle('is-selected', selected);
      item.setAttribute('aria-selected', String(selected));
    });
    col.setAttribute('aria-activedescendant', `${colId}-${index}`);
  }
  function onSnap() {
    const index = getIdx();
    paintSelection(index);
    onSelect(index);
  }

  if ('onscrollend' in window) {
    col.addEventListener('scrollend', onSnap);
  } else {
    let t;
    col.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(onSnap, 150); });
  }

  col.addEventListener('keydown', e => {
    const cur = getIdx();
    if (e.key === 'ArrowUp' && cur > 0) {
      e.preventDefault();
      col.scrollTo({ top: (cur - 1) * ITEM_H, behavior: 'smooth' });
    } else if (e.key === 'ArrowDown' && cur < items.length - 1) {
      e.preventDefault();
      col.scrollTo({ top: (cur + 1) * ITEM_H, behavior: 'smooth' });
    }
  });

  paintSelection(initIdx);
  requestAnimationFrame(() => { col.scrollTop = initIdx * ITEM_H; });
  return col;
}

function mountWheel(mountEl, initialValue, onChangeCb) {
  const [datePart, timePart] = (initialValue || nowStr()).split('T');
  const [initH, initM] = (timePart || '00:00').split(':').map(Number);
  // Build the window around the opened date so its row always exists; the picker
  // then lands exactly on it and never silently rewrites the date on save.
  const dateItems = buildDateItems(datePart);
  const hourItems = Array.from({length: 24}, (_, i) => ({ val: p2(i), label: p2(i) }));
  const minItems  = Array.from({length: 60}, (_, i) => ({ val: p2(i), label: p2(i) }));

  const foundIdx = dateItems.findIndex(x => x.val === datePart);
  const initDateIdx = foundIdx >= 0 ? foundIdx : dateItems.findIndex(x => x.val === todayStr());

  let selDate = initDateIdx, selH = initH, selM = initM;

  function emit() {
    onChangeCb(`${dateItems[selDate].val}T${p2(selH)}:${p2(selM)}`);
  }

  mountEl.innerHTML = '';

  const picker = document.createElement('div');
  picker.className = 'wheel-picker';
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-label', t('picker.wheelAria'));

  const dateCol = makeWheelCol(dateItems, initDateIdx, idx => { selDate = idx; emit(); }, 'wheel-col-date', t('picker.colDate'));
  const div1 = document.createElement('div'); div1.className = 'wheel-divider'; div1.setAttribute('aria-hidden', 'true');
  const hCol = makeWheelCol(hourItems, initH, idx => { selH = idx; emit(); }, '', t('picker.colHour'));
  const div2 = document.createElement('div'); div2.className = 'wheel-divider'; div2.setAttribute('aria-hidden', 'true');
  const mCol = makeWheelCol(minItems, initM, idx => { selM = idx; emit(); }, '', t('picker.colMinute'));

  const highlight = document.createElement('div');
  highlight.className = 'wheel-highlight';

  [dateCol, div1, hCol, div2, mCol, highlight].forEach(el => picker.appendChild(el));

  const actions = document.createElement('div');
  actions.className = 'wheel-actions';

  const nowBtn = document.createElement('button');
  nowBtn.className = 'wheel-now-btn';
  nowBtn.type = 'button';
  nowBtn.textContent = t('picker.now');
  setButtonTip(nowBtn, t('picker.nowTip'), t('picker.nowAria'));
  nowBtn.addEventListener('click', () => {
    const n = new Date();
    const ds = `${n.getFullYear()}-${p2(n.getMonth()+1)}-${p2(n.getDate())}`;
    const idx = dateItems.findIndex(x => x.val === ds);
    if (idx >= 0) { selDate = idx; dateCol.scrollTo({ top: idx * ITEM_H, behavior: 'smooth' }); }
    selH = n.getHours(); selM = n.getMinutes();
    hCol.scrollTo({ top: selH * ITEM_H, behavior: 'smooth' });
    mCol.scrollTo({ top: selM * ITEM_H, behavior: 'smooth' });
    emit();
  });

  actions.appendChild(nowBtn);
  mountEl.appendChild(picker);
  mountEl.appendChild(actions);
}

// v1.5.0：段内区间选择器（切一刀 / 补一下共用）。原段落在一个自然日内，日期列只会引人
// 选出非法值，所以这里只选时刻：两端各自夹在原段 [minTs, maxTs] 里（开始 ≤ 段尾−1 分、
// 结束 ≥ 段首+1 分），滚到段外的值回弹到最近的合法时刻。「开始 < 结束」刻意不在这里
// 强制——一端推着另一端跑会让人找不到自己刚设的值；交给事务 planner 在预览里报错。
// 窄屏（<720）一行四列「时:分 – 时:分」替代原来两整块带日期列的滚轮，高度减半；宽屏
// 两枚 HH:MM 文本框（↑↓ 步进 1 分钟，Shift 步进 10 分钟）。两种形态都带贴边捷径。
export function mountRangePicker(mountEl, range, onChangeCb) {
  const minTs = normalizeTimestamp(range && range.minTs);
  const maxTs = normalizeTimestamp(range && range.maxTs);
  if (!mountEl || !minTs || !maxTs || maxTs <= minTs) return null;
  const day = minTs.slice(0, 10);
  const nextDay = localDateKey(addDays(parseDateKey(day), 1));
  const toMin = ts => {
    const value = normalizeTimestamp(ts);
    if (!value) return null;
    if (value.slice(0, 10) !== day) return value > minTs ? 1440 : 0;
    return Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
  };
  const toTs = m => (m >= 1440 ? `${nextDay}T00:00` : `${day}T${p2(Math.floor(m / 60))}:${p2(m % 60)}`);
  const label = m => (m >= 1440 ? '24:00' : `${p2(Math.floor(m / 60))}:${p2(m % 60)}`);
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const lo = toMin(minTs);
  const hi = toMin(maxTs);
  const bounds = { start: [lo, hi - 1], end: [lo + 1, hi] };
  const value = {
    start: clamp(toMin(range.startTs) ?? lo, ...bounds.start),
    end: clamp(toMin(range.endTs) ?? hi, ...bounds.end)
  };
  const emit = () => onChangeCb({ startTs: toTs(value.start), endTs: toTs(value.end) });
  const labels = {
    start: { name: t('picker.rangeStart'), hour: t('picker.rangeStartHour'), minute: t('picker.rangeStartMinute'), text: t('picker.rangeStartTextAria') },
    end: { name: t('picker.rangeEnd'), hour: t('picker.rangeEndHour'), minute: t('picker.rangeEndMinute'), text: t('picker.rangeEndTextAria') }
  };

  const coarse = useCompactTimePicker();
  mountEl.dataset.pickerCompact = coarse ? '1' : '0';
  mountEl.innerHTML = '';
  const view = coarse ? buildRangeWheel() : buildRangeFields();

  function set(which, next) {
    const clamped = clamp(next, ...bounds[which]);
    view.show(which, clamped);
    if (clamped === value[which]) return;
    value[which] = clamped;
    emit();
  }

  function buildRangeWheel() {
    const head = document.createElement('div');
    head.className = 'range-wheel-head';
    head.setAttribute('aria-hidden', 'true');
    head.innerHTML = '<span></span><span></span>';
    head.children[0].textContent = labels.start.name;
    head.children[1].textContent = labels.end.name;
    const picker = document.createElement('div');
    picker.className = 'wheel-picker range-wheel';
    picker.setAttribute('role', 'group');
    picker.setAttribute('aria-label', t('picker.rangeAria'));
    const minuteItems = Array.from({ length: 60 }, (_, i) => ({ val: i, label: p2(i) }));
    const cols = {};
    const sep = text => {
      const el = document.createElement('div');
      el.className = 'wheel-sep';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = text;
      return el;
    };
    ['start', 'end'].forEach(which => {
      const [a, b] = bounds[which];
      const hours = Array.from({ length: Math.floor(b / 60) - Math.floor(a / 60) + 1 }, (_, i) => Math.floor(a / 60) + i);
      const pick = (part, v) => {
        const cur = value[which];
        const raw = part === 'h' ? v * 60 + (cur % 60) : Math.floor(cur / 60) * 60 + v;
        const next = clamp(raw, a, b);
        // 停在段外 → 滚回最近的合法值；那次程序滚动的 scrollend 回到这里时 raw===next===cur，自然收敛。
        if (next !== raw) show(which, next);
        if (next !== cur) { value[which] = next; emit(); }
      };
      const hCol = makeWheelCol(hours.map(h => ({ val: h, label: p2(h) })), Math.max(0, hours.indexOf(Math.floor(value[which] / 60))),
        idx => pick('h', hours[idx]), 'wheel-col-range', labels[which].hour, RANGE_PAD);
      const mCol = makeWheelCol(minuteItems, value[which] % 60,
        idx => pick('m', idx), 'wheel-col-range', labels[which].minute, RANGE_PAD);
      cols[which] = { hCol, mCol, hours };
      if (which === 'end') picker.appendChild(sep('–'));
      picker.append(hCol, sep(':'), mCol);
    });
    const highlight = document.createElement('div');
    highlight.className = 'wheel-highlight';
    picker.appendChild(highlight);
    mountEl.append(head, picker);
    function show(which, m) {
      const { hCol, mCol, hours } = cols[which];
      hCol.scrollTo({ top: Math.max(0, hours.indexOf(Math.floor(m / 60))) * ITEM_H, behavior: 'smooth' });
      mCol.scrollTo({ top: (m % 60) * ITEM_H, behavior: 'smooth' });
    }
    return { show };
  }

  function buildRangeFields() {
    const row = document.createElement('div');
    row.className = 'range-fields';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', t('picker.rangeAria'));
    const inputs = {};
    ['start', 'end'].forEach(which => {
      if (which === 'end') {
        const dash = document.createElement('span');
        dash.className = 'range-dash';
        dash.setAttribute('aria-hidden', 'true');
        dash.textContent = '–';
        row.appendChild(dash);
      }
      const field = document.createElement('label');
      field.className = 'range-field';
      const name = document.createElement('span');
      name.textContent = labels[which].name;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'inp range-inp';
      input.dataset.role = `range-${which}-text`;
      input.setAttribute('inputmode', 'numeric');
      input.setAttribute('aria-label', labels[which].text);
      input.value = label(value[which]);
      const commit = () => {
        // 全角冒号 \uFF1A 也认：中文输入法下敲「9：20」是常态。
        const match = /^(\d{1,2})\s*[:\uFF1A.]?\s*(\d{2})$/.exec(input.value.trim());
        const typed = match && Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : null;
        if (typed === null || typed > 1440) { input.value = label(value[which]); return; }
        set(which, typed);
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', e => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
        set(which, value[which] + step);
      });
      field.append(name, input);
      row.appendChild(field);
      inputs[which] = input;
    });
    mountEl.appendChild(row);
    return { show: (which, m) => { inputs[which].value = label(m); } };
  }

  const snaps = document.createElement('div');
  snaps.className = 'range-snaps';
  [
    ['start', lo, t('picker.rangeSnapStart', { time: label(lo) }), t('picker.rangeSnapStartAria', { time: label(lo) })],
    ['end', hi, t('picker.rangeSnapEnd', { time: label(hi) }), t('picker.rangeSnapEndAria', { time: label(hi) })]
  ]
    .forEach(([which, target, text, aria]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'range-snap';
      btn.dataset.snap = which;
      btn.textContent = text;
      btn.setAttribute('aria-label', aria);
      btn.addEventListener('click', () => set(which, target));
      snaps.appendChild(btn);
    });
  mountEl.appendChild(snaps);
  return { set: (which, ts) => set(which, toMin(ts) ?? value[which]) };
}

function mountDesktopTimePicker(mountEl, initialValue, onChangeCb) {
  let value = normalizeTimestamp(initialValue) || nowStr();
  mountEl.innerHTML = '';

  let viewY = parseInt(value.slice(0, 4));
  let viewM0 = parseInt(value.slice(5, 7)) - 1;

  const wrap = document.createElement('div');
  wrap.className = 'dt-picker';
  mountEl.appendChild(wrap);

  // Trigger button
  const triggerBtn = document.createElement('button');
  triggerBtn.type = 'button';
  triggerBtn.className = 'dt-trigger';
  triggerBtn.dataset.act = 'toggle';
  triggerBtn.setAttribute('aria-label', t('picker.triggerAria'));
  triggerBtn.innerHTML =
    '<span class="dt-trigger-text"></span>' +
    '<svg class="dt-cal-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
      '<rect x="1" y="2.5" width="14" height="12" rx="2"/>' +
      '<line x1="5" y1="1" x2="5" y2="4"/>' +
      '<line x1="11" y1="1" x2="11" y2="4"/>' +
      '<line x1="1" y1="6.5" x2="15" y2="6.5"/>' +
    '</svg>';
  wrap.appendChild(triggerBtn);

  // Popover
  const popEl = document.createElement('div');
  popEl.className = 'dt-pop';
  popEl.setAttribute('role', 'dialog');
  popEl.setAttribute('aria-label', t('picker.popAria'));
  popEl.hidden = true;
  wrap.appendChild(popEl);

  // Precise text input (secondary path for keyboard / a11y)
  const preciseDiv = document.createElement('div');
  preciseDiv.className = 'dt-precise';
  const preciseLabel = document.createElement('span');
  preciseLabel.className = 'dt-precise-label';
  preciseLabel.textContent = t('picker.preciseLabel');
  preciseDiv.appendChild(preciseLabel);
  const textEl = document.createElement('input');
  textEl.type = 'text';
  textEl.className = 'inp';
  textEl.dataset.role = 'text';
  textEl.setAttribute('inputmode', 'numeric');
  textEl.placeholder = 'YYYY-MM-DD HH:mm';
  textEl.setAttribute('aria-label', t('picker.preciseAria'));
  preciseDiv.appendChild(textEl);
  wrap.appendChild(preciseDiv);

  // Error display
  const errEl = document.createElement('div');
  errEl.className = 'dt-error';
  errEl.dataset.role = 'time-error';
  errEl.hidden = true;
  wrap.appendChild(errEl);

  // --- Calendar rendering (rebuilds popEl contents each call) ---
  function renderCal() {
    popEl.innerHTML = '';

    // Header: ‹ year month ›
    const head = document.createElement('div');
    head.className = 'dt-cal-head';
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button'; prevBtn.className = 'dt-nav';
    prevBtn.setAttribute('aria-label', t('picker.prevMonth')); prevBtn.dataset.act = 'prev-month';
    prevBtn.textContent = '‹';
    const monthLabel = document.createElement('span');
    monthLabel.textContent = t('picker.calendarMonth', { y: viewY, m: viewM0 + 1 });
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button'; nextBtn.className = 'dt-nav';
    nextBtn.setAttribute('aria-label', t('picker.nextMonth')); nextBtn.dataset.act = 'next-month';
    nextBtn.textContent = '›';
    head.appendChild(prevBtn); head.appendChild(monthLabel); head.appendChild(nextBtn);
    popEl.appendChild(head);

    // Day-of-week header
    const dow = document.createElement('div');
    dow.className = 'dt-cal-dow';
    tList('date.weekdayNarrow').forEach(d => {
      const s = document.createElement('span'); s.textContent = d; dow.appendChild(s);
    });
    popEl.appendChild(dow);

    // Calendar grid
    const grid = document.createElement('div');
    grid.className = 'dt-cal-grid';
    const firstDay = new Date(viewY, viewM0, 1).getDay();
    const lastDate = new Date(viewY, viewM0 + 1, 0).getDate();
    const td = new Date();
    const todayY = td.getFullYear(), todayM0 = td.getMonth(), todayDate = td.getDate();
    const selY = parseInt(value.slice(0, 4));
    const selM0 = parseInt(value.slice(5, 7)) - 1;
    const selDate = parseInt(value.slice(8, 10));

    for (let i = 0; i < firstDay; i++) {
      const blank = document.createElement('button');
      blank.type = 'button'; blank.className = 'dt-day dt-blank';
      blank.disabled = true; blank.setAttribute('aria-hidden', 'true'); blank.tabIndex = -1;
      blank.textContent = '';
      grid.appendChild(blank);
    }
    for (let d = 1; d <= lastDate; d++) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'dt-day';
      btn.dataset.act = 'pick-day'; btn.dataset.day = String(d);
      btn.setAttribute('aria-label', t('picker.dayAria', { y: viewY, m: viewM0 + 1, d }));
      btn.textContent = String(d);
      if (viewY === todayY && viewM0 === todayM0 && d === todayDate) btn.classList.add('is-today');
      if (viewY === selY && viewM0 === selM0 && d === selDate) btn.classList.add('is-sel');
      grid.appendChild(btn);
    }
    popEl.appendChild(grid);

    // Time stepper
    const timeDiv = document.createElement('div');
    timeDiv.className = 'dt-time';

    function makeStep(role, label, upAct, dnAct, val, max) {
      const step = document.createElement('div');
      step.className = 'dt-step';
      const upBtn = document.createElement('button');
      upBtn.type = 'button'; upBtn.className = 'dt-step-btn';
      upBtn.dataset.act = upAct; upBtn.setAttribute('aria-label', label + '+1');
      upBtn.textContent = '▲';
      const inp = document.createElement('input');
      inp.type = 'number'; inp.className = 'dt-step-inp';
      inp.min = '0'; inp.max = String(max);
      inp.dataset.role = role; inp.setAttribute('aria-label', label);
      inp.value = String(val);
      const dnBtn = document.createElement('button');
      dnBtn.type = 'button'; dnBtn.className = 'dt-step-btn';
      dnBtn.dataset.act = dnAct; dnBtn.setAttribute('aria-label', label + '-1');
      dnBtn.textContent = '▼';
      step.appendChild(upBtn); step.appendChild(inp); step.appendChild(dnBtn);
      return { step, inp };
    }

    const curH = parseInt(value.slice(11, 13));
    const curM = parseInt(value.slice(14, 16));
    const hParts = makeStep('hour-inp', t('picker.stepHour'), 'hour-up', 'hour-down', curH, 23);
    const mParts = makeStep('min-inp',  t('picker.stepMinute'), 'min-up',  'min-down',  curM, 59);

    const colon = document.createElement('span');
    colon.className = 'dt-colon'; colon.textContent = ':';

    const nowBtn = document.createElement('button');
    nowBtn.type = 'button'; nowBtn.className = 'dt-now';
    nowBtn.dataset.act = 'now'; nowBtn.dataset.tip = t('picker.nowAria');
    nowBtn.setAttribute('aria-label', t('picker.nowAria'));
    nowBtn.textContent = t('picker.now');

    timeDiv.appendChild(hParts.step); timeDiv.appendChild(colon);
    timeDiv.appendChild(mParts.step); timeDiv.appendChild(nowBtn);
    popEl.appendChild(timeDiv);

    // Typed-number-input handlers (no re-render to keep focus)
    hParts.inp.addEventListener('change', () => {
      const h = Math.min(23, Math.max(0, parseInt(hParts.inp.value) || 0));
      hParts.inp.value = String(h);
      const nv = normalizeTimestamp(value.slice(0, 10) + 'T' + p2(h) + ':' + value.slice(14, 16));
      if (nv) { value = nv; sync(); }
    });
    mParts.inp.addEventListener('change', () => {
      const m = Math.min(59, Math.max(0, parseInt(mParts.inp.value) || 0));
      mParts.inp.value = String(m);
      const nv = normalizeTimestamp(value.slice(0, 10) + 'T' + value.slice(11, 13) + ':' + p2(m));
      if (nv) { value = nv; sync(); }
    });
  }

  function sync(emit = true) {
    const parts = value.split('T');
    const dp = parts[0].split('-');
    triggerBtn.querySelector('.dt-trigger-text').textContent =
      dp[0] + '/' + dp[1] + '/' + dp[2] + ' ' + parts[1];
    textEl.value = value.replace('T', ' ');
    setTimeInputError(wrap, '');
    if (emit) onChangeCb(value);
  }

  // --- Popover lifecycle ---
  let ac = null;

  function reposition() {
    if (popEl.hidden) return;
    const rect = triggerBtn.getBoundingClientRect();
    if (rect.bottom + 300 > window.innerHeight) {
      popEl.classList.add('dt-pop-up');
    } else {
      popEl.classList.remove('dt-pop-up');
    }
  }

  function openPop() {
    if (!popEl.hidden) return;
    renderCal();
    popEl.hidden = false;
    ac = new AbortController();
    const { signal } = ac;
    document.addEventListener('keydown', e => {
      if (popEl.hidden || !document.contains(wrap)) return;
      if (e.key === 'Escape') { e.stopPropagation(); closePop(); }
    }, { capture: true, signal });
    document.addEventListener('pointerdown', e => {
      if (popEl.hidden || !document.contains(wrap)) return;
      if (!wrap.contains(e.target)) closePop();
    }, { signal });
    window.addEventListener('resize', reposition, { signal });
    document.addEventListener('scroll', reposition, { signal, passive: true });
    reposition();
  }

  function closePop() {
    if (popEl.hidden) return;
    popEl.hidden = true;
    if (ac) { ac.abort(); ac = null; }
    triggerBtn.focus();
  }

  // --- Delegated click for all data-act controls ---
  wrap.addEventListener('click', e => {
    const target = e.target.closest('[data-act]');
    if (!target) return;
    const act = target.dataset.act;
    if (act === 'toggle') { if (popEl.hidden) openPop(); else closePop(); return; }
    if (act === 'prev-month') {
      viewM0--; if (viewM0 < 0) { viewM0 = 11; viewY--; }
      renderCal(); return;
    }
    if (act === 'next-month') {
      viewM0++; if (viewM0 > 11) { viewM0 = 0; viewY++; }
      renderCal(); return;
    }
    if (act === 'pick-day') {
      const d = parseInt(target.dataset.day || '0');
      if (d > 0) {
        const nv = normalizeTimestamp(viewY + '-' + p2(viewM0 + 1) + '-' + p2(d) + 'T' + value.slice(11));
        if (nv) { value = nv; sync(); renderCal(); }
      }
      return;
    }
    if (act === 'hour-up') {
      const h = parseInt(value.slice(11, 13));
      if (h < 23) { const nv = normalizeTimestamp(value.slice(0, 10) + 'T' + p2(h + 1) + ':' + value.slice(14, 16)); if (nv) { value = nv; sync(); } }
      renderCal(); return;
    }
    if (act === 'hour-down') {
      const h = parseInt(value.slice(11, 13));
      if (h > 0) { const nv = normalizeTimestamp(value.slice(0, 10) + 'T' + p2(h - 1) + ':' + value.slice(14, 16)); if (nv) { value = nv; sync(); } }
      renderCal(); return;
    }
    if (act === 'min-up') {
      const m = parseInt(value.slice(14, 16));
      if (m < 59) { const nv = normalizeTimestamp(value.slice(0, 10) + 'T' + value.slice(11, 13) + ':' + p2(m + 1)); if (nv) { value = nv; sync(); } }
      renderCal(); return;
    }
    if (act === 'min-down') {
      const m = parseInt(value.slice(14, 16));
      if (m > 0) { const nv = normalizeTimestamp(value.slice(0, 10) + 'T' + value.slice(11, 13) + ':' + p2(m - 1)); if (nv) { value = nv; sync(); } }
      renderCal(); return;
    }
    if (act === 'now') {
      value = nowStr();
      const nd = new Date();
      viewY = nd.getFullYear(); viewM0 = nd.getMonth();
      sync(); renderCal(); return;
    }
  });

  // --- Text input (reused verbatim from previous implementation) ---
  function commitText() {
    const ts = normalizeTimestamp(textEl.value);
    if (!ts) {
      onChangeCb(textEl.value);
      setTimeInputError(wrap, t('validate.needFullDateTime'));
      return;
    }
    value = ts;
    sync();
  }
  textEl.addEventListener('input', () => {
    onChangeCb(textEl.value);
    const err = wrap.querySelector('[data-role="time-error"]');
    if (err && !err.hidden) {
      const ts = normalizeTimestamp(textEl.value);
      if (ts) {
        value = ts;
        sync();
      } else {
        setTimeInputError(wrap, t('validate.needFullDateTime'));
      }
    }
  });
  textEl.addEventListener('change', commitText);
  textEl.addEventListener('blur', commitText);

  sync(false);
}

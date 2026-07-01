// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
import { normalizeTimestamp, nowStr, p2, parseDateKey, todayStr } from './time.js';
import { setButtonTip } from './ui.js';

const ITEM_H = 40;
const PAD = 80;
const DAYS_BACK = 90;
const DAYS_FWD = 7;
const MAX_WINDOW_DAYS = 800;

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
  const dow = '日一二三四五六'[d.getDay()];
  return { val: `${y}-${p2(mo)}-${p2(da)}`, label: `${mo}月${da}日 周${dow}` };
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

  function makeCol(items, initIdx, onSelect, extraClass) {
    const col = document.createElement('div');
    col.className = 'wheel-col' + (extraClass ? ' ' + extraClass : '');
    col.tabIndex = 0;

    const inner = document.createElement('div');
    inner.style.paddingTop = PAD + 'px';
    inner.style.paddingBottom = PAD + 'px';

    items.forEach((item, idx) => {
      const el = document.createElement('div');
      el.className = 'wheel-item';
      el.textContent = item.label;
      el.addEventListener('click', () => col.scrollTo({ top: idx * ITEM_H, behavior: 'smooth' }));
      inner.appendChild(el);
    });
    col.appendChild(inner);

    function getIdx() {
      return Math.min(Math.max(Math.round(col.scrollTop / ITEM_H), 0), items.length - 1);
    }
    function onSnap() { onSelect(getIdx()); }

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

    requestAnimationFrame(() => { col.scrollTop = initIdx * ITEM_H; });
    return col;
  }

  mountEl.innerHTML = '';

  const picker = document.createElement('div');
  picker.className = 'wheel-picker';

  const dateCol = makeCol(dateItems, initDateIdx, idx => { selDate = idx; emit(); }, 'wheel-col-date');
  const div1 = document.createElement('div'); div1.className = 'wheel-divider';
  const hCol = makeCol(hourItems, initH, idx => { selH = idx; emit(); });
  const div2 = document.createElement('div'); div2.className = 'wheel-divider';
  const mCol = makeCol(minItems, initM, idx => { selM = idx; emit(); });

  const highlight = document.createElement('div');
  highlight.className = 'wheel-highlight';

  [dateCol, div1, hCol, div2, mCol, highlight].forEach(el => picker.appendChild(el));

  const actions = document.createElement('div');
  actions.className = 'wheel-actions';

  const nowBtn = document.createElement('button');
  nowBtn.className = 'wheel-now-btn';
  nowBtn.type = 'button';
  nowBtn.textContent = '现在';
  setButtonTip(nowBtn, '把时间选择器重置为当前时间。', '重置为当前时间');
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
  triggerBtn.setAttribute('aria-label', '选择日期和时间');
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
  popEl.setAttribute('aria-label', '日期时间选择器');
  popEl.hidden = true;
  wrap.appendChild(popEl);

  // Precise text input (secondary path for keyboard / a11y)
  const preciseDiv = document.createElement('div');
  preciseDiv.className = 'dt-precise';
  const preciseLabel = document.createElement('span');
  preciseLabel.className = 'dt-precise-label';
  preciseLabel.textContent = '精确输入';
  preciseDiv.appendChild(preciseLabel);
  const textEl = document.createElement('input');
  textEl.type = 'text';
  textEl.className = 'inp';
  textEl.dataset.role = 'text';
  textEl.setAttribute('inputmode', 'numeric');
  textEl.placeholder = 'YYYY-MM-DD HH:mm';
  textEl.setAttribute('aria-label', '精确时间文本');
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
    prevBtn.setAttribute('aria-label', '上一月'); prevBtn.dataset.act = 'prev-month';
    prevBtn.textContent = '‹';
    const monthLabel = document.createElement('span');
    monthLabel.textContent = viewY + ' 年 ' + (viewM0 + 1) + ' 月';
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button'; nextBtn.className = 'dt-nav';
    nextBtn.setAttribute('aria-label', '下一月'); nextBtn.dataset.act = 'next-month';
    nextBtn.textContent = '›';
    head.appendChild(prevBtn); head.appendChild(monthLabel); head.appendChild(nextBtn);
    popEl.appendChild(head);

    // Day-of-week header
    const dow = document.createElement('div');
    dow.className = 'dt-cal-dow';
    ['日','一','二','三','四','五','六'].forEach(d => {
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
      btn.setAttribute('aria-label', viewY + '年' + (viewM0 + 1) + '月' + d + '日');
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
    const hParts = makeStep('hour-inp', '时', 'hour-up', 'hour-down', curH, 23);
    const mParts = makeStep('min-inp',  '分', 'min-up',  'min-down',  curM, 59);

    const colon = document.createElement('span');
    colon.className = 'dt-colon'; colon.textContent = ':';

    const nowBtn = document.createElement('button');
    nowBtn.type = 'button'; nowBtn.className = 'dt-now';
    nowBtn.dataset.act = 'now'; nowBtn.dataset.tip = '重置为当前时间';
    nowBtn.setAttribute('aria-label', '重置为当前时间');
    nowBtn.textContent = '现在';

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
      setTimeInputError(wrap, '请输入完整日期和时间，例如 2026-06-28 09:05。');
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
        setTimeInputError(wrap, '请输入完整日期和时间，例如 2026-06-28 09:05。');
      }
    }
  });
  textEl.addEventListener('change', commitText);
  textEl.addEventListener('blur', commitText);

  sync(false);
}

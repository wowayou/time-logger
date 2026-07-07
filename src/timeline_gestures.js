// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
// 真·静轴动标：拖动中轴（相邻段高度）完全不动，只有把手数字和浮动气泡跟手指变；
// 松手落库后现存两段柔和过渡到新高度（沿用既有 200ms CSS transition），过渡
// settle 完再整体 render()。只移动「边界点」本身；落库统一走 normalizeEntries。
import { normalizeEntries } from './entry_model.js';
import { p2, todayStr } from './time.js';

const PX_PER_MIN = 2;      // 拖拽映射：2px = 1min（5min 吸附 = 10px）
const SNAP = 5;            // 默认吸附步长（分钟）
const FINE_AFTER_PX = 48;  // 拖动中手指右移超过该值 → 1min 精调，挪回恢复粗档
const SETTLE_MS = 260;     // 落库后等段高过渡完成再 render 的兜底时限（略大于 CSS 200ms）

const hhmm = mins => `${p2(Math.floor(mins / 60))}:${p2(mins % 60)}`;
const fmtDur = mins => (mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? p2(mins % 60) + 'm' : ''}` : `${mins}m`);

export function createTimelineGestures(deps) {
  let drag = null;
  let pendingSettle = null; // 落库后待 settle 的 finish 回调，供下一次 pointerdown 抢先 flush

  function bubbleEl() {
    let el = document.getElementById('drag-bubble');
    if (!el) {
      el = document.createElement('div');
      el.id = 'drag-bubble';
      el.className = 'drag-bubble';
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = '<span data-role="bubble-time"></span><small data-role="bubble-ctx"></small>';
      document.body.appendChild(el);
    }
    return el;
  }

  // 气泡横向锚定在把手所在的静止列（不再跟手指横移，避免精调时飘到段文字上）；
  // 纵向仍跟手指，方便远离把手做粗调时看到当前值，clamp 进视口避免出屏。
  function showBubble(e, minute, handle, fine) {
    const el = bubbleEl();
    el.style.display = 'block';
    const rect = handle.getBoundingClientRect();
    const anchorX = Math.min(window.innerWidth - 70, Math.max(70, rect.right + 12));
    const anchorY = Math.min(window.innerHeight - 60, Math.max(60, e.clientY));
    el.style.left = `${anchorX}px`;
    el.style.top = `${anchorY}px`;
    el.querySelector('[data-role="bubble-time"]').textContent = hhmm(minute);
    const ctx = handle.dataset.ctx || '';
    const prevStart = Number(handle.dataset.prevStart);
    const dur = Number.isFinite(prevStart) ? ` ${fmtDur(minute - prevStart)}` : '';
    el.querySelector('[data-role="bubble-ctx"]').textContent =
      `↑ ${ctx.slice(0, 8)}${dur}${fine ? ' · 精调1min' : ''}`;
  }

  function hideBubble() {
    const el = document.getElementById('drag-bubble');
    if (el) el.style.display = 'none';
  }

  // Move the boundary point: same object graph from load → save (P1), funneled
  // through normalizeEntries. Bails instead of writing when the target minute is
  // already taken (e.g. a planned entry parked on it) — the clamp already rules
  // out real neighbors.
  function commitBoundary(id, dateKey, minute) {
    const d = deps.load();
    const entry = d.entries.find(item => item.id === id);
    if (!entry) return false;
    const ts = `${dateKey}T${hhmm(minute)}`;
    if (ts === entry.ts) return false;
    if (d.entries.some(item => item.ts === ts && item.id !== id)) return false;
    entry.ts = ts;
    delete entry.longConfirm;
    normalizeEntries(d, { todayKey: todayStr(), createId: deps.uid });
    deps.save(d);
    return true;
  }

  function dragBounds(handle) {
    return {
      t0: Number(handle.dataset.min),
      lo: Number(handle.dataset.lo),
      hi: Number(handle.dataset.hi)
    };
  }

  // 落库后让现存的两段 DOM 节点过渡到新时长对应的钳制高度（seg-block 自带
  // 200ms height transition），settle 完再整体 render 画回真实布局/统计。
  function applySettledHeights(handle, prevEl, selfEl, newStart) {
    const prevStartAttr = handle.dataset.prevStart;
    if (prevEl && prevStartAttr !== undefined && prevStartAttr !== '') {
      const prevMins = newStart - Number(prevStartAttr);
      prevEl.style.height = `${deps.railHeight(prevMins)}px`;
    }
    const endMinAttr = handle.dataset.endMin;
    if (selfEl && endMinAttr !== undefined && endMinAttr !== '') {
      const selfMins = Number(endMinAttr) - newStart;
      selfEl.style.height = `${deps.railHeight(selfMins)}px`;
    }
  }

  function settleThenRender(prevEl, selfEl) {
    const reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { pendingSettle = null; deps.render(); return; }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (prevEl) prevEl.removeEventListener('transitionend', onEnd);
      if (selfEl) selfEl.removeEventListener('transitionend', onEnd);
      if (pendingSettle === finish) pendingSettle = null;
      deps.render();
    };
    const onEnd = ev => { if (ev.propertyName === 'height') finish(); };
    if (prevEl) prevEl.addEventListener('transitionend', onEnd);
    if (selfEl) selfEl.addEventListener('transitionend', onEnd);
    const timer = setTimeout(finish, SETTLE_MS);
    pendingSettle = finish;
  }

  function onPointerDown(e) {
    let target = e.target;
    if (pendingSettle) {
      // 上一次拖拽还在等段高 settle：先 flush（清定时器+立即 render），
      // 再按同一屏幕坐标重新命中——render 换了 DOM，e.target 指向的旧节点已脱树。
      const finish = pendingSettle;
      finish();
      target = document.elementFromPoint(e.clientX, e.clientY);
    }
    const handle = target ? target.closest('.tl-handle') : null;
    if (!handle || handle.classList.contains('fixed') || drag) return;
    const container = handle.closest('#timeline');
    if (!container) return;
    e.preventDefault();
    const idx = Number(handle.dataset.idx);
    const prevEl = container.querySelector(`.seg-block[data-idx="${idx - 1}"]`);
    const selfEl = container.querySelector(`.seg-block[data-idx="${idx}"]`);
    const { t0, lo, hi } = dragBounds(handle);
    drag = {
      handle,
      container,
      pointerId: e.pointerId,
      startY: e.clientY,
      startX: e.clientX,
      t0,
      lo,
      hi,
      last: t0,
      moved: false,
      prevEl,
      selfEl
    };
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('active');
    container.classList.add('dragging');
    showBubble(e, t0, handle, false);
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dy = e.clientY - drag.startY;
    // 横向挪开进入 1min 精调：模型本就是分钟精度，只是 2px/min 直拖映射下
    // 1min=2px 低于触控抖动，所以默认吸附 5min。
    const fine = (e.clientX - drag.startX) > FINE_AFTER_PX;
    const snap = fine ? 1 : SNAP;
    let t = drag.t0 + Math.round(dy / PX_PER_MIN / snap) * snap;
    t = Math.max(drag.lo, Math.min(drag.hi, t));
    drag.moved = drag.moved || t !== drag.t0;
    // 真·静轴动标：拖动中不改任何段的高度，段与轴完全静止；只有把手数字
    // 和浮动气泡随手指变化，松手后再统一过渡（见 applySettledHeights）。
    if (t !== drag.last) {
      drag.last = t;
      const pillTime = drag.handle.querySelector('[data-role="pill-time"]');
      if (pillTime) pillTime.textContent = hhmm(t);
    }
    showBubble(e, t, drag.handle, fine);
  }

  function onPointerEnd(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { handle, container, last, prevEl, selfEl } = drag;
    const committed = drag.moved && last !== drag.t0
      ? commitBoundary(handle.dataset.id, handle.dataset.date, last)
      : false;
    handle.classList.remove('active');
    container.classList.remove('dragging');
    hideBubble();
    drag = null;
    if (committed) {
      applySettledHeights(handle, prevEl, selfEl, last);
      settleThenRender(prevEl, selfEl);
    } else if (e.type !== 'pointercancel') {
      deps.render();
    }
  }

  function onKeyDown(e) {
    const handle = e.target.closest('.tl-handle');
    if (!handle || handle.classList.contains('fixed')) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const { t0, lo, hi } = dragBounds(handle);
    const step = e.shiftKey ? 1 : SNAP;
    const next = Math.max(lo, Math.min(hi, t0 + (e.key === 'ArrowUp' ? -step : step)));
    if (next === t0) return;
    if (!commitBoundary(handle.dataset.id, handle.dataset.date, next)) return;
    const id = handle.dataset.id;
    deps.render();
    const again = document.querySelector(`#timeline .tl-handle[data-id="${CSS.escape(id)}"]`);
    if (again) again.focus();
  }

  function attach(container) {
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerEnd);
    container.addEventListener('pointercancel', onPointerEnd);
    container.addEventListener('keydown', onKeyDown);
  }

  return { attach, commitBoundary };
}

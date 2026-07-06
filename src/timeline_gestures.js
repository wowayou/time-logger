// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
// 直接操纵时间轴：边界时间文字即把手，按住可拖、聚焦可用方向键微调。
// 只移动「边界点」本身；落库统一走 normalizeEntries（v30 写路径纪律）。
import { normalizeEntries } from './entry_model.js';
import { p2, todayStr } from './time.js';

const PX_PER_MIN = 2;      // 拖拽映射：2px = 1min（5min 吸附 = 10px）
const SNAP = 5;            // 默认吸附步长（分钟）
const FINE_AFTER_PX = 48;  // 拖动中手指右移超过该值 → 1min 精调，挪回恢复粗档
const MIN_LIVE_H = 24;     // 拖动中相邻段的最小实时像素高

const hhmm = mins => `${p2(Math.floor(mins / 60))}:${p2(mins % 60)}`;
const fmtDur = mins => (mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? p2(mins % 60) + 'm' : ''}` : `${mins}m`);

export function createTimelineGestures(deps) {
  let drag = null;

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

  function showBubble(e, minute, handle, fine) {
    const el = bubbleEl();
    el.style.display = 'block';
    el.style.left = `${Math.min(window.innerWidth - 70, Math.max(70, e.clientX))}px`;
    el.style.top = `${e.clientY}px`;
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

  function onPointerDown(e) {
    const handle = e.target.closest('.tl-handle');
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
      selfEl,
      prevH0: prevEl ? prevEl.offsetHeight : 0,
      selfH0: selfEl ? selfEl.offsetHeight : 0
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
    // 拖动中直接改两侧段的像素高（不经钳制布局重排），手指与把手不脱节。
    const dpx = (t - drag.t0) * PX_PER_MIN;
    if (drag.prevEl) drag.prevEl.style.height = `${Math.max(MIN_LIVE_H, drag.prevH0 + dpx)}px`;
    if (drag.selfEl) drag.selfEl.style.height = `${Math.max(MIN_LIVE_H, drag.selfH0 - dpx)}px`;
    if (t !== drag.last) {
      drag.last = t;
      const pillTime = drag.handle.querySelector('[data-role="pill-time"]');
      if (pillTime) pillTime.textContent = hhmm(t);
    }
    showBubble(e, t, drag.handle, fine);
  }

  function onPointerEnd(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { handle, container, last } = drag;
    const committed = drag.moved && last !== drag.t0
      ? commitBoundary(handle.dataset.id, handle.dataset.date, last)
      : false;
    handle.classList.remove('active');
    container.classList.remove('dragging');
    hideBubble();
    drag = null;
    // 无论是否落库都重排：恢复钳制布局，把库里真实状态画回来。
    if (committed || e.type !== 'pointercancel') deps.render();
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

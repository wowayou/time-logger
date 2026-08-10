// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
import {
  addOneMinute,
  entriesRevision,
  defaultFormTimestamp,
  findTimeConflict,
  normalizeEntries,
  openPlaceholderForDate,
  planDeleteEntry,
  settlementEndFor as getSettlementEndFor
} from './entry_model.js';
import {
  OPEN_DATE_KEY,
  RECORD_MODE_KEY,
  SELECTED_DATE_KEY,
  THEME_KEY,
  VIEW_KEY,
  appendBootDiagSample,
  ensureFirstUsedDate,
  ensureLegacyLocalePinned,
  load,
  loadConfig,
  mergeImportedConfig,
  mergeImportedEntries,
  mergeImportedFirstUsedDate,
  readBootDiag,
  readFirstUsedDate,
  rememberCustomTagForBucket,
  resolveMotto,
  setBootDiagEnabled,
  save,
  saveConfig,
  uid,
  validateImportData,
  loadLocalePref,
  saveLocalePref,
  refreshBucketLabels
} from './storage.js';
import { getLocale, plural, resolveLocale, setLocale, t, tList } from './i18n.js';
import { createIoActions } from './io_actions.js';
import { createSheetController } from './sheet_controller.js';
import {
  buildRangeSegmentsFromEntries,
  confirmSegmentInData,
  listPlannedEntries,
  recordingMilestones,
  summarizeEntries
} from './stats.js';
import {
  addDays,
  addMonths,
  addYears,
  fmtMins,
  hhmm,
  entryModeForDate,
  localDateKey,
  minsBetweenDates,
  nowStr,
  parseDateKey,
  periodLabel as getPeriodLabel,
  periodRange as getPeriodRange,
  shortDateLabel,
  todayStr
} from './time.js';
import {
  APP_VERSION,
  esc,
  iconSvg,
  renderDayHero,
  renderRuler,
  renderSummaryRows,
  renderTimeline,
  setButtonTip
} from './ui.js';

  const bootTrace = window.__timelogBootTrace || null;
  function markBootTrace(name) {
    if (!bootTrace) return;
    const previous = bootTrace.marks.length ? bootTrace.marks[bootTrace.marks.length - 1].at : 0;
    bootTrace.marks.push({ name, at: Math.max(previous, performance.now()) });
  }
  function setBootSnapshotState(state) {
    if (!bootTrace) return;
    bootTrace.snapshot = state;
    bootTrace.snapshotStates.push(state);
  }
  markBootTrace('app_module_body_start');
  // v62 启动诊断（P33 取证）的两个早期采样点：模块图就绪时刻，以及「本次导航是否
  // 已被 SW 接管」——controller 必须赶在注册/claim 改变世界之前读，晚了读到的就
  // 不再是本次导航的真相。
  const bootDiagModuleAt = Math.round(performance.now());
  const bootDiagControlled = Boolean(navigator.serviceWorker && navigator.serviceWorker.controller);
  let bootDiagSnapshotAdopted = false;
  // 诊断 v2（v68，C6 第一优先）：SW 注册三态同样必须早读——冷启动的 reg.update()
  // 会在网络返回后改变 installing/waiting，晚读就分不清「启动继承的卡死态」与
  // 「本次更新检查新产生的过渡态」。值是固定枚举（i/w/a + Worker.state），无内容。
  let bootDiagSwStates = '';
  const bootDiagFormatSwStates = reg => {
    if (!reg) return 'none';
    const parts = [];
    if (reg.installing) parts.push(`i:${reg.installing.state}`);
    if (reg.waiting) parts.push(`w:${reg.waiting.state}`);
    if (reg.active) parts.push(`a:${reg.active.state}`);
    return parts.join('+') || 'empty';
  };
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration()
        .then(reg => { bootDiagSwStates = bootDiagFormatSwStates(reg); })
        .catch(() => {});
    }
  } catch {}

  let sheetEditId = null;
  let pendingUpdateRegistration = null;
  let updateReloading = false;
  let pendingDelete = null;
  let undoDeleteState = null;
  let lastIntervalSignature = '';
  let state = { view: 'day', selectedDate: '' };
  const HELP_SEEN_KEY = 'timelog.helpSeen.v16';
  const BOOT_SNAPSHOT_KEY = 'timelog.bootSnapshot.v1';
  const UNRECORDED_GAP_FLOOR_MIN = 15;

  // SPEC-001：同一份代码同时部署在旧 origin（GitHub Pages）和新 origin
  // （time.eigentime.org），迁移横幅只在旧 origin 出现。带尾斜杠的
  // startsWith('/time-logger/') 特意排除镜像预览路径 /time-logger-site/app/
  // （该路径的下一个字符是 '-'，不是 '/'，不会误命中）。
  // SPEC-002（v76）：旧 origin 浸泡期已确认足够，转为完整应用 + 只读——同一个
  // isLegacyOrigin() 现在还驱动全部写路径入口的收敛（见 render()/renderChrome()/
  // renderTimeline 的 readOnly 分支）。
  function isLegacyOrigin() {
    return location.hostname === 'wowayou.github.io' && location.pathname.startsWith('/time-logger/');
  }

  // SPEC-002：横幅转为常驻不可关闭（去掉「知道了」/「重开」，只保留「打开新地址」），
  // 不再有 dismissed 状态——旧 origin 上永远显示，新 origin 上永远隐藏。
  function updateMigrationNotice() {
    const notice = document.getElementById('migration-notice');
    if (!notice) return;
    notice.hidden = !isLegacyOrigin();
  }

  function defaultFormTs() {
    const entries = load().entries;
    const dateKey = state.selectedDate || todayStr();
    return defaultFormTimestamp(entries, dateKey);
  }

  function periodRange(view = state.view, dateKey = state.selectedDate) {
    return getPeriodRange(view, dateKey);
  }
  function periodLabel(opts = {}) {
    return getPeriodLabel(state.view, state.selectedDate, opts);
  }
  function periodFullLabel() {
    return getPeriodLabel(state.view, state.selectedDate);
  }

  function persistState() {
    localStorage.setItem(VIEW_KEY, state.view);
    localStorage.setItem(SELECTED_DATE_KEY, state.selectedDate);
  }

  // --- Theme ---
  function getSysPref() {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  function applyTheme(pref) {
    const html = document.documentElement;
    if (pref === 'auto') {
      html.removeAttribute('data-theme');
    } else {
      html.setAttribute('data-theme', pref);
    }
    const effective = pref === 'auto' ? getSysPref() : pref;
    document.getElementById('meta-theme-color').setAttribute('content', effective === 'light' ? '#eceef3' : '#0e0f13');
    document.querySelectorAll('#theme-seg button').forEach(btn => {
      const selected = btn.dataset.theme === pref;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
  }
  function setThemePref(pref) {
    localStorage.setItem(THEME_KEY, pref);
    applyTheme(pref);
  }

  // SPEC-014 §2：语言开关只出现在「更多」sheet 里，切换时该 sheet本身没有任何
  // 未保存的输入控件（没有 textarea/input 承载草稿），因此不需要禁用切换或强制
  // 先关闭其它 sheet——采用与 toggleBootDiag 相同的「原地重渲染当前更多 sheet +
  // 刷新主内容 render()」模式：不刷新页面、不丢输入（本来就没有输入）。
  function setLocalePref(code) {
    saveLocalePref(code);
    setLocale(resolveLocale(code, navigator.languages));
    refreshBucketLabels();
    applyShellI18n();
    document.documentElement.lang = getLocale();
    render();
    sheetController.openMoreSheet();
  }

  // --- Compute entries and summaries ---
  function settlementEndFor(startTs, dateKey) {
    return getSettlementEndFor(load().entries, startTs, dateKey);
  }
  // v87：`config` 一次读、往下传。stats.js 的桶查询每个片段要问三次（classifySegment
  // 两次 + addBucket 一次），不传的话每次都重新 localStorage.getItem + JSON.parse +
  // normalizeConfig——年视图一次 summarize 实测 1994 次。stats.js 仍不 import
  // loadConfig（模块边界不变），config 由这里注入。
  function summarizeRange(start, end, opts = {}) {
    return summarizeEntries(load().entries, start, end, { config: loadConfig(), ...opts });
  }
  function computeDay() {
    const { start, end } = periodRange('day', state.selectedDate);
    const statEnd = state.selectedDate === todayStr() ? new Date() : end;
    const allEntries = load().entries;
    const config = loadConfig();
    const segments = buildRangeSegmentsFromEntries(allEntries, start, statEnd, { config });
    const timeline = segments.filter(segment => segment.e || segment.mins >= UNRECORDED_GAP_FLOOR_MIN);
    const planned = listPlannedEntries(allEntries, state.selectedDate);
    return { timeline, planned, totals: summarizeEntries(allEntries, start, statEnd, { config }) };
  }
  function summaryRows() {
    const { start } = periodRange();
    if (state.view === 'week') {
      return Array.from({ length: 7 }, (_, i) => {
        const d = addDays(start, i);
        return { key: localDateKey(d), label: shortDateLabel(d), rangeStart: d, rangeEnd: addDays(d, 1), targetView: 'day' };
      });
    }
    if (state.view === 'month') {
      const rows = [];
      for (let d = new Date(start); d.getMonth() === start.getMonth(); d = addDays(d, 1)) {
        rows.push({ key: localDateKey(d), label: shortDateLabel(d), rangeStart: new Date(d), rangeEnd: addDays(d, 1), targetView: 'day' });
      }
      return rows;
    }
    if (state.view === 'year') {
      // 验收指出旧的 t('chrome.monthCell', {n}) 插值在英文侧读成 "Month 1"…
      // "Month 12"；改用真正的月份短名数组（zh 一侧逐字节与旧模板输出相同）。
      const monthShort = tList('date.monthShort');
      return Array.from({ length: 12 }, (_, i) => {
        const d = new Date(start.getFullYear(), i, 1);
        return { key: localDateKey(d), label: monthShort[i] || String(i + 1), rangeStart: d, rangeEnd: addMonths(d, 1), targetView: 'month' };
      });
    }
    return [];
  }

  // --- Navigation ---
  const VIEW_ORDER = ['day', 'week', 'month', 'year'];
  function setView(view) {
    const direction = Math.sign(VIEW_ORDER.indexOf(view) - VIEW_ORDER.indexOf(state.view));
    state.view = view;
    sheetController.closeEditSheet();
    sheetController.closeForm();
    persistState();
    render();
    animateContentEnter(direction);
  }
  function setSelectedDate(dateKey) {
    state.selectedDate = dateKey;
    persistState();
  }
  function shiftPeriod(delta) {
    const d = parseDateKey(state.selectedDate) || new Date();
    if (state.view === 'day') setSelectedDate(localDateKey(addDays(d, delta)));
    if (state.view === 'week') setSelectedDate(localDateKey(addDays(d, delta * 7)));
    if (state.view === 'month') setSelectedDate(localDateKey(addMonths(d, delta)));
    if (state.view === 'year') setSelectedDate(localDateKey(addYears(d, delta)));
    sheetController.closeEditSheet();
    sheetController.closeForm();
    render();
    animateContentEnter(Math.sign(delta));
  }
  function goToday() {
    const prevDate = state.selectedDate;
    setSelectedDate(todayStr());
    sheetController.closeEditSheet();
    sheetController.closeForm();
    render();
    const today = todayStr();
    animateContentEnter(today > prevDate ? 1 : (today < prevDate ? -1 : 0));
  }
  function drill(dateKey, view) {
    state.view = view;
    setSelectedDate(dateKey);
    sheetController.closeEditSheet();
    sheetController.closeForm();
    render();
  }

  // R7：切视图/切周期后内容方向性滑入（280ms）——只在导航函数里、render() 之后
  // 调用，纯视觉糖：从偏移位滑到原位，不影响内容或任何时序；reduced-motion 跳过。
  // direction: 1=正向（下一段/更晚的视图/更晚的日期），-1=反向，0/falsy=不动画。
  function animateContentEnter(direction) {
    if (!direction) return;
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const dx = direction > 0 ? 14 : -14;
    [document.getElementById('ruler'), document.getElementById('timeline')].forEach(el => {
      if (!el) return;
      el.style.transition = 'none';
      el.style.transform = `translateX(${dx}px)`;
      el.style.opacity = '0';
      void el.offsetWidth;
      requestAnimationFrame(() => {
        el.style.transition = 'transform 0.28s ease-out, opacity 0.22s ease';
        el.style.transform = '';
        el.style.opacity = '';
        const clear = () => { el.style.transition = ''; el.removeEventListener('transitionend', clear); };
        el.addEventListener('transitionend', clear);
      });
    });
  }

  // --- Render ---
  function render() {
    // v86：记下这一帧代表的分钟。定时器被系统冻住时（S23 实录：应用在前台，界面
    // 却停在一两分钟前），它是「界面已经过期」的廉价判据——见 refreshLiveClockOnTouch。
    lastRenderedMinute = nowStr();
    renderChrome();
    if (state.view === 'day') {
      const day = computeDay();
      const isToday = state.selectedDate === todayStr();
      renderDayHero(day.totals, day.timeline.length || day.planned.length || day.totals.total, {
        isToday,
        asOf: nowStr().slice(11, 16)
      });
      renderTimeline(day.timeline, {
        sheetEditId,
        plannedItems: day.planned,
        isToday,
        nowLabel: nowStr().slice(11, 16),
        // SPEC-002：旧 origin 只读——行不可点开编辑、不渲染补一下/标记已发生/确认
        // 等写入口，左滑轨道因缺少 data-action="start-edit" 锚点而自然不启用。
        readOnly: isLegacyOrigin()
      });
      lastIntervalSignature = dataSignature();
      saveBootSnapshot();
      return;
    }
    const { start, end } = periodRange();
    renderRuler(summarizeRange(start, end), 1, state.view);
    renderSummary();
    lastIntervalSignature = dataSignature();
    saveBootSnapshot();
  }

  function saveBootSnapshot() {
    try {
      const app = document.querySelector('.app');
      const addBtn = document.getElementById('add-btn');
      const listFade = document.getElementById('list-fade');
      if (!app || !addBtn) return;
      sessionStorage.setItem(BOOT_SNAPSHOT_KEY, JSON.stringify({
        // v56：快照带版本戳——应用更新后（SKIP_WAITING reload）不得把旧版 DOM 形态
        // 交给新版 JS 还跳过首轮渲染；init() 里版本不符则按无快照走正常启动。
        appVersion: APP_VERSION,
        // SPEC-013：语言也是快照的有效性条件（见 index.html 的 locale 门）。
        locale: getLocale(),
        appHtml: app.innerHTML,
        addHtml: addBtn.innerHTML,
        addHidden: addBtn.hidden,
        addAria: addBtn.getAttribute('aria-label') || '',
        fadeHidden: listFade ? listFade.hidden : true,
        dataRaw: localStorage.getItem('timelog.v1'),
        configRaw: localStorage.getItem('timelog.config'),
        view: localStorage.getItem(VIEW_KEY),
        selectedDate: localStorage.getItem(SELECTED_DATE_KEY),
        recordMode: localStorage.getItem(RECORD_MODE_KEY),
        today: todayStr()
      }));
    } catch {}
  }
  function renderChrome() {
    const crossTabBanner = document.getElementById('cross-tab-banner');
    if (crossTabBanner) crossTabBanner.hidden = true;
    document.querySelectorAll('#view-tabs button').forEach(btn => {
      const selected = btn.dataset.view === state.view;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
    // 里程碑从当前数据派生（最早真实记录→今天 + 有真实记录的自然日数），因此随
    // 完整备份天然恢复；本机安装日 firstUsedDate 已降为纯诊断值，不再上 header。
    const { journeyDay, recordedDays } = recordingMilestones(load().entries, todayStr());
    const usageEl = document.getElementById('usage-day');
    if (usageEl) {
      // 一条真实记录都没有时不编造里程碑，直接不显示。
      usageEl.hidden = recordedDays === 0;
      if (recordedDays > 0) {
        // SPEC-014 §3：「N 天/days」的单复数用 i18n.js 的 plural() 现算，再整体
        // 塞进 {recorded}——中文两形取值相同，字节不变；英文 N=1 时读 "1 day"。
        const recordedLabel = plural(recordedDays, {
          one: t('chrome.recordedDayOne', { n: recordedDays }),
          other: t('chrome.recordedDayOther', { n: recordedDays })
        });
        usageEl.textContent = t('chrome.milestone', { journey: journeyDay, recorded: recordedLabel });
        usageEl.setAttribute('aria-label', t('chrome.milestoneAria', { journey: journeyDay, recorded: recordedLabel }));
      }
    }
    // R5：当前周期是否包含今天——驱动「回到今天」按钮的条件渲染 + 日期行内的
    // 「今天」常驻高亮字样，两处共用同一次判定。
    const { start: periodStart, end: periodEnd } = periodRange();
    const todayDate = parseDateKey(todayStr());
    const inCurrentPeriod = Boolean(todayDate && todayDate >= periodStart && todayDate < periodEnd);
    const periodEl = document.getElementById('period-label');
    const periodText = periodLabel({ short: state.view === 'week' });
    periodEl.innerHTML = inCurrentPeriod
      ? `${periodText} <span class="period-today-badge">${esc(t('chrome.todayBadge'))}</span>`
      : periodText;
    periodEl.setAttribute('aria-label', periodFullLabel());
    // R2+FAB：悬浮「记一条」——只在日视图出现；主文案随计划/记录模式，副文案标注
    // 续记起点（续 X 起 · 已 Ymin）。底部渐隐遮罩与 FAB 同步显隐。
    const addBtn = document.getElementById('add-btn');
    const listFade = document.getElementById('list-fade');
    const isDay = state.view === 'day';
    const dateMode = entryModeForDate(state.selectedDate);
    // SPEC-002：旧 origin 只读——FAB 与配套渐隐层是唯一的新增入口，收敛掉。
    // v77：defaultFormTimestamp 返回空串＝所看这天已被记录覆盖到最后一分钟
    // （尾点是 23:59 的真实记录），当天没有任何合法的新增起点——与其给一个点
    // 进去必然报冲突的按钮，不如按既有惯例隐藏 FAB（切一刀/编辑仍可从行进入）。
    const fabStart = isDay ? defaultFormTs() : '';
    const canCreate = isDay && dateMode.canCreate && !isLegacyOrigin() && fabStart !== '';
    addBtn.hidden = !canCreate;
    if (listFade) listFade.hidden = !canCreate;
    if (canCreate) {
      const preferPlan = localStorage.getItem(RECORD_MODE_KEY) === 'plan';
      const isPlan = dateMode.forcedMode === 'plan' || (dateMode.kind === 'today' && preferPlan);
      const mainLabel = isPlan ? t('chrome.fabPlan') : t('chrome.fabLog');
      const sub = fabSubCopy(fabStart);
      addBtn.innerHTML = `<span class="fab-main">${mainLabel}</span>${sub ? `<span class="fab-sub">${esc(sub)}</span>` : ''}`;
      // FAB 有可见文案，不需要 hover tooltip；且 `button[data-tip]` 会把 position 强制
      // 成 relative（tooltip 定位规则），破坏 fixed 悬浮——所以只设 aria-label，不设 data-tip。
      addBtn.setAttribute('aria-label', isPlan ? t('chrome.fabPlanAria') : t('chrome.fabLogAria'));
    }
    // 阶段格言（v69，C13）：只在日视图显示；textContent 填充（用户/导入文案不进
    // innerHTML）。'' ＝显式隐藏——此时唯一入口是「···」更多里的「阶段格言」。
    const mottoEl = document.getElementById('motto-line');
    if (mottoEl) {
      const motto = resolveMotto(loadConfig());
      const showMotto = isDay && Boolean(motto);
      mottoEl.hidden = !showMotto;
      if (showMotto) {
        mottoEl.textContent = motto;
        mottoEl.setAttribute('aria-label', t('chrome.mottoAria', { motto }));
      }
    }
    const periodNames = { day: t('period.day'), week: t('period.week'), month: t('period.month'), year: t('period.year') };
    const todayLabels = { day: t('period.backDay'), week: t('period.backWeek'), month: t('period.backMonth'), year: t('period.backYear') };
    const todayTip = t('period.backTip', { period: periodNames[state.view] });
    const todayBtn = document.getElementById('today-btn');
    // R5：只在离开当前周期（已不含今天）后才出现，避免常驻占位。
    todayBtn.hidden = inCurrentPeriod;
    todayBtn.textContent = todayLabels[state.view];
    setButtonTip(todayBtn, todayTip, todayLabels[state.view]);
    document.querySelectorAll('[data-action="shift-period"]').forEach(btn => {
      const isPrev = Number(btn.dataset.delta || 0) < 0;
      const dir = isPrev ? t('period.prev') : t('period.next');
      const text = t('period.shiftTip', { dir, period: periodNames[state.view] });
      setButtonTip(btn, text, t('period.shiftAria', { dir, period: periodNames[state.view] }));
    });
    const labels = { day: t('list.titleDay'), week: t('list.titleWeek'), month: t('list.titleMonth'), year: t('list.titleYear') };
    document.getElementById('list-label').textContent = labels[state.view];
  }

  // R2+FAB 副文案：续记起点。今天有记录 → 「续 hh:mm 起 · 已 Ymin」；今天空 →
  // 「今天还没记」；历史空 → 「这天还没记」。
  // v77：历史日再分两种——尾点是**未记录占位**才叫「续」（确实有一段空白可以接
  // 着写）；尾点是**真实记录**时那天已被覆盖到 24:00，没有可续之物，默认起点是
  // 其后一分钟，文案随之改为「补记」，与表单标题（非今天＝补记）同一套词汇。
  function fabSubCopy(start) {
    const dateKey = state.selectedDate;
    const isToday = dateKey === todayStr();
    const entries = load().entries;
    const dayLogged = entries.filter(e => !e.planned && e.ts.slice(0, 10) === dateKey);
    if (!dayLogged.length) return isToday ? t('fab.emptyToday') : t('fab.emptyOtherDay');
    if (!start) return '';
    if (!isToday) {
      return openPlaceholderForDate(entries, dateKey)
        ? t('fab.continueFrom', { time: hhmm(start) })
        : t('fab.backfillFrom', { time: hhmm(start) });
    }
    const settlement = settlementEndFor(start, dateKey);
    const dur = settlement.endTs ? minsBetweenDates(new Date(start), new Date(settlement.endTs)) : 0;
    return t('fab.ongoingFrom', { time: hhmm(start), dur: fmtMins(dur) });
  }

  function renderSummary() {
    // 月视图 31 行、年视图 12 行，每行一次 summarize——entries 与 config 各读一次就够，
    // 别让每一行都重新 JSON.parse 一遍整份记录（真实数据 120KB）。
    const entries = load().entries;
    const config = loadConfig();
    const rows = summaryRows().map(row => ({
      ...row,
      totals: summarizeEntries(entries, row.rangeStart, row.rangeEnd, { config })
    }));
    renderSummaryRows(rows);
  }

  // --- Segment confirmation ---
  function confirmSegment(id, endTs) {
    const d = load();
    const result = confirmSegmentInData(d, id, endTs);
    if (!result.ok) {
      if (result.reason === 'stale') {
        showInfoToast(t('toast.segmentChanged'));
      }
      render();
      return;
    }
    normalizeEntries(d, { todayKey: todayStr(), createId: uid });
    save(d);
    render();
  }

  // --- Delete / undo ---
  function deleteError(message) {
    const error = document.querySelector('#form-sheet [data-role="delete-error"]');
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
  }

  function requestDelete(id, opts = {}) {
    const d = load();
    const entry = d.entries.find(item => item.id === id);
    const plan = planDeleteEntry(d.entries, id, { todayKey: todayStr(), nowTs: nowStr() });
    if (!entry || !plan.ok) return;
    pendingDelete = {
      id,
      plan,
      returnToEdit: opts.returnToEdit !== false && sheetController.getSheetMode() === 'edit'
    };
    sheetController.openFormSheet({ mode: 'delete-confirm', deletePlan: plan, deleteEntry: entry });
  }

  function cancelDelete() {
    const pending = pendingDelete;
    pendingDelete = null;
    sheetController.closeFormSheet({ restoreFocus: false });
    if (pending && pending.returnToEdit) sheetController.startEdit(pending.id);
    else render();
  }

  function hideUndoToast() {
    if (undoDeleteState && undoDeleteState.timer) clearTimeout(undoDeleteState.timer);
    if (undoDeleteState && undoDeleteState.detach) undoDeleteState.detach();
    undoDeleteState = null;
    const toast = document.getElementById('undo-toast');
    if (toast) toast.hidden = true;
  }

  // v84（维护者方案 b）：8 秒上限不动，但**你已经在做别的事**就收起——那是比倒计时
  // 更准的失效信号，也是「横幅停留太长」的真实答案。撤销窗口与横幅同生共死（红线
  // 语义不变：横幅在＝还能撤销），所以这里只是让它更早、更自然地结束。
  // 触发口径刻意收窄：滚动、指针按下、键盘按键；且**不含撤销按钮自身**（点它是使用
  // 撤销，不是放弃撤销），也跳过删除刚结束那一帧的余波（`once` + 捕获阶段 + 忽略
  // 首次 100ms 内的事件，避免确认删除的那一下点击顺手把自己关掉）。
  // 宽限期与 sheet 关闭动画（320ms）同源：确认删除后面板正在收起，那一段的滚动与
  // 布局余波不是「你在做别的事」，不能算数。
  const UNDO_ARM_GRACE_MS = 350;

  function armUndoDismissOnInteraction() {
    // 宽限期用**定时器**而不是 Date.now() 差值：测试夹具会把 Date.now() 冻在固定时刻
    // （FixedDate），任何基于时钟差的宽限判据在那里恒为 0，守卫会静默失效——第一版
    // 就是这么写的，用例因此变红，才发现这条依赖。定时器不受冻结时钟影响。
    let detach = () => {};
    const armTimer = setTimeout(() => {
      const onInteract = event => {
        // 点「撤销」本身是**使用**撤销，不是放弃它。
        if (event.target instanceof Element && event.target.closest('[data-action="undo-delete"]')) return;
        hideUndoToast();
      };
      const opts = { capture: true, passive: true };
      window.addEventListener('scroll', onInteract, opts);
      document.addEventListener('pointerdown', onInteract, opts);
      document.addEventListener('keydown', onInteract, opts);
      detach = () => {
        window.removeEventListener('scroll', onInteract, opts);
        document.removeEventListener('pointerdown', onInteract, opts);
        document.removeEventListener('keydown', onInteract, opts);
      };
    }, UNDO_ARM_GRACE_MS);
    return () => {
      clearTimeout(armTimer);
      detach();
    };
  }

  function showUndoToast(beforeData, afterRevision) {
    hideUndoToast();
    const toast = document.getElementById('undo-toast');
    if (!toast) return;
    const message = toast.querySelector('[data-role="undo-message"]');
    const button = toast.querySelector('[data-action="undo-delete"]');
    if (message) message.textContent = t('toast.deleted');
    if (button) button.hidden = false;
    toast.hidden = false;
    const timer = setTimeout(hideUndoToast, 8000);
    undoDeleteState = { beforeData, afterRevision, timer, detach: armUndoDismissOnInteraction() };
  }

  function cancelUndoForConflict() {
    if (!undoDeleteState) return;
    const toast = document.getElementById('undo-toast');
    const message = toast && toast.querySelector('[data-role="undo-message"]');
    const button = toast && toast.querySelector('[data-action="undo-delete"]');
    if (undoDeleteState.timer) clearTimeout(undoDeleteState.timer);
    // v84：撤销失效这条路径同样要摘掉交互监听，否则它会活到下一次撤销窗口，
    // 把新横幅在第一次滚动前就关掉（也是一处泄漏）。
    if (undoDeleteState.detach) undoDeleteState.detach();
    undoDeleteState = null;
    if (message) message.textContent = t('toast.undoCancelled');
    if (button) button.hidden = true;
    if (toast) {
      toast.hidden = false;
      setTimeout(() => { toast.hidden = true; }, 3000);
    }
  }

  // SPEC-006 B：原生弹窗清零——非阻塞、自动消退、无动作按钮的通用提示，供导入
  // 完成摘要和区间确认签名过期复用。独立于 #undo-toast，避免抢占撤销窗口。
  let infoToastTimer = null;
  function showInfoToast(message) {
    const toast = document.getElementById('info-toast');
    if (!toast) return;
    const span = toast.querySelector('[data-role="info-message"]');
    if (span) span.textContent = message;
    toast.hidden = false;
    clearTimeout(infoToastTimer);
    infoToastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
  }

  function confirmDelete(id) {
    if (!pendingDelete || pendingDelete.id !== id) return;
    const d = load();
    const entry = d.entries.find(item => item.id === id);
    const latest = planDeleteEntry(d.entries, id, { todayKey: todayStr(), nowTs: nowStr() });
    if (!entry || !latest.ok) {
      deleteError(latest.message || t('txn.missing'));
      return;
    }
    if (latest.resultSignature !== pendingDelete.plan.resultSignature) {
      pendingDelete.plan = latest;
      sheetController.openFormSheet({
        mode: 'delete-confirm',
        deletePlan: latest,
        deleteEntry: entry,
        deleteStale: true
      });
      return;
    }
    const beforeData = JSON.parse(JSON.stringify(d));
    d.entries = latest.resultEntries;
    if (!save(d)) {
      deleteError(t('toast.deleteQuota'));
      return;
    }
    pendingDelete = null;
    sheetController.closeFormSheet({ restoreFocus: false });
    render();
    showUndoToast(beforeData, entriesRevision(d.entries));
  }

  function undoDelete() {
    const pending = undoDeleteState;
    if (!pending) return;
    const current = load();
    if (entriesRevision(current.entries) !== pending.afterRevision) {
      cancelUndoForConflict();
      return;
    }
    if (!save(pending.beforeData)) {
      cancelUndoForConflict();
      return;
    }
    hideUndoToast();
    render();
  }

  function confirmPlanned(id) {
    const d = load();
    const entry = d.entries.find(e => e.id === id);
    if (!entry || !entry.planned) return;
    delete entry.planned;
    if (new Date(entry.ts) > new Date()) entry.ts = nowStr();
    // ⑥ Confirming to "now" can collide with an existing entry on that exact
    // minute. Every other write path guards same-ts; here there is no sheet to
    // host an inline prompt, so nudge forward to the next free minute (matching
    // the "+1min" direction) instead of silently creating a duplicate timestamp.
    while (findTimeConflict(d.entries, entry.ts, entry.id)) {
      entry.ts = addOneMinute(entry.ts);
    }
    normalizeEntries(d, { todayKey: todayStr(), createId: uid });
    save(d);
    render();
  }

  // --- Data signature ---
  function dataSignature() {
    const d = load();
    const { start, end } = periodRange();
    const now = new Date();
    const liveMinute = now >= start && now < end ? nowStr() : '';
    return JSON.stringify({ view: state.view, selectedDate: state.selectedDate, today: todayStr(), liveMinute, entries: d.entries });
  }
  function openHelp(opts = {}) {
    if (opts.markSeen !== false) localStorage.setItem(HELP_SEEN_KEY, '1');
    sheetController.openFormSheet({ mode: 'help' });
  }
  function openTagConfig() {
    sheetController.openFormSheet({ mode: 'config' });
  }

  const sheetController = createSheetController({
    state,
    load,
    loadConfig,
    save,
    saveConfig,
    rememberCustomTagForBucket,
    uid,
    defaultFormTs,
    settlementEndFor,
    persistState,
    setSelectedDate,
    render,
    renderChrome,
    isLegacyOrigin,
    // v82：删掉一个零记录标签后，还挂着的「撤销删除」会把引用它的记录放回来，
    // 那条记录就成了孤儿标签。与跨标签页修改同一处理：让撤销失效并明说。
    cancelPendingUndo: cancelUndoForConflict,
    getSheetEditId: () => sheetEditId,
    setSheetEditId: value => { sheetEditId = value; }
  });

  const ioActions = createIoActions({
    state,
    load,
    loadConfig,
    save,
    saveConfig,
    validateImportData,
    mergeImportedEntries,
    mergeImportedConfig,
    readBootDiag,
    readFirstUsedDate,
    // 诊断值随备份延续：只并入 localStorage，不再有 header 状态要刷新。
    adoptImportedFirstUsedDate: value => {
      mergeImportedFirstUsedDate(value, todayStr());
    },
    periodRange,
    periodFullLabel,
    computeDay,
    summaryRows,
    summarizeRange,
    openFormSheet: opts => sheetController.openFormSheet(opts),
    closeForm: () => sheetController.closeForm(),
    showInfoToast,
    render
  });

  // --- App update prompt ---
  // C1（v64）：skipWaiting → controllerchange 在 iOS 上会整链无声失败，点击后
  // 版本纹丝不动（2026-07-15/16 两次真机复现）。三层处理：① statechange→activated
  // 作为第二条成功路径（controllerchange 丢了它可能还在）；② 8 秒超时兜底——两条
  // 都没来就承认没生效，横幅换成可执行的绕法指引（完全退出后重开，waiting worker
  // 自然激活），按钮不再无声装死；③ 指引可「知道了」收起。
  const UPDATE_APPLY_TIMEOUT_MS = 8000;
  let updateApplyTimer = null;
  function setUpdateBannerStuck(stuck) {
    const banner = document.getElementById('update-banner');
    if (!banner) return;
    const prompt = banner.querySelector('[data-role="update-prompt"]');
    const applyBtn = banner.querySelector('[data-action="update-app"]');
    const stuckMsg = banner.querySelector('[data-role="update-stuck"]');
    const dismissBtn = banner.querySelector('[data-action="dismiss-update-banner"]');
    if (prompt) prompt.hidden = stuck;
    if (applyBtn) applyBtn.hidden = stuck;
    if (stuckMsg) stuckMsg.hidden = !stuck;
    if (dismissBtn) dismissBtn.hidden = !stuck;
  }
  function showUpdatePrompt(registration) {
    pendingUpdateRegistration = registration;
    setUpdateBannerStuck(false);
    const banner = document.getElementById('update-banner');
    if (banner) banner.hidden = false;
  }
  function clearUpdateApplyTimer() {
    if (updateApplyTimer === null) return;
    clearTimeout(updateApplyTimer);
    updateApplyTimer = null;
  }
  function applyUpdate() {
    const worker = pendingUpdateRegistration && pendingUpdateRegistration.waiting;
    if (!worker) {
      window.location.reload();
      return;
    }
    updateReloading = true;
    clearUpdateApplyTimer();
    if (typeof worker.addEventListener === 'function') {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated' && updateReloading) {
          clearUpdateApplyTimer();
          window.location.reload();
        }
      });
    }
    updateApplyTimer = setTimeout(() => {
      updateApplyTimer = null;
      updateReloading = false;
      setUpdateBannerStuck(true);
    }, UPDATE_APPLY_TIMEOUT_MS);
    worker.postMessage({ type: 'SKIP_WAITING' });
  }

  // SPEC-009-lite（D15 额度裁剪：只做「更多」里的常驻手动出口，不做检测/计数器/
  // 横幅第三态——那部分登记为「出现外部用户后重启」，见 SPEC-009 文末）。
  // 「修复更新通道」永远由用户点击触发，任何路径都不自动 unregister/reload：
  // 点一次进入「再次点击确认」武装态（4 秒后自动收回，防误触发），同一个 DOM
  // 节点上的第二次点击才真正执行——sheet 重渲染会换新节点，武装态天然失效，
  // 不需要额外清理。在线前置检查 → sw.js 探活 → unregister → reload；
  // localStorage 全程不被触碰。
  let repairUpdateArmedBtn = null;
  let repairUpdateArmTimer = null;
  let repairUpdateRestAria = '';
  function repairUpdateResetLabel(btn) {
    const label = btn && btn.querySelector('[data-role="cell-label"]');
    if (label) label.textContent = t('repair.label');
    // 验收补正：aria-label 会覆盖按钮内容，只改可见文字会把读屏用户留在旧的
    // 可访问名上（可见标签与可访问名不一致）。两个状态都同步改。
    if (btn && repairUpdateRestAria) btn.setAttribute('aria-label', repairUpdateRestAria);
  }
  async function repairUpdateChannel(btn) {
    if (!btn) return;
    if (navigator.onLine === false) {
      showInfoToast(t('repair.needOnline'));
      return;
    }
    if (repairUpdateArmedBtn !== btn) {
      repairUpdateArmedBtn = btn;
      repairUpdateRestAria = btn.getAttribute('aria-label') || repairUpdateRestAria;
      const label = btn.querySelector('[data-role="cell-label"]');
      if (label) label.textContent = t('repair.armed');
      btn.setAttribute('aria-label', t('repair.armedAria'));
      clearTimeout(repairUpdateArmTimer);
      repairUpdateArmTimer = setTimeout(() => {
        repairUpdateArmedBtn = null;
        repairUpdateResetLabel(btn);
      }, 4000);
      return;
    }
    clearTimeout(repairUpdateArmTimer);
    repairUpdateArmedBtn = null;
    const label = btn.querySelector('[data-role="cell-label"]');
    if (label) label.textContent = t('repair.checking');
    try {
      const res = await fetch('sw.js', { cache: 'no-store' });
      if (!res || !res.ok) throw new Error('probe failed');
    } catch {
      showInfoToast(t('repair.offline'));
      repairUpdateResetLabel(btn);
      return;
    }
    // 验收补正（v64 判例：修复没生效就必须说出来，不得无声装死）。没有注册＝
    // 没什么可注销的，reload 后会全新注册、同样达到目的，算成功；只有真的
    // 注销失败（返回 false 或抛错）才承认失败并给出可执行的出路。
    let unregistered = true;
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) unregistered = (await reg.unregister()) !== false;
      }
    } catch { unregistered = false; }
    if (!unregistered) {
      showInfoToast(t('repair.failed'));
      repairUpdateResetLabel(btn);
      return;
    }
    window.location.reload();
  }

  // --- Actions ---
  function registerActions() {
    // 新发现：header「···」更多按钮此前是裸文本字形，换成 iconSvg 体系图标（一次性
    // 注入，因为它是 index.html 静态壳里的按钮，不像其它图标按钮那样走 JS 模板渲染）。
    const moreBtn = document.querySelector('[data-action="open-more"]');
    if (moreBtn) moreBtn.innerHTML = iconSvg('more');
    document.addEventListener('click', e => {
      const el = e.target.closest('[data-action]');
      if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      const action = el.dataset.action;
      if (action === 'theme') setThemePref(el.dataset.theme);
      if (action === 'set-locale') setLocalePref(el.dataset.locale || '');
      if (action === 'view') setView(el.dataset.view);
      if (action === 'shift-period') shiftPeriod(Number(el.dataset.delta || 0));
      if (action === 'today') goToday();
      if (action === 'open-form') sheetController.openForm();
      if (action === 'backfill-seg') sheetController.openFormSheet({
        mode: 'new',
        ts: el.dataset.ts,
        endTs: el.dataset.end,
        backfill: true,
        backfillKind: el.dataset.kind,
        sourceId: el.dataset.sourceId || ''
      });
      if (action === 'open-help') openHelp();
      if (action === 'open-more') sheetController.openMoreSheet();
      if (action === 'open-tag-config') openTagConfig();
      if (action === 'open-motto') sheetController.openFormSheet({ mode: 'motto' });
      if (action === 'save-motto') sheetController.saveMotto();
      if (action === 'reset-motto-input') sheetController.resetMottoInput();
      if (action === 'toggle-start-time') sheetController.toggleStartTime(el);
      if (action === 'toggle-edit-start-time') sheetController.toggleEditStartTime(el);
      if (action === 'pick-edit-end-mode') sheetController.pickEditEndMode(el);
      if (action === 'pick-form-tag') sheetController.pickTag(el);
      if (action === 'pick-form-bucket') sheetController.pickBucket(el);
      if (action === 'pick-record-mode') sheetController.pickRecordMode(el);
      if (action === 'pick-overnight-end-mode') sheetController.pickOvernightEndMode(el);
      if (action === 'save-entry') sheetController.saveEntry();
      if (action === 'close-form') {
        if (sheetController.getSheetMode() === 'delete-confirm') cancelDelete();
        else sheetController.closeForm();
        renderIfCrossTabPending();
      }
      if (action === 'use-conflict-plus-new' || action === 'use-conflict-plus-edit') sheetController.useConflictPlusMinute(el);
      if (action === 'edit-conflict-entry') sheetController.editConflictEntry(el.dataset.id);
      if (action === 'start-edit') sheetController.startEdit(el.dataset.id);
      if (action === 'pick-edit-tag') sheetController.pickEditTag(el);
      if (action === 'pick-edit-bucket') sheetController.pickBucket(el);
      if (action === 'commit-edit') sheetController.commitEdit(el.dataset.id || sheetEditId);
      if (action === 'cancel-edit') sheetController.cancelEdit();
      if (action === 'open-backup') sheetController.openBackupSheet();
      if (action === 'open-advanced') sheetController.openAdvancedSheet();
      if (action === 'save-tag-config') sheetController.saveTagConfig();
      if (action === 'confirm-tag-merge') sheetController.saveTagConfig({ confirmMerge: el.dataset.signature || '' });
      if (action === 'set-current-mainline') sheetController.setCurrentMainline(el.dataset.name || '');
      if (action === 'cfg-pick-bucket') sheetController.pickConfigBucket(el);
      if (action === 'cfg-toggle-delete') sheetController.toggleConfigRowDelete(el);
      if (action === 'cfg-add-row') sheetController.addConfigRow(el);
      if (action === 'cfg-remove-draft') sheetController.removeConfigDraftRow(el);
      if (action === 'preview-locale-defaults') sheetController.previewLocaleDefaults();
      if (action === 'apply-locale-defaults') sheetController.applyLocaleDefaults();
      if (action === 'cancel-locale-defaults') sheetController.cancelLocaleDefaults();
      if (action === 'confirm-planned') confirmPlanned(el.dataset.id);
      if (action === 'confirm-segment') confirmSegment(el.dataset.id, el.dataset.end);
      if (action === 'request-delete') requestDelete(el.dataset.id);
      if (action === 'confirm-delete') confirmDelete(el.dataset.id);
      if (action === 'cancel-delete') cancelDelete();
      if (action === 'undo-delete') undoDelete();
      if (action === 'drill') drill(el.dataset.date, el.dataset.view);
      if (action === 'copy-summary') ioActions.copyCurrentViewSummary();
      if (action === 'copy-json') ioActions.copyJSON();
      if (action === 'download-json') ioActions.downloadJSON();
      if (action === 'import-json') ioActions.importJSON();
      if (action === 'cancel-import-shift') ioActions.cancelImportShift();
      if (action === 'confirm-import-shift') ioActions.confirmImportShift();
      if (action === 'resolve-import-conflict') ioActions.resolveImportConflict(el.dataset.key, el.dataset.resolution);
      if (action === 'send-backup') ioActions.shareJSON();
      if (action === 'toggle-boot-diag') toggleBootDiag();
      if (action === 'copy-boot-diag') ioActions.copyBootDiagnostics();
      if (action === 'repair-update-channel') repairUpdateChannel(el);
      if (action === 'update-app') applyUpdate();
      if (action === 'dismiss-update-banner') {
        const banner = document.getElementById('update-banner');
        if (banner) banner.hidden = true;
      }
      if (action === 'dismiss-cross-tab-banner') {
        const b = document.getElementById('cross-tab-banner');
        if (b) b.hidden = true;
        cancelUndoForConflict();
        render();
      }
    });
    document.getElementById('import-file').addEventListener('change', ioActions.handleImport);
    document.addEventListener('input', e => {
      if (e.target instanceof HTMLTextAreaElement && e.target.classList.contains('ta')) {
        sheetController.autosizeTextareas(e.target.parentElement || document);
      }
      if (e.target instanceof HTMLInputElement && (e.target.id === 'form-ctag' || e.target.matches('[data-role="edit-custom-tag"]'))) {
        sheetController.updateMainlineHint(e.target);
        sheetController.syncCustomDraft(e.target);
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.target.id === 'import-shift-hours') ioActions.previewImportShift(e.target.value);
        sheetController.handleFormInput(e.target);
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (sheetController.getSheetMode() === 'delete-confirm') cancelDelete();
        else { sheetController.cancelEdit(); sheetController.closeForm(); }
        renderIfCrossTabPending();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (sheetEditId) { sheetController.commitEdit(sheetEditId); return; }
        if (sheetController.isFormOpen()) sheetController.saveEntry();
      }
    });
    window.addEventListener('resize', sheetController.handleResponsiveResize, { passive: true });
    window.addEventListener('orientationchange', sheetController.handleResponsiveResize, { passive: true });
    window.addEventListener('storage', e => {
      if (e.key !== 'timelog.v1') return;
      cancelUndoForConflict();
      if (sheetEditId || sheetController.isFormOpen() || sheetController.getSheetMode()) {
        const b = document.getElementById('cross-tab-banner');
        if (b) b.hidden = false;
      } else {
        render();
      }
    });
  }

  function renderIfCrossTabPending() {
    const b = document.getElementById('cross-tab-banner');
    if (b && !b.hidden) render();
  }

  // 触摸/触控笔左滑揭示 2x72px 编辑/删除轨道。一次只开一张；纵向滚动、点空白、
  // 打开另一张都会关闭。桌面鼠标不启用，键盘仍走点卡片编辑与编辑页删除。
  function registerCardSwipe() {
    const timeline = document.getElementById('timeline');
    if (!timeline) return;
    const TRACK = 144;
    const SNAP = 72;
    let active = null;
    let openRow = null;
    let suppressClickUntil = 0;

    function setActionsEnabled(row, enabled) {
      const actions = row && row.querySelector('.swipe-actions');
      if (!actions) return;
      actions.setAttribute('aria-hidden', String(!enabled));
      actions.querySelectorAll('button').forEach(button => { button.tabIndex = enabled ? 0 : -1; });
    }

    function setOffset(row, offset, animate = false) {
      const card = row && row.querySelector('.entry');
      if (!card) return;
      card.style.transition = animate ? 'transform 180ms cubic-bezier(.2,.8,.2,1)' : 'none';
      card.style.transform = offset ? `translateX(${offset}px)` : '';
      row.dataset.swipeOffset = String(offset);
      row.classList.toggle('swipe-open', offset === -TRACK);
      if (offset < 0) row.classList.add('swipe-revealing');
      else if (!animate) row.classList.remove('swipe-revealing');
      setActionsEnabled(row, offset === -TRACK);
      if (animate) setTimeout(() => {
        if (document.contains(card)) {
          card.style.transition = '';
          if (!offset) row.classList.remove('swipe-revealing');
        }
      }, 200);
    }

    function closeOpen(animate = true) {
      if (openRow && document.contains(openRow)) setOffset(openRow, 0, animate);
      openRow = null;
    }

    function finishGesture(cancelled = false) {
      if (!active) return;
      const { row, offset, axis, velocity } = active;
      const shouldOpen = !cancelled && axis === 'x' && (offset <= -SNAP || velocity < -0.45);
      if (shouldOpen) {
        if (openRow && openRow !== row) setOffset(openRow, 0, true);
        setOffset(row, -TRACK, true);
        openRow = row;
      } else {
        setOffset(row, 0, true);
        if (openRow === row) openRow = null;
      }
      if (axis === 'x') suppressClickUntil = performance.now() + 350;
      active = null;
    }

    function begin(row, x, y, source, pointerId = null) {
      if (!row || !row.querySelector('.entry[data-action="start-edit"]')) return;
      if (openRow && openRow !== row) closeOpen(true);
      active = {
        row,
        source,
        pointerId,
        startX: x,
        startY: y,
        base: Number(row.dataset.swipeOffset || 0),
        offset: Number(row.dataset.swipeOffset || 0),
        axis: '',
        lastX: x,
        lastAt: performance.now(),
        velocity: 0
      };
    }

    function move(x, y, event) {
      if (!active) return;
      const dx = x - active.startX;
      const dy = y - active.startY;
      if (!active.axis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        active.axis = Math.abs(dx) > Math.abs(dy) + 4 ? 'x' : 'y';
        if (active.axis === 'y') {
          closeOpen(true);
          active = null;
          return;
        }
      }
      if (active.axis !== 'x') return;
      const now = performance.now();
      const elapsed = Math.max(1, now - active.lastAt);
      active.velocity = (x - active.lastX) / elapsed;
      active.lastX = x;
      active.lastAt = now;
      active.offset = Math.max(-TRACK, Math.min(0, active.base + dx));
      setOffset(active.row, active.offset, false);
      if (event && event.cancelable) event.preventDefault();
    }

    timeline.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      if (e.target.closest('.mini-btn, .swipe-action')) return;
      const row = e.target.closest('.swipe-row');
      begin(row, e.clientX, e.clientY, 'pointer', e.pointerId);
      if (active && row.setPointerCapture) row.setPointerCapture(e.pointerId);
    });
    timeline.addEventListener('pointermove', e => {
      if (!active || active.source !== 'pointer' || active.pointerId !== e.pointerId) return;
      move(e.clientX, e.clientY, e);
    });
    timeline.addEventListener('pointerup', e => {
      if (active && active.source === 'pointer' && active.pointerId === e.pointerId) finishGesture(false);
    });
    timeline.addEventListener('pointercancel', e => {
      if (active && active.source === 'pointer' && active.pointerId === e.pointerId) finishGesture(true);
    });

    // Synthetic TouchEvent coverage and older WebKit fallback.
    timeline.addEventListener('touchstart', e => {
      if (active || e.touches.length !== 1 || e.target.closest('.mini-btn, .swipe-action')) return;
      const touch = e.touches[0];
      begin(e.target.closest('.swipe-row'), touch.clientX, touch.clientY, 'touch');
    }, { passive: true });
    timeline.addEventListener('touchmove', e => {
      if (!active || active.source !== 'touch' || e.touches.length !== 1) return;
      move(e.touches[0].clientX, e.touches[0].clientY, e);
    }, { passive: false });
    timeline.addEventListener('touchend', () => {
      if (active && active.source === 'touch') finishGesture(false);
    }, { passive: true });
    timeline.addEventListener('touchcancel', () => {
      if (active && active.source === 'touch') finishGesture(true);
    }, { passive: true });

    timeline.addEventListener('click', e => {
      const row = e.target.closest('.swipe-row');
      if (e.target.closest('.swipe-action')) {
        if (row === openRow) closeOpen(false);
        return;
      }
      if (performance.now() < suppressClickUntil || (row && row === openRow)) {
        e.preventDefault();
        e.stopPropagation();
        if (row === openRow) closeOpen(true);
      }
    });
    document.addEventListener('pointerdown', e => {
      if (openRow && !e.target.closest('.swipe-row')) closeOpen(true);
    }, { passive: true });
    window.addEventListener('scroll', () => closeOpen(true), { passive: true });

    // R6：卡片是 role=button 的 div，键盘 Enter/Space 激活（等价点击）——保 a11y 不回退。
    timeline.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      const cardEl = e.target.closest('.entry[data-action]');
      if (!cardEl || cardEl !== e.target) return;
      e.preventDefault();
      cardEl.click();
    });
  }

  // --- Register SW ---
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (updateReloading) {
        clearUpdateApplyTimer();
        window.location.reload();
      }
    });
    navigator.serviceWorker.register('sw.js').then(reg => {
      // 新 worker 进入 waiting 后始终提示，由用户点击后才 skipWaiting + reload。
      // 不在空闲态静默重载：用户需要看见版本边界，也避免刷新造成视觉闪烁。
      const consider = () => {
        if (updateReloading) return;
        if (!reg.waiting || !navigator.serviceWorker.controller) return;
        showUpdatePrompt(reg);
      };
      consider();
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) consider();
        });
      });
      // 主动、及时地复查新版本——iOS Safari（尤其 standalone PWA）不会主动/及时
      // 复查 sw.js。每次冷启动 + 每次切回前台都强制 update()，让新版尽快到达。
      // SPEC-006 A：飞行模式下 reg.update() 的网络请求会触发 iOS 系统弹窗（"打开
      // 飞行模式或使用 Wi-Fi"），离线时跳过——恢复在线后下一次前台事件照常检查，
      // 不需要补偿逻辑。诚实边界：WebKit 自身按导航节奏的 SW 复查不受 JS 控制，
      // 极偶发的系统提示仍可能出现；这里消除的是每次进入必弹的主要来源。
      const checkForUpdate = () => {
        if (navigator.onLine === false) return;
        reg.update().catch(() => {});
      };
      checkForUpdate();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
    }).catch(() => {});
  }

  // --- Init ---
  let tickTimer = null;
  let lastRenderedMinute = '';

  // v86：真机上出现过「应用一直在前台，时间却停在一两分钟前」（S23 截图：系统
  // 21:22 / 界面 21:20）。对齐分钟的定时器本身没问题，问题是**进程被系统冻住**时
  // 它既不会触发、也不会有 visibilitychange/focus 事件把我们叫醒（Samsung 的省电
  // 策略尤其激进）。用户一旦碰这个页面，界面就该是当前时间：先做一次「分钟变了吗」
  // 的字符串比较（廉价），变了才走 refreshLiveClock（那里才 load() + 算签名）。
  // **必须挂在 click 的冒泡阶段、不能挂 pointerdown**：pointerdown 时重渲染会把
  // 正在被点的那个元素换掉，随后的 click 落在已脱离文档的节点上、永远到不了
  // 事件委托——一次点击被自己吞掉。第一版就是 pointerdown，`plan defaults…` 用例
  // 当场变红（点 FAB 没反应），比线上被吞掉的那一下便宜得多。冒泡阶段则保证动作
  // 已经跑完；若动作打开了 sheet，refreshLiveClock 自己会早退。
  function refreshLiveClockOnTouch() {
    if (!lastRenderedMinute || nowStr() === lastRenderedMinute) return;
    refreshLiveClock();
  }

  function refreshLiveClock() {
    if (document.hidden) return;
    if (sheetEditId || sheetController.isFormOpen() || sheetController.getSheetMode()) return;
    const signature = dataSignature();
    if (signature === lastIntervalSignature) return;
    // P35：WebKit 无 scroll anchoring，#timeline 整块替换的瞬间文档变矮，窗口滚动
    // 被钳回 0——回看今天早些的记录时每分钟被拽回顶部。这里是唯一的被动重渲染
    // 路径（用户没有操作、不该动视口），渲染后同帧还原滚动位置。
    const scrollY = window.scrollY;
    render();
    if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
  }

  function startTickTimer() {
    if (tickTimer !== null) return;
    const delay = 60000 - (Date.now() % 60000);
    tickTimer = setTimeout(() => {
      tickTimer = null;
      refreshLiveClock();
      startTickTimer();
    }, delay);
  }

  function stopTickTimer() {
    if (tickTimer === null) return;
    clearTimeout(tickTimer);
    tickTimer = null;
  }

  function resumeLiveClock() {
    // iOS standalone may suspend/discard a timer without clearing its JS id.
    // Always replace it, and reconcile immediately instead of waiting up to a minute.
    stopTickTimer();
    refreshLiveClock();
    startTickTimer();
  }

  // P33 缓解押注：申请常驻存储，降低系统在长间隔后回收 Cache Storage/SW 的概率。
  // 这只是申请、不保证生效；真实效果由启动诊断样本里的 persisted 布尔佐证。
  function requestPersistentStorage() {
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch {}
  }

  // 启动诊断（v62；v68 诊断 v2 增补 SW 注册态与首绘）：开关关闭时这里一次早退，
  // 不留任何监听器/timer/持久化痕迹。样本只含计时、布尔、缓存命中数与固定枚举的
  // SW 注册态——用来区分「缓存被回收」「SW 没接管」「waiting 交接卡死」「纯网络慢」
  // 「模块执行慢」等根因，绝不记录条目内容、标签或备份数据。
  async function recordBootDiagnostics(readyMs) {
    if (!readBootDiag().enabled) return;
    const sample = {
      at: Date.now(),
      ver: APP_VERSION,
      nav: '',
      htmlMs: 0,
      moduleMs: bootDiagModuleAt,
      readyMs,
      fcpMs: -1,
      controlled: bootDiagControlled,
      sw: bootDiagSwStates,
      snapshot: bootDiagSnapshotAdopted,
      standalone: Boolean((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true),
      persisted: null,
      cache: '',
      cacheFiles: -1,
      cacheCount: 0
    };
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav) {
        sample.nav = nav.type || '';
        sample.htmlMs = Math.round(nav.responseEnd || 0);
      }
    } catch {}
    try {
      const paint = performance.getEntriesByType('paint').find(entry => entry.name === 'first-contentful-paint');
      if (paint) sample.fcpMs = Math.round(paint.startTime);
    } catch {}
    try {
      // 早读 promise 极少数情况在 app-ready 前未回来；兜底晚读仍是同一固定枚举，
      // 只是可能混入本次 reg.update() 的过渡态。
      if (!sample.sw && navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        sample.sw = bootDiagFormatSwStates(await navigator.serviceWorker.getRegistration());
      }
    } catch {}
    try {
      if (navigator.storage && navigator.storage.persisted) sample.persisted = await navigator.storage.persisted();
    } catch {}
    try {
      if (window.caches) {
        const names = (await caches.keys()).filter(name => /^timelog-v\d+$/.test(name));
        sample.cacheCount = names.length;
        names.sort((a, b) => Number(a.slice(9)) - Number(b.slice(9)));
        const newest = names[names.length - 1] || '';
        sample.cache = newest;
        if (newest) sample.cacheFiles = (await (await caches.open(newest)).keys()).length;
      }
    } catch {}
    appendBootDiagSample(sample);
  }

  // 开关翻转后经 openMoreSheet 原地重渲染（returnToMore 已验证的重入路径）。
  function toggleBootDiag() {
    setBootDiagEnabled(!readBootDiag().enabled);
    // v84：这个开关现在住在「高级」二级页里——原地重渲染当前那一层，别把用户
    // 弹回「更多」（否则开关一按就跳走一层，还会把返回栈搞乱）。
    sheetController.openAdvancedSheet();
  }

  // SPEC-013：把完整 catalog 应用到静态壳的 data-i18n* 上。index.html 的内联字典
  // 已经填过一遍（首帧不闪），这里是幂等的第二遍——内联字典只带壳用得到的键，
  // 完整 catalog 才是权威。
  function applyShellI18n() {
    const put = (attr, apply) => {
      document.querySelectorAll('[' + attr + ']').forEach(el => {
        apply(el, t(el.getAttribute(attr)));
      });
    };
    put('data-i18n', (el, v) => { el.textContent = v; });
    put('data-i18n-aria', (el, v) => { el.setAttribute('aria-label', v); });
    put('data-i18n-tip', (el, v) => { el.setAttribute('data-tip', v); });
    put('data-i18n-alt', (el, v) => { el.setAttribute('alt', v); });
  }

  function init() {
    // SPEC-014 修复（方案 A）：存量用户迁移守卫必须先于 resolveLocale() 运行，
    // 否则「从未显式选过语言 + 浏览器偏好英文 + 本机已有数据」的存量用户会被
    // navigator 探测分支（v78 才第一次真正生效）静默切成英文。
    // locale 必须在任何渲染、任何 BUCKETS 读取之前定下来。
    ensureLegacyLocalePinned();
    setLocale(resolveLocale(loadLocalePref(), navigator.languages));
    refreshBucketLabels();
    applyShellI18n();
    // 静态壳的同步脚本比这里更早跑，它自己的判定与这里应当一致；这里是权威
    // 结果，覆盖回去以防两者因任何原因不一致。
    document.documentElement.lang = getLocale();
    markBootTrace('init_start');
    updateMigrationNotice();
    const today = todayStr();
    // 只做诊断：写下本机首用日备查，不再驱动任何用户可见里程碑。
    ensureFirstUsedDate(today, load().entries);
    const savedView = localStorage.getItem(VIEW_KEY);
    const savedDate = parseDateKey(localStorage.getItem(SELECTED_DATE_KEY));
    state.view = ['day', 'week', 'month', 'year'].includes(savedView) ? savedView : 'day';
    state.selectedDate = savedDate ? localDateKey(savedDate) : today;
    localStorage.setItem(OPEN_DATE_KEY, today);
    persistState();

    applyTheme(localStorage.getItem(THEME_KEY) || 'auto');
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    if (mq.addEventListener) mq.addEventListener('change', () => applyTheme(localStorage.getItem(THEME_KEY) || 'auto'));
    // v53：命中快照则跳过首轮渲染（恢复节点保持同一 DOM，不闪）。v56 补版本门：
    // 快照是旧版本写的就当没有快照——旧 DOM 形态不能在新版 JS 下继续活着。
    let restoredBootFrame = window.__timelogBootRestored === true;
    if (restoredBootFrame) {
      try {
        const snap = JSON.parse(sessionStorage.getItem(BOOT_SNAPSHOT_KEY));
        if (!snap || snap.appVersion !== APP_VERSION) {
          restoredBootFrame = false;
          setBootSnapshotState('rejected:version');
        } else if ((snap.locale || 'zh') !== getLocale()) {
          restoredBootFrame = false;
          setBootSnapshotState('rejected:locale');
        }
      } catch {
        restoredBootFrame = false;
        setBootSnapshotState('rejected:invalid');
      }
    }
    if (restoredBootFrame) {
      lastIntervalSignature = dataSignature();
      bootDiagSnapshotAdopted = true;
      setBootSnapshotState('adopted');
      markBootTrace('snapshot_adopted');
    } else {
      render();
      markBootTrace('first_render_complete');
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.body.classList.add('app-ready');
        markBootTrace('app_ready');
        requestPersistentStorage();
        recordBootDiagnostics(Math.round(performance.now())).catch(() => {});
        initBootTraceHud();
        document.body.classList.remove('boot-restored');
        delete window.__timelogBootRestored;
        if (!navigator.webdriver && !localStorage.getItem(HELP_SEEN_KEY)) openHelp();
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopTickTimer();
      else resumeLiveClock();
    }, { passive: true });
    window.addEventListener('pageshow', resumeLiveClock, { passive: true });
    window.addEventListener('focus', resumeLiveClock, { passive: true });
    document.addEventListener('click', refreshLiveClockOnTouch, { passive: true });
    window.addEventListener('scroll', refreshLiveClockOnTouch, { passive: true });
    startTickTimer();
  }

  function initBootTraceHud() {
    if (!bootTrace || document.getElementById('boottrace-hud')) return;
    const hud = document.createElement('div');
    hud.id = 'boottrace-hud';
    hud.setAttribute('aria-label', t('diag.hudAria'));
    hud.style.cssText = 'position:fixed;left:4px;right:4px;bottom:max(4px,env(safe-area-inset-bottom));'
      + 'z-index:2147483646;pointer-events:none;max-height:48vh;overflow:auto;'
      + 'font:10px/1.45 ui-monospace,Menlo,monospace;color:#b8ffab;background:rgba(0,0,0,.82);'
      + 'border:1px solid rgba(184,255,171,.35);border-radius:8px;padding:6px 8px;'
      + 'white-space:pre-wrap;word-break:break-word';
    const first = bootTrace.marks[0] ? bootTrace.marks[0].at : 0;
    const marks = bootTrace.marks.map((mark, index) => {
      const previous = index ? bootTrace.marks[index - 1].at : first;
      return `${String(index + 1).padStart(2, '0')} ${mark.name} +${Math.round(mark.at - previous)}ms (${Math.round(mark.at - first)}ms)`;
    });
    const nav = performance.getEntriesByType('navigation')[0];
    const navLines = nav
      ? ['startTime', 'requestStart', 'responseStart', 'responseEnd', 'domInteractive', 'domContentLoadedEventEnd', 'loadEventEnd']
          .filter(key => Number.isFinite(nav[key]) && (key === 'startTime' || nav[key] > 0))
          .map(key => `${key}=${Math.round(nav[key])}ms`)
      : ['Navigation Timing unavailable'];
    hud.textContent = [
      `boottrace v${APP_VERSION} snapshot=${bootTrace.snapshotStates.join(' → ')}`,
      ...marks,
      `page total=${Math.round((bootTrace.marks[bootTrace.marks.length - 1]?.at || first) - first)}ms`,
      t('diag.navTimingNote'),
      ...navLines
    ].join('\n');
    document.body.appendChild(hud);
  }

  // --- vv 诊断 HUD（?vvdebug=1 启用；P20 键盘时序与分享能力真机取证，无参数时零成本） ---
  function initVvDebugHud() {
    let enabled = false;
    try { enabled = new URLSearchParams(window.location.search).has('vvdebug'); } catch {}
    if (!enabled) return;
    const hud = document.createElement('div');
    hud.setAttribute('aria-hidden', 'true');
    hud.style.cssText = 'position:fixed;left:4px;right:4px;top:max(4px,env(safe-area-inset-top));'
      + 'z-index:2147483647;pointer-events:none;font:10px/1.45 ui-monospace,Menlo,monospace;'
      + 'color:#7cff5e;background:rgba(0,0,0,0.72);border-radius:8px;padding:5px 7px;'
      + 'white-space:pre-wrap;word-break:break-all';
    document.body.appendChild(hud);
    const t0 = performance.now();
    const lines = [];
    const vv = window.visualViewport;
    const standalone = Boolean(
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || navigator.standalone
    );
    const header = () =>
      `v${APP_VERSION} share:${typeof navigator.share} canShare:${typeof navigator.canShare} standalone:${standalone}\n`
      + `inner:${window.innerHeight} vv:${vv ? `${Math.round(vv.height)}@${Math.round(vv.offsetTop)}` : 'n/a'}`;
    const paint = () => { hud.textContent = `${header()}\n──\n${lines.join('\n')}`; };
    window.__vvlog = msg => {
      lines.push(`${String(Math.round(performance.now() - t0)).padStart(6)} ${msg}`);
      if (lines.length > 16) lines.shift();
      paint();
    };
    if (vv) {
      vv.addEventListener('resize', () => window.__vvlog(`vv:resize h=${Math.round(vv.height)} top=${Math.round(vv.offsetTop)}`));
      vv.addEventListener('scroll', () => window.__vvlog(`vv:scroll h=${Math.round(vv.height)} top=${Math.round(vv.offsetTop)}`));
    }
    document.addEventListener('focusin', e => window.__vvlog(`focusin ${e.target && e.target.tagName}`));
    document.addEventListener('focusout', e => window.__vvlog(`focusout ${e.target && e.target.tagName}`));
    window.__vvlog('HUD ready');
  }

  registerActions();
  registerCardSwipe();
  registerServiceWorker();
  initVvDebugHud();
  init();

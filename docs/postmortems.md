# 排查记录（Postmortems）

记录已发生并已修复（或已确诊待修）的功能/逻辑 bug：**现象 → 根因 → 修法 → 护栏 → 范围**。
与 `docs/decisions.md`（评估过但不落地）区分：这里只放真实出过问题的东西。

---

## P1 · 编辑记录静默不落库（v28 热修）

**确诊日期**：2026-07-01 · **状态**：已修复（v28）· **严重度**：高（静默数据丢失）

**现象**：
- 点已有记录的铅笔 → 改「做了什么」/ 改标签 chip / 改时间 → 点 ✓ 保存 → 看似没反应，记录仍是原样。
- 不分标签：改自定义标签不生效，改已有 chip 也不生效；进一步发现改内容、改时间同样丢失。表现像「整个修改功能没实现」。
- 新建 / 续记 / 补录的「新增」能存下（受其它守卫拦截除外），唯独**编辑**全丢。

**根因**：`src/storage.js` 的 `load()` 每次都 `JSON.parse(localStorage)`，**每次返回一张全新的对象图**。而 `src/sheet_controller.js` 的 `commitEdit` 调了**两次** `load()`：

- `entry` 取自 **load #1**；
- 真正被保存的 `d` 取自 **load #2**，与 `entry` 不是同一张图。

于是 `entry.ts/what/tags = …` 改的是 load #1 的对象，`deps.save(d)` 写回的是 load #2（从未被改过）。**所有编辑都写进一个随后被丢弃的对象，等于没存。** `saveEntry`（新增/续记/补录）只用了一个 `d`，所以新增能存、编辑不能——正好对上现象。

**修法**：`commitEdit` 收敛为**单次** `load()`，在被保存的同一张图里取 `entry`：

```js
const d = deps.load();
const entry = d.entries.find(e => e.id === id);
// …校验、冲突检查…
if (entry) { entry.ts = …; entry.what = …; entry.tags = [tag]; deps.save(d); }
```

外科手术级改动，只动 `commitEdit` 两行；不碰续记/结算/跨日等精密逻辑。

**护栏**：
- 新增 UI smoke：`editing an existing record persists content and tag (① commitEdit single load)`——打开已有记录、同时改内容与标签、保存、断言 localStorage 落库，并 reload 后仍在。
- 全量审查运行时所有 `load()` 调用点，确认「在一张图里改、却保存另一张图」只此一处（`saveTagConfig`/`confirmPlanned`/`saveEntry` 均为单次 load，安全）。

**经验**：`load()` 是纯函数式（每次新图），任何「先 find 后 save」的写路径**必须共用同一次 load 的结果**。后续新增写路径沿用此约束。

---

## P2 · 编辑时 ✓ 被 iOS 键盘顶出屏外（v29）

**确诊日期**：2026-07-01 · **状态**：已修复（v29）· **严重度**：中（功能不可达）

**现象**：iPhone SE2 上编辑记录、聚焦输入弹出软键盘后，保存 ✓ 跑到屏幕上方看不见、够不着，能改但存不了。

**根因**：`.form-sheet` 是 `position: fixed; inset: 0` 的遮罩，面板 bottom-anchored（`align-items: end`），✓ 在顶部 sticky 的 `.form-sheet-head` 里。iOS 键盘弹出时 Safari 把整个 fixed 遮罩上推，顶部 head（连同 ✓）被推出可视区。

**修法**：visualViewport 驱动——`sheet_controller.js` 在开 sheet 时监听 `window.visualViewport` 的 `resize`/`scroll`，把可视视口的 top/height 写进 `--vvt`/`--vvh` CSS 变量；`.form-sheet` 用 `top: var(--vvt)`、`height: var(--vvh)`、面板 `max-height: var(--vvh, …)` 跟随键盘上方的可视区。无 visualViewport 时回退到原布局。关 sheet 时移除监听并清变量。

**护栏**：需真机验（fixed-overlay + 键盘交互无法在 headless 稳定复现）；CSS 回退保证不支持时退回旧行为。

---

## P3 · 补录计划模式泄漏致 ✓ 静默失败（v29）

**确诊日期**：2026-07-01 · **状态**：已修复（v29）· **严重度**：中

**现象**：补**今天**的空档（「补一下」）填好内容、选好标签、点 ✓ → 静默不保存；与标签无关。

**根因**：`openFormSheet` 让 `new` 模式沿用持久化的记录模式 pref（`loadRecordModePref`），且只在「历史日」(`isHistoryDate`) 才强制 `log`。今天不是历史日，所以若 pref 曾停在「计划中」，补录表单以计划模式打开、预填过去时刻，`validatePlannedTs` 拒「计划时间应晚于现在」→ 在标签逻辑之前就 return。

**修法**：`openFormSheet` 收 `backfill` 标志（由 `backfill-gap` 动作传入），`isHistoryDate() || opts.backfill` 时强制 `formRecordMode = 'log'`；`renderFormSheet` 收同名标志，补录时不渲染记录模式开关。

**护栏**：UI smoke `② backfill on today forces log mode even when plan pref leaked`——预置 `recordMode='plan'`，补录今天空档，断言开关不存在且保存为非计划记录。

---

## P4 · 补录撞中间空占位条被当冲突拦下（v29）

**确诊日期**：2026-07-01 · **状态**：已修复（v29）· **严重度**：中

**现象**：补录落到当天**中间**一条空占位条所在的分钟时，被当成同刻冲突拦下，存不进。

**根因**：`saveEntry` 只经 `openPlaceholderForDate`（仅看当天**最后**一条）识别可复用占位条；中间被遗落的占位条不被识别，于是走 `findTimeConflict` 被判为同刻冲突。

**修法**：**局部并入**——`saveEntry` 内若同刻冲突的那条本身是空 placeholder（`isPlaceholderEntry`）且非计划，就地采纳它作为填充目标，不报冲突。**不改**共享的 `openPlaceholderForDate`，影响面锁在补录路径，避开续记/结算/跨日精密逻辑。

**护栏**：UI smoke `③ backfill fills a middle placeholder instead of self-conflicting`——补录到中间占位条分钟，断言就地填充、该分钟无重复条。

---

## P5 · 被拦保存无可见反馈（v29）

**确诊日期**：2026-07-01 · **状态**：已修复（v29）· **严重度**：低（体验）

**现象**：保存被拦（时间非法 / 内容空 / 同刻冲突）时只留一条不显眼的内联提示，可能落在键盘下方或折叠区外，✓ 看起来像坏的。

**修法**：`showInlineError`（sheet_controller）和 `setTimeInputError`（pickers）在显示消息后 `scrollIntoView({ block: 'center' })`，把反馈拉进视野。

**护栏**：归在 ④ 体验类，靠现有冲突 smoke 覆盖触发路径。

---

## P6 · 滚轮日期窗口静默改值（v29）

**确诊日期**：2026-07-01 · **状态**：已修复（v29）· **严重度**：中（潜在静默数据改写，当前数据够不着）

**现象（潜在）**：移动端滚轮日期选择器窗口固定 ±90/+7 天。打开窗口外的记录（>90 天前或 >7 天后）时 `findIndex` 返回 -1，`Math.max(0, -1)=0` 让初始值落到 index 0（90 天前）；保存即把该记录日期**静默搬到边界**。当前真实数据尚无 >90 天记录，够不着，但攒够历史或导入旧数据后会触发。

**修法**：`buildDateItems(anchor)` 动态把窗口扩到包含打开值；扩展上限 `MAX_WINDOW_DAYS=800` 防生成上千行，超限时把那个极远日期**钉为单独的边界项**保证其 val 一定在列表里；`mountWheel` 用精确 index，找不到时回退到今天而非静默 0。桌面端是日历 + 自由文本输入，无此窗口，无需改。

**护栏**：confirm_smoke 不覆盖 DOM；该路径靠真机/手动验，逻辑改动集中在 `buildDateItems`/`mountWheel`。

---

## P7 · confirmPlanned 撞同刻无守卫（v29）

**确诊日期**：2026-07-01 · **状态**：已修复（v29）· **严重度**：低

**现象（潜在）**：把计划标记「已发生」时 `ts→now`，但不走 `findTimeConflict`，可造出与现有记录同刻的重复条（其它写路径都有同刻守卫）。

**修法**：`confirmPlanned` 在 `ts→now` 后，若该分钟已被占用，复用 `addOneMinute` 向后逆推到第一个空位（与表单「用+1min」方向一致），再 `ensureOpenPlaceholderAt`。

**护栏**：UI smoke `⑥ confirming a plan onto a taken now-minute nudges forward`——预置占用「现在」分钟的记录 + 未来计划，确认计划后断言时间戳全局唯一、原记录不被覆盖。

---

## P8 · iPhone SE2 刷新闪烁（v29）

**确诊日期**：2026-07-01 · **状态**：先修后验（v29）· **严重度**：低（体验）

**现象**：SE2 刷新时闪一下（用户未能进一步描述形态）。

**修法（两个零风险嫌疑同治）**：
1. `index.html` 内联启动脚本之前只设 `data-theme`、未设 `theme-color`，亮色模式用户每次刷新先看到硬编码的暗色状态栏再纠正。改为在内联脚本里就按 pref（含 `auto`→系统）算出 effective 主题并设对 `<meta theme-color>`，paint 前就对。
2. `body:not(.app-ready) .app { opacity: 0 }` 双 rAF 后硬 0→1 蹦出。加一段短 fade-in 柔化揭露，不掩盖真实加载时间。

**护栏**：需真机验（无法 headless 复现「闪一下」的主观形态）；两项均为零风险、可独立回退。

---

## P9 · 补录搬走尾占位 / 无法优雅切分（v30）

**确诊日期**：2026-07-01 · **状态**：已修复（v30）· **严重度**：中

**现象**：想在一段已成段的时段（如 4:47→9:40）中间塞一段别的事，只能改起点，且结束会顺延到下一条，导致「6:00 之后整段被改成新标签」；补录还会牵连改动无关段。

**根因**：纯打点模型里插入只有「起点」，后半段继承新标签直到下一个点；`saveEntry` 又盲目复用 `openPlaceholderForDate`（仅当天**最后**一条）拿到的尾占位并搬到补录时刻。

**修法**：点存储 + 区间 UX。补录改「起点+终点」**有界插入** `carveInsert`：写 `新标签@起点` + `合成原标签@终点`（原标签可为空占位＝未记录），只写点、保持段不重叠强不变式，不碰 `buildRangeSegments`。落未记录段时两侧自动保持未记录。跨点窗口拦下加内联提示。每段渲染统一「补/切」按钮，预填该段 `[段起,段终]`。

**护栏**：`confirm_logic_smoke` 加 carve 拆分 / carve 落未记录两条；UI smoke 加「切分成三段、邻段不动」。

---

## P10 · 记录时静默改桶污染全历史（v30）

**确诊日期**：2026-07-01 · **状态**：已修复（v30）· **严重度**：中

**现象**：某 chip 先归 A 桶，之后记录时选了 B 桶又用同名，A 桶的全历史被静默改到 B 桶。

**根因**：`storage.addChipTag` 命中同名 existing chip 时 `existing.bucket = bucket` 直接变异并存回；桶在渲染/统计时按名字派生，于是全历史随之改桶。与自身提示「同名按 chip 归类」矛盾。

**修法**：`addChipTag` 命中同名即返回、**不改桶**；改桶只在配置页 `saveTagConfig` 显式发生。表单加一行「已属 X 桶，仍按 X 归类」小提示。

**护栏**：`confirm_logic_smoke` 加「记录同名 chip 选别的桶 → 桶不变」。

---

## P11 · 删除无归一化 / 静默并入前段（v30）

**确诊日期**：2026-07-01 · **状态**：已修复（v30）· **严重度**：中

**现象**：删除后（尾占位被删或末条被删）下一条「记一条」默认起点撞末条，被迫先 +1min；删一个独立活动会把它那段时间静默说成前一段的标签。

**根因**：`delEntry` 纯 `filter` + 重渲，无归一化、不恢复尾占位；点模型里删除让前段直接延伸盖住释放的时间。

**修法**：智能删除——两侧相邻同标签→移除让 `coalesceRedundant` 愈合（撤销切分）；否则把该条转空占位＝未记录，绝不静默改成前段标签。所有写路径末尾统一 `normalizeEntries`（去冗余边界 + 今天恒保尾占位），根治「增删改补录后被迫 +1min」。占位渲染区分活动尾（进行中）与中间/历史（未记录）。

**护栏**：UI smoke 加「删独立中段→转未记录、邻段不变」；`coalesceRedundant` 加「同标签不同内容不合并」防误并。

---

## P12 · sheet 打开先小后大 / iPhone 抖动（v30）

**确诊日期**：2026-07-01 · **状态**：先修后验（v30）· **严重度**：低（体验）

**现象**：iPhone Safari PWA 打开新增表单时先出现一个较小界面、过一小会变大。

**根因**：`.form-sheet` 用 `top:var(--vvt)`、`height:var(--vvh)`，但 `openFormSheet` 先 `sheet.hidden=false` 再 `lockBodyForSheet()→syncVisualViewport()`，首帧用 fallback 几何、随后一帧才套上真实 visualViewport 值，产生跳变。

**修法**：把 `lockBodyForSheet()`（内含首次 `syncVisualViewport`）挪到 `sheet.hidden=false` **之前**，首帧即带正确 `--vvt/--vvh`。Bug2「textarea 被时间控件挡住」留真机复现后实修。

**护栏**：需真机验（fixed-overlay + 键盘无法 headless 稳定复现）。

---

## P13 · iPhone SE2 编辑表单溢出屏幕、✓ 够不着（v30）

**确诊日期**：2026-07-01 · **状态**：已修复（v30）· **严重度**：高（功能不可达）

**现象**：SE2 上编辑「做了什么」较长的记录，编辑表单超出屏幕可见区域，保存 ✓ 够不着、无法编辑。用户怀疑是多行文本框导致。

**根因（两层，同一类溢出）**：
1. **横向 min-content 撑爆**：`.form-sheet-panel` 是 `.form-sheet`（grid）的子项，未设 `min-width:0`；`.form-sheet-body`（grid）用隐式 `auto` 列。文本框内容一多，其 min-content 沿 grid/flex 链把面板撑到 `max-width:600px`——在 375px 屏上 ✓ 被顶到 `left:487`，整块跑出右侧屏外（真实浏览器实测 `panel.right=600`）。
2. **纵向无上限**：`autosizeTextareas` 把高度设成 `scrollHeight` 无封顶，长内容 + 编辑态内联 200px 滚轮，键盘弹起后（visualViewport ~250px）文本框吃掉整屏。

**修法**：
- 横向：`.form-sheet-panel { min-width: 0 }` + `.form-sheet-body { grid-template-columns: minmax(0,1fr) }` + `.fl { min-width: 0 }`，与 view-tabs 的 `minmax(0,1fr)` 同一套「min-content 不撑父」纪律。
- 纵向：`autosizeTextareas` 按当前 `visualViewport.height` 的 ~32%（下限 88px）封顶，超出加 `.ta-capped` 内部滚动；`syncVisualViewport` 在键盘开合时重算封顶。

**护栏**：UI smoke `editing a long-note record keeps the save button on screen (SE2 textarea cap)`——375px 打开长内容编辑，断言 `panel.right ≤ 视宽`、✓ 四边都在视口内、textarea 被封顶且可滚。真实浏览器复现测得修后 `panel.right=360`、✓ 可点。

**经验**：任何进 grid/flex 的可变高/宽容器都要显式 `min-width:0`（或列 `minmax(0,1fr)`），否则子内容的 min-content 会静默把父撑过屏。这是本仓库第二次踩（view-tabs 之后）。

---

## 协作约束补记（v28）

- 多步改动走主线程；避免并发 fan-out 子代理 / workflow（上游会 429，串行 workflow 亦然）。已同步进 `CLAUDE.md` / `AGENTS.md`「开发与维护红线」。

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

## P14 · 保存后一拍才重排 / iPhone 收起键盘的二次抖动（v31）

**确诊日期**：2026-07-01 · **状态**：先修后验（v31）· **严重度**：低（体验）

**现象**：iPhone Safari PWA 上编辑一条记录、点 ✓ 保存后，页面先关表单重排一次，隔一拍又抖一下才稳定。P12/P13 是「打开表单」与「表单溢出」，这条是**保存关闭**时的二次重排，症状独立。

**根因**：`commitEdit`（及三条 `save*` 路径）在软键盘仍在场时**同步**执行 `closeEditSheet()` + `deps.render()`。关闭表单让持焦的 textarea/input 失焦，iOS 随后才收起软键盘并把 visualViewport 恢复高度——这次恢复发生在我们同步重排**之后**一帧，于是「关表单排一次、键盘收起再排一次」被看成两跳。桌面/无键盘不涉及这个二次恢复，所以只在真机 iOS 出现。

**修法**：新增 `settleThenTeardown(run)` 统一四条 keyboard-save 路径（`saveEntry` 计划/非计划、`saveBackfill`、`commitEdit`）。仅当 `softKeyboardUp()`（有 input/textarea 持焦 **且** `innerHeight - visualViewport.height > 120`）时：先给 `body` 加 `.sheet-closing` 抑制过渡 → `blur()` 主动收起键盘 → 监听 `visualViewport` resize，稳定 60ms 后（250ms 上限兜底防不触发）在**单帧内** `close + render`，再下一帧移除 `.sheet-closing`。这样只重排一次、且发生在键盘已收起后。桌面 / headless / 无 visualViewport / 未持焦全部走原**同步**路径，Playwright UI smoke 行为不变、不 flake。

**护栏**：需线上 Pages 真机帧步验证（fixed-overlay + 软键盘无法 headless 稳定复现，同 P12）。`.sheet-closing` 仅在 teardown 窗口存在，纯遮罩残余重排，不改最终布局。若真机仍见抖动则 v32 跟进。

**经验**：iOS 软键盘的收起是**异步**的，会在失焦后再改一次 viewport；任何「表单关闭即同步重排」都要么等键盘先落定、要么把两次重排合并进键盘收起后的单帧。

---

## P15 · SE2 刷新「空白页 + 两个漂浮按钮」（v32）

**确诊日期**：2026-07-03 · **状态**：先修后验（v32）· **严重度**：低（体验）

**现象**：SE2 等慢设备刷新时，模块加载期间页面短暂呈现「一片空白 + 底部两个漂浮按钮」再整页蹦出。P8（v29）只柔化了揭露动画，没治住形态本身。

**根因**：启动门闩 `body:not(.app-ready) .app { opacity: 0 }` 把整个 `.app`（header、tabs、date-nav 等纯静态骨架）都藏了，而 `.footer` 在 `.app` **之外**、不受门闩控制——于是 JS 加载慢的那几百毫秒里，用户看到的是「静态骨架全隐身、只剩 footer 按钮悬空」。

**修法**：门闩收窄到只藏 JS 渲染区：`body:not(.app-ready) :is(#add-btn, .ruler, .tl-head, #timeline) { opacity: 0 }`。静态骨架（header、view tabs、date-nav 壳、footer）随 HTML 解析直接绘制；数据区在首次 `render()` 之后一起淡入（`render` 先于 `app-ready` 执行，揭露时内容已正确——包括非天视图下 `#add-btn` 保持隐藏）。`prefers-reduced-motion` 下无过渡。

**护栏**：UI smoke `reload starts with has-entries boot state and reaches app-ready` 继续把关启动链路；「闪」的主观形态需真机验（同 P8）。

**经验**：门闩类样式的作用域必须和「谁真的没准备好」对齐——藏多了（静态骨架）制造新的空白闪烁，藏少了露出未渲染数据。骨架能静态直出的就不要挂在 JS ready 上。

---

## P16 · iOS 键盘开合表单二排抖动（v32）

**确诊日期**：2026-07-03 · **状态**：先修后验（v32）· **严重度**：低（体验）

**现象**：iPhone 上打开/收起软键盘时，打开中的表单 sheet 肉眼可见地跳 2-3 次才停稳（「二排抖动」）。P14（v31）治的是**保存关闭**路径；这条是键盘动画**进行中**的跟踪抖动，以及取消/遮罩/Esc 关闭路径尚未接入 settle。

**根因**：iOS 用一串离散的 `visualViewport` resize/scroll 事件表现键盘动画；`syncVisualViewport` 每个事件都写一次 `--vvt/--vvh`，sheet 就跟着每个中间值重排一次，被看成连跳。

**修法**：
1. **跟踪侧 settle**（P14 settle 思路的镜像）：`resize/scroll` 只进 `scheduleVisualViewportSync`，风暴静默 60ms（400ms 上限兜底防话痨 viewport 永不静默）后一次性落最终几何；`.vv-glide` 把这剩下的一跳变成 0.18-0.25s 的短滑（`prefers-reduced-motion` 下无过渡）。打开时的首次同步保持**同步**（P12：第一帧必须正确）；`.sheet-closing` 在场时 teardown 拥有几何权，调度器让位。settle 后把持焦的 input/textarea `scrollIntoView` 收回（可能大幅变矮的）可视折叠区内，不压在键盘底下。
2. **关闭路径补全**：`closeForm`（取消/遮罩/Esc）与 `cancelEdit` 同走 `settleThenTeardown`，键盘在场时不再两跳关闭。
3. **teardown 队列**：Esc 会先后触发 `cancelEdit` **和** `closeForm`——第二次调用到达时已 blur、`softKeyboardUp()` 为假，会绕过等待同步执行、在 teardown 中途重入。`settleThenTeardown` 改为队列：teardown 等待中时后来者入队，settle 后单帧内按序执行。

**护栏**：需线上真机帧步验证（同 P12/P14，headless 无软键盘）。桌面 / headless / 无键盘路径全部保持同步，51 条 UI smoke 全绿不 flake。

**经验**：`visualViewport` 在 iOS 键盘动画期是事件风暴不是单事件，逐事件写布局变量等于把中间帧全部演出来；跟踪侧和 teardown 侧要用同一套「等静默、单帧落位」纪律，且两侧必须明确几何权属（`.sheet-closing` 为界），否则互相覆盖。

---

## P17 · rail 拖把手松手回弹（v35）

**确诊日期**：2026-07-07 · **状态**：先修后验（v35）· **严重度**：中（核心手势体验）

**现象**：v34 SE2 真机验收，拖动边界把手改时间，松手后段边界肉眼可见地大幅弹回原位（用户录屏「二次重排」），拖拽手感与预期差距很大。

**根因**：v34 实现在 `pointermove` 里直接把相邻两段的像素高按 `2px/min` 与手指位移 1:1 改写（"轴跟手指动"），松手后 `render()` 改用 `railHeight = clamp(54, mins×1.1, 200)` 重新布局。真实一天的时间分布是「少数大块（睡眠常 8–13h）+ 大量碎段」，大块段拖前拖后都被钳在 200px 上限——于是拖了 N px，松手原路弹回 N px，钳制越狠回弹越明显。这是 **drag-space（像素:分钟线性映射）与 layout-space（钳制布局）两套坐标系的结构性矛盾**，不是吸附/精调阈值可调的参数问题。

历史 `timeline-dm.html` 原型验证时用的 demo 数据全部落在 49–182min 区间，从未触发过 200px 钳制，因此回弹缺陷在原型阶段完全不可见，直到真机喂入真实一天的数据分布才暴露。v53 删除可执行副本后由 Git 历史保留。

**修法**：改为「真·静轴动标」——拖动全程相邻两段高度保持完全静止（不做任何实时像素改写），只有把手上的时间数字和一个跟手指移动的浮动气泡在变化；松手落库成功后，再让这两个仍在场的 DOM 节点把 `style.height` 设为按新时长算出的 `railHeight()` 钳制值，配合 `.seg-block` 已有的 200ms CSS 过渡，柔和地"长高/缩短"到位，`transitionend`（或 260ms 兜底定时器，覆盖 `prefers-reduced-motion`）后才整体 `render()`。像素↔分钟的直接映射只用来算「新的分钟值」，从不用来实时摆布局，回弹在结构上不可能再发生。气泡横向锚定到把手的静止屏幕位置（而非跟随 `clientX`），避免精调时飘到段落文字上。

**护栏**：新增 Playwright 回归——`pointerdown+move`（不 `up`）断言相邻两个 `.seg-block` 高度与拖前完全相等；`up` 后断言目标段高度在超时内到达新 `railHeight` 值。真机手感仍需 SE2 线上验收兜底。

**经验**：给拖拽手势写可交互原型时，**demo 数据必须覆盖真实使用会撞到的极值分布**（这里是「一天里有个大大超过钳制上限的整块」），均匀/居中的示例数据会系统性地把钳制类缺陷藏起来，直到真实数据上线才现形。

---

## P18 · 键盘弹出瞬间表单头部被顶出视口（v35）

**确诊日期**：2026-07-07 · **状态**：先修后验（v35）· **严重度**：低（体验，短暂）

**现象**：v34 SE2 真机验收，打开新建/编辑 sheet 后点击「做了什么」文本框，键盘弹出的瞬间 sheet 头部（取消/完成文字按钮）被顶出视口上沿、正文从中间裸露起头，约 150–300ms 后表单自己滑回正常位置（用户在同一段录屏里指出的「二次重排」，与 P17 的拖拽回弹是两个独立问题）。

**根因**：P16（v32）为了消除键盘动画期间 `visualViewport` 事件风暴带来的「连跳 2-3 次」，把 `--vvt`/`--vvh` 的写入推迟到风暴静默 60ms（400ms 兜底）之后才一次性落位，中间用 `.vv-glide` 把这一跳变成短滑。但这意味着**风暴期间 `.form-sheet` 整个停在键盘弹出前的旧几何上**——Safari 在此期间为了把聚焦的输入框露出来，会先把可视视口本身下移/收窄，而固定定位的 `.form-sheet`（`top: var(--vvt); height: var(--vvh)`）因为还没收到任何几何更新，被系统的视口位移直接顶出可视区域，直到 settle 定时器触发才追上真实几何、一次性滑回。P16 用「晚一拍只跳一次」换掉了「跳三次」，但这个「晚一拍」的等待窗口本身，就是本条症状暴露的时间段。

**修法**：把 P16 的「静默后才写」升级为「全程都写，但一直挂在过渡态下写」——`visualViewport` 的每个 `resize`/`scroll` 事件仍会立即（`requestAnimationFrame` 合帧，一帧至多写一次）更新 `--vvt`/`--vvh`，但只要风暴还在进行就恒定挂着 `.vv-glide`（首个事件到来即挂上，此后每个事件都刷新、防止过早摘除）；CSS 的 `top`/`height` 过渡会对连续变化的目标值自动重新定向（retarget），于是原本三次离散跳变，变成一条持续追着键盘走的平滑滑动，永远不会停在旧几何上被顶出屏幕。原有的 60ms/400ms 静默定时器职责收窄为**收尾**：只做一次最终权威几何写入、`autosize`（依赖折叠区域已经稳定的高度）、把聚焦控件 `scrollIntoView`，以及在收尾之后 260ms 摘掉 `.vv-glide`。`.sheet-closing` 期间的站岗、teardown 队列、四条 keyboard-save settle 路径（P14/P16）完全不受影响——`.sheet-closing` 的 `* { transition: none !important }` 规则本来就会压过 `.vv-glide`。

**护栏**：iOS 键盘动画的几何行为无法在 headless/无真实键盘环境下复现，只能确认既有 sheet 相关 Playwright 用例全绿（无回归）；本条的唯一有效验证是 SE2 线上真机点「做了什么」呼出键盘。

**经验**：为消除「事件风暴导致的视觉抖动」而引入的 settle/防抖策略，必须回头检查「静默等待的这段时间里，用户到底在看什么」——P16 只验证了「静默后落位对不对」，没验证「静默期间界面停留在哪」，而这个被忽略的等待窗口本身就成了下一个可见的缺陷。

---

## P19 · 键盘收起瞬间表单底部露出空白（v36）

**确诊日期**：2026-07-07 · **状态**：先修后验（v36）· **严重度**：低（体验，短暂）

**现象**：打开新建/编辑 sheet，点「做了什么」呼出键盘、输入后点键盘自带的「完成」把键盘收起——键盘让出的区域先短暂出现一块空白，表单随后很快"长满"到全屏。用户形容为「二次重排」，与 P18（键盘弹出方向的顶出遮挡）是同一体验症状的镜像方向：P18 修的是弹出、这条是收起。

**根因**：`.form-sheet-backdrop` 一直是 `position: absolute; inset: 0`，即只覆盖 `.form-sheet` 自身当前的矩形（`top: var(--vvt); height: var(--vvh)`）。键盘弹出方向，`.form-sheet` 的几何滞后被键盘本身遮住、不可见；但键盘**收起**方向，可视视口下方让出的区域比 `--vvh` 追上真实高度更快露出来——那块区域在 `.form-sheet` 的矩形之外，backdrop 盖不到，用户看到的就是页面本身的背景色（"空白"），直到 P16/P18 的 burst 写入 + `.vv-glide` 追上几何，面板才滑到新高度盖住它。

**修法**：两处纯 CSS 改动，P14/P16/P18 的 settle/burst 时序机制完全不动。① `.form-sheet-backdrop` 从 `position: absolute` 改 `position: fixed; inset: 0`——不再受父级 `.form-sheet` 当前矩形限制，恒定覆盖整个布局视口，键盘收起露出的区域从一开始就是暗色遮罩而不是裸页面背景。② 给 `.form-sheet-panel` 加一个 `::after` "裙边"：`position: absolute; top: 100%; left:0; right:0; height:50vh; background: var(--card)`——键盘让出速度快于 `--vvh` 追上真实高度时，这块裙边用表单自己的卡片背景色顶上那段过渡期，视觉上读作"表单已经是满屏"，几何随后才柔和落位。面板处于静止满高状态时裙边天然落在视口外，零副作用。

**护栏**：iOS 键盘收起动画同样无法在 headless 环境复现；仅能确认既有 sheet 相关 Playwright 用例无回归。本条的唯一有效验证是 SE2 线上真机：呼出键盘、输入、点键盘「完成」收起，全程不出现空白条带。

**经验**：P18 只处理了键盘弹出方向的几何滞后，收起方向是同一滞后的镜像场景，但两侧暴露的视觉缺陷不对称（弹出=遮挡、收起=露白），容易只堵一个方向就误判问题已解决——排查视口跟随类缺陷时，弹出/收起两个方向要分别过一遍，不能只验证触发那一侧。

---

## P20 · 键盘收起后表单二段式落位（v37，P16/P19 续篇）

**确诊日期**：2026-07-07 · **状态**：修复不完整，真根因见 P23（v41）· **严重度**：低（体验，短暂但连修四轮）

**现象**：v36 上线后 SE2 真机复验（用户录屏）：点键盘「完成」收起键盘后，表单不再露出空白（P19 已修），但面板本体仍有肉眼可见的「悬停一拍 → 再滑到全屏」的二段式落位——P19 的裙边只是把裸露区涂成了卡片色，**面板内容（头部、正文）本身的位移一点没少**。

**根因**：几何写入（`--vvt`/`--vvh`）是 `visualViewport` 事件驱动的，而键盘**收起**方向的事件稀疏/迟到——事件到达之前面板停在键盘还在时的旧几何上，事件到了才开始 0.18s 的 `.vv-glide` 滑动。P16→P18→P19 三轮都在优化「事件到达之后怎么动」，没人质疑「为什么要等事件」。而收起动画的终态其实**在失焦瞬间就完全已知**：body 被 `position: fixed` 锁定时布局视口=无键盘可视视口，终态恒为 `--vvt: 0 / --vvh: window.innerHeight`。

**修法**：失焦即预测（`predictKeyboardCollapse`）。`focusout` 自 sheet 内文本控件、且此刻键盘确在场（`innerHeight - vv.height > 120`）、且一帧后焦点没有落回 sheet 内另一文本控件（键盘不走）时：立即挂 `.vv-glide` 并直写终态几何 + 用终态高度重排 textarea（`autosizeTextareas` 加 `viewHOverride` 参数）——面板增长与键盘离场动画同步发生、被离场键盘遮住，感知为一次连续滑动。配套「防回拽」：`vvPredictionHold` 期间（700ms 硬上限）rAF 写入与 settle 权威写入若发现键盘还没收完（vv 仍报缩小高度）则跳过/顺延，否则中途的过渡事件会把面板拽回中间高度；键盘收完后 settle 落权威值（≈预测值，无可见变化）并清 hold。`focusin` 回到文本控件即清 hold（键盘回来了）。save/取消/Esc 路径不受影响：`settleThenTeardown` 先挂 `sheet-closing` 再显式 blur，`onSheetFocusOut` 对 `sheet-closing`/`teardownQueue` 直接让路。

**护栏**：桌面/headless 无键盘 → 高度差检查不过 → 全程 no-op，既有 Playwright 用例全绿即无回归；本条唯一有效验证是 SE2 线上真机（含「textarea 间切换焦点不触发预测」的反向用例）。

**经验**：同一症状（键盘开合的表单跳变）连修三轮 P16→P18/P19→P20，每轮只验证了自己改的那一侧。事件驱动的跟随策略有天然下界——事件不来就只能停在旧状态；当终态可以被**预测**时，别等事件，直接向终态动画，让事件只做校验。

---

## P21 · 更多菜单最后一行被分组拦腰裁掉（v37）

**确诊日期**：2026-07-07 · **状态**：已验（2026-07-08 SE2 真机确认排版正常）· **严重度**：中（备份入口不可用）

**现象**：SE2 真机（用户截图）：更多菜单里备份 cell 分组的第四行「分享备份」在分组圆角底边处被水平裁掉约一半，按钮残缺、难以点按。桌面与 headless Chromium 均不复现。

**根因（推断）**：`.cell-group { display: grid; overflow: hidden }`，行是 `min-height: 48px` 的 `<button>`（内容自然高 ≈41px）。iOS WebKit 对 grid auto 轨道内 button 条目的 `min-height` 存在计量缺陷：**轨道按内容高计量、条目按 min-height 绘制**，每行欠账 ~7px，四行累计 ~28px，行流整体下溢出分组，最后一行被 `overflow: hidden`（圆角裁切所需）拦腰截断——与截图裁切量吻合。含 `.cell-row`（div，自然高更高）的第三分组欠账少、不易察觉。

**修法**：`.cell-group` 去掉 `display: grid` 改普通块级流（行自身已是 `display: flex` 的块级盒，常规流中 `min-height` 恒被尊重，不经过任何轨道计量），并给 `.cell-btn`/`.cell-row` 显式 `width: 100%`（button 在块级流中可能收缩适应）。整类 bug 结构性消除，分隔线（absolute `::before`）与 `[hidden]` 行为不变。

**护栏**：Playwright 补断言——更多 sheet 每个可见 cell 行的 boundingBox 必须完整落在其父 `.cell-group` 内（Chromium 上防布局回归；WebKit 侧仍需真机兜底）。

**经验**：跨引擎的布局原语差异（grid 轨道计量 × 表单元素内在尺寸）只在真机暴露；cell 分组这类「圆角容器 + overflow: hidden + 定高行」的组合，布局机制越朴素越安全——能用块级流就不用 grid。

**验证补记（2026-07-08）**：SE2 真机（iOS 18.6.2 Safari）确认 v39 排版正常，块级流修复有效。本地 Playwright WebKitGTK 用 v36 旧样式也**不复现**该 grid 裁行——此缺陷属 iOS 构建的 WebKit 特有，本地 WebKit 可覆盖大部分排版差异但不是 100% 等价。另：用户同时报告「分享备份」cell 消失——经考古 v36→v39 显隐判定（`typeof navigator.share === 'function'`）逐字节未变，属设备侧能力应答变化（iOS 18.6 Safari 标签页报无 `navigator.share`，与平台常识相悖），已在 v40 加 `?vvdebug=1` 能力探针 HUD 实测取证，独立跟踪。

---

## P22 · 亮色主题滚轮选中行文字被高亮带涂掉（v39）

**确诊日期**：2026-07-08 · **状态**：已修（v39）· **严重度**：高（亮色下新建/编辑/补录的时间滚轮不可用，v33 起持续三个版本）

**现象**：SE2 真机（亮色主题）补录时「当日日期和时间都消失了」——时间滚轮的选中行整行空白：日期列今天缺席、小时/分钟列选中值缺席，选谁谁消失；选择与保存功能完全正常。本地 Chromium 亮色 colorScheme 可复现；暗色不复现。

**根因**：v33 双色板把亮色 `--accent-bg` 从半透明改为不透明 `#efecfc`，而 `.wheel-highlight`（选中行高亮带，`position: absolute; z-index: 1; pointer-events: none`）一直压在滚轮列内容**上方**——层序本来就是错的，只是暗色 `rgba(139,124,255,0.14)` 半透明让文字透了出来，掩盖了三个版本。令牌一换成不透明色，覆盖层就把选中行文字整行涂掉。

**修法**：把高亮带垫到文字层下面（iOS 原生滚轮同层序）——`.wheel-col` 加 `position: relative; z-index: 1`，`.wheel-highlight` 降为 `z-index: 0`。列背景透明，带色与上下描边仍可见，文字恒在最上。

**护栏**：Playwright 补层序不变量断言（列必须建立高于高亮带的堆叠层；paint 级可见性无法直接断言——`elementFromPoint` 会跳过 `pointer-events: none` 的覆盖层）；`CLAUDE.md` 自测清单补「亮色+暗色各打开一次带滚轮的 sheet，选中行文字可见」。

**经验**：①**主题相关验证必须双色板都跑**——本项目全部 smoke 截图与演示图此前只跑暗色，亮色专属缺陷有整整一类盲区；②「半透明覆盖层盖在内容上」是层序错误被透明度掩盖的典型形态——令牌改透明度时，必须重查所有用该令牌做覆盖层的地方；③用户描述「数据消失」不一定是数据层问题，选中态渲染断裂在交互上与数据丢失难以区分。

---

## P23 · 键盘收起跳变的真根因：getter 新鲜、事件迟到（v41 确诊，v42 二诊，v43 结构性根治，P20 续篇）

**确诊日期**：2026-07-09 · **状态**：v43 结构性根治（面板不再随键盘缩放），待 SE2 真机确认 · **严重度**：低（体验，短暂但连修六轮才认清是结构问题）

**现象**：P16→P18→P19→P20 四轮之后，SE2（iOS 18.6.2 Safari）真机点键盘「完成」收起键盘时，表单面板仍「悬停一拍再跳到全屏」。P20 的失焦预测（`predictKeyboardCollapse`）看似正确却从未触发。

**取证**：v40 上线的 `?vvdebug=1` 诊断 HUD（16 条事件环形缓冲 + `window.__vvlog` 埋点）录屏逐帧比对，时间线铁证：

```
13336 focusout TEXTAREA
13339 focusout: kb not up, no predict   ← P20 预测门闩误判「键盘不在」，直接跳过预测
14067 vv:resize h=544 top=1             ← visualViewport resize 事件迟到 728ms 才派发
14084 write --vvt=1 --vvh=544           ← 面板此刻（728ms 后）才落位 = 用户看到的悬停一拍再跳
```

**根因**：iOS 18 点键盘「完成」时，`visualViewport.height` 的 **getter 瞬间恢复**到无键盘值（544），但对应的 `resize` **事件却迟 ~700ms 才派发**——getter 与事件的新鲜度不一致。P20 的预测门闩 `innerHeight - vv.height > 120`（「键盘还在场吗」）在 `focusout` 那一刻读到差值≈0（getter 已恢复），判定「键盘不在」→ 预测路径从不启动 → 面板挂在**上一次写进 CSS 的旧几何**（`--vvh=318`，键盘态）上，干等那个迟到 728ms 的 resize 事件才落位。P20 探测的是「世界当前状态」，而世界状态此刻自相矛盾（getter 已变、事件未到）。

**修法**：门闩从单条件改双条件——探「世界状态」不如探「我写进 CSS 的状态是否已过时」。`onSheetFocusOut` 里：
- `kbUp = innerHeight - vv.height > 120`（键盘确在场，兼容 getter 尚未恢复的旧时序）；
- `varsStale = vv.height - 已写入的 --vvh > 120`（我写的几何 `--vvh` 还停在键盘态、而 getter 已报无键盘高度——正是本 bug 的时序）；
- 任一成立即走 rAF 复查 → `predictKeyboardCollapse`（其内部直写 `--vvh = innerHeight`，两种情况都是正确终态）。

**护栏**：桌面/headless 无键盘 → 两条件都不过 → 全程 no-op，既有 Playwright 用例全绿即无回归；`?vvdebug=1` HUD 常备，真机复现时录屏可逐帧复查事件时序。唯一有效验证仍是 SE2 线上真机：升 v41 后用 `?vvdebug=1` 复录同样操作，时间线应在 `focusout` 后立刻出现预测落位（`PREDICT collapse`），不再有 728ms 悬停。

**经验**：事件驱动几何跟随的最后一课——**getter 与事件可以不同步**。当「读值」与「收事件」给出矛盾答案时，与其去判断难以捉摸的「世界当前状态」（本例：键盘到底在不在），不如判断确定可知的「我上一次写进 DOM 的状态是否已经过时」，据此决定是否重写。

**v42 二诊（v41 修法为何仍失手）**：v41 上线后 SE2 真机 HUD 复录，`focusout` 仍打印「no predict」、面板仍跳。因为 v41 的第二条件 `varsStale = vv.height − 已写入 --vvh > 120` **又把 getter `vv.height` 掺了进来**。SE2 上 `focusout` 那一刻 getter 返回的既不是键盘态 318 也不是终态 544，而是**收起动画中途的 ~430**，正好落进死区：`kbUp = 544−430 = 114 < 120`、`varsStale = 430−318 = 112 < 120`，两侧都够不着，预测又没触发，`resize` 迟到 710ms 后才 snap。教训被自己犯了一遍：postmortem 写「探自写状态优于探世界状态」，实现时却把「自写状态」的判断建立在不可靠的 getter 上。**v42 真修**：判据改为纯自写几何——`writtenIsKbState = innerHeight − 已写入 --vvh > 120`，用稳定量 `innerHeight`（布局视口，`position:fixed` 锁 body 时恒定）对比自写量 `--vvh`，**全程不读 getter**。`writtenVvh=318, innerHeight=544 → 226 > 120 → 预测在 focusout 立即触发`。`kbUp` 仅作 getter 确读到键盘高度时的兜底。

**v43 结构性根治（v42 仍失手后，停止打补丁、拆掉整套方案）**：v42 真机仍跳。至此连修六轮（P16→P18→P19→P20→v41→v42）全部失败，认清**根因不是任何阈值/时序，而是方案本身**：表单是「高度追踪键盘的 bottom sheet」——`.form-sheet { height: var(--vvh) }` 随键盘缩放、`align-items:end` 面板底部锚定，所以每次键盘开合面板都必须移动；而 iOS 收键盘的 `visualViewport` resize 事件**天生迟到/稀疏**（实测迟 710ms），任何「跟事件」或「预测事件」都在赌一个不可靠时序，必然有跳的窗口。**根治=让面板不随键盘缩放**：`.form-sheet` 改 `position:fixed; inset:0` 恒定满视口；会召唤键盘的表单（新建/编辑/标签设置）用定高 `.tall` 面板，头部 `position:sticky; top:0`（保存 ✓ 永远在键盘够不到的顶部，顺带结构性根治 P2/⑧），正文可滚、焦点控件 `focusin` 里 `scrollIntoView` 滚到键盘上方；`visualViewport` 只剩一处极简用途——把键盘遮挡高度写成 `--kb` 供正文 `scroll-padding-bottom`，**只影响滚动、不移动面板**（迟到也只是晚一拍滚，不跳）。删掉约 200 行精密时序机器（`predict`/`settle`/`glide`/`burst`/`--vvt`/`--vvh`/`.vv-glide`/`settleThenTeardown`/P19 裙边）。**经验（真正的最后一课）**：同一症状修到第三轮还没好，就别再调参数了——退一步问「是不是整个方案的前提就错了」。这里的错误前提是「面板必须浮在键盘上方所以必须追踪键盘」；换成「面板满屏、键盘只盖住底部、焦点靠滚动避开」，那个不可靠的时序就被彻底移出关键路径，无可跳之处。

---

## P24 · 「分享备份」入口在真机消失：footer→更多 迁移丢了 reveal（v41/v42 假说均错，v43 常显根治）

**确诊日期**：2026-07-09 · **状态**：v43 常显 + 点击回退下载根治，待 SE2 真机确认 · **严重度**：中（备份分享入口不可达）

**现象**：SE2（iOS 18.6.2 Safari 标签页，状态栏全程有 VPN 徽标）真机上，更多菜单里的「分享备份」cell 彻底不出现（分组无空档、非裁切）。桌面、headless、本地 WebKit 均不复现。用户明确否认开过 Safari 内容拦截器，并指出分享按钮此前一直在、是在 P21 裁行修复之后才消失。

**取证与排除（硬证据）**：① v40/v41 HUD 能力探针实测 `share:function canShare:function`——设备**能力在**；② `git show 51b7556`（v37 P21 裁行修复）**没碰**分享渲染或 `updateShareAvailability`，显隐门闩来自 v24、`updateShareAvailability` 来自 v22，均早于裁行修复——用户的时间关联是巧合；③ 本地写 `share_probe.mjs`，**WebKit + Chromium 各一次**注入真 `navigator.share`，分享按钮均 `present=true, hidden=false, display=flex`——代码在 `navigator.share` 为函数时**必然渲染可见**。设备能力在 + 代码渲染可见 + 按钮却 `display:none`，只剩一种来源：**页面之外的装饰性抑制**（cosmetic filter 注入 `display:none !important`），VPN 徽标是头号来源（其内置去广告/去社交规则用户未必视作「内容拦截器」）。

**v41 假说被推翻**：v41 以为是「内容拦截器按名精确命中 `#share-btn`」，把 id 改成 `backup-share-btn`——**仍含子串 "share"**。若规则是 `[id*="share"]` / `[data-action*="share"]` 之类**子串匹配**，改名照样命中，与「改了名还是没了」完全自洽。

**v42 修法（三管齐下）**：① **去尽 "share" 令牌**——id `backup-share-btn` → `backup-send-btn`、`data-action="share-json"` → `send-backup`（app.js 路由、io_actions `getElementById`、ui_smoke 选择器同步；内部函数名 `shareJSON`、可见文案与 `aria-label` 保留，不进选择器常见匹配面）；② **HUD 加探针**——`openFormSheet` 里 `mode==='more'` 渲染后打印 `more: send-btn hidden=… disp=… navShare=…`，真机开「更多」即得「app 自己认为它可见」的铁证；③ **用户 A/B**——关掉状态栏 VPN 那个 app 的过滤后重开对比，回来即实锤。

**v41/v42 假说均被推翻，真因是 footer→更多 迁移**：用户决定性纠正——**VPN 一直开着（分享好用的那段时间也开着），不是拦截器**；按钮是「移进『更多』菜单后」才没的。核实（`git show dd0daa3~6`）：v33 footer 时代分享按钮用**一模一样**的 `${shareSupported?'':' hidden'}` 门闩却能显示——因为 footer **常驻 DOM**，主 `render()` 每次都调 `updateShareAvailability()` 把它 reveal；v34 移进「更多」sheet 后，按钮**动态渲染、且开 sheet 不触发主 render**，那次 reveal 再没跑过。渲染期门闩本应传 `shareSupported=true`（`typeof navigator.share==='function'`，iOS 上为真）——但 iOS WebKit 上它卡在隐藏态（本地 WebKitGTK 不复现，与 P21 同类 iOS 构建特有），加上没有主 render 兜底 reveal，就彻底不出现。「代码/能力/CSS 都对但按钮没了」的组合，配上「footer 有、更多 无」这个唯一结构差，指向的是**reveal 时序在迁移中丢失**，不是页面外抑制（v41 的拦截器假说、v42 的 VPN 假说都错，教训：别凭「本地不复现」就往环境甩锅，先找「能用 vs 不能用」两态之间**代码路径的真实差异**）。

**v43 根治（绕开 reveal 时序）**：分享按钮与 `复制/下载/导入` 三个兄弟一样**无条件常显**（它们从不消失，因为从不靠能力 reveal）；点击时若无 Web Share 能力就**回退 `downloadJSON()`**——保证任何浏览器上都不是死按钮/隐藏按钮。删 `updateShareAvailability` 与渲染期 `hidden` 门闩。id/data-action 维持 v42 的去 "share" 令牌（`backup-send-btn`/`send-backup`）作为额外防御，不回退。

**经验**：能力检测驱动的「默认隐藏、再 reveal」很脆——reveal 要么每次渲染都跑、要么就别用它做常驻可见性的唯一依赖；对「只要能力在就该常在」的入口，直接常显 + 点击时降级，比「藏起来等 reveal」稳得多。排查「A 能用 B 不能用」时，先钉两态之间**代码走了哪条不同的路**，再谈环境。

---

## P25 · 新版发布后用户端一直吃旧缓存（v44，可能是 v41–v43「还是没修好」的元凶）

**确诊日期**：2026-07-09 · **状态**：v44 改主动检查 + 静默自动更新，本地验证通过，待真机确认 · **严重度**：高（掩盖了所有前序修复的真机验证——用户以为在测新版，其实一直是旧缓存）

**现象**：用户报「GitHub Pages 没更新」。核实：Pages **确已发布** v43（live `sw.js` = `timelog-v43`、live `sheet_controller.js` 含 v43 的 `writeKeyboardInset`、Pages API `status: built`），仓库与线上一致。问题在**用户设备的 Service Worker 缓存**——旧 SW 用 cache-first 策略把旧文件一直喂给页面。

**根因**：`registerServiceWorker` 只做了两件不够的事——注册时 `register('sw.js')` 只触发浏览器**隐式**的更新检查，从不显式 `reg.update()`；发现新版也只是把「更新应用」横幅 `hidden=false`。iOS Safari（尤其加到主屏的 standalone PWA）**不会主动/及时复查 `sw.js`**，横幅又是屏幕底部一条、极易被忽略/不知道要点。于是「Pages 已发新版」和「用户看到新版」之间断了：新版永远到不了真机。**这极可能是 v41→v42→v43 一路「还是没修好」的元凶**——每次真机测的可能都是旧缓存，我的 P23 二诊（v42）、乃至 v43 结构重设计，都未必在真机上干净加载过；据此推断「还在跳」并再改，是在错误前提上迭代。

**修法（`src/app.js` registerServiceWorker）**：① **主动复查**——冷启动立即 `reg.update()`，并在 `visibilitychange → visible`（每次切回前台）再 `reg.update()`，把 iOS 那套「懒得查」彻底绕开；② **静默自动更新**——新 SW 到 `installed`/`waiting` 且有 controller 时：表单开着（可能正在输入）才弹横幅让用户自己点，否则直接 `skipWaiting` + 单次 `reload` 自动切新版（`localStorage` 数据不受 SW 更新影响，无损）。`controllerchange` 仅在 `updateReloading` 时 reload，无循环风险。

**验证**：本地 Chromium 双版本模拟——注册旧 SW 控制页面后，把磁盘上的 `sw.js` CACHE 改名模拟发新版，`reg.update()` 后 2.5s 内缓存自动从旧名切到新名、页面自动 reload，全程零点击。iOS standalone 的复查时机仍需真机确认，但「一旦查到新版就自动装上」这段已确定可靠。

**用户侧一次性解卡（旧 SW 里没有本 fix，需手动清一次）**：iOS Safari 标签页——设置 → Safari → 高级 → 网站数据 → 搜 `wowayou` → 左滑删除，重开即拿最新；或直接「清除历史记录与网站数据」。主屏 PWA——删掉图标重新「添加到主屏幕」。清一次拿到 v44 后，此后所有新版都会自动更新，不用再清。手动触发一次 Pages 构建（排查用，不影响缓存问题）：`gh api -X POST repos/<owner>/<repo>/pages/builds`。

**经验**：**「修了但用户说没用」先怀疑「用户到底加载到没有」**——离线优先的 PWA 里，「已部署」≠「已送达」，SW 缓存会把新版拦在门外。验证一个真机修复前，先确认真机加载的版本号（本项目更多 sheet 底部有「时间尺 vN」、`?vvdebug=1` HUD 也显示版本，正是为此）。更新链路本身必须主动 + 自动，别指望用户去点一条容易被忽略的横幅。

---

## P26 · v47 时间操作“像是能改、实际不允许”：边界与后果不可见（v48）

**确诊日期**：2026-07-10 · **状态**：v48 修复，自动化通过，待 Safari/PWA 真机验收 · **严重度**：高（用户无法在操作前判断合法范围与保存后果）

**现象**：文字复现称要把 15:39–16:14 的“各种”改到 18:11，但 v47 会阻止跨过 16:14 的右邻记录；录屏里实际做的是在 16:11–19:11 原段内切分，结果逻辑正确。两份证据看似冲突，真正共同点是：打开编辑/切分前看不到原段边界、相邻约束和保存后会怎样改写前后段，用户只能靠试错猜规则。

**根因**：底层是点存储、界面却让人按区间理解；v47 的校验和写入分散在表单提交路径，预览不是保存算法的直接产物。开始时间、结束时间、右邻边界、今日“至今”结算和删除后的愈合规则都没有统一事务表示，因此“被拒绝”像控件坏了，“保存成功”也无法事前证明不会吞记录。删除还依赖事后观察，缺少精确结果确认和冲突安全撤销。

**修法**：v48 在 `entry_model.js` 建立 `planIntervalEdit`、`planSegmentSplit`、`planDeleteEntry` 三个事务 planner，统一返回 `resultEntries`、`resultSignature`、约束和前/本/后预览。表单实时预览与最终保存调用同一规则；提交前在最新 `localStorage` 数据上重算，签名变化就要求再次确认。普通记录可编辑完整开始—结束；切分冻结原段边界并明确内部/贴边/整段；删除只在前后内容与标签完全一致时接回，否则保留同区间未记录。删除后提供 8 秒撤销，但任何跨标签或后续写入都会使撤销失效。

**同轮可靠性发现**：Playwright 的 waiting-worker 用例发现更新横幅虽然可见，却被 z-index 更高的右下角 FAB 挡住按钮；v48 把更新横幅提高到 FAB 之上、sheet 之下。分享路径补齐文件→文本→下载并区分 `AbortError`；导入改 Map 整批预检，冲突不再部分写入；Service Worker 预缓存失败拒绝安装、激活等待清理与 `clients.claim()`、只拦同源 GET，waiting worker 由用户点击后才切换。

**护栏**：纯模型 smoke 覆盖内部/贴边/整段切分、首尾删除、内容不同不接回、自然日边界和最新数据重算；Playwright 在 Chromium/WebKit 覆盖完整区间预览、删除确认/撤销、触摸左滑、恶意/冲突导入、分享取消/降级、跨标签同步和 waiting 更新按钮可点击。Safari 浏览器与主屏 PWA 仍需真机检查文件/文本/下载回退、数据保留、横滑手感和刷新闪烁。

**经验**：当数据模型与用户心智模型不同，不能只靠“正确拒绝”保证安全；必须在动作前展示边界、动作中展示后果、动作后提供有限且并发安全的恢复。预览若不是由保存算法本身生成，就只是另一套可能漂移的说明文案。

---

## P27 · 更新按钮视觉未重叠但命中区仍被 FAB 截走（v49）

**确诊日期**：2026-07-10 · **状态**：v49 结构修复，待 iOS standalone 真机确认 · **严重度**：高（新版已就绪但用户无法手动完成更新）

**现象**：iOS 主屏 PWA 中，「发现新版」提示与右下角「记一条」FAB 视觉上已经上下错开，但「更新应用」按钮无法点击；录屏/截图显示按钮区域的触控被 FAB 所在合成层截走。v48 仅把提示的 `z-index` 提到 FAB 上方，未解决命中测试。

**根因**：更新提示使用 `position: sticky`，FAB 使用 `position: fixed`。iOS standalone WebKit 会把两者放入不同滚动/合成层；此时 CSS 绘制顺序与触控命中顺序可能不一致，导致“看得见且不重叠”并不等于“点得到”。单纯继续抬高 `z-index` 仍依赖跨层排序，不能消除问题来源。

**修法**：更新提示改为 `position: fixed`，与 FAB 进入同一类视口定位层；日视图下提示底边固定抬到 FAB 上方，层级保持 FAB（70）< 更新提示（75）< 表单 sheet（80）。不隐藏记录入口，也不依赖设备型号或 viewport 补丁。

**护栏**：Playwright waiting-worker 用例改到 375px 移动端宽度，同时检查三件事：提示与 FAB 的矩形不相交、提示计算样式确为 `fixed`、按钮中心点的 `document.elementFromPoint()` 确实命中 `update-app`。本地引擎只能防 DOM/CSS 回归，最终仍需 iOS 主屏 PWA 点击验证。

**经验**：移动 WebKit 的可点击性问题不能只看截图和 `z-index`；固定悬浮控件之间应尽量使用同一种定位模型，并把 `elementFromPoint` 纳入命中区护栏。

---

## P28 · Safari 点击下载却没有可查的备份文件（v50）

**确诊日期**：2026-07-10 · **状态**：v50 改系统文件面板，待 iOS Safari/主屏 PWA 真机确认 · **严重度**：高（用户以为完成备份，实际无法在 Files 找到文件）

**现象**：6 月 30 日通过旧路径保存的 `timelog-*.json` 仍在 Files/Downloads，但当天从 Safari 新点「下载备份」后，同一目录和搜索均找不到新文件。页面没有报错，也没有能力判断 Safari 是否真正落盘。「分享备份」入口在 Safari 标签页仍可能因旧缓存/真机渲染状态不可见，而主屏 PWA 与桌面可见。

**根因**：原实现用 `Blob → URL.createObjectURL → 隐藏 a.download → a.click()` 发起程序化下载。浏览器没有提供下载完成事件；iOS Safari 可能接受点击却未把 Blob 文件可靠写入 Files，应用仍无法区分“已保存”“进了别的下载目录”或“根本没落盘”。这条路径把关键的备份成功交给了不可观测行为。

**修法**：更多菜单「下载备份」改名「存储备份」。iPhone/iPad（含 iPadOS 桌面 UA）且支持文件 Web Share 时，直接 `navigator.share({ files })` 打开系统面板，让用户明确选择「存储到文件」和目录；用户取消 (`AbortError`) 即停止，不暗中回退成去向不明的下载。能力探测失败或非 Apple 移动平台才保留 Blob 下载。复制、存储、分享复用同一份完整 JSON artifact；独立「分享备份」仍按文件→文本→下载降级并始终渲染。

**护栏**：Playwright Chromium/WebKit 覆盖三条路径：模拟 iPhone 时「存储备份」必须调用文件分享且文件名为 `timelog-YYYYMMDD-HHMMSS.json`；取消后隐藏下载点击数保持 0；桌面仍触发真实 download 事件。同时既有双能力状态用例继续断言「分享备份」cell 无条件可见。

**经验**：备份动作的首要目标不是“发起过”，而是用户能指出文件在哪里。平台提供可选目录的系统面板时，应优先选择可确认去向的交互；对没有完成回执的下载，只能称“已请求下载”，不能当作备份成功。

---

## P29 · Safari 刷新闪烁：空壳修掉后转成二次重建闪动（v51→v52）

**确诊日期**：2026-07-10 · **状态**：v53 处理合成层透底，待 Safari 真机确认 · **严重度**：中（无数据损坏，但每次刷新出现明显错误状态）

**现象**：Safari 标签页手动刷新时，录屏逐帧显示约 50–100ms 的错误画面：hero、时间轴和 FAB 退场，静态 HTML 中默认可见的「回到今天」独占日期导航；随后 ES module 执行 `render()`，真实数据和正确按钮状态再回来。用户感知为整页闪烁。

**根因**：P15 的启动门闩只把 JS 数据区设为 `opacity:0`，保留 header/date-nav 静态壳以避免“整页白屏”。这在首次访问合理，但刷新时 Safari 会在模块加载前先提交静态 DOM 的一帧：数据区被刻意隐藏、`#today-btn` 尚未经过 `renderChrome()` 条件隐藏，两种临时状态组合成比整页空白更刺眼的假界面。`data-boot=has-entries` 只知道有无数据，无法同步重建 hero/时间轴。

**修法**：主 `render()` 后把 `.app` 和 FAB 的**已转义、已渲染 DOM**保存到同标签页 `sessionStorage['timelog.bootSnapshot.v1']`；`index.html` 在 `src/app.js` module 前用内联脚本同步恢复快照并加 `.boot-restored`。CSS 启动门闩只在没有快照时隐藏数据区；有快照时沿用上一帧，模块到达后仍以 `localStorage` 权威数据重新渲染。恢复前必须确认数据/config/视图/日期/记录模式和当前自然日仍与保存时一致，避免跨标签更新或午夜后短暂展示旧内容。快照不跨标签、不进导出、不参与业务写入。

**护栏**：Playwright 在首次正常渲染后拦截并延迟 `src/app.js`，触发 reload；模块仍被扣住时必须已经有 `.boot-restored`，时间轴仍显示原记录、`#today-btn` 仍隐藏、使用天数不消失。释放模块后正常进入 `.app-ready`。Chromium/WebKit 均覆盖。

**经验**：刷新不是首次访问。首次访问的“静态骨架”策略若直接复用于刷新，会主动丢掉浏览器本来可以延续的视觉上下文；本地优先应用可以用短生命周期、非权威的视觉快照接帧，但必须让真实数据模型在模块启动后重新接管。

**v52 二诊**：v51 真机录屏证明静态空壳已消失，但闪动转移到卡片/FAB。代码链路是确定的：内联脚本刚恢复快照，`init()` 又无条件 `render()`；`renderTimeline()` 用 `innerHTML` 销毁并重建所有 `.entry`，新节点触发 140ms `@starting-style opacity:0`，FAB 内容也被再次写入 fixed 合成层。v52 在快照通过权威状态一致性校验时不再首轮 render，只初始化 state 与 `lastIntervalSignature`，随后直接进入 `app-ready`；下一次真实数据/分钟变化才正常 render。自动化在快照 entry 上写 sentinel，模块延迟和最终 app-ready 后 sentinel 都必须仍在，直接证明节点未被重建。

**v53 三诊**：v52 后的 Safari 真机录屏逐帧显示，刷新加载指示出现时，最底部记录卡在约两帧内露出完整「编辑/删除」轨道，随后恢复；主内容和 FAB 并未被 JS 重建。轨道此前始终以可见层放在卡片下方，只靠带 `will-change: transform` 的卡片合成层遮挡；刷新期间 WebKit 重组/回收上层时，底层按钮便会透出。v53 把轨道改为默认 `visibility:hidden`，只有横向位移小于 0 或吸附打开时才挂 `.swipe-revealing` 显示，关闭动画结束后再隐藏。刷新正确性不再依赖两个合成层永远保持遮挡关系；快照测试同时断言闭合轨道在模块延迟前后都不可见。

---

## P30 · 导入冲突正确但不可读、不可行动（v51）

**确诊日期**：2026-07-10 · **状态**：v51 对照卡 + 禁用提交修复 · **严重度**：中（数据安全已有保证，但用户无法理解或解决冲突）

**现象**：导入检查显示「将导入 0 条，跳过 0 条，冲突 2 条」，下面一个红框串联两条长句，暴露随机内部 ID；用户看不出备份记录和本机记录各自是什么。右上角「导入」仍是高亮可点击状态，点击后只是留在原页，像按钮失灵。

**根因**：v48 只完成了“整批预检、冲突不写”的数据安全闭环，UI 直接渲染 planner 的调试型 `message`。冲突对象没有携带可比较的 incoming/local 条目；提交按钮也没绑定 `plan.ok`。平移小时数变化不实时重算，若禁用按钮又会让用户无法通过平移消解同时刻冲突。

**修法**：preflight 冲突对象补 `incoming` 与 `local` 安全副本；UI 每条冲突渲染「备份中 / 本机中」对照卡，只显示内容、时间、标签和计划态，不显示 ID。有冲突时 summary 明示「本次不会写入」并 disabled 顶部导入按钮；`#import-shift-hours` 输入时立即重新 plan，冲突全部消失后自动启用。仍保持整批原子写入与 textContent 防注入。

**护栏**：Chromium/WebKit 注入两条同时刻冲突，其中 ID 和内容含恶意 HTML：必须显示两张对照卡、内部 ID 不可见、恶意内容只作为文字、导入按钮禁用；平移 2 小时后实时变为「可导入 2 条」并启用，改回 0 再禁用；全程本机数据未写入。

**经验**：安全拒绝只是底线。冲突 UI 必须回答三件事：哪两份内容冲突、现在为什么不能继续、用户做什么能解除；否则“正确的不写入”在体验上仍像失败。

**v52 交互闭环**：v51 对照卡仍只是“标记”，用户只能改平移或退出。v52 每条冲突加入三种明确决策：①保留本机＝跳过备份条目；②使用备份＝以备份条目替换冲突本机条目；③合并文字＝保留本机 ID、时间、标签、计划/进行中与确认状态，只把不同 `what` 以空行合并。刻意不提供“都保留并自动 +1min”——点存储模型中这会凭空制造 1 分钟区间并改变后续段语义。所有选择携带 incoming/local 内容签名，提交前在最新数据上重算；签名变化、选择组合产生新同刻/同 ID 冲突时整批不写并要求重选。

---

## P31 · 抓手条暗示可下拉，但更多菜单只能点关闭（v52）

**确诊日期**：2026-07-10 · **状态**：v53 扩大真实命中区，待 iOS 真机手感确认 · **严重度**：低（无功能阻断，但视觉承诺与行为不一致）

**现象**：移动端「更多」bottom sheet 顶部有标准抓手条，用户自然尝试向下拖动关闭，但它只是装饰；只能点左上「关闭」。

**根因**：v34 统一 sheet 头部时引入 `.sh-grab` 视觉语法，却没有绑定任何手势。抓手属于强 affordance，不可交互比没有抓手更误导。

**修法**：仅在 `<720px` 且 mode=`more` 时，从 `.sh-grab` 接管 touch/pen pointer：拖动面板 1:1 跟手并同步淡出遮罩；短拖回弹；位移 ≥72px 或 ≥24px 且下甩速度 >0.55px/ms 时沿当前方向关闭。鼠标、正文滚动、桌面 dialog、新建/编辑/config 高表单均不接管，避免误丢输入。

**v53 二诊**：v52 自动化把 PointerEvent 直接派发给 `.sh-grab`，绕过了真机命中测试；真实元素只有 40×5px，手指几乎点不中，于是功能存在但用户仍感知为不可用。v53 保持 40×5px 视觉不变，把元素本身扩为 64×44px 并覆盖头部中央区域；测试改从扩展区域底部坐标调用 `elementFromPoint()`，把事件派发给真实命中元素，controller 再用坐标确认它位于抓手矩形内才接管拖动。

**护栏**：Chromium/WebKit 在 375px 合成 pointer 手势：30px 短拖后 sheet 仍为 more；100px 下拉后完整走既有 close cleanup 并 hidden。

**经验**：若不准备实现手势，就不要画抓手；一旦画了，触控命中、跟手、回弹和关闭阈值就是同一个组件契约。

---

## P32 · PWA 后台恢复后进行中时长停在旧分钟（v54）

**确诊日期**：2026-07-11 · **状态**：v54 修复，待 iOS 主屏 PWA 真机确认 · **严重度**：高（进行中时长、今日汇总和续记入口同时失真）

**现象**：iOS 主屏 PWA 从后台切回后，系统状态栏已是 08:55，页面仍显示「截至 02:41」，进行中的未记录段和右下角「记一条」副文案也停在 02:41 的时长。

**根因**：页面隐藏时会停止 60 秒 interval，但恢复可见时只重新启动 interval，不会立即按当前时间补算，因此至少有一分钟陈旧窗口；更糟的是 iOS standalone 可能在挂起时丢弃底层 timer，却保留页面内的 timer id，使 `if (tickTimer) return` 误以为刷新仍在运行。恢复路径又只监听 `visibilitychange`，漏掉 WebKit 可能派发的 `pageshow` / `focus`。

**修法**：统一 `resumeLiveClock()`：每次前台 `visibilitychange`、`pageshow`、`focus` 都先清理旧 timer，立即用数据签名检查并按当前分钟重渲染，再建立对齐下一整分钟的单次 timeout；timeout 触发后自行续订。重复生命周期事件由签名去重，不增加业务状态。

**护栏**：Playwright 固定页面从 12:34 直接跳到 18:55，再派发 PWA 恢复 `focus`；今日汇总「截至」和 FAB「已用时」必须在同次事件后都变为 18:55 对应值。原有自然分钟刷新用例继续覆盖常驻前台路径；Chromium/WebKit 双引擎执行。

**经验**：Web/PWA 的 timer id 只代表 JavaScript 曾安排过任务，不证明系统挂起后任务仍存活；恢复前台必须以墙上时钟立即校准，不能靠补跑旧 interval。

---

## P33 · PWA 冷启动 3.8s：模块执行很轻，时间耗在网络 / SW 缓存未命中（v58）

**确诊日期**：2026-07-14 · **真机复测**：2026-07-15 · **状态**：v58 已部署 Fix A + B；用户确认运行 v58 后无可感知改善，问题仍未解决 · **严重度**：中（无数据损坏，但冷启动和 daily opens 明显迟缓）

**2026-07-16 升级与取证落地（v62）**：用户升级定性为「严重影响使用」，并补充关键规律——**起床后/长时间未打开后的第一次打开特别慢**，与「系统在长间隔后回收 Cache Storage/SW」假说一致。冻结期按协议取得维护者明确批准（方案：诊断 + persist() 一起上），v62 落地本节「下一步取证方向」：opt-in 设备端启动诊断（每次启动记各阶段耗时、SW 是否接管本次导航、Cache Storage 套数/文件命中数、`storage.persisted()`、standalone、快照命中、距上次打开间隔；只含计时/布尔/命中数，关闭即删）+ `navigator.storage.persist()` 尝试性缓解。根因判定等待真机慢启动样本：若慢样本呈现 `SW接管 否` 或 `缓存 无/文件数不足`，回收假说实锤；若缓存全命中仍慢，嫌疑转向 SW 冷启动延迟或网络复验。

**2026-07-17 首批长间隔样本判读：体感与页面计时反相，归因收窄到「计时零点之前」（待录屏判决）**：C6 重置（备份→删主屏→重新添加→导入）后 PWA 干净运行 v64 单套缓存，当日回传 3 条样本，与用户体感逐条对照——06:02（起床首开）就绪 572ms **体感慢**；12:34（间隔 6h32m）就绪 299ms（三条最快）**体感慢**；13:02（间隔 28min）就绪 546ms（三条最慢）**体感还可以**。三条全部 `SW接管 是`、`常驻存储 是`、`timelog-v64 20 文件全命中`。判读：① **体感与页面计时反相**——慢不发生在诊断计时窗口（`performance.timeOrigin` → app-ready）内；② 慢的等待期间画面为**整屏纯色、无 header**（用户回忆），与 iOS 自动生成的启动屏一致（manifest `background_color: #0e0f13` + 居中图标，无 `apple-touch-startup-image`）；③ 28min 间隔体感正常、6h32m 慢，符合系统长间隔回收进程的曲线。**据此排除**：Cache Storage 回收假说（体感慢的两次缓存均全命中）；`persist()` 已被 iOS 授予但**不是解药**（无害保留）。**中间结论（强指向，非证明）**：慢段＝iOS 冷孵化 PWA 的 WebKit 进程 + 首帧呈交，发生在页面计时零点之前，页面代码测不到。**诚实记录两个证据窟窿**：证词是事后回忆而非现场记录；诊断没有首绘/FCP 打点——「首帧被未打点环节（如经冷 SW 取 `styles.css`）拖住几秒」的页面侧场景同样表现为纯色屏，反相论证对未测量的环节无效。**判决性取证协议（零代码，已与维护者约定）**：下次 6h+ 间隔后先开 iOS 屏幕录制 → 点图标 → 内容出现即停录 → **立刻**复制启动诊断，保证录像与样本对应同一次启动；录像回答两个问题——纯色屏持续几秒、纯色消失后直接出完整内容还是先出空壳。录像属私人资料，只用于判读，不进仓库。**若判决为 OS 段**：仓库内无正当修复手段（进程回收策略在 Apple 侧，「保活」花招不可靠且违反别镀金），感知层唯一可上桌项仍是已 park 的 Fix C 启动图（不缩短等待，冻结期不做）；诊断 v2（FCP 首绘计时 + C6 所需的 SW 注册状态字段）只记候选，待 07-30 复盘。

**2026-07-17 22:29 录屏判决（协议执行，结论：OS 段实锤）**：用户按协议完成首个「同一启动的录像 + 诊断样本」交叉取证（录像私人保存，不进仓库；`bug-screenrecordings/` 已在 `.gitignore`）。录像逐帧时间线（±0.1s）：点击图标 ≈1.0s → **1.1–2.5s 整屏纯黑无任何 web 内容（≈1.5s，即 iOS 启动屏段——暗色 `background_color` 在录像里呈黑）** → 2.6s 一帧空白 WebKit 表面 → 2.7s 静态壳（header/日期导航，无内容区）→ 2.8s 完整内容。同一启动的诊断样本：html 171ms、模块 351ms、就绪 435ms、缓存 20 文件全命中。**算术交叉**：内容出现（视频 ≈2.8s）− 页面侧就绪 435ms → `performance.timeOrigin` ≈ 视频 2.37s ≈ **点击后 ~1.4s**——点击到计时零点之间存在约 1.4 秒纯 OS 进程孵化段，占本次总等待（≈1.8s）的 3/4；页面侧从零点到内容只花 0.44s，与样本毫秒级吻合，「空壳」阶段仅一帧（≈0.1s）。两个证据窟窿（回忆非现场、无首绘打点）均被录像补死。**判决**：P33 剩余慢段＝OS 进程冷孵化，发生在页面计时零点之前，页面代码测不到也缩短不了；本次为温和冷启动（总 1.8s），起床后体感数秒的最坏场景按同一结构即黑屏段拉长，如需可再录一次最坏场景定量（结构结论不依赖它）。页面侧优化已到边际（就绪 435ms，其中 html 经 SW 171ms），清零也只省全程 1/4。缓解杠杆按诚实评级：① 习惯杠杆（唯一免费有效）——不要上滑杀掉 PWA，挂起态恢复秒开，冷孵化只发生在系统回收之后；② Fix C 启动图＝纯观感（黑屏变骨架图，不缩短一毫秒），维持候选；③ 架构转向（打包为原生壳）在 28 天 gate 与冻结之外，维持 v58 结论「最后选项」。

**现象与测量方法**：iOS 主屏 PWA 冷启动约 3.8s，经历白屏→骨架→内容，daily opens 也慢。用项目自带的 `#boottrace=1` marks，在 headless 浏览器读取 `window.__timelogBootTrace.marks`；分别测「完美缓存命中 + CPU 节流」与「网络节流」，用 `app_ready` 作为终点。

| 场景 | `app_ready` 耗时 |
|---|---:|
| 完美缓存命中 + CPU 10× 节流 | ~496ms |
| 完美缓存命中 + 无节流 | ~186ms |
| 网络节流 4×CPU+3G（基线 waterfall） | 2309ms |
| 网络节流 6×CPU+slow-3G（≈复现录像） | 4463ms |
| 6×+3G + `modulepreload` | 3675ms（↓~18%） |

**v58 真机复测**：2026-07-15，用户在 iOS 主屏 PWA 的“更多”页确认当前版本为 v58 后复测，冷启动体感“一点没有缓解”。这是明确的用户侧定性证据，但不是一组新的同条件计时数据：可以据此判定 Fix A + B **没有产生可感知收益**，不能据此声称耗时精确不变或出现数值回归。

**核心发现**：模块图的 parse+execute 极廉价，10× CPU 节流下也只有约 0.3s；3.8s 冷启动几乎全是网络等待 / Service Worker 缓存未命中。daily opens 仍慢说明 iOS standalone 没有给到本该有的缓存命中，启动动画无法覆盖这段时间，因为动画代码本身也尚未加载。

**v58 修法**：Fix A 在 `<head>` 的早期内联脚本里注册 `sw.js`，让注册脱离 12 模块图的加载链路；`app.js` 原有 `registerServiceWorker()` 保留，继续负责 `updatefound` 与「更新应用」提示。Fix B 为 9 个现有 ES modules 增加 `modulepreload`，拉平 import 瀑布；不新增运行时资产、不改 `sw.js` 的 `FILES` 或 fetch 策略。Fix C（`apple-touch-startup-image` 启动屏）已 park，本次不做。

**诚实的局限**：Fix A 是低成本、合理的猜测，不保证命中。录像里 `app.js` 最终确实跑完并显示内容，说明「注册被慢加载困住」不是全部真相；更可疑的是 iOS 在两次启动之间回收了 Cache Storage / Service Worker。iOS 对 PWA 存储有上限，也可能在数小时后或存储压力下回收；若缓存本来就已被清空，提前注册无法避免重新下载，daily opens 仍会慢。

**下一步取证方向**：v58 后 daily opens 仍慢已经得到真机确认，下一步应进入 instrumentation，而不是继续凭桌面模拟猜优化点。现有 HUD 在装好的 PWA 上跑不了，需要另想取证手段，例如把关键 boot 分段写入可导出的本地诊断，或加入一次性可视化 timing；取证必须区分导航取资源、Service Worker 控制状态、Cache Storage 命中和模块到达/执行。若最终证实 iOS 会回收缓存，在不破铁律（尤其不能 bundle 减文件数）的前提下可能无解；届时再把 Fix C 启动屏作为感知优化重新上桌，或明确评估打包载体这一架构转向。

**经验**：先用分段测量判断 CPU、模块执行和网络各占多少，再选优化点；对无法直接观测的 iOS 缓存生命周期必须把「合理猜测」与「已证实根因」分开记录。

---

## P34 · v62 更多菜单全分组压扁裁切：cell-group 坐在被压缩的 grid 轨道上（v63）

**确诊日期**：2026-07-17 · **状态**：v63 已修 · **严重度**：高（Safari 入口的导入/分享备份不可达，属阻断级；维护者明确要求立即修）

**现象**：v62 真机（iOS Safari）更多菜单每个 cell 分组只显示约 1.5 行，其余被拦腰裁掉：存储备份剩半行，导入备份、分享备份、说明、复制启动诊断完全不可见。

**根因**：`.form-sheet-body` 是 `display:grid`，同时又是 `min-height:0` 的 flex 子项。v62 新增启动诊断分组和提示行后，更多正文内容总高**首次**超过面板 `max-height`——grid 不走正文滚动，而是把各 auto 轨道压到低于内容高，`.cell-group` 为 inset 圆角设置的 `overflow:hidden` 随即把溢出行裁掉。**Chromium 与 WebKit 在 375×600 视口均可本地复现**，非 iOS 特有。与 P21 同缺陷家族但高一层：P21 是组内 grid 轨道（iOS 特有计量缺陷），P34 是正文 grid 轨道（标准压缩行为撞上 overflow:hidden）。

**为什么 v61 没事**：v61 更多正文内容不超高，压缩路径从未被走到。v62 没改任何 CSS，纯内容增量触发——**容量边界之外的布局路径等于没测过**。

**修法（v63，沿 v37/P21 判例）**：`.form-sheet-body.more-body { display:block }` + 相邻兄弟 margin 复刻 gap。注意第一版写 `.more-body{display:block}` 无效——它在源码里先于 `.form-sheet-body{display:grid}` 且同优先级，按序被覆盖；必须用复合选择器。块级流中分组高度恒被尊重，超高由正文 `overflow-y` 滚动接住。config sheet（标签高级设置）同为 cell-group×grid 正文结构，经矮视口探针实测**不受影响**，但回归测试把两处一起锁住（375×600 + 启动诊断开 = 最大内容量）。

**经验**：① `overflow:hidden` 的容器绝不能坐在可被压缩的 grid/flex 轨道上；② 同优先级选择器按源码顺序定胜负，修 display 冲突用复合选择器，别赌规则位置；③ 回归测试要在「内容最大化 × 视口最小化」的组合下跑，新增任何会加高 sheet 内容的功能都要重跑这一组。

---

## P35 · 分钟 tick 整页重渲染把日视图滚动钳回顶部：WebKit 无 scroll anchoring（v65）

**确诊日期**：2026-07-17 · **状态**：v65 已修 · **严重度**：中（不阻断核心动作，但打的是「回看今天」这一 dogfood 核心流程，且每分钟必发一次；用户真机报告，冻结期经维护者明确批准修复）

**现象**：回看今天早些的记录（往下滚动日视图）时，分钟跳变（如 13:53 → 13:54）的瞬间页面弹回顶部。

**根因**：今天的日视图每分钟因 `liveMinute` 签名变化触发整页 `render()`，`renderTimeline` 对 `#timeline` 做整块 `innerHTML` 替换。WebKit 没有 scroll anchoring：替换瞬间旧内容移除、文档瞬时变矮，窗口滚动被钳到 0，新内容装回后也不还原。Chromium 有 scroll anchoring 所以无感——**这是只在用户真机引擎上存在的缺陷**。双引擎脚本复现：同场景滚到 600px 后跨分钟，WebKit 600→0，Chromium 600→600。历史日不受影响（`liveMinute` 只在「现在落在所看周期内」时参与签名，历史日无被动重渲染）。

**为什么现在才暴露**：需要同时满足「今天时间轴足够长可滚动 + 停留回看超过一分钟」。dogfood 记录密度上来之后，今天的时间线才第一次长到需要往回滚着看。

**修法（v65，最小改动）**：`refreshLiveClock` 在 `render()` 前后保存/还原 `window.scrollY`。只动这一处是刻意的：它是**唯一的被动重渲染路径**——用户没有任何操作，视口位置属于用户，渲染不该动它；主动路径（切视图/切周期/保存表单）语义上允许重置视口，不碰。回退＝revert 单提交。

**回归测试**：走真实 tick 路径（`page.clock.install` + `fastForward(60_000)` 触发 `setTimeout` → `refreshLiveClock` → `render`），矮视口（375×420）保证可滚动，断言「现在」一线跨过分钟（渲染确实发生）且 `scrollY` 纹丝不动。落地前验证过**无修复时 WebKit 必红**，测试真实咬人。

**经验**：① 被动重渲染（timer、后台恢复）不得移动视口——用户没操作时视口是用户的；② 回归测试落地前先证明「没修会红」，否则只是绿色装饰；③ 引擎差异（scroll anchoring 有无）会让「本地 Chromium 看不出问题」成为常态，涉及滚动/布局的断言必须双引擎跑；④ 测试环境教训：`playwright.config` 的 `reuseExistingServer: true` 会把 4173 端口上**任何**陈旧 server 当被测应用——本轮它正服务着另一个项目的静态站，228 用例每条烧满 30s 超时再重试，共 4.5 小时全部假失败；跑套件前先确认 4173 是时间尺或为空（`curl 127.0.0.1:4173` 一眼即知）。

---

## 协作约束补记（v28）

- 多步改动走主线程；避免并发 fan-out 子代理 / workflow（上游会 429，串行 workflow 亦然）。已同步进 `CLAUDE.md` / `AGENTS.md`「开发与维护红线」。

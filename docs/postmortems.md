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

`docs/prototypes/timeline-dm.html` 原型验证时用的 demo 数据全部落在 49–182min 区间，从未触发过 200px 钳制，因此回弹缺陷在原型阶段完全不可见，直到真机喂入真实一天的数据分布才暴露。

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

## 协作约束补记（v28）

- 多步改动走主线程；避免并发 fan-out 子代理 / workflow（上游会 429，串行 workflow 亦然）。已同步进 `CLAUDE.md` / `AGENTS.md`「开发与维护红线」。

# v57 实施规格与审计记录（阶段 A 已确认）

> 审计日期：2026-07-13
>
> 基线：v56（`8cd8d39`）
>
> 状态：阶段 A 已完成三次独立复核，用户已接受 §12.4 与第三轮两项补强；结论已并入正文，允许按 §10 进入阶段 B。本文件仍不授权推送、tag 或 Release。
>
> 拍板记录（第一轮）：用户于 2026-07-13 接受跨夜开始时间调整、SE2 合入边界、性能实验提前停止、无退化容差和 v54 发布债隔离。
>
> 拍板记录（第二轮 grilling）：用户于 2026-07-13 进一步确认六项收敛：性能改为真实 iOS 慢现场诊断，v57 只加入 boottrace beacon；过夜续记改为纯数据形态触发并提供显式结束选择；跨夜时长不设上限；计划编辑采用上下界对称的“时间未变”豁免并显示过期提示；三笔本地提交结构不变；其余已接受日期、午夜拆分、硬终点、版本和 v54 隔离规则不变。
>
> 拍板记录（第三轮独立复核）：用户于 2026-07-13 接受以 `#boottrace=1` 取代会改变 SW 缓存路径的 query 触发；HUD 必须位于 v53 快照采集范围外；测试 origin 若实测丢失 start URL fragment，可在该次测试部署的最早内联脚本使用一行硬编码开关并明确记录，生产构件保持不变；DST 回归使用 Playwright 真实 `timezoneId`。

## 1. 结论先行

- v57 应优先解决日期计划窗口和已确认存在的过夜续记语义问题；性能部分只加入诊断用 `#boottrace=1` 启动分段计时，不实现任何优化候选。
- 过夜续记只看可解释的数据形态，并由表单显式选择“到今天”或“只记到 24:00”；不再依赖 `OPEN_DATE_KEY`、内存 provenance、导航清除或 boot snapshot 来源耦合。
- 编辑既有计划时，只要规范化后的时间与同一次 `load()` 取得的最新持久化时间相同，就跳过计划窗口上下界校验；时间一旦变化则重新执行完整校验。
- 不改统计的“空日不继承前一日标签”通则，不把所有历史日续记放宽到“现在”。
- 不做框架、构建、后端、账号、云同步、虚拟列表、CSS 拆分、核心模块懒加载、IO 延迟加载、A/B harness、fragment retry 或 SW 策略重构。
- 三笔提交只在本地保持清晰；本轮任何一笔及整组都不得推送，完成全部验证后仍须等待用户另行授权。
- 用户确认真实可感知的慢场景是 iOS 主屏 PWA 冷启动和被系统回收后的后台切回；桌面 `navigationStart → app-ready` 不能替代这两条真实路径。优化候选整体推迟到 v58+，待真机证据决定。

## 2. 已同意的提交结构

### 提交 1：janitorial，不单独发布

- 删除两个未跟踪文件：
  - `docs/prototypes/index.html`（与已跟踪 `continuous-log-refined.html` 内容相同）
  - `docs/prototypes/index只是占位.txt`（空文件）
- 注意：未跟踪文件的删除本身不会形成 Git diff；本提交仍会包含下面的已跟踪清理。
- 删除 [entry_model.js](../src/entry_model.js) 中无运行时调用的 `carveInsert`，删除它的两组直接 smoke。
- **不得连语义护栏一起删掉**：把“在未记录 placeholder 内部补一段后，左右仍保持未记录”的用例改写为现役 `planSegmentSplit` planner 测试。
- 修正 [sheet_controller.js](../src/sheet_controller.js)、[ui_smoke.spec.js](../tests/ui_smoke.spec.js)、`CLAUDE.md`、`CONTRIBUTING.md` 中的陈旧 `carveInsert` 现役表述；历史 CHANGELOG v30 和 postmortem P9 原样保留。
- 清理 `ui_smoke.spec.js` 中重复的 `addInitScript + boot` 和半截重复注释；原测试当前还会被 fixture 的 `localStorage.clear()` 抹掉预设偏好，需改成可真实注入 `recordMode` 的 fixture 参数。
- 图标准确表述为：运行时实际使用 `more/edit/trash`；不存在 `check` 定义，保存是文字按钮。
- 把 `CLAUDE.md` 中“`sw.js` 第 1 行 CACHE”修成不依赖行号的“CACHE 声明”。

这笔提交会修改运行时文件，但不单独升版本的前提是：它只作为三笔本地提交的第一笔存在，绝不单独推到 `main`。若 v57 暂停，整组三笔均保持本地。

### 提交 2：决策日志，不改运行时

在 [decisions.md](decisions.md) 中记录：

- 将本审计规格 `docs/v57-plan-audit.md` 与 `docs/decisions.md` 一同纳入本笔 docs-only 提交；它不进入提交 1 或运行时提交 3。

- 里程碑未来按“累计有效记录日”研究，不断签清零；首阶段只考虑一次性温和庆祝，徽章/进度页更后置，节点不照抄 `3/7/21/100`，且继续受“28 天真实记录 + 求职实质进展”总 gate 约束。
- “有效记录日”**尚未定义**，必须诚实列为待调研：是否按不同自然日、计划是否计入、导入历史是否计入、删除记录后是否回退。
- 付费方向改为“支持作者”：入口只放“更多”，所有功能始终免费；支持不购买功能、服务、股权或优先权，款项由作者自由支配。月度支持与 pay-what-you-want 仅为备选。
- 新条目应明确取代 D2 中“一次性买断 + 可选云备份增值”的付费方向；D2 的 AGPL、公开源码和双许可事实仍保留。
- 仓库继续公开并维持准确的许可证名 `AGPL-3.0-or-later`；私有化不能保护已部署的前端源码。官方渠道、名称和图标的防冒充规则只列后续评估。
- 主线高级设置交给 Fable5 后续调研，本轮不实现。四类动作必须分开记录风险：
  - 改名：迁移历史标签或建立别名，否则产生孤儿标签；
  - 改桶：会追溯性重算全部历史统计；
  - 停用：应只阻止新选用，不能破坏历史归类；
  - `longOk`：会追溯改变长段待确认口径。

### 提交 3：v57 运行时、测试与版本仪式

- 包含日期计划窗口、入口模式、表单取消无副作用、过夜续记和 `#boottrace=1` 诊断 beacon。
- 不包含 IO 延迟加载、A/B harness、fragment retry 或其它性能优化候选；这些方向只能在 v57 真机诊断证据之后另立 v58+ 方案。

## 3. v57 日期计划规则

### 3.1 单一时间真源

在 [time.js](../src/time.js) 增加可注入 `now` 的本地日历计划窗口 helper，供 validator、FAB 分类和 sheet 模式分类共用：

- 下界：计划时刻必须**严格晚于** `now + 5min`；
- 上界：以本地今天 `00:00` 为第 0 天，`今天 + 8 日 00:00` 为半开区间上界；
- 等价结果：第 `+7` 日 `23:59` 可保存，第 `+8` 日 `00:00` 拒绝；
- 必须通过本地 `setDate/addDays` 推进日历日，不能用 `7 * 24h` 代替自然日。

`validateTsForMode` 不再接收或服从“打开表单时所选日”的上界。用户可从今天表单直接把计划改到明天或第 `+7` 日。

### 3.2 新增入口模式

- 历史日：强制“已发生”，隐藏模式切换。
- 今天：保留并允许切换 `timelog.recordMode` 偏好。
- `+1…+7` 日：强制“计划中”，隐藏模式切换；强制状态不得改写今天的偏好。
- `+8` 日及以后：隐藏 FAB 和与它配套的底部渐隐层；既有计划仍可查看和编辑。

### 3.3 既有计划的对称豁免

- 编辑既有计划时，必须先从**同一次** `load()` 的对象图中找到最新持久化 entry，再把规范化后的输入时间与该 entry 的最新 `ts` 比较；不得使用打开表单时冻结的旧副本，也不得 find 一张图、save 另一张图（P1）。
- 时间未变：跳过整个计划窗口校验，既不检查 `now + 5min` 下界，也不检查 `+7` 日上界。已过期、距现在不足 5 分钟或超过 `+7` 日的旧计划都可以只改文字和标签。
- 时间有任何变化：重新执行完整计划窗口校验，必须严格晚于 `now + 5min` 且早于 `今天 +8 日 00:00`。
- 编辑已过期计划时，表单显示一行中性提示：该计划可以修改文字和标签；若要把它记为已发生，应使用列表中的“标记已发生”。具体措辞实现时可微调，但不得暗示过去时间可以作为新的计划时间保存。

### 3.4 默认计划时间与取消语义

- 今天新建计划默认取“严格晚于 `now + 5min` 的最早 5 分钟刻度”：例如 `12:34 → 12:40`、`12:56 → 13:05`、`23:58 → 次日 00:05`。
- 从未来日期进入时仍默认该日 `09:00`。
- 打开表单或在表单内改日期不得提前改变主页面日期；取消后必须仍停在原日期。
- 只有成功保存后，主页面才切到记录或计划实际所属日期。

## 4. 新发现：过夜续记

### 4.1 已确认的当前问题

场景：昨天 `23:00` 后是未记录占位，今天 `08:00` 打开或恢复应用，页面仍停在昨天，此时新增“睡觉”。

当前路径会得到：

```text
昨天 23:00  睡觉
今天          没有边界点
```

原因链：

- `defaultFormTimestamp` 正确取得昨天尾部 `23:00` placeholder；
- `settlementEndFor` 对普通历史日无同日右邻时固定结到 `24:00`；
- 普通 `saveEntry` 只填起点；
- `normalizeEntries` 在今天完全为空时不会凭空创建今天 `08:00` 的右边界；
- [stats.js](../src/stats.js) 因此按设计把历史末点封在自身日末。现有 logic smoke 明确保护“空日不继承前日标签”，这条通则不能删除。

现有 UI smoke 也明确固化了“主动历史日续记到 `24:00`、保存后不创建今日 placeholder”。修复必须同时保留跨夜与只到 `24:00` 两种结果，由表单显式选择，不再猜测到达意图。

### 4.2 已解决（2026-07-13 grilling）：纯数据形态触发

只在以下条件同时满足时提供“过夜续记”表单：

- 日视图；
- 所看日期恰好是昨天；
- 昨天最后一点仍是未记录 placeholder；
- 从 FAB 发起普通新增，非 gap/backfill、非 edit；
- 今天可以已经有记录；planner 按 §4.3 的确定性定义计算不可跨越 hardEnd，绝不覆盖真实记录。没有符合条件的真实记录时才结束于现在；已有空 placeholder 可在最新数据复核后复用或归一化。

到达路径不再参与判定：不建立、读取或持久化来源 provenance，不要求显式导航清除候选，也不把来源状态塞进 boot snapshot。理由是 provenance 会在 reload、进程回收或表单打开前重载时丢失，使同一数据形态表现不一致；显式结束选择比隐式猜测更可解释。

“恰好昨天”从结构上保证最多跨一个午夜；前天及更早仍走普通历史日 `→24:00`。昨天的普通 FAB 新增会进入过夜表单，但用户可以显式选择“只记到 24:00”保留旧行为。gap 行的“补一下”、编辑和切分不进入该表单。

当前 `fabSubCopy()` 对所有非今天日期只显示“续 hh:mm 起”，不显示结算时长，因此本方案不需要改变 FAB 文案，也不与启动快照产生新的文案状态耦合。

### 4.3 UI 与落库

表单必须明确预览：

```text
续昨晚 23:00 起 · 到今天 08:00 · 约 9h
昨天 23:00–24:00
今天 00:00–08:00
```

表单在时间预览附近提供一行显式结束选择，复用现有 v48 “至今 / 固定”一类分段控件语法：

- `到今天 hh:mm`：默认项；`hh:mm` 是最新数据下计算出的硬终点；
- `只记到 24:00`：保留现行普通历史续记行为。

选择“只记到 24:00”时走现行单日 `saveEntry` 路径，不进入过夜 planner，保存后仍停在昨天。若开始时间被调整到今天 `00:00` 或之后，“只记到 24:00”已不再有语义，必须隐藏或禁用并强制使用今天单段结果。

跨夜时长不设软阈值或硬上限。预览必须始终显示准确的“约 Xh/Xmin”，并覆盖接近 48h 的极长但结构上合法场景；“睡觉”是 `longOk` 的既有取舍不在本轮改变。

hardEnd 与 placeholder 必须按以下规则确定，不允许实现阶段自行猜测：

```text
realToday = 今天满足 !entry.planned、!isPlaceholderEntry(entry)、entry.ts <= now 的记录
hardEnd = realToday 中 ts 最早者的 ts；不存在则为 now
```

- hardEnd 恰为今天 `00:00` 时，今天没有正时长可填，“到今天”与“只记到 24:00”结果相同；不进入特殊跨夜表单，直接走现行 `→24:00` 单日路径。
- 午夜 placeholder 可原位复用为今天睡眠起点；hardEnd placeholder 可复用为结束边界。
- 严格位于睡眠区间内部的 placeholder 必须由专用 planner 移除或归一化，否则会提前截断睡眠。
- hardEnd 是真实记录时不创建空边界；hardEnd 是 `now` 时，即使其后存在未来真实点，也必须显式复用或创建 `now` placeholder。
- 未来真实点和不占必写边界的计划点原样保留；只检查当前结果实际必须创建的午夜/hardEnd 边界。
- 计划记录若占用必须创建的午夜或 hardEnd 时刻，保留计划，不静默平移、删除或覆盖；阻止“到今天”并显示内联冲突，同时保留“只记到 24:00”。

默认开始时间仍是昨天尾部未记录 placeholder。用户可在提交前把开始时间向后调整，但调整范围必须落在打开表单时冻结、提交前以最新数据复核的未记录区间内：不得早于原空白起点，不得等于或越过硬终点，预览和预计时长随之更新。

- 调整后开始时间仍早于今天 `00:00`：继续按午夜拆成昨天、今天两段；
- 调整到今天 `00:00` 或之后：午夜不再是必写边界，退化为普通的今天单段记录，不再填写昨天，并隐藏“只记到 24:00”；
- 任何跨标签页或导入造成的边界变化都必须使旧预览失效，要求重算，不能静默扩大可写区间。

推荐新增专用事务 planner，在提交前基于**同一次** `load()` 的最新对象图重算并校验结果签名；不要复活无签名、无最新数据复核的 `carveInsert`，也不得在一张对象图上 find 后保存另一张图（P1）。

当开始时间仍在昨天时，推荐按自然日硬边界原子写成：

```text
昨天 23:00  睡觉
今天 00:00  睡觉
今天 08:00  未记录
```

若今天已经有真实记录，例如 `07:30 洗漱`，则已接受的规则是把它作为结束边界：写入昨 `23:00` 睡觉和今 `00:00` 睡觉，保留今 `07:30` 洗漱，不再新增或覆盖 `08:00` 边界。该场景虽不常见，但真实可达：一个仍停在昨天的标签页可以收到另一标签页今天写入的 `storage` 事件，数据会刷新而 `selectedDate` 仍保持昨天；导入也可能形成同类状态。本项目没有跨设备同步，因此不把“另一设备自动写入”列为来源。

理由：现有 `planIntervalEdit`、`planSegmentSplit` 和删除预览均按单自然日设计。虽然统计层能够读取“昨 23:00 起点 + 今 08:00 右邻”的单条跨日记录，但主动创建这种记录会让现有编辑页误认终点为昨天 `24:00`。在午夜显式拆成两个同标签日内段，可继续复用现有编辑、切分和删除规则。

**已接受的取舍**：开始时间仍在昨天的一次用户动作会生成两条可分别编辑的日内记录，当前没有“跨日组 ID”；后续修改一半不会自动同步另一半。用户于 2026-07-13 接受“创建时连续、之后按自然日独立编辑”。开始时间被调到今天后只生成今天单段，不适用该取舍。独立复核仍可用更强证据推翻，但默认实施方案以此为准。若坚持“一条逻辑记录跨午夜”，就必须同时设计跨日编辑、切分、删除和预览，范围明显更大。

“到今天”跨夜分支保存成功后切到今天，让用户立即看到 `00:00–08:00` 的睡眠；“只记到 24:00”分支沿用现行路径并停在昨天。前天及更早的普通历史日仍保持 `→24:00` 行为。

## 5. PWA 性能：真实慢现场诊断先行

### 5.1 已确认的现场与证据边界

- 用户确认存在真实可感知的慢：iOS 主屏 PWA 冷启动，以及应用进后台后被系统回收、再次切回时发生的“隐形冷启动”。页面仍存活的普通后台恢复是另一条路径，继续由 v54 的即时分钟刷新护栏验证。
- 真冷启动或进程回收后，`sessionStorage` 快照可能存在也可能不存在，不能从“新进程”预判；beacon 必须报告实际的无快照、DOM 恢复、版本/日期/数据拒绝或最终采纳状态。跨夜早晨即使恢复旧快照，也会因自然日变化正确拒绝。
- 桌面 Chromium/WebKit 的 `navigationStart → app-ready`、FCP/LCP 或 DevTools trace 只能描述页面内阶段，不能覆盖“点主屏图标 → iOS 拉起 WebKit 进程”这段系统成本，也不能替代 SE2 standalone 现场。
- [stress-baseline.md](stress-baseline.md) 仍是旧 Chromium 单引擎记录；现有 `tests/stress.spec.js` 是单次暖机计时，不是五次真机中位数，也不测 iOS 进程拉起。

因此 v57 不先猜优化对象，只增加可在真实设备读取的启动分段诊断；任何优化候选推迟到 v58+。

### 5.2 `#boottrace=1` beacon 规格

采用与 `?vvdebug=1` 相同的显式诊断姿态，但从 `location.hash` 读取 `#boottrace=1`，避免改变 HTTP 请求与 Service Worker cache key；不新增运行时文件：

- 无 `boottrace` fragment 时不创建诊断 DOM、不注册诊断 timer/listener、不收集或持久化诊断结果；正常路径只保留最小的 hash 门判断。
- `index.html` 现有最早内联脚本在 fragment 启用时记录 `html_inline_start`；`src/app.js` 模块体顶端记录 `app_module_body_start`，解释为 app module body / static import graph ready，不能称为网络“module 到达”；随后记录 `init()` 开始、首轮 render 完成（或快照被采纳）、`app-ready`。
- 同时附带 Navigation Timing entry 中浏览器实际提供的关键字段，并明确这些字段从 navigation 起算，不包含点击主屏图标到 WebKit 进程开始导航之前的系统时间。
- 启用时用轻量只读 HUD 显示有序打点、各段耗时、总页面内耗时和快照状态，便于真机录屏逐帧核对；状态至少区分无快照、DOM 已恢复、版本/日期/数据拒绝与最终采纳，不得显示记录内容、标签、导入数据或其它个人信息。
- 时间点必须单调有序；诊断 HUD 自身只在 `app-ready` 之后呈现，不能把 HUD 构建成本混进被报告的 `app-ready`。
- HUD 必须挂载在 v53 启动快照采集的 `.app` 与 FAB 范围之外，避免被写入快照并在下一次未带 flag 的启动中恢复；不增加 localStorage/sessionStorage 等持久化诊断开关。
- beacon 不新增资产，`sw.js` 的 `FILES` 列表保持不变；因 `index.html`/`app.js` 属既有运行时资产，仍按 §7 执行 v57 版本同步。

### 5.3 SE2 采样与诚实口径

取得单独的部署/真机授权后，使用全新 HTTPS 测试 origin 和纯合成数据；安装前让该测试部署的 manifest 临时使用 `start_url: "./#boottrace=1"`，生产 manifest 始终保持 `"./"`。顺序采集：

1. 从 iOS 主屏完全冷启动，5 次；
2. 进入后台、确认进程已被系统回收后再从主屏/任务切换返回，5 次；
3. 页面仍存活的普通后台恢复另做画面与当前分钟正确性回归，不与冷启动中位数混算。

每次保存 boottrace 数值、最终快照状态和录屏观测，分别报告原始五次值与中位数并写入 [stress-baseline.md](stress-baseline.md)。若五次中混有 `adopted`、无快照或不同拒绝原因，应分别报告或明确标注混合样本，不只给一个未分层中位数。录像和临时 trace 不提交；不得包含真实记录。没有 SE2 证据时，只能说 beacon 与桌面自动化已验证，不能宣称 iOS 启动性能验收完成。

测试 origin 安装后必须先实测主屏启动是否保留 fragment。若 iOS standalone 实际剥离 fragment，允许仅在该次一次性测试部署的最早内联脚本中把诊断门硬编码为开启：只允许一行差异，必须在采样记录中明确注明，且生产构件、生产 manifest、`sw.js` 与 `FILES` 均保持不变。该后备的失败模式是 beacon 不亮，不能静默把无诊断样本算作成功。

当前任务明确不推送、不发布，因此本轮最多完成 beacon 代码与本地合成验证；真实 HTTPS 主屏采样等待用户另行授权，不伪造“发布后已测”。

### 5.4 v58+ 候选池（不构成 v57 开工项）

只有 boottrace 证据指出可控的页面内瓶颈后，才另立同配置基线/候选实验。候选按先验价值排列：

1. 评估可安全失效的冷启动 `localStorage` 渲染快照，复用 v53 的 DOM 快照与签名思想；
2. 评估 `sheet_controller.js` 与 `pickers.js` 的延后加载或空闲预取，但核心首条记录操作不得退化；
3. `io_actions.js` lazy 仅列低优先候选，其约 20.7KB 体量不足以先验认定能解释真实慢。

未来候选仍需在真实目标路径达到 `max(50ms, baselineMedian * 10%)`，并使用已接受的无退化哲学；具体指标、样本和容差须由届时证据重新定稿，不能把旧桌面 A/B 门槛直接冒充 iOS 结论。

### 5.5 未采用的知识存档：fragment retry

此前推导过 `import('./io_actions.js#retry')` 可利用不同 module-map key、同时让 Cache URL 比较排除 fragment；该推导本轮**不采用、不实现、不测试**，仅作为未来若真正选择动态 import 时重新核实的知识线索：

- [HTML Standard：module map](https://html.spec.whatwg.org/multipage/webappapis.html)
- [Service Worker specification：Cache request matching](https://w3c.github.io/ServiceWorker/#request-matches-cached-item-algorithm)

### 5.6 v57 硬边界

v57 性能运行时代码只允许 `#boottrace=1` beacon。不得实现 lazy loading、A/B harness、fragment retry、CSS 拆分、SW 策略重构、虚拟列表或其它优化候选；不得因为本地桌面数字好看就宣称 iOS 慢已解决。

## 6. 必补回归

### 日期与模式

- 严格 `+5min` 拒绝、`>5min` 接受；明天接受；`+7 23:59` 接受；`+8 00:00` 拒绝；覆盖跨月/跨年。DST 用例必须使用 Playwright 独立 context 的真实 `timezoneId`（例如 `America/New_York`），不得用固定 `timezoneOffsetMinutes` 冒充。
- 历史、今天、`+1`、`+7`、`+8` 的 FAB/表单矩阵；强制模式不得污染今天偏好。
- 从今天表单直接保存 `+7 23:59`；`+8` 留在表单显示内联错误且不写库。
- 既有计划对称豁免：过期、距现在不足 5 分钟、远于 `+7` 日三类计划在时间未变时均可改文字/标签；过期计划显示中性提示行。
- 上述三类计划只要改动时间就重新走完整窗口校验：留在过去/过近/远期均拒绝，移回有效窗口成功；比较对象必须来自同一次 `load()` 的最新 entry。
- `12:56`、`23:58` 打开计划时默认值本身有效。
- 打开、改日期、取消后主页面日期不变；成功保存后才切到目标日。

### 过夜续记

- 数据形态矩阵：恰好昨天/前天/今天 × 尾 placeholder 有/无 × FAB/“补一下”/edit。只有“恰好昨天 + 尾 placeholder + FAB 普通新增”进入过夜表单；不检查到达路径。
- 默认选择“到今天 hh:mm”，显示昨 `23:00–24:00`、今 `00:00–08:00` 与约 9h 预览；选择“只记到 24:00”只写昨天并停在昨天。
- “到今天”保存后落库包含昨 `23:00` 睡觉、今 `00:00` 睡觉、今 `08:00` 空边界；昨天维持 60 分钟，今天维持 480 分钟，并切到今天展示结果。
- 开始时间可在冻结空白区间内向后调整：仍在昨天时按新起点拆成两段；调到今天 `00:00` 或之后时只生成今天单段，同时隐藏/禁用“只记到 24:00”；早于空白起点或不早于硬终点均拒绝。
- 不设跨夜时长上限；构造昨天 `00:00` 左右到今天接近 `24:00` 的近 48h 场景，预览时长必须可见且计算准确。
- 今天已有真实记录时，必须以截至现在的第一条为硬终点并原样保留；未来真实点、计划点、空 placeholder 和边界同刻冲突也要覆盖，planner 不得吞记录。
- hardEnd 恰为今天 `00:00` 时退回普通 `→24:00`；计划占用当前结果必写的午夜/hardEnd 时，阻止“到今天”且保留“只记到 24:00”，不得移动、删除或覆盖计划。
- 内部 placeholder 被移除/归一化、午夜和 hardEnd placeholder 复用、hardEnd=`now` 且其后有未来真实点时仍存在 `now` 空边界，均须有回归。
- 跨标签或导入改变数据后，旧预览签名必须失效，基于同一次最新 `load()` 重算并要求再次确认。
- 两个午夜拆分后的日内记录仍可正常编辑、切分和删除。
- 保留“空日不继承前日标签”、前天及更早普通历史日 `→24:00`、backfill/edit 不触发过夜表单等护栏。

### Boottrace

- 无 `boottrace` fragment：不出现诊断 DOM，不注册诊断 timer/listener，不持久化任何 trace；核心启动、记录、编辑和 IO 行为不变。
- 有 `#boottrace=1`：`html_inline_start`、`app_module_body_start`、init、首渲/快照采纳、app-ready 打点按序可见；模块点解释为 app module body / static import graph ready，Navigation Timing 字段明确页面外 iOS 启动时间不在其中。
- 快照无/DOM 恢复/版本、日期、数据拒绝/最终采纳均能正确标注；HUD 在 app-ready 后才创建，不能污染被测时间。
- HUD 位于 `.app` 与 FAB 的 v53 快照采集范围外；带 flag 启动后再无 flag 启动，快照不得恢复 HUD。
- 输出不得出现记录内容、标签、内部备份或其它个人数据；无新增运行时资产，SW `FILES` 不变。

### 完整门禁

```bash
python3 scripts/project_audit.py
python3 scripts/confirm_logic_smoke.py
npm run test:ui
npm run test:stress
git diff --check
```

## 7. 版本、推送与发布

v57 最终提交必须同步：

- `sw.js` 的 `CACHE = 'timelog-v57'`；
- `manifest.webmanifest` 的 `version: "57"`；
- `scripts/project_audit.py` 的 `EXPECTED_VERSION`；
- `src/ui.js` 的 `APP_VERSION`；
- `CLAUDE.md` 当前版本行和 v57 CHANGELOG；
- 缓存资产列表保持不变，除非独立复核决定新增运行时文件。

本轮授权只到三笔本地提交和验证：**不推送 `main`、不打 `v57` tag、不创建 GitHub Release**。即使全部门禁通过，也必须停下等待用户另行授权；未来若获发布授权，再按 `CLAUDE.md` 将 main、同版本 tag 与 Release 作为同一版本仪式处理。

另有既有发布债：本地 v31–v56 标签中缺 `v54`。已接受将它作为独立发布审计债务另行核对、必要时修复远端 tag/Release；它不纳入、不阻塞 v57，也不写进 v57 的三笔提交或 release notes。

## 8. 独立复核必须重点挑战的地方

1. **已确认（三次独立复核）**：过夜续记按午夜拆成两条日内记录，后续分别编辑；现有编辑、切分、删除与 `coalesceRedundant` 的自然日边界均支持该方案，未发现扩展为一条跨日记录的必要性。
2. **已解决（2026-07-13 grilling）**：provenance 方案已被纯数据形态 + 表单显式结束选择取代。不得重新引入 `OPEN_DATE_KEY/lastSeenToday/导航清除/boot snapshot 来源耦合`，除非拿出新的代码级反证证明数据形态方案不可实现或会破坏现有不变量。
3. **已确认（三次独立复核）**：今天已有记录时，按 §4.3 的 `realToday/hardEnd` 定义取硬终点；跨标签、导入、未来时间点、计划点、placeholder、同刻冲突与最新数据复核均已纳入规则和回归。
4. **已解决（2026-07-13 grilling）**：既有计划在时间未变时跳过上下界全部窗口校验；时间变化时全量校验。不得退回“只豁免远期上界”，除非有新的代码级反证。
5. **已确认（三次独立复核）**：五分钟默认刻度与 `+7` 半开上界在秒级 now、跨月和跨年下自洽；DST 必须由 Playwright 真实 `timezoneId` context 验证。
6. **随 §5 重写作废，推迟 v58+**：旧桌面 A/B 的主门槛与无退化容差不再是 v57 合入流程；未来必须由真实 iOS boottrace 证据重新定稿。
7. **随 §5 重写作废，知识存档**：fragment retry 不进入 v57 实现或测试；只有未来真的选择动态 import 时才重新核实规范与跨引擎行为。
8. **随 §5 重写作废，推迟 v58+**：v57 不评估或实现 `io_actions.js` lazy；先采真实慢现场，再决定候选。
9. **已确认（三次独立复核）**：决策日志新条目明确 supersede D2 的付费方向，同时保留 AGPL/公开源码/双许可事实和“28 天真实记录 + 求职实质进展”总 gate。

## 9. 本次审计的验证状态与限制

- 已核实 `carveInsert` 只有定义、直接 smoke 与注释/文档引用，没有运行时调用；现役 `planSegmentSplit` 可以承接“未记录段内部切分后两侧仍未记录”的语义护栏。
- 已核实运行时实际使用 `more/edit/trash`，`ui.js` 没有 `check` 定义；`CLAUDE.md` 的“仅 more 在用”和 `edit/trash/check` 备用说法已过时。
- 已核实 `OPEN_DATE_KEY` 当前只写不读；第二轮 grilling 已决定不把它扩展为过夜 provenance。
- 已核实 `sw.js` 第 1 行是 AGPL 文件头而非 CACHE；维护文档应改成不依赖行号的“CACHE 声明”。
- 已核实 `ui_smoke.spec.js` 存在重复的 plan 偏好注入/半截注释，且 `ui_fixture.js` 的 `localStorage.clear()` 会抹掉调用方预设偏好。
- 已核实现行计划上界是“所选日次日”和“now +7 天同壁钟”取较早者；已过期计划今天即使只改文字也会先被 `validatePlannedTs` 下界拒绝。
- 已核实 `settlementEndFor` 会把无同日右邻的普通历史记录结到 `24:00`，用户报告的过夜问题根因链成立；现有统计通则仍明确保护空日不继承。
- 已核实昨天视图 FAB 副文案只显示“续 hh:mm 起”而无时长，纯数据形态触发不需要增加 snapshot 文案状态。
- 已核实 D2 仍写有“一次性买断 + 可选云备份增值”，新决策必须明确 supersede 该方向而保留 AGPL/公开源码事实。
- 已核实 `tests/stress.spec.js` 是单次计时；`io_actions.js` 约 20.7KB，仅占当前 JS 的小部分，不能在无真实 trace 时先验认定为启动瓶颈。
- 用户确认 iOS 主屏冷启动和被回收后的切回存在可感知慢；这是真实用户报告，不等于已经取得可量化 boottrace 证据。
- 早期一次定向 Chromium 尝试曾因执行环境禁止创建子进程而未运行；第一次独立复核随后完成 Chromium + WebKit 全量运行，168 项首轮通过、2 项 WebKit 重试后通过。第三次独立复核没有重跑 Playwright；阶段 B 仍必须按 §10 重新运行完整门禁。
- 未完成 boottrace、SE2 五次采样或 iOS standalone 性能验收；旧 Chrome DevTools/A-B/lazy 方案已由第二轮 grilling 移出 v57。
- 第三次独立复核重新确认：query 版 boottrace 会绕过当前无 search 的 SW shell cache，`#boottrace=1` 是不改变请求/cache key 的最小替代；HUD 快照隔离与测试 origin fragment 后备已获用户接受。
- 第三次独立复核独立运行 `python scripts/project_audit.py` 与 `python scripts/confirm_logic_smoke.py` 均通过；截至本次 docs-only 收敛未修改运行时代码、未提交、未推送、未打 tag、未发布。

## 10. 独立复核与实施协议

### 阶段 A：独立复核（先于任何运行时代码改动）

1. 通读 `CLAUDE.md` 与本文，抽查本文引用的代码事实与当前代码是否一致：至少包括 `validatePlannedTs`、`settlementEndFor`、`saveEntry/commitEdit`、`normalizeEntries`、SW 缓存与版本联动、现有 smoke 断言。
2. 对 §8 标注“待复核”的项逐条给出结论；标注“已解决（2026-07-13 grilling）”的项不得重开，除非有新的代码级反证。
3. 输出复核报告，分成“确认 / 推翻（附证据）/ 需澄清”三类。存在“推翻”或“需澄清”时，必须停在阶段 A 等用户拍板：先改计划，不硬做。
4. 只有用户确认阶段 A 复核报告后，才可进入阶段 B。

本项目的三次阶段 A 复核与用户确认已于 2026-07-13 完成，结论已并入正文；阶段 B 可以按下述边界开始。

### 阶段 B：实施

- 严格按 §2 三笔本地提交的顺序与内容边界实施；任何一笔完成后都不推送。
- 提交 3 完成 §7 的版本联动、`CLAUDE.md` 当前版本行与 v57 CHANGELOG。
- 开始 UI 测试前先执行 `npm ci`。每笔提交前运行完整门禁：`python3 scripts/project_audit.py`、`python3 scripts/confirm_logic_smoke.py`、`npm run test:ui`（Chromium + WebKit）和 `git diff --check`；提交 3 另运行 `npm run test:stress`。
- §6 是必须落地的测试验收清单，不是建议。普通时间用例使用 `tests/ui_fixture.js` 已有的 `now`、`selectedDateOffset` 与必要的固定 offset 注入；DST 用例使用 Playwright 独立 context 的真实 `timezoneId`，不得用 `timezoneOffsetMinutes` 冒充 DST。
- 写路径铁律（P1）：任何“先 find 后 save”都共用同一次 `load()` 的对象图；过夜 planner 与 §3.3“最新持久化 ts”比较均适用。
- 手动浏览器检查使用本地 HTTP server，禁止 `file://`；只用合成数据，不提交真实记录、截图、导出 JSON、`test-results/` 或录像。

### 边界（硬性）

- 不引入依赖、构建或框架；`src/*.js` 只相对导入本项目模块；模块边界和 UI 红线以 `CLAUDE.md` 为准。
- 性能部分只实现 §5 的 boottrace beacon；不做 lazy loading、A/B harness、fragment retry 或其它性能候选。
- 不推送 `main`、不打 tag、不创建 Release、不处理 v54 tag 债；全部等待用户另行明确授权。
- 规格模糊或与代码冲突时停下来问用户，不自行发明。

### 本次 docs-only 收敛验证

- 运行 `python3 scripts/project_audit.py` 与 `git diff --check`，确认文档修改无损；文档不进 SW 缓存，不触发版本仪式。
- 自查 §5 不再出现“门槛通过后在 v57 合入 IO lazy”类措辞；§4.2 不再引用 `OPEN_DATE_KEY/lastSeenToday` 作为方案；§6 没有 Lazy IO 验收块；头部包含 2026-07-13 三轮拍板；§10 协议保持模型无关措辞。
- v57 运行时、测试与本地提交必须遵循：阶段 A 报告与用户确认（已完成）→ 阶段 B 实施 → 等待推送授权。

## 11. 阶段 A 第一次独立复核报告

> 复核日期：2026-07-13
>
> 状态：本节结论已经第二、三次独立复核确认，并已并入 §2、§4、§5、§6 与 §10；本节作为取证记录保留。

### 11.1 确认

1. §8 #1 的午夜拆分方案与当前模型相容。`planIntervalEdit`、`planSegmentSplit`、`planDeleteEntry` 均按自然日工作；`coalesceRedundant` 把日期纳入相邻点签名，不会把午夜两侧同标签记录误合并。纯模块复算“昨 23:00 睡觉、今 00:00 睡觉、今 08:00 未记录”得到昨天睡眠 60 分钟、今天睡眠 480 分钟。
2. §8 #3 的主体规则可行：今天截至现在的第一条真实记录可以作为不可跨越硬终点；计划记录不参与统计段，空 placeholder 可复用或归一化，未来真实点应原样保留。边界同刻冲突仍有待 11.3 拍板。
3. §8 #5 的日期算法成立：上界应是 `addDays(startOfDay(now), 8)` 的半开区间；默认计划时间应取严格晚于 `now +5min` 的第一个 5 分钟刻度。因此 `12:34:30 → 12:40`，但 `12:35:00 → 12:45`。
4. §8 #9 可按现有方案落地：新决策明确 supersede D2 的“一次性买断 + 可选云备份增值”付费方向，同时保留 `AGPL-3.0-or-later`、公开源码、商业双许可事实和“28 天真实记录 + 求职实质进展”总 gate。
5. janitorial 事实成立：两个 prototype 文件分别是已跟踪原型的逐字节副本和空文件；`carveInsert` 无运行时调用；现役 `planSegmentSplit` 能保持“未记录—新段—未记录”；运行时实际使用 `more/edit/trash`，不存在 `check` 定义；`OPEN_DATE_KEY` 当前只写不读；`sw.js` 第 1 行是许可证头而非 CACHE。
6. 日期入口、取消语义、计划豁免和 boottrace 都可在现有模块边界内实现，不需要新依赖、构建、框架或运行时资产。

### 11.2 已确认并并入正文的修正

1. **现有 `timezoneOffsetMinutes` 注入不能验证 DST。** 它只覆盖 `Date.prototype.getTimezoneOffset()`，不会改变 `Date` 构造、`setDate()` 或时区跳变规则。推荐保留现有 `now/selectedDateOffset` 注入，同时为 DST 用例使用 Playwright 独立 context 的真实 `timezoneId`（例如 `America/New_York`）；不得把固定 offset 测试冒充 DST 测试。
2. **§4.1 末句仍残留旧 provenance 语义。** “修复必须区分跨午夜留下的旧今天与主动查看普通历史日”容易被理解为自动猜测到达意图，与 §4.2 的纯数据形态 + 显式结束选择冲突。推荐改成：“必须同时保留跨夜和只到 24:00 两种结果，由表单显式选择，不再猜测到达意图。”
3. **boottrace 两处口径应收紧。** `app.js` 模块体顶端的打点发生在静态依赖图完成加载、解析和依赖求值之后，应命名为“app module body / import graph ready”，不能描述成网络意义的“module 到达”。iOS 进程重建后是否仍恢复同一 page session 的 `sessionStorage` 也不是当前代码可保证的事实；beacon 应报告实际快照命中/拒绝，不预设“新进程必然无快照”。

### 11.3 已确认并并入正文的边界

1. **硬终点恰好等于今天 `00:00`。** 这时今天没有正时长可填，“到今天 00:00”与“只记到 24:00”结果相同。推荐：不进入特殊跨夜表单，直接走现行 `→24:00` 单日路径。
2. **计划记录占用必须创建的边界时刻。** 当前数据模型禁止任意两条记录同刻；若计划恰好位于今天 `00:00` 或计算出的“现在”硬终点，不能同时创建睡眠边界。推荐：保留计划，不静默平移、删除或覆盖；阻止“到今天”分支并显示内联冲突，同时保留“只记到 24:00”。严格位于区间内部、但不占边界的计划原样保留。
3. **本审计文档的提交归属。** `docs/v57-plan-audit.md` 当前是未跟踪文件，§2 三笔结构尚未写明它归哪一笔。推荐：把它放入提交 2，与 `docs/decisions.md` 一起作为治理/决策文档提交，从而维持三笔结构。

### 11.4 基线验证

- `python scripts/project_audit.py`：通过。
- `python scripts/confirm_logic_smoke.py`：通过。
- 完整 Playwright Chromium + WebKit：最终退出码 0；168 项首轮通过，2 项 WebKit 重试后通过。两项 flaky 分别是“同分钟 placeholder 原位填充”和“中间 placeholder 补录”，不得写成“170/170 首轮全绿”。
- `git diff --check`：通过；另对未跟踪的本文做了尾随空白检查，通过。
- 未修改运行时代码，未提交、未推送、未打 tag、未发布；Playwright 产物仅在已忽略的 `test-results/`。

### 11.5 第二次独立复核交接要求

复核方应在当前仓库状态上独立读取 `CLAUDE.md` 与本文，不依赖聊天摘要，重点复核：

1. 11.1 四个 §8 待复核结论是否有遗漏或代码级反证；
2. 11.2 三项修正是否准确，尤其 DST 测试机制和 ESM 打点语义；
3. 11.3 三个推荐答案是否会破坏点模型、同刻唯一性、P1 同一次 `load()` 或三笔提交边界；
4. 是否还存在会阻止阶段 B 的规格歧义。

输出仍按“确认 / 推翻（附证据）/ 需澄清”分类。若没有新的推翻或需澄清，应明确写出“建议按 11.2/11.3 推荐项修订正文后进入阶段 B”；不得直接修改运行时代码、提交、推送、打 tag 或发布。

## 12. 阶段 A 第二次独立复核报告（已确认并并入正文）

> 复核日期：2026-07-13
>
> 状态：第二次独立复核确认 §11.2 三项修正与 §11.3 三个边界，并发现 query 版 boottrace 会改变被测启动路径。用户已于 2026-07-13 接受 `#boottrace=1` 替代方案及第三轮两项补强，结论已并入正文。

### 12.1 确认

1. `timezoneOffsetMinutes` 只能覆盖 `getTimezoneOffset()`，不能模拟 `Date` 构造、`setDate()` 与 23/25 小时自然日。普通时间用例可继续使用 `now/selectedDateOffset`；DST 用例应使用 Playwright 独立 context 的真实 `timezoneId`，且不得同时声称固定 offset 已覆盖 DST。
2. 计划窗口算法与秒级默认刻度结论成立：上界是 `addDays(startOfDay(now), 8)` 的半开区间；默认值是严格晚于 `now +5min` 的首个 5 分钟刻度。
3. §4.1 不应暗示自动猜测到达意图；应与 §4.2 统一为“按数据形态进入同一表单，由用户显式选择跨夜或只到 24:00”。
4. boottrace 的模块点应命名为 `app_module_body_start`，解释为 app module body / static import graph ready；不得称为网络“module 到达”。进程回收后 `sessionStorage` 可能存在也可能不存在，报告必须记录实际快照状态。
5. 午夜拆成两条日内记录、hardEnd 恰为 `00:00` 时退回普通 `→24:00`、计划占用必写边界时保留计划并阻止“到今天”，均符合现有点模型与同刻唯一性。
6. janitorial、D2 supersede、现有模块边界和三笔提交结论成立；本文应归入提交 2，与 `docs/decisions.md` 同笔提交。

### 12.2 hardEnd 与 placeholder 的确定性展开

第二次复核没有改变产品选择，但要求在进入阶段 B 前把既有结论写成可实现的确定规则：

```text
realToday = 今天满足 !entry.planned、!isPlaceholderEntry(entry)、entry.ts <= now 的记录
hardEnd = realToday 中 ts 最早者的 ts；不存在则为 now
```

- 午夜 placeholder 可原位复用为今天睡眠起点；hardEnd placeholder 可复用为结束边界。
- 严格位于睡眠区间内部的 placeholder 必须由专用 planner 移除或归一化，否则会提前截断睡眠。
- hardEnd 是真实记录时不创建空边界；hardEnd 是 `now` 时，即使其后存在未来真实点，也必须显式复用或创建 `now` placeholder。
- 未来真实点和不占必写边界的计划点原样保留；只检查当前结果实际必须创建的午夜/hardEnd 边界。
- 若调整后的开始时间已到今天 `00:00` 或之后，午夜不再是必写边界，应重算为今天单段，并隐藏“只记到 24:00”。

### 12.3 已确认的推翻：query 版 boottrace 不能代表目标 PWA 冷启动

当前 §5.2/§5.6/§6 的 query 触发协议存在代码级反证：

- `sw.js` 只预缓存无 query 的 `./` 与 `./index.html`，fetch handler 使用默认 `caches.match(e.request)`；默认匹配不忽略 search。因此旧 query 触发 URL 不命中已缓存 shell，会走网络 fallback，且当前 fallback 不回填缓存。
- `manifest.webmanifest` 的生产 `start_url` 是 `./`；普通主屏点击没有可靠路径携带该 query。
- 于是 query 既改变了正常缓存启动路径，也无法稳定启用被测主屏冷启动；所得时序不能直接代表目标现场。

推荐的最小替代方案：

- 将诊断开关改为 `#boottrace=1`。fragment 不进入 HTTP 请求，也不改变 Service Worker cache key。
- 未来 SE2 采样使用另行授权的全新测试 origin，安装前临时令测试部署 manifest 的 `start_url` 为 `./#boottrace=1`；生产 manifest 始终保持 `./`。
- 不修改 `sw.js` 策略或 `FILES`，不新增运行时资产，不增加持久化诊断 flag。
- 每次样本附带最终快照状态；若五次中混有 `adopted`、无快照或不同拒绝原因，分别报告或明确标注混合样本，不只给未分层中位数。

若坚持 query，则必须同时改变缓存匹配/预缓存与安装入口，范围更大且冲突于当前硬边界，不推荐。

### 12.4 用户确认

用户于 2026-07-13 接受把 boottrace 改为 `#boottrace=1`，并采用“测试 origin 临时 manifest 带 fragment、生产 manifest 保持不变”的未来 SE2 采样协议。

第三次复核补充的 HUD 快照隔离与测试 origin fragment 后备也已接受，并已同步修订 §5.2、§5.3、§5.6、§6 Boottrace 与 §10 的 DST 说明。阶段 A 至此完成，可以进入阶段 B；本轮文档收敛仍未修改运行时代码、未提交、未推送、未打 tag、未发布。

## 13. 阶段 A 第三次独立复核报告（已确认并并入正文）

> 复核日期：2026-07-13
>
> 状态：无新增推翻；用户已接受两项非阻断补强，阶段 A 完成。

### 13.1 确认

1. §12.3 的代码级反证成立：当前 SW 只缓存无 search 的 shell，请求带 query 时默认 cache match 不命中，离线 standalone 甚至可能直接白屏；fragment 不进入 HTTP 请求或 cache key，因此 `#boottrace=1` 是最小替代。
2. DST、秒级计划刻度、午夜拆分、hardEnd/placeholder、计划占用必写边界、janitorial 与三笔提交结论均重新通过代码取证，没有新的反证。
3. `#boottrace=1` 可由 `index.html` 最早内联脚本同步读取；不需要修改 SW、`FILES` 或生产 manifest。

### 13.2 已接受的两项补强

1. boottrace HUD 必须挂载在 `.app` 与 FAB 的 v53 快照采集范围之外；否则可能被写入启动快照，并在后续未带 flag 的启动中恢复。
2. iOS standalone 是否保留 manifest `start_url` fragment 缺少可靠保证。测试 origin 必须先实测；若 fragment 被剥离，允许该次一次性测试部署在最早内联脚本使用一行硬编码开关并明确记录，生产构件保持不变。

### 13.3 验证与结论

- 第三次复核独立重跑两个 Python 门禁并通过；未重跑 Playwright，阶段 B 必须按 §10 完整重跑 Chromium、WebKit 与 stress。
- 本轮只收敛文档，没有运行时代码、提交、推送、tag 或 Release。
- 结论：建议按已并入正文的 §11/§12/§13 进入阶段 B；推送与发布仍须另行授权。

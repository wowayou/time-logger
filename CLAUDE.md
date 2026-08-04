# CLAUDE.md — 时间尺维护规范

## 项目性质

时间尺是**单页静态零运行时依赖 PWA**。运行时结构只包括：

- `index.html`：DOM 壳、PWA/meta 引用、`styles.css` 和 `src/app.js` 模块入口
- `styles.css`：全部样式
- `src/app.js`：启动、状态组合、导航、渲染调度、事件委托和 Service Worker 注册
- `src/entry_model.js`：记录日期模型、续记默认起点、占位条、结算点、同刻冲突和 `+1min` helper
- `src/io_actions.js`：当前视图摘要、复制、下载、导入、分享等本地 IO 动作
- `src/sheet_controller.js`：新建/编辑/config/import sheet、focus trap、picker 重挂载和表单保存
- `src/time.js`：本地日期解析、格式化、周期范围
- `src/storage.js`：`localStorage['timelog.v1']` 读写、`localStorage['timelog.config']` 标签配置、导入合并
- `src/stats.js`：纯统计逻辑、按日分段、长段确认绑定
- `src/pickers.js`：移动滚轮与桌面时间选择器
- `src/ui.js`：渲染模板、图标、tooltip helper 和 DOM 更新
- `sw.js`：Service Worker 离线缓存
- `manifest.webmanifest`：PWA 清单
- `icon.svg` 与 `icons/*.png`：运行时图标资产

允许的开发期工具包括 `scripts/project_audit.py`、`scripts/confirm_logic_smoke.py`、`scripts/bump_version.py`（版本仪式六处锚点一键联动）、`scripts/build_site.py`（D12：解析 `sw.js` FILES 组装 `time.eigentime.org` 部署产物——`site/` 主页 → 根、运行时 → `/app/`；`site/` 是非运行时静态主页源码，不进 SW 缓存）、`npm run typecheck`（tsc 对 `time/storage/stats/entry_model` 四个纯逻辑模块做 JSDoc 类型检查，devDependency、无构建产物）和 Playwright UI smoke。Python 脚本使用标准库；确认逻辑 smoke 会调用本机 `node` 导入真实 ES modules；Playwright 只用于开发期响应式验证。

**铁律：无运行时依赖 / 无构建 / 原生 ES modules。** npm 只允许作为开发期测试依赖；不引入打包器、框架、账号、云同步或后端。

## 开发与维护红线

- `package.json` 必须保持 `"private": true` 和 `"type": "module"`；禁止新增 `dependencies`，只能在 `devDependencies` 中放开发期测试工具。
- 改动开发期 npm 依赖时必须提交 `package-lock.json`；不得提交 `node_modules/`、`test-results/`、`playwright-report/`。
- 运行时文件禁止从 npm 包导入代码；`src/*.js` 只能使用相对路径导入本项目模块。
- 不新增构建命令、产物目录、压缩产物或框架初始化文件；GitHub Pages 继续从仓库根目录直接发布静态文件。
- 新增任何运行时资产时，必须同步 `sw.js` 缓存列表；文档、测试、npm 元数据不进 Service Worker 缓存。
- 本地开发必须通过 HTTP server 打开页面；不要用 `file://` 验证 ES modules 或 Service Worker。
- 多步改动走主线程，逐个顺序做；不要为了加速并发 fan-out 子代理 / workflow——上游 API 不扛并发，连串行 workflow 都会 429。
- 写路径数据一致性：`load()` 每次返回新对象图；任何「先 find 后 save」必须共用**同一次** `load()` 的结果，禁止改一张图、保存另一张图（见 `docs/postmortems.md` P1）。

模块边界：

- `src/time.js`：只放日期、时间、周期和格式化工具；不读写 DOM / localStorage。
- `src/storage.js`：只负责本地数据/config、导入校验和合并；不渲染 UI。
- `src/stats.js`：保持统计逻辑集中；不访问 DOM / navigator；桶归类只能通过 `storage.js` 的配置 helper；日边界规则必须在这里测试。
- `src/pickers.js`：只负责时间选择器 DOM；不直接保存业务数据。
- `src/ui.js`：只负责模板、图标、tooltip helper 和 DOM 渲染；不做数据持久化。
- `src/entry_model.js`：只放记录日期模型、续记默认起点、占位条、结算点、同刻冲突、`+1min`、区间编辑/切分/删除事务 planner、无冗余边界归一化（`coalesceRedundant`）和写后统一出口（`normalizeEntries`，恒保今天尾占位）等纯/低副作用 helper；不访问 DOM / localStorage。
- `src/io_actions.js`：只处理当前视图摘要、复制、下载、导入、分享；通过显式依赖接收 `load/save/render/state`，不拥有全局状态。
- `src/sheet_controller.js`：只处理新建/编辑/config/import sheet、focus trap、picker 重挂载和表单保存；通过显式依赖读写状态和持久化。
- `src/app.js`：只负责启动、状态组合、导航、渲染调度、事件委托和 Service Worker 注册。

提交与推送前红线：

- 至少跑 `python3 scripts/project_audit.py`、`python3 scripts/confirm_logic_smoke.py`、`npm run test:ui`、`git diff --check`。
- 推送前检查 `git status --short`，确认没有真实记录、真实截图、导出 JSON、Playwright 结果或本机临时文件。
- 产品、架构、隐私、发布存续等决策一旦落入 `docs/decisions.md`，应及时形成边界清晰的独立提交并推送，不长期只留在本地；不得顺带混入无关工作区文件。
- 正式版本推送到 `main` 后，必须创建并推送同版本 Git tag（例如 `v16`），让 GitHub 上有稳定发布锚点。
- 正式版本 tag 推送后，必须创建或更新同版本 GitHub Release；release notes 简短列出用户影响、内部治理和验证结果，不贴真实数据或截图。
- 除非用户明确要求，不把无关重构、真实数据或工作区外文件混进同一个提交。

## 当前版本

当前版本：`timelog-v85` / manifest `version: "85"`。

改动 `index.html`、`sw.js`、`manifest.webmanifest` 或新增运行时资产后，必须同步：

1. `sw.js` 的 `CACHE = 'timelog-vN'` 声明
2. `manifest.webmanifest` 的 `version`
3. `sw.js` 的 `FILES` 运行时缓存列表
4. `scripts/project_audit.py` 的 `EXPECTED_VERSION`、`REQUIRED_RUNTIME_ASSETS` 和运行时 import 检查列表
5. `src/ui.js` 的 `APP_VERSION`（更多 sheet 底部展示的版本号，audit 脚本校验同步）

运行时资产必须进 SW 缓存；文档和开发脚本不进缓存。

六处版本锚点（上表 1/2/5 + CLAUDE.md 当前版本行 + README Release 行）可用 `python3 scripts/bump_version.py <N>` 一键联动；CHANGELOG 行与 `FILES` 清单属内容判断仍需手动，脚本会在锚点漂移时拒绝改写任何文件。

## UI 红线

- 响应式默认用 container query、CSS Grid/Flex 和文档流布局；禁止按 iPhone/iPad/设备名堆叠 viewport 补丁。
- Header 排版固定为三行信息架构：第一行站点标识（图标即 GitHub 入口）和「···」更多入口；第二行天/周/月/年视图切换；第三行 `< 当前周期 >` 与回到今天按钮；不要把日期导航塞回第一行；说明入口在「···」更多菜单里，不放回 header。v46（R5）：回到今天/本周/本月/今年按钮**条件渲染**——只在当前周期已不含今天时出现；`.date-nav` 用 `:has(#today-btn[hidden])` 在 ≥430px 断点收窄 grid 列数，避免显式轨道在按钮隐藏后留死区。当前周期含今天时，`#period-label` 内追加常驻 `.period-today-badge`（「今天」高亮字样）。「···」按钮改 `iconSvg('more')`（三点，零长度 round-linecap 描边），app.js `registerActions` 一次性注入（唯一不走 JS 模板渲染的图标按钮）。
- 低频动作（摘要、备份四项、标签高级设置、主题、启动诊断、说明）收纳在「···」更多 sheet 的 cell 分组里；footer 已退役，不得重新引入常驻底栏；分享 cell 与复制/存储/导入一样**常显**（v43：不再按能力检测显隐——旧 reveal 时序在 footer→更多 迁移后丢失、iOS 卡隐藏态，P24），点击时若无 Web Share 能力则回退下载完整备份。
- 窄屏第一行优先保留站点标识和「···」入口；空间不足时可以隐藏站点标题文字。
- Header 站点标识旁的里程碑（v61 起）**只从当前数据派生**，显示「记录历程第 N 天 · 已记录 N 天」：前者＝最早**非计划、非占位**记录到今天的自然日跨度，后者＝有真实记录的不同自然日数；逻辑集中在 `stats.js` 的 `recordingMilestones`，一条真实记录都没有时隐藏整块、不编造里程碑。计划条和空占位条永远不算「记过」（`normalizeEntries` 恒给今天留尾占位，不排除会让每天都算已记录）。因为派生自 `entries`，它随完整备份天然恢复，**不得**再改回依赖本机安装日。
- 「已记录 N 天」是机器可判定的「有真实记录的自然日数」，**不等于** `docs/dogfood-freeze-handoff.md` 的「有效记录日」（后者要求人工判断当天时间线是否足以重建主要活动），两者不得混用或互相冒充。
- `timelog.firstUsedDate`（本机首次使用日）**只做诊断**，不做用户里程碑：首次初始化写入，老用户以最早本机记录日期迁移，随完整备份导出/导入（v60），导入只允许往**更早**挪且拒绝未来日期。它不得出现在 header 或任何用户里程碑文案里——装了不等于记了。
- 静态壳的 `#usage-day` 必须为空且 `hidden`，由 JS 填充；`styles.css` 的 `body:not(.app-ready):not(.boot-restored) .usage-day{visibility:hidden}` 同时挡住冷启动露出，不得往静态壳里写死任何天数。
- 窄屏日期导航必须允许两行：上一段/周期/下一段一行，回到今天/本周/本月/今年独立一行；周视图窄屏周期标题可用短格式，完整日期保留在可访问标签中。
- 日视图时间轴是**连续日志容器**（v56，取代 v36–v55 离散卡片列表）：一整块贴地 `--card` 面（`.log`：hairline 边、无阴影——hero 仍是唯一带内容阴影的主表面），行按时间倒序（最新在最上），行＝时间｜内容｜时长三列网格。左缘 4px 通高桶色竖脊由 `data-b` 驱动：色相＝桶（与 hero 比例条同源），实色＝已发生、虚线（CSS mask 圆头胶囊，不支持时退化实色）＝计划、`--track` 灰＝未记录；发丝分隔线从 16px 起、放在不滑动的 wrapper 层，**不得横穿竖脊**（行行相接、竖读色序＝一天的形状）。今天视图在计划块与已发生块之间渲染「现在 hh:mm」一线（`.tl-now`，accent 呼吸点，`prefers-reduced-motion` 静止），非今天不渲染；tag 是素色 `#标签` 小字——桶色职责已移交竖脊，不得恢复彩色 tag 胶囊。点行编辑（行是 `role="button" tabindex="0"` 的 `div[data-action]`，键盘 Enter/Space 激活）；空隙行整行=补录；行内动作只留指向缺口/待办的 accent 文字链（`mini-btn` 无底色，44px 热区靠透明伪元素）：未记录/占位行「补一下」、计划行「标记已发生」、超长段「确认」；**已发生普通段的「切一刀」在编辑 sheet 内**（`cell-action` 按钮；行内禁止逐行常显动作词）。行自带不透明 `--card` 底（左滑时行滑过底部轨道，透明底会透出——v53 教训的行级版）；行入场过渡仍只碰 `opacity` 不碰 `transform`。**v48 区间编辑**：普通已发生记录编辑完整开始—结束，不能跨自然日、越过相邻记录或产生零时长；共享边界变化必须实时预览前/本/后三段。今日尾段可选「至今」或固定结束，固定结束后自动留下未记录尾段；计划记录仍只编辑计划时刻。**v48 切分**（入口 v56 迁入编辑 sheet）：打开时冻结原段边界，两端只允许在段内选择，预览内部/贴边/整段结果，禁止吞掉其它记录。**v48 删除**：应用内确认 sheet 显示确切结果；仅前后内容和标签完全一致时接回，其余已发生记录转同区间未记录，计划直接移除；成功后 8 秒撤销，检测到其它标签页修改即取消撤销。**v48 左滑轨道**：仅触摸/触控笔启用，水平轴锁定、跟手拖动并吸附到 2×72px「编辑/删除」，一次只开一张，纵向滚动或点空白关闭；桌面和键盘继续点行编辑、编辑页删除。右下角 FAB 与 hero 结论卡保持 v47/v55 规则（v56 起 hero 大数字 36px、仍为墨色）。
- 阶段格言（v69，C13）：`#motto-line` 只在日视图、hero 结论卡与时间轴之间显示；三态逻辑全部在 `storage.js`（`DEFAULT_MOTTO`/`normalizeMotto`/`resolveMotto`——键缺失=默认、空串=显式隐藏、非空=自定义，60 字上限，恰等于默认归一化回未设置）；文案只经 textContent/`esc` 注入，静态壳保持空 + hidden（同 `#usage-day` 纪律，不得写死文案）；隐藏态唯一入口是「···」更多的「阶段格言」cell；motto sheet 召唤键盘走 tall + returnToMore；`.motto-line` 是 `display:block` 按钮，`[hidden]{display:none}` 让位规则不得删除。v1 边界（D11 锁定）：不做多条轮换、按阶段自动切换、格言历史。
- 表单 sheet 只按宽度适配：`>=720px` 居中 dialog，`<720px` bottom sheet；不要用 `pointer:fine` 决定视觉布局。
- 统一 sheet 头部语法：抓手条 + 左「取消/关闭」右「完成/保存」文字按钮 + 居中标题；正文低频列表用 cell 分组（inset 底 + 内分隔线）；cell 分组容器用块级流布局、不用 grid——iOS WebKit 对 grid auto 轨道内 button 的 min-height 计量有缺陷，会累计裁掉最后一行（P21）。**正文层同理（P34，v63）**：承载 cell-group 的 sheet 正文不得让分组坐在会被压缩的 grid/flex 轨道里——`.form-sheet-body` 的 grid（min-height:0 flex 子项）在内容超过面板可用高度时会把 auto 轨道压到低于内容高，分组的 `overflow:hidden` 随即拦腰裁行（双引擎可复现，非 iOS 特有）；更多正文已改 `.form-sheet-body.more-body{display:block}`（复合选择器压过后文同优先级 `display:grid`），超高由正文滚动接住；矮视口（375×600）+ 最大内容量的回归测试同时锁更多与标签设置两处。
- 时间选择器只按宽度选择 wheel/desktop picker；打开表单后跨断点 resize 或旋转屏幕时，必须按当前宽度重挂载，不能停留在旧 picker。
- 禁止 `title=`，避免原生 tooltip 与自定义 tooltip 叠加。
- 可见文字按钮不强制 tooltip；图标按钮必须同时有短 `data-tip` 和 `aria-label`。
- tooltip 默认不能生成会撑宽页面的盒子；tooltip hover 延迟 800ms 后显示，移开立即隐藏；`focus-visible` 必须无延迟显示；触屏不能靠 hover 触发 tooltip。
- 图标语义固定（v47 起日视图卡片已无常驻图标按钮——点整行编辑、删除进编辑 sheet；此规则约束将来若再引入图标处）：编辑=铅笔，删除=垃圾桶，取消=回退/撤销箭头，关闭只读页=细线 ×。当前运行时 `iconSvg` 实际使用 `more/edit/trash`；不存在 `check` 定义，保存使用文字按钮。
- 删除/取消禁用 x、`×`、`✕`，包括图标定义、按钮文本和渲染模板。
- 输入字号不低于 16px，避免移动端聚焦放大。
- 统一表单 sheet 打开后先把焦点收进 sheet 容器，首个 Tab 进入内部控件；“做了什么”是 textarea，Enter 必须换行，只有 Cmd/Ctrl+Enter 或「完成」按钮保存；定时刷新不能打断新增或编辑中的输入。
- v46（R1）：sheet 关闭走 class 驱动过渡（`.sheet-closing`）+ `transitionend`/320ms 兜底后置 hidden，与进场 `@starting-style` 对称；`sheetCloseCleanup` 挡重入（关闭动画未播完又被重开/重关时立即收尾旧的，不留悬空定时器）；`prefers-reduced-motion` 下直接同步隐藏。
- v46（R3）：编辑态时间选择默认折叠为触发行（点击展开滚轮），与新建态一致；计划编辑（时间本就是核心可改项）例外，始终展开。校验失败但触发行仍折叠时，先展开触发行再显示错误，不能把报错文案落进看不见的容器里。
- v46（R7）：切视图/切周期后内容方向性滑入（280ms，`app.js animateContentEnter`）；列表卡片入场淡入（140ms，纯 `opacity`，`.entry` CSS `@starting-style`）——刻意只过渡 `opacity` 不碰 `transform`，因为 `transform` 是左滑手势（v45）的驱动属性，两者共用 transition 会让拖拽跟手变成带延迟的动画。均不做 FLIP／逐项 diff。
- v53 刷新接帧：每次主渲染后把 `.app` 与 FAB 的已转义 DOM 写入同标签页 `sessionStorage['timelog.bootSnapshot.v1']`；`index.html` 在 ES module 到达前同步恢复该快照并加 `.boot-restored`。只有数据/config/视图/日期/记录模式/自然日仍一致才恢复；命中后 `init()` **不得再首轮 render**。左滑「编辑/删除」轨道默认 `visibility:hidden`，只在真实拖动或吸附打开时显现，禁止依赖上层卡片合成层遮盖，避免 Safari 刷新时底层轨道透出。快照不跨标签、不进备份、不替代 `localStorage` 权威数据。
- 移动端「更多」短 sheet 的抓手必须可下拉关闭：只从 `.sh-grab` 的至少 44px 高真实命中区响应触摸/笔，短拖回弹，拖动 ≥72px 或快速下甩关闭；正文滚动、桌面布局和新建/编辑等高表单不接管该手势。
- 进行中时长必须按分钟刷新；iOS PWA 从后台恢复时，`visibilitychange`、`pageshow` 或 `focus` 必须立即按当前时间补算并重建分钟 timer，不能等待下一轮或信任暂停前的 timer id。
- v57 新增入口按本地自然日分类：历史日强制已发生；今天沿用并可切换 `timelog.recordMode`；未来 `+1…+7` 日强制计划且不得改写今天偏好；`+8` 日起隐藏 FAB/底部渐隐层，但既有计划仍可查看编辑。计划时刻必须严格晚于 `now +5min`，且早于本地“今天 +8 日 00:00”；编辑既有计划时，只有规范化时间与同一次 `load()` 取得的最新 `ts` 完全相同，才可跳过整个窗口校验。
- v57 过夜续记只由数据形态触发：日视图恰好停在昨天、尾点为未记录 placeholder、且从 FAB 普通新增时，表单显式选择“到今天硬终点”或“只记到 24:00”。跨午夜原子写成昨/今两条日内记录；提交前必须在同一次最新 `load()` 对象图上重算签名，计划占用必写边界时不得移动或覆盖。
- `#boottrace=1` 只用于启动分段诊断：无 fragment 时不得创建 HUD、监听器、timer 或持久化诊断状态；HUD 只能在 `app-ready` 后挂到 `.app`/FAB 快照范围外，且不得显示记录内容、标签或备份数据。不得用 query 触发、不得改 SW 缓存策略或 `FILES`。**v62 起唯一的持久化例外**是「更多」里用户显式开启的启动诊断（P33 真机取证，fragment 带不进主屏 PWA 冷启动）：开启后每次启动向 `localStorage['timelog.bootDiag.v1']` 追加一条**只含计时、布尔、缓存命中数、固定枚举 SW 注册态（v68 诊断 v2：`i/w/a:Worker.state` 模块顶早读）与首绘毫秒**的样本（环形 ≤30 条，附距上次打开的间隔分钟数），绝不含记录内容、标签或备份数据，不进备份；关闭即整键删除样本；默认关闭时不得有任何读写、监听器或 timer。

## 隐私红线

- 公开仓库不得含真实记录/真实截图/具体个人线索。
- 不提交导出的 `timelog-*.json` 或真实备份 JSON。
- 只发布 `time-logger/` 独立仓库与 `wowayou/time-logger-site` 部署镜像（D12：镜像只含 `scripts/build_site.py` 生成的产物，禁止手工维护业务代码、不得含密钥或用户数据），不发布父目录、`toolkit/`、`archive/` 或本机路径。
- README 和使用文档只能描述边界与用法，不写真实公司、个人进度或截图线索。
- README 演示图只能来自 `docs/assets/` 的固定 demo 数据 PNG，不得用真实 `localStorage` 或真实个人记录截图。
- `docs/assets/` 是仓库里唯一的 PNG 白名单目录（`.gitignore` 全局忽略 `*.png`），因此它同时是「最容易被当垃圾桶」的目录：新增任何 PNG 必须同步登记进 `project_audit.py` 的 `REQUIRED_DEMO_ASSETS` 或 `ALLOWED_DOC_ASSETS`，audit 会拒绝未登记的图。当前 `ALLOWED_DOC_ASSETS` 只含 3 张 icon-proto 评审渲染（合成图标，无真实记录）；登记用显式文件名，不用通配。

## 代码约定

- 纯原生 HTML/CSS/JS，使用浏览器原生 `type="module"`；不要引入打包步骤。
- 日期值统一 `YYYY-MM-DDTHH:mm`。
- 颜色走 CSS 变量；按钮白字 `#fff` 可保留。
- 尺子未记录段用 `--track`，不用 `--border`。`.ruler-bar` 分段缝背景用 `--border`（不用 `transparent`——透出父级 `--card` 会导致两主题缝的视觉重量不一致，v46 新发现）。
- 统计以分钟数为权威值：`job` / `maintain` / `leak` / `unrecorded` / `pending` / `total` 先累加分钟；百分比只用于展示，不反向参与统计，不强行凑满 100%。
- 标签 taxonomy 固定 4 桶：主线 `job`、维持 `maintain`、偏航 `leak`、未记录 `unrecorded`。桶在渲染/统计时由 tag→bucket 映射派生；孤儿 tag 落未记录。**第三桶 v69 起显示名为「偏航」，内部键仍是 `leak`**（存量 config/备份/CSS 令牌 `--leak`/`.chip-leak` 全按键走，改键＝数据迁移 + 旧备份读不回，明确不做）；语义是「偏离当前主线的时间」，不含道德评判——帮助页必须保留「偏航不等于错误、适时放空是必要的、可在标签高级设置改桶」这层意思，不得回退成「逃避娱乐」式措辞。
- 本地自然日 00:00 是统计硬边界；空日不继承前一天最后标签；有明确右邻记录的跨日闭合段会切入后续日期；有首条记录的日期从 00:00 到首条之间计为未记录；周/月/年汇总按每日独立统计累加。
- 超过 3h 的非 `longOk` 明确标签段确认只绑定 `longConfirm.startTs` 和 `longConfirm.endTs`；相邻时间变化或中间补录自动失效，改成另一个明确标签不自动失效；跨日闭合段使用真实右邻作为确认结束，没有右邻时才使用本地日边界。默认只有“睡觉” `longOk:true`。v67（C7A）：过夜续记（`planOvernightContinuation`）写入时即对超阈值段落 `longConfirm`——显式双端断言视为已确认，不再落待确认；「只记到 24:00」模式与普通补录**不**自确认；起点被 coalesce 并入前段时标记随点消亡。
- 时间戳是本地壁钟值，不做时区转换；跨设备导入可根据备份 `meta.sourceTimezoneOffsetMinutes` 建议“整体平移 ±N 小时”，用户仍可覆盖。
- 续记模型以所看日期为准：空日默认从 00:00 开始；有记录日按**尾点形态**分流（v77）——尾点是空占位条（或今天的进行中段）时默认续该点、FAB 文案「续 hh:mm 起」；尾点是**真实记录**时那天已被它覆盖到 24:00、没有可续之物，默认取**其后一分钟**、文案改「补记 hh:mm 起」（旧行为返回该记录自身的 ts，默认值恒撞同刻冲突，点进去必被拦）；尾点压线到 23:59 时当天不存在合法新增起点，**隐藏 FAB**，绝不把默认值越过午夜写进第二天。补录到已有右邻记录之前时结束点吸附右邻；今天无右邻到当前时间，非今天无右邻到 24:00。
- 数据只存在 `localStorage['timelog.v1']`；标签配置只存在 `localStorage['timelog.config']`。
- **标签同一性按 `tagKey()`（`trim().toLowerCase()`）判定，不按逐字相等**（v85）：`sleep` 与 `Sleep` 是同一个标签，桶归类、longOk、计数、迁移、录入去重、导入占位一律走它；用 `toLowerCase()` 而非 `toLocaleLowerCase()`（后者随设备语言变，标签是数据）。但 `normalizeConfig` 的**去重仍逐字**——存量并存的两种拼写要留到标签设置里显式「合并」，数据层不得静默丢弃或改桶。
- 复制/存储/导入/分享都是完整备份，导出前按 `ts` 升序排序；摘要只代表当前视图；所有动作都在浏览器本地完成，不上传。iPhone/iPad 的「存储备份」优先文件分享面板，让用户明确选择「存储到文件」和目录；取消不得暗中回退下载，能力不足或非 Apple 移动平台才走浏览器下载。
- 区间编辑、切分、删除必须先由 `entry_model.js` 的事务 planner 生成 `resultEntries` / `resultSignature`；UI 预览与最终保存共用同一规则，提交前必须基于最新数据重算，结果变化时要求再次确认。
- 导入必须整批预检：字符串 ID、合法时间、内容、标签及可选字段全部校验；完全相同记录跳过，同 ID 不同内容或同时刻不同记录阻止整批导入并列出冲突；本机同名标签配置优先，导入新增标签只追加。
- 导入冲突 UI 禁止暴露内部 ID 或堆叠原始错误句：逐条显示「备份中 / 本机中」内容、时间和标签，并提供「保留本机 / 使用备份 / 合并文字」。合并文字只合并 `what`，保留本机 ID、时间、标签、计划/进行中与确认状态；不提供静默 `+1min` 的“两条都留”。全部冲突有明确选择后才允许原子提交，提交前基于最新本机数据核验选择签名，变化则要求重选。
- 分享备份按钮始终渲染；优先文件分享，退化为文本分享，再退化为下载。用户取消不得触发下载；对象 URL 延迟释放。Service Worker 安装预缓存任一失败即拒绝安装，激活必须等待旧缓存清理和 `clients.claim()`，fetch 只处理同源 GET；waiting worker 只提示，用户点击后才 `skipWaiting`。

## 产品硬约束（D13，2026-07-24 固化）

任何新功能/改动不得破坏以下四条（已成立，视同红线）：

1. **首次打开即用**：无强制 onboarding，不要求先创建工作区/项目/标签体系（默认四桶 chips 起步）。
2. **离线照常记录**：核心记录流程离线完全可用（SW cache-first）。
3. **AI/自动化不得悄悄修改原始时间线**：原始记录是权威事实，任何自动处理只能建议、预览、经用户确认。
4. **导出不依赖付费或云端账号**：完整备份永远本地免费可得。

第五条「**约 5 秒完成一次记录**」当前未达标，是军令状而非现状：记录侧一切候选（语音、一键延续等）统一按「是否让中位记录耗时逼近 5 秒」裁决，不逐个功能辩论。

核心定位（工作假设，对外文案与主页以此为准）：**「5 秒记下真实做了什么——本地、离线、可信的一天时间线」**。禁止对外声称市场需求已被验证。

## v2 锁死 & 别镀金

在累计 **28 天真实记录**之前：

- 不做可扩展分类法
- 不做人类报表 / 更多图表
- 不为滚轮像素手感无限打磨
- 不引入跨设备同步、登录、云端

最大风险 = 用打磨工具逃避面试推进。如果用户或 AI 在没有充分求职进展的情况下要求继续打磨功能，请明确指出这一风险。

### 当前更严格的约束：14 天功能冻结（2026-07-16 → 2026-07-29，GMT+8）

> **2026-07-24 终止（D13）**：维护者明确决定**提前终止本冻结**，转入「基础发版 + 上线推广」冲刺（域名迁移三步序列、定位文案、首轮中文社区推广）；多模型协作模式（Fable 定规格/验收、Sonnet 5 等执行、维护者做人肉步骤）与产品硬约束见 `docs/decisions.md` D13、`docs/collab-protocol.md` 与 `docs/launch-runbook.md`。28 天 gate 与别镀金条款对**功能扩张类** roadmap 继续有效；隐私红线、铁律、版本仪式、自测清单不变。以下冻结条文保留作历史边界记录。

> **2026-07-18 修订（D10）**：维护者因 AI 协作窗口临近关闭，决定**定向提前处置**部分候选——C11（开发期工具）与 v67（C8 文案 + 死 export + C7 方案 A）提前执行；其余候选（C1–C6 语义改动、C3/C4/C5/C9/C10）**继续冻结**，07-30 复盘照常举行。28 天 gate、别镀金与求职硬约束不变。详见 `docs/decisions.md` D10。

冻结期内**上述 28 天 gate 不是当前门槛，本冻结才是**（决策见 `docs/decisions.md` D9 与 D10 修订，执行边界见 `docs/dogfood-freeze-handoff.md`）：

- **只允许修阻断级问题**：数据丢失/损坏、保存提示与真实状态不一致、无法打开、无法进入记录流程、无法创建/编辑/补录/撤销、无法导出完整备份、无法在空环境导入恢复、离线核心流程完全不可用。
- 即便是阻断修复，仍需复现证据 + 最小改动 + 回退方法 + 自动化测试 + 维护者明确批准。**发现问题不等于自动获得编码权限。**
- 冻结期新想法**只记录为候选**，不排期、不估时、不顺手实现。
- **达到 28 天真实记录只表示可以重新评审，不自动解锁 roadmap**；14 天内任何新功能仍需等待 2026-07-30 阶段复盘。
- 外部用户验证已延期且**尚未开始**——不是通过也不是失败。任何文档或对外表述**不得声称市场需求已被验证**。
- 本阶段并行的硬约束是求职外部结果（10 次高质量投递 + 1 个作品集案例）。**作品集不是新增功能的理由。**

## 改动自测清单

每次改完至少跑：

```bash
python3 scripts/project_audit.py
python3 scripts/confirm_logic_smoke.py
npm run typecheck
npm run test:ui
git diff --check
```

浏览器手动检查：

1. 桌面鼠标 hover 图标按钮约 800ms 后只出现自定义 tooltip，移开立即隐藏；键盘 Tab 到图标按钮时 tooltip 立即出现，不出现原生 title。
2. sheet 头部为「取消/完成」文字按钮；取消不是 x，删除不是 x（删除是编辑 sheet 内的「删除这条」文字按钮）。
3. 移动端新增/编辑输入不自动放大；textarea 回车换行，Cmd/Ctrl+Enter 或「完成」保存。
4. 新增或编辑时，定时刷新不打断输入；无数据变化的 60s tick 不重绘页面。
5. 日视图 hero 结论卡显示主线净时长大数字 + 偏航次要数字 + 比例条 + 辅助行（维持/未记录/截至）；周/月/年 ruler/摘要显示主线、维持、偏航、未记录 4 桶；睡觉 6h 不待确认，吃饭 6h 待确认。
5a. 亮色+暗色各打开一次带滚轮的 sheet（新建/编辑/补录），选中行文字可见、不被高亮带涂掉（P22）。
6. 同时刻新增出现内联冲突提示，可编辑原条或用 +1min。
7. 「···」更多菜单里存储、导入、分享、摘要、复制均可用；iPhone/iPad 存储优先打开文件分享面板，用户取消不下载，桌面仍直接下载；分享依次验证文件→文本→下载。导入冲突逐条选择保留本机/使用备份/合并文字，平移修改实时重算，未全部处理不写入；最新数据变化会使旧选择失效。从「更多」下钻进入标签设置/说明/导入检查后，取消、保存、Esc、点遮罩都回到「更多」。
7a. 标签高级设置的建/删（v82/v83）：每组底部「＋ 新建标签」插一行草稿，保存才落库、取消整单作废，空草稿视为没建；新建主线排在历史末尾不顶掉当前主线；`未知` 被拒。删除：只有零记录标签（主线与 chip 同一判据）显示「删除」，有记录的行只显示「N 条记录」；点删除后行变灰、按钮翻「撤销」，保存才生效、取消整单作废；清空名称是内联报错而不是悄悄删行；删空一组显示空态提示。
8. PWA 更新链路：改 `index.html` 后升 CACHE 号；冷启动和回前台会检查更新，旧页面出现“更新应用”且按钮不被 FAB 遮挡；只有点击后才加载新版，本机 `localStorage['timelog.v1']` 保留。点击后 8 秒内 `controllerchange` 与 `statechange→activated` 都没来时，横幅必须转为「完全退出后重开」指引（可「知道了」收起），不得无声装死（C1/v64）。离线预缓存失败时旧 worker 继续服务。
8a. Safari 同标签刷新：人为延迟 `src/app.js` 时，模块到达前仍显示上一帧；模块到达并进入 `app-ready` 后，快照时间轴节点必须保持同一 DOM（sentinel 不丢），证明没有首轮重建；不得露出静态「回到今天」、空内容壳或二次卡片/FAB 动画。首次访问无快照时仍走正常启动门闩。
9. 午夜后重开仍停在上次所看日期；历史日续记无右邻时结束显示 24:00，不漏到当前时间。
9a. 日视图 hero 下方显示阶段格言（未设置＝默认句）；点行可编辑，清空保存后行消失且「···」更多里「阶段格言」仍能重新设置、「恢复默认」可回默认；周/月/年视图不显示。
10. 日视图连续日志（v56）：`.log` 单容器、竖脊通高不被分隔线打断，实/虚/灰对应已发生/计划/未记录；今天有「现在」一线、历史日没有。普通记录点行编辑完整起止时间并实时预览前/本/后三段；今日尾段可在「至今/固定」间切换；切一刀从编辑 sheet 进入，覆盖内部/贴边/整段；删除确认覆盖接回/转未记录/移除计划，8 秒撤销遇跨标签修改会失效。触摸/笔左滑揭示 2×72px 编辑/删除轨道，纵向滚动、点空白和打开另一张会关闭；鼠标不触发手势，键盘 Enter/Space 仍点行编辑。
11. 新建/编辑 sheet 点「做了什么」呼出键盘：sheet 头部（取消/完成）置顶常在、键盘开合时面板几何一动不动（v43：`.form-sheet` 恒定满视口、`.tall` 面板定高、头部 `sticky`——不再随键盘缩放，故无任何跳变/悬停/裸露）；焦点控件自动滚到键盘上方；点键盘「完成」收起键盘只是键盘离场，面板不动；两个文本框之间切换焦点也只滚动、不移面板。禁止再引入随 `visualViewport` 移动/缩放整个 sheet 的方案（P16–P23 连修六轮的根源）。

响应式手动矩阵：

1. 320-375px：header 第一行不横向溢出，标题可隐藏；date-nav 两行不溢出；时间轴行不溢出。
2. 360/390/412/430px：不刷新页面连续切换宽度，header/date-nav/时间轴行立即自适应。
3. 768px：sheet 居中，内容不被遮挡。
4. 横竖屏切换：打开新建/编辑 sheet 后切换宽度，时间 picker 使用当前宽度对应形态。
5. 存储/分享 cell 常显：更多菜单里存储备份、分享备份始终在，分组不留空缝；iPhone/iPad 存储走系统文件面板，分享无能力时点击回退下载。
6. v48 FAB/提示层级：日视图右下角悬浮「记一条」保持窄屏 16px、宽屏锚内容列；非日视图隐藏。更新提示和撤销提示必须可见且可点击，不得被 FAB 或渐隐遮罩覆盖。

## CHANGELOG

> v1–v65 的历史条目已移至 `docs/CHANGELOG.md`（2026-07-25，D15 额度治理：本文件是三个模型每次会话都要整读的「法律」，历史流水不必每次付费）。
> **红线、边界、仪式条文全部留在本文件**，只有已归档的版本流水外移。本表保留最近八个版本。

| 版本 | 日期 | 变更 |
|---|---|---|
| v85 | 2026-08-04 | **标签合并 + 大小写不敏感的同一性**（D20 文末受理项；触发是维护者的「`sleep` 和 `Sleep` 应该算同一个吧」与中英标签并存的真机截图）。排查先挖出比反馈更严重的一层：**今天根本没法合并两个标签**——把 `Sleep` 改名成 `睡觉` 会被「重复了」拦下，出口是 v80 自己堵死的，而 v78 的按 locale 种子 + v80 的「添加本语言的默认标签」正好制造了并存。**同一性判据**新增 `tagKey()`（`trim().toLowerCase()`），一切「这两个名字是不是同一个」的比较改走它：`bucketForTag`/`longOkForTag`（记录里存的是当时敲的拼写，只差大小写不该掉进未记录）、`countEntriesWithTag`/`migrateEntryTags`、`addMainlineTag`/`addChipTag`（录入不再长出第二个）、`mergeImportedConfig` 与 `previewLocaleDefaultTags` 的占位判据（备份里的 `SLEEP` 遇上本机 `Sleep` 直接跳过）、三个主线事务。**刻意用 `toLowerCase()` 而非 `toLocaleLowerCase()`**：后者随运行环境语言变（土耳其语的无点 i），同一份数据在不同设备上会得出不同答案，而标签是数据。**同样刻意不折叠的地方**：`normalizeConfig` 的去重仍逐字比较——第一版顺手让它也折叠，结果存量并存的 `sleep`/`Sleep` 在**加载时**就被静默丢掉一个（用户没同意，两者桶/longOk 不同还会悄悄改历史归类），而且设置页因此看不到冲突、合并入口反而无从触发。数据层不合并，只有显式动作才动。**合并**：重名判定改严必须同时给出口，否则存量并存的 config 每次保存都被拦死（这正是两条必须同批的原因）。`saveTagConfig` 检出折叠冲突后生成合并计划——方向判据 ① 恰好一边被改名→被改名的是来源；② 两边都没动（存量并存）→ **按逐字计数**留下用得多的拼写（同一性计数在这里会得出相同数字、分不出方向，故新增 `countEntriesWithExactTag`）；③ 来源必须是已落库的行，草稿行撞名退化为普通重名错误（那是「别建这个」不是「要合并」）。提示给确切后果（「「{from}」的 N 条记录会归到「{to}」」，N 用 `countEntriesNeedingRetag`——已经是目标拼写的不计，免得夸大），带**显式「合并」按钮**；签名 `from→to#N` 按最新 `load()` 复算，确认期间数据变了就重新问一次。记录侧新增 `canonicalTagName`：敲 `sleep` 而 config 是 `Sleep` 时记录存**权威拼写**，否则时间轴 `#sleep`、设置页 `Sleep`，同一个标签两副面孔。新增 `tests/tag_merge.spec.js` 6 条 + **五处 P35 红灯**（判据退回逐字→4 条红、撤掉合并出口→2 条红、不复算签名→红、允许草稿行合并→红、不做拼写规范化→红）。零新增运行时资产（`FILES` 不变）。 |
| v84 | 2026-08-04 | **真机验收反馈批次**（v82/v83 首轮真机验收，维护者结论「基本可以」+ 8 条反馈，清单与去向存档在 `docs/device-acceptance.md`）。① **空名报错把人甩到页面最底部**（v83 缺陷）：`showInlineError` 只会把错误条滚进视野，而它挂在正文**末尾**——判据本身错了，报错该定位**出问题的那一行**。新增可选 `focusEl` 参数，标签设置的四条校验（空名/保留名/重名/删除被拦）各自传出错行，滚它并聚焦它的输入框。② **撤销横幅停留太长**（维护者选方案 b）：8 秒上限不动，但**下一次交互**（滚动/指针按下/按键）即收起，撤销随之结束——「你已经在做别的事了」比倒计时更准。宽限期 350ms 与 sheet 关闭动画同源（确认删除时面板正在收起，那一段的滚动余波不算数），且**用定时器实现而非 `Date.now()` 差值**：测试夹具把 `Date.now()` 冻在固定时刻，任何基于时钟差的宽限判据在那里恒为 0、守卫静默失效——第一版正是这么写的，用例变红才逮到。副作用如实记录：v82 的「删标签让待撤销失效」守卫**在 UI 上不再可达**（要进标签设置必先点「···」，那一下已结束撤销窗口），守卫代码保留为防御，用例改为断言当前事实，不假装还能触发。③ **「更多」面板太长**（13 行 + 3 段说明 → **9 行**）：备份四项下沉到「备份与导入」、修复更新通道与启动诊断下沉到「高级」，两张二级页复用既有 sheet 机制（短 sheet、抓手可下拉关闭、只读 origin 判据照旧）。**v41 的返回栈从布尔升级为栈**——「更多 → 备份与导入 → 导入检查」有两层，布尔只记得住一层，关掉导入检查会一路关到底；同时补上「原地重渲染同一层不压栈」（切主题/语言、开关启动诊断、设为当前主线都走这条，少了它每按一次就多压一层）。`toggleBootDiag` 改重渲染「高级」而不是弹回「更多」。④ **hero 的 `~`**：查出它**只存在于中文路径**（英文 `fmtMinsEn` 从来没有），即不承载任何英文没有的信息，去掉后两语言一致、hero 干净；7 处既有断言随之更新。⑤ **Android S23 退出动效白边**（维护者反馈，暗色下仍在，排除了「亮色页面 vs 深色 `background_color`」）：候选修复是 **`color-scheme` 从未声明**——缺席时 UA 按 light 画它自己的表面，包括**合成器的基础背景色**，而窗口被系统缩放时未绘制区域正是用它填充。四处令牌块各配一处声明（默认暗 / 跟随系统亮 / 显式亮 / 显式暗）；**必须四处都写**：「跟随系统」时根本没有 `data-theme` 属性，只挂 `html[data-theme]` 上等于对大多数用户不生效（红灯用例锁死这一点）。真机确认仍需维护者再录一次。新增 `tests/v84_polish.spec.js` 7 条 + **六处 P35 红灯**（撤销不随交互收起→红、报错回到只滚错误条→红、`color-scheme` 只挂 data-theme→红、`~` 回归→红、返回栈退回布尔→红、备份项塞回主面板→红）；`tests/ui_fixture.js` 新增 `openBackupSheet`/`openAdvancedSheet` 两个 helper，既有用例按二级页调整（含 P34 矮视口用例改为**逐层**检查：主更多 + 高级 + 标签设置三处）。零新增运行时资产（`FILES` 不变）。 |
| v83 | 2026-08-03 | **建/删对称：标签高级设置里可以新建标签了**（维护者真机录屏：翻遍设置页找不到「新建标签」）。**先回答「是不是有意的」：是**——标签一直只在记录时长出来（写自定义标签即按当时选的桶记住），设置页被 SPEC-007 明确划定为「管理已有的」，依据是 D13 硬约束①「首次打开即用」与「别镀金：不做可扩展分类法」。但 v82 加了删除之后，这张 sheet 能改名、改桶、设当前、删除，**唯独不能建**——正是维护者上一条反馈的同一类不对称，镜像过来而已；且页面上早已有个半吊子的「添加本语言的默认标签」，它只会追加固定那一套。故按维护者拍板补齐（D19 补充）。**做法**：每组底部一行「＋ 新建标签」，点了在**本组内**插一行草稿（`data-new="1"`，桶由所在组决定），名称/桶/longOk 与已有行走**同一套保存事务与校验**；草稿行右槽是「移除」而不是 v82 的待删除态——从未落库的东西没有「撤销」可言。**四条边界**：① 空草稿＝没建过（点了「新建」又没写名字直接忽略），而**已有行**的空名仍是错误——两者判据相反是有意的，后者一旦丢掉就是删除；② 新建主线名追加到历史**末尾**，不顶掉当前主线（要当前得显式点「设为当前」）；③ `未知` 是 unrecorded 桶的保留名（`bucketForTag` 直接判它未记录），新建与改名同一处拦下——此前改名路径就没拦，属顺带修掉的既有洞；④ 插入草稿**不重渲染整张 sheet**，否则会丢掉别的行里还没保存的改名/勾选。**实现**：`mainline` 改为**按行重建**（`mainlineRows.map(row => row.name)`）——行序即数组序，改名/删除/新建三件事一次落齐；`setMainlineLongOk` 只认已在 `mainline` 里的名字，故 longOk 写回必须移到数组定稿**之后**（这条顺序依赖单独有红灯锁）。行内两个零件（longOk 勾选框、桶分段控件）提到模块层供草稿行与已有行共用，两条路径必须逐字同构，否则保存时的 `querySelector` 会在其中一条上落空。空组仍留空态提示，但组本身不再是空盒（多了「新建」这一行），v82 的空组用例判据随之从「没有 cell-group」改为「没有标签行」。新增 6 条用例；**六处 P35 红灯逐一点亮**：摘掉「＋ 新建标签」→红、主线改回只过滤不重建→红、longOk 写回移回数组定稿之前→红、摘掉保留名守卫→红、空草稿改成与已有行同等对待→红、草稿「移除」改成空操作→红。同批清掉 `configSnapshot`（SPEC-007 移走 mainlineCollision 校验后它只写不读）。零新增运行时资产（`FILES` 不变）。 |
| v82 | 2026-08-03 | **标签生命周期对称：建得出来的就删得掉**（维护者真机反馈：为试一下而新建的「測試主線」一条记录都没有，却永远删不掉）。SPEC-007 当初「主线停用/删除不做」的理由写得很具体——「历史记录引用主线历史名，删除会产生孤儿标签」——**这条理由只在有记录时成立**，所以删除按「零记录」开放，而不是整类禁止（决策见 `docs/decisions.md` D19）。**判据**：`countEntriesWithTag(entries, name) === 0`。渲染时它决定行右槽显示什么（有记录→「N 条记录」，零记录→「删除」，二者互斥故行高不变）；保存时**按最新 `load()` 再算一次**——sheet 打开期间另一个标签页给这个标签记了一条就必须拦下（渲染时的判据已过期）。**删除是待生效的中间态**：点「删除」后行留在原地变灰、名称划线、控件禁用、按钮翻成「撤销」，真正生效在 sheet 头部的「保存」，「取消」则整单作废；不加确认弹层——零记录＝零数据损失，再加一层确认只是噪声。主线与 chip 走同一个入口、同一条判据（主线删除落在 `saveTagConfig` 里，按「留下的名字集合」过滤 `config.mainline`，残留 `mainlineLongOk` 由 `normalizeConfig` 清掉；chips 本就按行整体重建，行不在即等于被移除）。**顺带修掉反向的隐式删除**：清空名称一直等于悄悄删掉那一行（早于 SPEC-007），既不可发现，又会在 chip **有记录**时静默把历史打成孤儿标签、统计当场变化；现在空名一律内联报错（`config.emptyName`），删除只剩显式入口一条路。**同批放开 `config.keepOneChip`**：删空一组不再被拦（录入时写自定义标签就能重新长出来，tag picker 早有空桶提示），空组渲染一行空态提示而不是空的圆角灰盒；该 key 随之从 zh/en 两套 catalog 删除（`audit_i18n_keys_referenced` 死词条护栏强制）。**跨机制一致性**：删除生效会让还挂着的「撤销删除记录」失效（复用 `cancelUndoForConflict`）——否则 8 秒窗口内一撤销就把引用该标签的记录放回来，当场造出孤儿标签，正是删除守卫要防的东西从后门溜进来。新增 6 条用例、改写 1 条（`主线没有删除入口` 那句断言编码的是被推翻的裁决，改为「零记录行必须有删除入口」）；**五处 P35 红灯逐一点亮**：摘掉主线过滤→两条红、空名守卫改回静默丢行→红、摘掉保存时复算→红、摘掉撤销失效→红、空态提示改回永远渲染 `cell-group`→红。零新增运行时资产（`FILES` 不变）。 |
| v81 | 2026-08-01 | **跨应用缓存清理缺陷修复**（同源另一个 PWA 的维护侧报来，见 `docs/postmortems.md` P36）。`CacheStorage` 按 **origin** 分区、不按 SW scope——`wowayou.github.io` 上同时住着本项目的旧只读站与另一个 PWA（`/six-pm-sprint/`），`caches.keys()` 因此会列出对方的缓存；而 activate 的清理一直写作 `keys.filter(k => k !== CACHE)`，**把邻居的离线缓存一并删掉**。两边都静默失去离线能力，联网时表现完全正常，从表象几乎无法回溯到成因。已核实：对方 worker 已改前缀限定，本项目旧 origin 线上 `sw.js` 第 41–42 行确为该写法，报告属实。**共享 origin 上的本项目是 v76 起转只读的旧站，线上主站在 `time.eigentime.org/app/`（同源无第二应用），故当前伤害是单向的：我们删他们。**修法：新增 `CACHE_PREFIX = 'timelog-'`，清理改为 `k.startsWith(CACHE_PREFIX) && k !== CACHE`；`CACHE` 保持 `'timelog-vN'` 字面量形态不动（`bump_version.py` 与 audit 逐字匹配它，改模板字符串会打断六锚点联动）。两条护栏：`project_audit.py` 断言清理必须按前缀过滤且前缀与 `CACHE` 一致；新增 `tests/sw_cache_scope.spec.js` **真注册 Service Worker**（全局 block，该文件显式放开）种邻居缓存 + 自己的旧缓存，断言前者留存后者被删。P35 红灯：改回 `k !== CACHE` 后行为用例实测 `Received array: ["timelog-v80"]`——邻居缓存当场消失；audit 同时报 prefix 缺失。**写用例时的坑**：第一版用 `unregister()`+`register()` 催发第二次 activate，用例红了，差点被当成修复没生效；用「activate 时写缓存」的临时标记确证后发现 `unregister()` 在页面仍被控制时**延迟生效**，随后的 `register()` 只是取回同一注册、不触发 activate。改为注销后 `reload()`。 |
| v80 | 2026-08-01 | **SPEC-007**（D18 解 park）：标签高级设置重设计 + 主线可编辑。**数据层**：主线的 `longOk` 存成独立的 `mainlineLongOk: string[]` 而不是把 `mainline` 改成对象数组——`mainline` 是 `string[]` 这件事被 `addMainlineTag`/`bucketForTag`/`mergeImportedConfig`/`uniqueNames` 多处按值使用，改形态要动一大片并强制迁移存量 config；追加字段则「老备份没有它＝空集」天然成立、零迁移。`normalizeConfig` 只保留仍在 `mainline` 里的名字，改名/移除后的残留自然清掉。导入：新字段缺失合法，存在则必须是字符串数组否则整批拦下；合并取并集、本机条目不被备份删掉。三个主线事务（`renameMainlineTag`/`setCurrentMainline`/`setMainlineLongOk`）只返回新 config、不碰 entries——历史迁移由调用方在**同一次 `load()`** 的对象图上做（写路径红线 P1）。**D7 四类动作的裁决**按规格执行：改名做、`longOk` 做、改桶不做、停用/删除不做；另加「设为当前主线」（`config.mainline` 本就是 unshift 语义的历史数组，只是把既有语义放上台面）。**UI**：三分组（主线/维持/偏航）+ 行左缘 4px 桶色竖脊（`data-b` 与时间轴同源，主线行是整张 sheet 里唯一的 job 紫；历史行脊淡化 55%）；两段式分段控件替换原生 `<select>`——v78 之后尤其要紧，原生弹层不跟随应用语言，英文界面下会弹中文选项；`longOk` 换应用样式勾选框（仍是真 `<input type=checkbox>`，键盘与读屏行为白送，44px 命中靠透明伪元素）；切桶时竖脊即时跟随。**D18 新增范围**：「添加本语言的默认标签」显式入口——只追加、同名跳过、先预览再落库，绝不自动或在切语言时弹窗（SPEC-014 §1.5 的「切语言不动数据」不变）。文案全部走 catalog（zh/en 对等 553 键）；`cfg.hint` 长段落按规格拆开，「录入时先选桶…」移交帮助页。新增 `tests/tag_config.spec.js` 8 条 + 三条 P35 红灯（主线 longOk 判定摘掉→红；主线改名不迁移历史→红；只追加改成全部追加→红）。**第三条红灯第一次做时没点亮**，暴露的是测试本身假：只断言预览整体包含「睡觉」时，把「只追加」改成「全部追加」照样绿——`normalizeConfig` 按名去重并保留原有那条，把缺陷盖住了。改成方向性断言（同名必须在「将跳过」行、且**不得**在「将新增」行）后红灯才成立。既有用例 `config rename migrates…` 的 `.cfg-name.first()` 因新增主线分组而命中错行，改为按 `data-original-name` 显式定位（v73 已记过 `.first()` 掩盖真实定位的坑）。 |
| v79 | 2026-08-01 | 真机反馈修复（维护者截图）：**「更多」里隐私政策 cell 与同组其它 cell 长得不一样**——文字与右侧 `›` 一起被加了下划线。根因是 `.cell-btn` 从未设过 `text-decoration`：它一直只用在 `<button>` 上（UA 默认无下划线），v78 的 §1.6 隐私政策 cell 是本仓库**第一个用这个 class 的 `<a>`**，UA 的链接下划线随即露出。修法一行 `.cell-btn { … text-decoration: none; }`——**外观归 class 管、不归标签管**，此后再有别的 cell 用 `<a>` 也不会重犯。回归用例不只断言「没有下划线」，而是与同组「说明」cell **逐项比对**装饰线、x 坐标与宽度（只测前者的话，把整组都改成有下划线也能过）。P35 红灯：摘掉修复后实测 `Expected: "none" / Received: "underline"`，装回转绿。零 JS 改动、零布局改动、零新增运行时资产（`FILES` 不变）。 |
| v78 | 2026-08-01 | v78 合并批次（013+014+015 三部分同一次版本仪式；SPEC-013 已于 PR #34、SPEC-015 §1–§3 已于 PR #35 提前合并且均未 bump，本单是三者共同的发版）。**SPEC-014**：`src/locales/en.js` 新增英文 catalog（542 key，与 `zh.js` 逐一对齐），术语表锁定 **Focus/Upkeep/Drift/Unlogged**（App 名 **Eigentime**），语气规则（无感叹号、无 "Oops"/"Sorry"、按钮文案不加句号）。「···」更多新增语言开关（跟随系统 / 中文 / English 三选一 `.seg`，紧邻主题，写 `timelog.locale`）：切换后立即整页重渲染，不刷新页面；该开关只出现在「更多」sheet 里、当时没有任何未保存输入，故未额外做「有 sheet 打开时禁用切换」的分支。`document.documentElement.lang` 与 `document.title` 随之更新。`src/time.js` 按 locale 分流展示格式（唯一写代码而非填表处）：**zh 路径字节不动**，en 走 `Intl.DateTimeFormat('en-US', …)`（不传 `timeZone`，避免时区转换）产出 `Fri, Jul 31` / `Jul 28 – Aug 3` / `July 2026` / `2026`；`fmtMins`/`fmtPlainMins` 新增 en 分支（`3h 20m`/`0m`，与 zh 分支各自 early return、互不干扰）。`i18n.js` 新增最小 `plural(n, {one, other})` helper，仅用于「N day(s) logged」——连带把 `chrome.milestone`/`chrome.milestoneAria` 模板拆出 `chrome.recordedDayOne/Other`，zh 侧两形取值相同、最终拼出字节与改动前逐字相同（用 `tests/ui_smoke.spec.js` 既有断言核对）。**§1.5 默认标签种子（维护者拍板方案 B，2026-07-31）**：`storage.js` 新增 `DEFAULT_SEED_BY_LOCALE`，只在 `normalizeConfig(null)`（首次初始化、`timelog.config` 键缺失）按 `getLocale()` 选种；已有 config 的用户切换语言，chips**逐字不变**（P35 红灯证明：临时让切语言也重新种子 → 回归用例必须红）；导入不改标签名，一份 zh 备份进 en 设备后两套标签按名字共存、各自桶归类正确。**§1.6**（从 SPEC-015 §4 接手）：「···」更多说明分组新增「隐私政策」/「Privacy Policy」外链 cell（`more.privacy`），按 locale 指向 `https://time.eigentime.org/privacy/` 或 `/en/privacy/`，`target="_blank" rel="noopener"`；满足 App Store 5.1.1(i) 的「within the app」链接要求，不内嵌全文。新增三条永久 audit 护栏：`audit_i18n_catalog_parity`（zh/en key 集合必须完全相同）、`audit_i18n_en_terminology_guard`（`src/locales/en.js` 不得出现 Leak/Waste/Distraction/Unproductive/Wasted）、`audit_shell_dict_matches_catalog` 扩为按 locale 逐块比对（`index.html` 内联字典新增 en 块，与既有 zh 块同构）。**zh 零回归**：`tests/ui_smoke.spec.js` 272 条既有断言一行未改（只新增行）；新增 `tests/ui_smoke_en.spec.js`（7 条，覆盖 header/视图切换、FAB 「续」/「补记」两种文案的英文版 From/Backfill from、新建保存一条、四桶名 Focus/Upkeep/Drift/Unlogged、更多 sheet 与隐私链接、切回中文立即生效、SPEC-013 快照 locale 门在 en 下的实测）与 `tests/locale_seed.spec.js`（3 条，覆盖 §1.5 全新 en 安装种英文 chips / 已有 zh config 切 en 后 chips 不变 / zh 备份导入 en 设备两套标签共存）。`sw.js` `FILES` 新增 `src/locales/en.js`。**已知边界**：manifest 的 `name`/`short_name`/`apple-mobile-web-app-title` 保持中文不动（PWA 安装名跨 locale 切换会改现有用户主屏图标名，且属版本仪式六锚点之外的另一份清单，留给 D17 第三层由 App Store 的 per-locale 名称字段解决）；备份 JSON 不含语言（locale 是设备偏好，导入不得改语言，SPEC-013 已定）。**验收轮补充（方案 A，维护者拍板）**：v78 之前 `SUPPORTED_LOCALES` 只有 `zh`，`resolveLocale()` 的 navigator 探测分支从未真正生效；`en` 成为受支持语言的那一刻它第一次活了——**任何从未显式选过语言（＝全部存量用户，开关今天才出生）且浏览器偏好英文的设备，升级后会被静默切成英文**。新增 `ensureLegacyLocalePinned()`（`storage.js`），在 `init()` 里先于 `resolveLocale()` 运行，一次性把「已有数据（`timelog.v1` 或 `timelog.config` 存在）+ 无 locale 偏好」的设备持久化钉在 `zh`；**全新安装不受影响，仍跟随浏览器语言**。用独立标记键 `timelog.localeMigrated.v1` 而非复用「`timelog.locale` 是否为空」——用户之后可能显式选「跟随系统」，那同样会清空该键，复用会把这个明确选择误判成未迁移、每次启动强行按回中文。`index.html` 静态壳内联脚本同步同一条判据（含标记键），否则迁移那一次启动会先按 navigator 渲染一帧英文再被模块改回中文——正是 SPEC-013 建内联字典要消灭的闪烁。新增 `tests/locale_legacy_migration.spec.js` 两条**互相咬合**的用例（`test.use({ locale: 'en-US' })`）：回归「已有数据 + 英文浏览器 → 仍是中文」、对照「全新安装 + 英文浏览器 → 是英文」；双向 P35 红灯——摘掉守卫则回归红、对照绿，改成无条件钉中文则对照红、回归绿，任一单独的偷懒修法都过不了。同轮修掉年视图英文月格：`chrome.monthCell` 的 `'Month {n}'` 在英文里没有这种说法，改走 `date.monthShort` 数组（en `Jan`…`Dec`，zh `'1月'`…`'12月'`，zh 侧逐字与旧模板输出相同）。 |

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

当前版本：`timelog-v70` / manifest `version: "70"`。

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
- tooltip 默认不能生成会撑宽页面的盒子；hover 延迟 800ms 后显示，移开立即隐藏；`focus-visible` 必须无延迟显示；触屏不能靠 hover 触发 tooltip。
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
- 续记模型以所看日期为准：空日默认从 00:00 开始；有记录日默认续最后一条或当天空占位条；补录到已有右邻记录之前时结束点吸附右邻；今天无右邻到当前时间，非今天无右邻到 24:00。
- 数据只存在 `localStorage['timelog.v1']`；标签配置只存在 `localStorage['timelog.config']`。
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

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-06 | 初版：记录/编辑/删除、尺子、复制 JSON、离线 PWA |
| v2 | 2026-06-28 | 亮色模式、日期滚轮选择器、下载/导入/分享、文档 |
| v3 | 2026-06-28 | 天/周/月/年视图、周期导航、汇总下钻 |
| v4 | 2026-06-28 | 标签取消选中、稳定编辑/删除事件、回到今天、当前视图 Markdown 摘要 |
| v5 | 2026-06-28 | 按钮说明、分享禁用态、当前周期文案、GitHub Pages 隐私发布说明 |
| v6 | 2026-06-28 | 自定义 tooltip 不再叠加原生 title；无 Web Share 时隐藏分享按钮 |
| v7 | 2026-06-28 | PWA PNG/maskable/Apple 图标资产、移动端 16px 输入、表单不自动聚焦、编辑态刷新保护 |
| v8 | 2026-06-28 | 禁用 `title=`，记录操作图标语义收敛，取消改为撤销箭头，补充文档红线和 `scripts/project_audit.py` |
| v9 | 2026-06-28 | 超长段待确认统计、移动端编辑抽屉、PWA 更新提示、README 固定演示截图 |
| v10 | 2026-06-28 | 超长段逐段确认文案、桌面原生日期/时间输入、无效时间内联提示 |
| v11 | 2026-06-28 | tooltip hover 延迟、确认逻辑 smoke、分钟统计口径和审计规则收敛 |
| v12 | 2026-06-28 | tooltip hover 延迟 800ms、桌面自定义日期/时间 popover（保留精确输入文本框）、审计延迟/版本口径常量化 |
| v13 | 2026-06-28 | 三行 header 信息架构、icon/GitHub 链接、四端统一表单 sheet、focus trap、Enter 新建保存、响应式 footer 和 44px 触控目标 |
| v14 | 2026-06-28 | 响应式布局改为内容驱动：header/footer 容器查询、view/date 稳定网格、sticky footer、宽度驱动 sheet 与时间 picker |
| v15 | 2026-06-29 | 原生 ES modules + 独立 CSS 分层；修复日边界统计继承、小屏横向滚动和周标题溢出；新增 Playwright UI smoke |
| v16 | 2026-06-29 | 4 桶标签配置、longOk 长段策略、textarea 换行、同刻冲突提示、导入平移、帮助页、tooltip/F5 抖动修复、备份升序与秒级文件名 |
| v17 | 2026-06-29 | 新建记录时显示上一段确认块；修复 sheet 初始焦点黑阴影；导入平移改自定义弹框；375px header 与 help 关闭图标收敛 |
| v18 | 2026-06-29 | 根级预留滚动条槽位，修复 F5 与打开面板时的横向位移 |
| v19 | 2026-06-29 | 新建记录改为续记式回溯录入；空占位条表示未记录的进行中片段 |
| v20 | 2026-06-30 | 续记模型修正（起点续上一条/当天空→00:00）；时间条合并可点展开；冲突提示上移；去黑环；F5 防闪 |
| v21 | 2026-06-30 | 续记结算点跟随所看那天（非今天不漏 now）；重开恢复上次日期不再跨日复位；占位条只属于今天；表单结束文案动态化＋非今天明示补记日 |
| v22 | 2026-06-30 | 测试护栏先行后拆分 `entry_model.js` / `io_actions.js` / `sheet_controller.js`；补齐倒序补录、跨日 reload、导入/导出 smoke 和 repeat 压测口径 |
| v23 | 2026-06-30 | 修复跨时区导入后的跨日闭合段切片；导出新增时区 meta，导入按源/当前时区自动建议平移值 |
| v24 | 2026-06-30 | iOS 视口稳定与 deferred help；底栏「摘要+备份」；桶优先选标签与 chip 替换迁移；完整计划模式 |
| v25 | 2026-06-30 | 收窄启动门闩与启动骨架；修复 sheet 裁切；计划/已发生文案收敛；标签高级设置精简；自定义标签第二次使用才固定 |
| v26 | 2026-06-30 | 自定义标签首次使用即固定（修复首次被错算为未记录，取代 v25 的第二次才固定）；表单 sheet 与页面头部补 `safe-area-inset-top`；未记录引导空档可点「补一下」补录；计划时间补充「计划=未来」说明 |
| v27 | 2026-06-30 | 修复表单 sheet 第一项被 head 阴影裁切（head 改全宽 margin 覆盖、去 box-shadow 下溢）；补录/编辑默认桶不再落 unrecorded 导致自定义标签静默不固定、污染统计（桶兜底 job + 按 ts 取最后一条）；自定义标签输入即显示为该桶选中草稿 chip（统一「当前标签」）；删除死代码 summarizeEntriesByDay/hasEntriesOnDate |
| v28 | 2026-07-01 | 热修编辑静默不落库：`commitEdit` 之前用两次 `load()`（改 A 图、存 B 图），导致编辑标签/内容/时间全部丢失、看似"修改功能没实现"；改为单次 `load()`、在被保存的图里取 entry。详见 `docs/postmortems.md` P1 |
| v29 | 2026-07-01 | ⑧ 表单遮罩跟随 visualViewport，iOS 键盘不再把保存 ✓ 顶出屏外；② 补录强制「已发生」并隐藏计划开关（修计划模式泄漏致补录静默失败）；③ 补录落在中间空占位条时就地并入而非报自冲突；④ 被拦的保存把内联/时间错误 `scrollIntoView` 到视野内；⑤ 滚轮日期窗口动态包含打开值（修窗口外日期被静默改到边界），超 `MAX_WINDOW_DAYS` 钉边界项；⑥ confirmPlanned 落「现在」撞同刻时静默 +1min 顺推到空位；首屏闪烁：内联启动脚本预先解析 theme-color、揭露加淡入。详见 `docs/postmortems.md` |
| v30 | 2026-07-01 | 底层时间模型重梳：点存储 + 区间 UX + 无冗余边界归一化。补录改「起点+终点」有界插入（`carveInsert`），每段都有「补/切」按钮，切分自动补回原标签、不牵连其它段；写路径统一收敛到 `normalizeEntries`（去冗余边界 + 恒保今天尾占位），修热路径被迫 +1min；删除改智能（两侧同标签愈合、否则转未记录），不再静默并入前段；`addChipTag` 不再记录时静默改桶（同名按 chip 归类）；中间/历史占位显示「未记录」而非「进行中」；bug1 修 sheet 打开先小后大（viewport 先于揭露）；P13 修 SE2 编辑长记录表单溢出屏外（面板 `min-width:0` + body `minmax(0,1fr)` + textarea 按 visualViewport 封顶）。详见 `docs/postmortems.md` P9–P13 |
| v31 | 2026-07-01 | 版权保护 + 抖动热修 + 治理审计：全部运行时文件加 AGPL-3.0-or-later + `© 2026 wowayou` 文件头，`LICENSE` 落地 AGPL 全文，README/decisions 记双许可姿态；P14 修 iOS 编辑保存后一拍二次重排（`settleThenTeardown`：键盘在场时 blur→等 visualViewport 稳→单帧 close+render，桌面/headless 保持同步；`.sheet-closing` 过渡护栏），线上真机自验；`AGENTS.md` 收缩为指针（唯一真源指向 `CLAUDE.md`）；新增根级 `CONTRIBUTING.md`（「该不该加」决策清单 + 本地真机调试）；审计过时文档 drift；推广策略 park 到 `docs/decisions.md`。详见 `docs/postmortems.md` P14 |
| v32 | 2026-07-03 | P15 修 SE2 刷新「空白页+漂浮按钮」闪烁：启动门闩收窄到 JS 渲染区（`#add-btn`/`.ruler`/`.tl-head`/`#timeline`），静态骨架随 HTML 直出；P16 修 iOS 键盘开合表单二排抖动：visualViewport 事件风暴 settle（60ms 静默/400ms 兜底）后单帧落位 + `.vv-glide` 短滑，settle 后持焦控件收回折叠区；取消/遮罩/Esc 关闭同走 `settleThenTeardown`，teardown 队列防 Esc 双路径重入；编辑模板 `edit-wheel` 挂点内联清理。详见 `docs/postmortems.md` P15–P16 |
| v33 | 2026-07-05 | 视觉令牌全量重写（阶段0 提案 D 定稿，UI 重构豁免轮）：`styles.css` 建立结构令牌层（圆角 12/16/22、动效 140/280ms、字阶令牌、阴影/顶光海拔），双色板换新——暗=石墨冷 `#0e0f13`、亮=宣纸暖 `#f7f5f1`，三桶彩色均过 dataviz 六项校验；描边整体降级为 hairline/透明占位、卡片改阴影海拔、chip 胶囊化、尺子色条 2px 缝+圆角端、sheet 进场动画（`@starting-style` 渐进增强）；`theme-color` 常量同步（index.html/app.js/manifest）；行为零变更，选择器与 P13–P16 护栏原样保留，51 条 UI smoke 全绿 |
| v34 | 2026-07-06 | 直接操纵时间轴（静轴动标 rail，UI 重构豁免轮）：日视图改时序 rail，边界时间文字即拖拽把手（66×44 热区、5min 吸附、横移精调 1min、键盘 ↑↓/Shift 微调），拖界经 `normalizeEntries` 落库，新模块 `src/timeline_gestures.js`；语义统一——点段=编辑、点空隙/占位=补录、点尾段=记一条，「切换活动」入口收敛；编辑表单去时间轮（计划条除外）、内置删除；footer 退役，header「···」更多 sheet 收纳摘要/备份四项/标签设置/主题/说明；sheet 头部统一「取消/完成」文字按钮 + cell 分组（C 语法 × B 皮肤）；结构性 UI 红线同版本重写，精神性红线不动 |
| v35 | 2026-07-07 | SE2 真机验收热修（两处）：① rail 拖把手改真·静轴动标——v34 拖动中直接改相邻段像素高，真实一天大段（如 12h+ 睡眠）撞 200px 钳制上限后松手原路回弹（drag-space≠layout-space 结构矛盾，demo 原型均匀数据未暴露）；改为拖动中两段高度纹丝不动、只有把手数字和气泡随手指变，松手落库后柔和过渡到新高度；气泡横向锚定把手静止点，不再跟手指飘到段文字上；② 键盘弹出遮挡——P16 settle 策略在键盘动画期间不写视口几何，导致 sheet 头部（取消/完成）被顶出视口约 150–300ms 后才回位；改为 burst 期间逐帧写入几何但恒挂 `.vv-glide` 过渡（离散事件合成连续滑动），settle 定时器收窄为收尾（autosize + 保持焦点控件在视野内）；详见 `docs/postmortems.md` P17–P18 |
| v36 | 2026-07-07 | 日视图回退 v33 卡片列表（v34/v35 直接操纵 rail 观感不及预期）：删除 `src/timeline_gestures.js` 与全部 rail CSS/dataset，`renderTimeline` 恢复按时间倒序的卡片模板（真实段/占位段/空隙段/计划段），编辑图标开编辑 sheet、删除图标智能删除；编辑表单恢复可在时间轮里改任意已发生记录的开始时间（不再仅限计划条），`commitEdit` 恢复同刻冲突校验；`switchActivity`／「切换活动」按钮回归；v34 引入的「···」更多菜单、footer 退役、sheet 头部「取消/完成」文字按钮语法保留不变。同时修 P19（键盘收起瞬间表单底部露出空白）：`.form-sheet-backdrop` 改 `position: fixed` 恒盖满视口，`.form-sheet-panel` 加同色「裙边」伪元素兜住几何未追上时的空档；P14/P16/P18 的 settle/burst 时序机制不变。详见 `docs/postmortems.md` P19 |
| v37 | 2026-07-08 | SE2 真机三缺陷热修：① P21 更多菜单「分享备份」行被分组拦腰裁掉——iOS WebKit 对 grid auto 轨道内 button 的 min-height 计量缺陷致行流累计下溢 ~28px 被 `overflow: hidden` 裁切；`.cell-group` 改块级流 + 行显式 `width: 100%`，Playwright 补「行必须完整落在分组内」断言；② 标签高级设置压缩为 cell 语法——每个 chip 改两行式 cell（名称+桶 select 一行，longOk+条数一行）收进 `cell-group`，删 ≤390px 单列坍缩，单行高约减半，`saveTagConfig` 选择器零改动；③ P20 键盘收起后表单二段式落位根治——P19 只涂掉了裸露区、面板内容位移仍在；改「失焦即预测」：`focusout` 时键盘在场且焦点未落回文本控件即直写终态几何（`--vvt:0/--vvh:innerHeight`）+ 终态高度重排 textarea，`vvPredictionHold`（700ms 上限）挡住收起中途的过渡 vv 事件防回拽，settle 落权威值收尾；save/取消/Esc 的 teardown 路径不受影响。顺带修 P19 裙边在 ≥720px 居中 dialog 下方露出卡片色矩形（裙边只服务贴边 bottom sheet，桌面断点 `content: none`）。详见 `docs/postmortems.md` P20–P21 |
| v38 | 2026-07-08 | 全项目收敛（审计轮，零新功能）：header 收敛——删重复 GitHub 图标与「?」按钮（说明收进「···」，站点图标即仓库入口），smoke 说明用例改经更多菜单；帮助页「怎么记」重写为 v36 卡片语义（清 v34 rail 残留文案）；README 演示图按当前 UI + 固定 demo 数据重生成（替换 v9 时代英文截图）；死代码清理（`clampEndToNow`、5 个未调用 icon 定义、`--green` 令牌、`.edit-context`/`.edit-actions`、`.entry.editing` 残留选择器）；`.mini-btn` 透明伪元素扩 44px 热区（视觉不变，T11）；压测 A 类加预热导航修单次冷启动误报并纠正 P90 注释；文档收敛（README 功能清单/文件地图、ROADMAP 去过时编号、audit-2026-07 结果标注、原型索引「已回退/已采纳」标注）；`.gitignore` 补 `memory/` |
| v39 | 2026-07-08 | P22 热修：亮色主题下时间滚轮选中行文字被高亮带整行涂掉（v33 令牌重写把亮色 `--accent-bg` 改为不透明色，暴露 `.wheel-highlight` 一直压在文字上方的层序错误；暗色半透明掩盖三个版本）——高亮带垫到文字层下（列 `z-index:1`/带 `z-index:0`，iOS 原生滚轮同层序）；Playwright 补层序不变量断言；更多 sheet 底部加「时间尺 vN」版本号小字（真机核对零成本），`project_audit.py` 校验 `APP_VERSION` 与版本四联动同步。P20/P21 经真机核对确认在 v37/v38 上仍存在，列入下一轮重诊断。详见 `docs/postmortems.md` P22 |
| v40 | 2026-07-08 | vv 诊断 HUD（`?vvdebug=1` 启用，无参数零成本）：页面顶部悬浮面板显示能力探针（`navigator.share`/`canShare`/standalone/版本号）+ 最近 16 条事件时间线（原始 vv resize/scroll、focusin/out、几何写入、P20 预测/挡写/settle、glide 开关、teardown 阶段），`sheet_controller` 在决策点埋 `window.__vvlog?.()` 守卫日志——用于 SE2 真机取证两件事：P20 键盘收起跳变的事件时序（录屏逐帧比对）与「分享备份消失」（iOS 18.6 Safari 报 `navigator.share` 缺失，代码侧 v36→v39 判定逐字节未变，属设备侧能力应答变化，待 HUD 实测）。P21 状态更新：v39 真机确认排版正常（v37 块级流修复有效）；本地 WebKitGTK 不复现 v36 grid 裁行，该缺陷属 iOS 构建特有 |
| v41 | 2026-07-09 | P23（P20 真根因，HUD 录屏确诊）：iOS 18 点键盘「完成」时 `visualViewport.height` getter 瞬间恢复、resize 事件迟 ~728ms 才派发；v37 预测门闩 `innerHeight-vv.height>120` 在 focusout 读到差值≈0 误判「键盘不在」→ 预测从不启动 → 面板挂旧几何等迟到事件（连修四轮的真相）；门闩改双条件 `kbUp`（键盘在场）**或** `varsStale`（`vv.height-已写入的--vvh>120`，即「我写的几何还停在键盘态」）——探「我写的状态是否过时」而非「世界当前状态」。P24：更多菜单「分享备份」真机消失——HUD 实测 `share:function` 能力在、代码 v36→v39 逐字节未变，强嫌疑=内容拦截器按名隐藏 `#share-btn`；防御性改 id → `backup-share-btn`（ui.js/io_actions/ui_smoke 同步），用户 aA 菜单关拦截器可 A/B 实锤。sheet 导航栈：config/help/import-shift 若从「更多」下钻进入，取消/保存/Esc/遮罩返回「更多」而非整层关闭（`returnToMore` 标志）；修 help 测试 + 新增导航返回栈回归。详见 `docs/postmortems.md` P23–P24 |
| v42 | 2026-07-09 | 真机热修二诊。P23：v41 修法失手——SE2 真机 HUD 复录仍 `no predict`、面板仍跳，因 v41 的 `varsStale` 又拿 getter `vv.height` 做判断，而 focusout 那刻 getter 落在收起中途的死区(~430)，两侧 120px 阈值都够不着；改纯自写几何 `writtenIsKbState = innerHeight-已写入的--vvh > 120`（稳定量对比自写量，全程不读 getter），`318 vs 544 → 226>120` 预测在 focusout 立即触发。P24：v41「内容拦截器按名隐藏 `#share-btn`」假说被推翻（用户否认开拦截器）——本地 `share_probe.mjs` WebKit+Chromium 双引擎注入真 `navigator.share` 均 `display:flex` 可见，证明代码渲染无辜、真机消失＝页面外装饰性抑制（状态栏 VPN 徽标为头号来源）；v41 改名保留子串 "share" 故未规避，v42 去尽令牌（id `backup-send-btn`、data-action `send-backup`）+ `openFormSheet` more 渲染后加 HUD 分享探针取证，待用户关 VPN A/B。详见 `docs/postmortems.md` P23–P24 |
| v43 | 2026-07-09 | 两处结构性重设计（停止打补丁、绕开问题）。**P23 键盘跳变根治**：连修六轮（P16→v42）认清根因是方案本身——「高度追踪键盘的 bottom sheet」每次键盘开合都要移动，而 iOS 收键盘的 vv resize 事件天生迟到 710ms，任何跟事件/预测都在赌不可靠时序。改为**面板不随键盘缩放**：`.form-sheet` 恒定 `inset:0`；召唤键盘的表单（新建/编辑/标签设置）用定高 `.tall` 面板 + 头部 `sticky top:0`（保存 ✓ 永在键盘够不到的顶部，顺带根治 P2/⑧），焦点控件 `scrollIntoView` 滚到键盘上方；`visualViewport` 只剩写 `--kb` 供正文 `scroll-padding-bottom`（只滚不移面板）。删约 200 行时序机器（predict/settle/glide/burst/`--vvt`/`--vvh`/`.vv-glide`/`settleThenTeardown`/P19 裙边/`.sheet-closing`）。**P24 分享消失根治**：用户证伪 VPN（一直开着、分享好用时也开着），真因是 footer→更多 迁移丢了 `updateShareAvailability` 的 reveal（footer 常驻 DOM 主 render 每次 reveal，更多动态渲染无 reveal，iOS 卡隐藏）；改**常显 + 点击无 Web Share 能力则回退下载**，删门闩与 `updateShareAvailability`。UI 红线（分享常显、键盘不移面板）与自测清单 5/11 同步重写；ui_smoke 分享显隐断言改常显。详见 `docs/postmortems.md` P23–P24 |
| v44 | 2026-07-09 | P25 SW 更新可达性：旧 `registerServiceWorker` 只弹「更新应用」横幅、且从不主动 `reg.update()`——iOS Safari（尤其 standalone PWA）不及时复查 `sw.js`、横幅又常被忽略，导致 GitHub Pages 已发新版、用户端一直吃旧缓存（历次「还是没更新/还是没修好」的真凶：v41–v43 很可能从未在真机干净加载过）。改为：① 冷启动 + 每次 `visibilitychange` 转前台都 `reg.update()` 强制复查；② 新版就绪时——表单开着就弹横幅（不打断输入），否则**静默 skipWaiting + 单次 reload 自动更新**（`localStorage` 数据不受影响）。本地 Chromium 双版本模拟验证：模拟发新版后缓存自动切到新 CACHE 且页面自动 reload，零点击。发布仍走 GitHub Pages 主分支根目录直发；手动触发一次构建可用 `gh api -X POST repos/<owner>/<repo>/pages/builds`。详见 `docs/postmortems.md` P25 |
| v45 | 2026-07-09 | 左滑即编辑（用户请求）：可编辑记录卡（真实/计划）支持左滑打开编辑 sheet，等价点右侧铅笔的移动端手势快捷方式；`app.js registerCardSwipe`（touchstart 认卡→touchmove 判轴/跟手/`preventDefault` 横向→touchend 超 56px 阈值即 `startEdit`），`.entry` 加 `touch-action: pan-y`（纵向滚动归浏览器、横向手势归左滑，互不抢）；占位/空隙卡不参与，图标按钮/桌面路径不变。Playwright 补 Chromium 合成触摸 swipe 断言（真机手感待确认）。键盘（v43）经无痕真机确认已修；分享按钮真机仍缺——代码 v43 起无条件常显、live 已核，无痕（绕缓存但不绕系统级 VPN 过滤）仍缺，强指向 VPN 装饰规则，待用户 `?vvdebug=1` HUD 读数 + 关 VPN A/B 定案 |
| v46 | 2026-07-09 | 设计交接包第一批（R1/R3/R5/R7 + 新发现，纯 CSS/小 JS，零模型改动）。**R1**：sheet 关闭改 class 驱动过渡（`.sheet-closing`）+ `transitionend`/320ms 兜底后置 hidden，与进场 `@starting-style` 对称；`sheetCloseCleanup` 挡重入（`editConflictEntry` 关了立刻重开一类场景，关闭动画未播完就先立即收尾旧的）；`prefers-reduced-motion` 同步隐藏。**R3**：编辑态时间选择折叠为触发行（点击展开滚轮），与新建态一致；计划编辑例外始终展开；`commitEdit` 校验失败时先展开触发行再报错，避免报错文案落进折叠容器看不见。**R5**：回到今天/本周/本月/今年按钮只在当前周期已不含今天时出现；`.date-nav` 用 `:has(#today-btn[hidden])` 收窄 grid 列数避免显式轨道留死区；当前周期含今天时 `#period-label` 追加常驻 `.period-today-badge`。**R7**：切视图/切周期后内容方向性滑入（280ms，`animateContentEnter`）+ 列表卡片入场淡入（140ms，纯 `opacity`——刻意不碰 `transform`，避免与左滑手势的驱动属性共用 transition 让拖拽变卡顿）；不做 FLIP/逐项 diff。**新发现**：`.ruler-bar` 分段缝改 `--border`（不再透出 `--card` 导致两主题缝视觉重量不一致）；gap 卡（空隙）与 planned 卡（有内容的未来计划）视觉区分（gap 保留 dashed，planned 改实线+accent 淡色调）；「···」更多按钮从裸文本字形换 `iconSvg('more')`（app.js 一次性注入，唯一不走 JS 模板渲染的图标按钮）。 |
| v47 | 2026-07-09 | 设计交接包第二批：日视图 DOM 形态重做（方案 1a「静尺」+ 悬浮 FAB，用户已授权破 UI 红线；只改日视图，周/月/年不动）。**R4** 尺子出结论——`renderDayHero` 把日视图 `#ruler` 改 hero 结论卡：主线净时长唯一大数字（32px/700）、漏损 19px 次要、6px 比例条（维持段 .55 透明）、辅助行「维持/未记录/截至」；周/月/年仍走 `renderRuler`。**R2+FAB** 入口收敛——删嵌入式「+记一条」横条与「切换活动」按钮（连同 `switchActivity`），合并为右下角悬浮 FAB（保留 `id=add-btn`，`fixed` 右偏移锚 600px 列右边缘内 16px，副文案「续 hh:mm 起 · 已 Ymin」由续记模型派生，只设 aria-label 不设 data-tip——`button[data-tip]` 会强制 position:relative 破坏悬浮）；列表底 `padding-bottom:84px` 避让 + `.list-fade` 渐隐遮罩，与 FAB 同步显隐。**R6** 撤记录行常驻图标——删卡片 edit/delete 图标，点整卡即编辑（卡片 `role=button tabindex=0 div[data-action]`，键盘 Enter/Space 激活，delegated click 靠 `closest` 让卡内 meta 按钮优先）；删除移进编辑 sheet 的「删除这条」；gap 卡点整卡补录（卡内「补一下」降级 `.e-cta` 纯提示）、段落卡 meta 保留「补/切/确认」、计划卡 meta「标记已发生」；`registerCardSwipe` 判据改 `dataset.action==='start-edit'`。UI 红线（日视图卡片/入口/hero）+ 自测清单 2/5/10 重写；帮助页「怎么记」重写；ui_smoke 断言全面适配（点整卡/点 gap 卡/FAB 文案/hero 无百分比），双主题截图自验，53/53 全绿。 |
| v48 | 2026-07-10 | 时间轴可信交互与离线可靠性修复：统一事务 planner 驱动完整区间编辑、冻结边界切分、精确删除预览与最新数据二次确认；今日尾段支持「至今/固定」，删除提供 8 秒冲突安全撤销；触摸/笔左滑改 2×72px 编辑/删除轨道。导入改 Map 整批预检并阻止 ID/同刻冲突，修默认标签复活、主线/chip 同名、首次固定文案与用户文本 DOM 注入。分享按文件→文本→下载可靠降级并区分取消；SW 安装/激活/fetch 收紧，waiting 更新只在用户点击后应用，更新提示层级高于 FAB。补最小对比度/a11y 语义，Playwright 启用 Chromium+WebKit 并覆盖区间、删除、撤销、导入、分享、跨标签和更新提示。 |
| v49 | 2026-07-10 | 修复 iOS standalone 下 sticky 更新提示与 fixed FAB 分层导致「更新应用」视觉可见但命中区被挡：提示改为 fixed，并保持在 FAB 上方、sheet 下方；移动端 smoke 增加不重叠与 `elementFromPoint` 可点击护栏。Header 新增纯本地「使用第 N 天」：首次写入本机起始日期，老用户按最早本机记录迁移，按自然日离线计算。 |
| v50 | 2026-07-10 | iOS 备份落盘可靠性：更多菜单「下载备份」改名「存储备份」；iPhone/iPad Safari 与主屏 PWA 优先通过系统文件分享面板选择「存储到文件」及目录，取消不再暗中产生去向不明的下载，能力不足时才回退浏览器下载；桌面保留直接下载。复用统一备份 artifact，分享仍按文件→文本→下载降级，并补 Chromium/WebKit 平台路径护栏。 |
| v51 | 2026-07-10 | Safari 刷新与导入冲突体验修复：同标签页保存安全 DOM 启动快照，刷新时在 ES module 到达前同步接住上一帧，消除主内容空白、静态「回到今天」误露和 FAB 闪变；导入冲突从原始 ID 长文本改为逐条「备份中 / 本机中」对照卡，有冲突时禁用导入，平移小时数变化实时重算，全部消解才可提交。补模块延迟刷新与恶意双冲突 Chromium/WebKit 护栏。 |
| v52 | 2026-07-10 | v51 二诊与交互闭环：启动快照命中后跳过 `init()` 首轮重渲染，避免恢复节点立刻被销毁重建而触发 `.entry` 淡入和 fixed FAB 二次合成闪动。导入冲突每条可选保留本机、使用备份或保守合并文字；全部选择后最新数据签名复核并原子写入，不静默 +1min。移动端「更多」抓手支持下拉关闭，短拖回弹，桌面/正文滚动/高表单不受影响。 |
| v53 | 2026-07-11 | 功能冻结前 KISS 收敛：更多抓手把 5px 装饰线扩为 44px 真实命中区；左滑操作轨道默认不可见，只在拖动/打开时显示，消除 Safari 刷新合成层透底。导入冲突不再只展开 8 条，新增 10 条冲突逐项处理、未处理阻写、签名过期阻写和最终原子提交回归。删除测试专用运行时分支、无调用包装/返回方法、内部多余 exports、未用图标/变量/旧选择器和过时可执行原型；README/应用说明明确完整备份是数据完整导出，导入是安全合并而非精确恢复。 |
| v54 | 2026-07-11 | 功能冻结后阻断 bug 修复：iOS 主屏 PWA 后台恢复时，系统时间已前进但今日汇总、进行中未记录段与「记一条」副文案仍停在旧分钟。前台 `visibilitychange`、`pageshow`、`focus` 统一清理可能已被 WebKit 丢弃的旧 timer，立即按当前时间补算，再建立对齐下一分钟的单次 timer；数据签名保持重复事件无额外重渲染。新增从 12:34 挂起到 18:55 后汇总与 FAB 同步更新回归。 |
| v55 | 2026-07-11 | 功能冻结后的明确批准视觉收敛：以“海拔＝信息层级”消除日视图 card soup——header 与日期控件贴地，记录卡保留背景差/边界但去阴影并收紧间距，hero 尺子成为唯一带内容阴影的主表面；主线大数字改用墨色，FAB 保留唯一饱和 CTA 并收敛发光。改动限于 CSS 与版本仪式，DOM、模板、业务 JS、左滑轨道、刷新快照和动画护栏均不动。 |
| v56 | 2026-07-11 | 日视图改**连续日志容器**（`docs/prototypes/continuous-log-refined.html` 评审定稿，用户批准）：`.log` 单一贴地面 + 发丝分隔（wrapper 层、避开竖脊）+ 左缘 4px 通高桶色竖脊（`data-b`：实=已发生、CSS mask 圆头虚线=计划、灰=未记录），tag 降素色小字（桶色职责移交竖脊）；今天视图「现在 hh:mm」一线分隔计划与已发生（accent 呼吸点，reduced-motion 静止）；行改 时间｜内容｜时长 三列网格，时长右置、文案单职责（进行中「已 X」与 FAB 同语，去掉「未记录·进行中」复读）；行内动作只留缺口/待办文字链（补一下/标记已发生/确认，mini-btn 去底色留 44px 热区），**已发生普通段「切一刀」迁入编辑 sheet**（cell-action；经批准的入口红线变更）；hero 大数字 32→36px 补偿去色层级；boot 快照加 `appVersion` 门（应用更新后旧 DOM 形态不再被新 JS 采纳而跳过首渲）；行仍自带不透明 `--card` 底、入场只过渡 opacity（左滑/v53 护栏不变），周/月/年与「···」更多不动。Playwright 断言适配 + 新增容器/竖脊/现在线/切一刀入口回归。 |
| v69 | 2026-07-20 | D11 定向开口（维护者批准，冻结期第三次）：① 亮色底色冷移一档 `#f7f5f1`→`#f6f6f5`——仅 `--bg` 两主题块 + `theme-color` 两锚点（index.html/app.js），卡面暖令牌（input/track/border/阴影）保留；WCAG 重校全部文字令牌持平或微升（正文 11.70:1、muted 5.27:1、danger 3.98:1），卡底分离 1.089→1.081。② 阶段格言展示区 v1（C13）：`config.motto` 三态（键缺失=默认「记录是手段，推进主线才是目的。」/空串=显式隐藏/非空=自定义；空白折叠 + 60 字上限，恰等于默认归一化回未设置）；日视图 hero 与时间轴之间一行安静小字 `#motto-line`（textContent 注入、CSS 生成引号、44px 触控高、静态壳空+hidden 同 `#usage-day` 纪律），点行或「···」更多「阶段格言」cell（隐藏态唯一入口）编辑——motto sheet 走 tall + returnToMore + 「恢复默认」；随 config 进完整备份，导入合并本机显式值优先（含显式隐藏），`validateImportData` 校验字符串。踩坑：`.motto-line` 的 `display:block` 压过 UA `[hidden]` 需显式让位；motto-body 沿 P34 判例脱离 `.form-sheet-body` grid 轨道。新增 5 条双引擎回归（三态/更多入口/导入合并/注入惰性）。③ 第三桶改名 漏损→偏航（C14，维护者原话「适时地放空是必要的」）：只改显示名与语义文案——`BUCKETS.leak` 显示名、hero 次要标签、chip 分组标题、config 选项/分节、`bucketHint`、校验错误文案、摘要 Markdown 两处、帮助页「4 桶」段（补「偏航不等于错误、可在标签高级设置改到维持」）；**内部键 `leak` 一律不动**（存量 config/备份/CSS 令牌按键走，改键＝强制迁移且旧备份读不回），故零数据迁移；回归锁「显示名＝偏航 且 落库桶键＝leak」。改名不重新归桶（发呆/娱乐仍在该桶，用户可自助改桶），历史 CHANGELOG 与 D5 候选沿用旧词不回溯改写。决策与诚实代价见 `docs/decisions.md` D11、`docs/freeze-candidates.md` C12/C13/C14 |
| v70 | 2026-07-20 | v69 缺陷修复（维护者点名要求修，范围严格限于格言收尾）：① **长格言撑破窄屏**——`.motto-line` 缺断行策略，中文可任意位置断行故从未暴露，但一串不带空格的拉丁字符（粘 URL 即触发）在 320px 下把 480px 的行挤进 279px 容器并把文档撑到 399px，撞「窄屏不得横向溢出」红线；修＝`overflow-wrap: anywhere`（与全站 11 处用户文本同一惯用法）。② **60 字截断留尾空格**——`slice` 在 `trim` 之后，截断点恰落在空格上时渲染成「…… 」；修＝截断后再 `trim` 一次。回归两条，均已按 P35 教训**先证明「没修会红」再落地**（双引擎）。踩坑记录：首版回归是**绿色装饰**——`boot()` 的 `addInitScript` 在每次导航重跑 `localStorage.clear()`，`page.reload()` 把刚写入的格言擦掉，改走真实编辑 UI 才有效；随后又误测到另一个东西——点「完成」后指针停在原坐标、sheet 关闭后压住 header「···」触发其 hover tooltip，那是**先于本功能就存在**的缺陷（320px 下 tooltip 把文档撑到 399px，已登记 C15，本轮**不修**：非阻断、触屏不触发 hover、撞冻结边界），用例里就地移开指针并注明出处。同版本落档：C1 定案观察（v68→v69 交接首次取到 `SW态 a:activated`，无 waiting 悬挂＝C6 反证；但维护者确认期间**完全退出过**，自动链路独立切版仍零正例、3/3 同形态，问题收窄为「触发的那次 reload 没拿到新版本」）；启动诊断三个原始问题全部有答案、**可关闭**（间隔↔就绪相关系数 +0.05，长间隔不比短间隔慢，最快的冷启动恰是间隔最长那次）。见 `docs/decisions.md` D11 追补与 `docs/freeze-candidates.md` C1/C15 |
| v57 | 2026-07-13 | 日期计划窗口改为本地自然日统一规则（严格晚于 `now+5min`、上界 `今天+8日 00:00`）；历史/今天/未来 `+1…+7`/`+8` 入口分别强制已发生、沿用偏好、强制计划、隐藏新增，取消表单不再提前切主页面日期。既有计划按同一次最新 `load()` 的 `ts` 实施“时间未变”上下界对称豁免。新增纯数据形态的过夜续记：显式选择到今天硬终点或只到 24:00，跨午夜写成两条可独立编辑的日内记录，planner 复核 placeholder/真实记录/计划边界与结果签名。加入仅由 `#boottrace=1` 启用、位于启动快照范围外的隐私安全启动分段 HUD；不改 SW 策略/FILES，不做 lazy、A/B 或其它性能优化。补真实 `timezoneId` DST、日期矩阵、计划豁免、过夜与 boottrace 双引擎回归。 |
| v68 | 2026-07-18 | 诊断 v2（D10 批次二，C6 定案的第一优先）：启动诊断样本增补 ① `sw`——SW 注册三态固定枚举（`i/w/a:Worker.state`，无注册 `none`），**模块顶早读**（晚读会混入本次 `reg.update()` 的过渡态），下次 waiting 交接卡死可直接区分 C6 的两个假说（installing 卡住 / worker 已 redundant 只留缓存）；② `fcpMs` 首绘毫秒（P33 页面侧首绘补充）。「复制启动诊断」排版同步（SW态/首绘），字段白名单测试过审（枚举正则锁形状）。随行记录真机判读（后经维护者口述修正，见 freeze-candidates C1）：v66→v67 与 v67→v68 两次升级的 reload 样本均为**旧代码＋新缓存**——自动 reload 可触发但两次切版都落在随后的 navigate（期间维护者完全退出过），**自动链路能否独立完成切版未证实**；14h42m 长间隔样本页面侧仍 355ms（P33「慢在计时零点之前」再印证）。零布局/交互改动 |
| v67 | 2026-07-18 | D10 定向解冻批次（AI 协作窗口收尾）：**C7A** 过夜写入即确认——`planOvernightContinuation` 对超阈值段写入时落 `longConfirm`，显式双端断言不再落待确认、昨天统计不再静默计未记录（「只记到 24:00」与普通补录**不**自确认；起点被 coalesce 并入前段时标记随点消亡），confirm smoke 补三组回归；**C8** 说明文案两处（「删除后 8 秒内可撤销」语序；「第 8 天起只查看和编辑已有计划」改「计划最多建到未来 7 天，再往后的日期不能新增」）；死 export 清理（`stats.js` `recordedDayKeys` 转模块内私有）；**C11b** 模型层类型检查落地——`npm run typecheck`（tsc checkJs 仅查 time/storage/stats/entry_model 四纯逻辑模块，devDependency、零构建产物、入自测清单），事务 planner 加 `TxOk`/`TxError` 字面量 JSDoc（131 行推断错误收敛为 0），stats 六处 `Math.max/min(Date)` 显式数值化（行为等价）；C11a bump 脚本已先行合入。零布局/交互改动 |
| v66 | 2026-07-17 | P33 感知缓解（维护者批准的冻结期观感改动，不缩短等待）：新增 `apple-touch-startup-image` 启动图——录屏判决确认冷孵化进程的 ~1.4s+ 发生在页面计时零点之前、仓库内不可修，唯一可触及该时段的杠杆是 OS 层启动图资产。最小范围：只做 SE 尺寸（750×1334，唯一真实设备）暗色一张（`icons/splash-750x1334.png`，Playwright 从 `icon.svg` 确定性渲染：品牌暗底 #0e0f13 + 居中 τ），其它设备保持系统默认；iOS 该机制只认静态图（动图不存在，连原生 launch screen 都被规定为静态）。资产进 `sw.js` FILES 与 audit `REQUIRED_ICON_SIZES` 双护栏。诚实边界：真机生效性待验证（iOS 可能要求重新添加主屏图标才刷新启动图），无效即 revert——**2026-07-19 真机确认已生效，不 revert；不扩设备（仅一台真实设备，防镀金）**；对将来「原生壳」架构选项零耦合（原生用自己的 launch storyboard，此标签直接删除）。经录屏交叉验证的缓解杠杆全景：习惯（不上滑杀 PWA）> 本启动图（纯观感）> 页面侧（已到边际，435ms）> 原生壳（gate 外最后选项） |
| v65 | 2026-07-17 | 冻结期修复 P35（维护者明确批准）：分钟 tick 的整页重渲染把日视图窗口滚动钳回顶部——WebKit 无 scroll anchoring，`#timeline` 整块 `innerHTML` 替换瞬间文档变矮、滚动被钳到 0（Chromium 有锚定不受影响），回看今天早些的记录时每分钟被拽回一次（用户真机报告，双引擎脚本复现：WebKit 600→0、Chromium 600→600）。修＝`refreshLiveClock` 渲染前后保存/还原 `window.scrollY`——它是唯一的被动重渲染路径（用户没有操作、不该动视口），主动路径（切视图/切周期/保存）不受影响。回归测试走真实 tick 路径（`page.clock` 快进跨分钟、矮视口滚动保持断言），验证过无修复时 WebKit 必红。教训（测试环境）：`reuseExistingServer: true` 会把 4173 上任何陈旧 server 当被测应用——本轮它正服务着另一个项目，228 用例烧 4.5h 全部假超时；跑套件前先确认 4173 是时间尺或为空 |
| v64 | 2026-07-17 | 冻结期修复 C1「点『更新应用』后无声装死」（维护者点名要求修）：iOS 上 skipWaiting → controllerchange 整链可无声失败（2026-07-15/16 两次真机复现，点击后版本纹丝不动、无任何反馈，用户只能靠再次完全退出这条自然激活路径脱困）。`applyUpdate` 三层处理：① waiting worker 自身 `statechange→activated` 作为第二成功路径（controllerchange 丢失时可能仍达）；② 8 秒超时兜底——两条都没来就承认没生效，横幅切换为「完全退出应用（Safari 关闭本站全部标签页）后重新打开」可执行指引，不再无声；③ 指引可「知道了」收起，`showUpdatePrompt` 复位回按钮态。静态壳横幅改双态 span/button（`data-role="update-prompt"/"update-stuck"`）。**诚实边界：本修复不能强迫 iOS 应答 skipWaiting**——它把按钮从「可能生效、失败装死」变成「多一条生效路径、失败给出路」；skipWaiting 本身在 iOS 的不可靠性仍留在候选 C1 观察。测试：mock waiting 升级为 EventTarget，新增超时→指引→收起与 statechange→reload 两条回归（page.clock 快进 8s；sentinel 消失证明真实 reload） |
| v63 | 2026-07-17 | 冻结期阻断修复 P34（维护者明确要求立即修）：v62 真机 Safari 更多菜单**全部 cell 分组被压扁裁切**（存储备份半行、导入/分享备份不可达——备份入口阻断）。根因：`.form-sheet-body` 是 `min-height:0` flex 子项上的 `display:grid`，v62 新增启动诊断分组+提示行让更多正文**首次**超过面板可用高度，grid 把各 auto 轨道压到低于内容高，`.cell-group` 的 `overflow:hidden` 拦腰裁掉后续行——P21 的上一层复发（那次组内 grid、iOS 特有；这次正文 grid、**双引擎 375×600 可复现**）。修法沿 v37 判例：`.form-sheet-body.more-body{display:block}`（复合选择器压过后文同优先级 `display:grid`——先写 `.more-body` 会按源码顺序输掉）+ 相邻兄弟 margin 复刻 gap，超高转正文滚动。config sheet 同结构经探针实测不受影响；新增矮视口+最大内容量（启动诊断开）回归测试锁更多+标签设置两处。教训：v62 没改一行 CSS 仍触发布局缺陷——**内容增量把布局推进从未走过的容量路径，容量边界外等于没测过** |
| v62 | 2026-07-16 | 冻结期阻断处理（P33 复发，维护者批准方案「诊断 + persist() 一起上」）：用户确认 v58 后启动仍严重迟缓，且规律为**起床/长时间未打开后第一次打开特别慢**——与「系统在长间隔后回收 Cache Storage/SW」假说一致，但真机无法带 `#boottrace` fragment，取证缺位。落地两件事：① **opt-in 设备端启动诊断**——「更多」新增「启动诊断」开关（默认关、零监听器零写入），开启后每次启动记一条样本进 `localStorage['timelog.bootDiag.v1']`（环形 ≤30 条）：各阶段耗时（html 到达/模块图就绪/app-ready）、SW 是否接管本次导航（模块顶早读，晚了会被 claim 污染）、Cache Storage 现存 `timelog-v*` 套数与文件命中数、`storage.persisted()`、standalone 与快照命中、距上次打开间隔分钟数——只有计时/布尔/命中数，绝不含记录内容，不进备份，关闭即整键删除；「复制启动诊断」cell 一键导出全部样本+UA。② **`navigator.storage.persist()`**——app-ready 后申请常驻存储，直击头号嫌疑的低风险缓解，效果由样本里 persisted 布尔佐证。诊断读写 helper 落 `storage.js`，文本排版落 `io_actions.js`，开关经 openMoreSheet 原地重渲染（returnToMore 同路径）。`#boottrace` 红线补「用户显式开启的持久化例外」条款 |
| v61 | 2026-07-15 | Header 里程碑改为**从数据派生**：「使用第 N 天」（基于本机安装日 `timelog.firstUsedDate`）退役，改显示「记录历程第 N 天 · 已记录 N 天」——前者＝当前数据中最早**非计划、非占位**记录到今天的自然日跨度，后者＝有真实记录的不同自然日数。动机：安装日是虚荣指标，装了不等于记了；两个新数字都从 `entries` 派生，因此随完整备份天然恢复（删主屏 PWA 换图标或换设备都不再丢里程碑），且「已记录 N 天」直接就是 28 天 gate 的计量口径。`firstUsedDate` **降为纯诊断值**：仍写入并随备份延续（v60）备查，但不再驱动任何用户可见里程碑。里程碑逻辑落在 `stats.js`（`recordedDayKeys` / `recordingMilestones`），`isPlaceholderEntry` 一并从 `entry_model.js` 移入 `stats.js`——`entry_model` 本就 import `stats`，反向引用会成循环依赖，移动后单一真源、`sheet_controller` 改从 `stats.js` 取。一条真实记录都没有时不编造里程碑，直接隐藏。注意：「已记录 N 天」是机器可判定的「有真实记录的自然日」，**不等于** `docs/dogfood-freeze-handoff.md` 里需人工判断的「有效记录日」，不得混用 |
| v60 | 2026-07-15 | 版本仪式一致性修复（零业务逻辑）：v59 只改了 manifest + `sw.js`，漏掉 `src/ui.js` 的 `APP_VERSION`、`project_audit.py` 的 `EXPECTED_VERSION`、`CLAUDE.md` 与 README，导致 audit 必然失败、且**已安装 v59 的设备在「更多」页显示「v58」**——版本探针说谎。修复不能回填成 v59：`src/ui.js` 在 SW `FILES` 预缓存列表内，而 `sw.js` fetch 是纯 cache-first 无 revalidation（`caches.match(r) \|\| fetch`），若 `CACHE` 字符串不变则 `sw.js` 字节不变 → 浏览器判定无更新 → 永不 install/addAll → 已安装客户端永远拿不到修正后的 `ui.js`。只有 bump `CACHE` 才能失效缓存，故走完整窄范围 v60（`CACHE`/manifest/`APP_VERSION`/`EXPECTED_VERSION`/CLAUDE/README 六处同步），由 v44 自动更新链路送达真机。同时放宽 `audit_demo_assets`：`docs/assets/` 允许 3 张已存档的 icon-proto 评审渲染（显式文件名白名单，非通配——通配会让未来误传的真实截图自动过闸）。不改 `FILES`（无新资产），不改 `index.html` 的 v58 历史注释，不夹带任何 UI/图标/业务改动。同版本另修一处「完整备份并不完整」：`timelog.firstUsedDate` 此前不进备份，删主屏 PWA 换图标（iOS 唯一的换图标途径，会清 localStorage）或换设备后「使用第 N 天」只能退回按最早记录推导——现纳入导出/导入，导入只准把起点往更早挪并拒绝未来日期（N 单调不减），`app.js` 经 `adoptImportedFirstUsedDate` 同步刷新缓存值 |
| v59 | 2026-07-15 | （追记）app 图标统一为网站 τ（分段-τ H1）：`icon.svg` 与 `icons/*.png` 重绘，manifest + `sw.js` 升 v59。**当时漏做版本联动**（`APP_VERSION`/audit/CLAUDE/README 仍为 58），断裂由 v60 修复 |
| v58 | 2026-07-14 | PWA 冷启动加速：SW 注册提前到 `<head>` 内联脚本（脱离 ES module 图加载链路，`app.js` 末尾原注册在慢启动时要等全图加载完）；`<head>` 加 9 条 `modulepreload` 提示拉平 import 瀑布（实测 6×CPU+slow-3G 下 `app_ready` ↓~18%）。实测确认 parse+execute 极廉价（10×CPU 仍 ~0.3s），3.8s 冷启动几乎全是网络/SW 缓存未命中；Fix A 为低成本合理猜测，若真因是 iOS 定期回收 Cache Storage，则 daily opens 仍慢，下一步走 instrumentation（见 postmortem P33）。启动屏 Fix C 已 park。零业务逻辑改动。 |

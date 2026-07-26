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

当前版本：`timelog-v76` / manifest `version: "76"`。

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

> v1–v65 的历史条目已移至 `docs/CHANGELOG.md`（2026-07-25，D15 额度治理：本文件是三个模型每次会话都要整读的「法律」，历史流水不必每次付费）。
> **红线、边界、仪式条文全部留在本文件**，只有已归档的版本流水外移。本表保留最近八个版本。

| 版本 | 日期 | 变更 |
|---|---|---|
| v76 | 2026-07-26 | v76 合并批次（三单一次版本仪式，`docs/decisions.md` D16 提前阶段复盘放行）。**SPEC-002** 旧 origin 只读冻结（浸泡确认足够，D15 时 blocked 解锁）：复用既有 `isLegacyOrigin()`，`render()`/`renderChrome()` 把它接成一个 `readOnly` 标志喂给 `renderTimeline`——只读态下卡片（真实段/占位/gap/计划）不再带 `data-action`/`role="button"`/`tabindex`，`swipeWrap` 整体跳过（左滑轨道原本就靠卡片上的 `data-action="start-edit"` 判据才会启动，读时干脆不画）,「补一下」/「标记已发生」/「确认」三个 mini-btn 一律不渲染；FAB 与 `#list-fade` 直接隐藏（`canCreate` 加 `&& !isLegacyOrigin()`）；「···」更多菜单移除「导入备份」cell，摘要/复制/存储/分享四项读写分明地保留读侧三项+导出项。SPEC-001 横幅同批改为**常驻不可关闭**——去掉「知道了」按钮与 `timelog.migrationNotice.dismissed.v1` 持久化、更多菜单的「迁移到新地址」重开入口一并删除（横幅本身已恒常显，无需重开），文案改「此旧地址已转为只读。请在新地址 time.eigentime.org/app/ 继续记录；历史数据可随时在此导出。」。新增 8 条测试（SPEC-002 只读收敛 7 条 + SPEC-001 横幅常驻重写 1 条），P35 红灯证明：stash 掉 4 个运行时文件、只留新测试跑 chromium，7 个只读断言全部先红（旧代码仍可点行编辑/仍渲染 mini-btn/FAB 可见/导入 cell 在），3 条防御性不变量（新 origin 基线、镜像路径、读写能力齐全）本就应绿。**控件表面分层修正**（v75 真机反馈：亮色下 `--input`（`#e2e5ea`）比 `--bg`（`#eceef3`）更暗，纯白内容卡反而比顶部 view-tabs/日期导航两条控件带更「轻」，层级倒挂；暗色 `--input`（`#1d1f29`）本就亮于 `--bg`（`#0e0f13`），无此问题）：新增 `--chrome` 令牌（四处主题块），暗色直接复用暗色 `--input` 值（零视觉变化），亮色取 `#f2f3f7`（比 `--bg` 更浮）；只把 `.view-tabs`（覆盖 `.seg` 共享底，源码顺序在其后、同优先级单类选择器即生效，`theme-seg`/`bucket-seg`/`record-mode-seg` 等其它 `.seg` 复用者不受影响）、`.nav-btn`、`.period-label`（与 `.nav-btn` 同一条 `.date-nav` 行，不改会一深一浅）三处的底从 `var(--input)` 改 `var(--chrome)`；其余约 9 处 `var(--input)`（`.inp`/`.form-time-row`/`.wheel-picker`/`.dt-trigger`/`.dt-step-inp`/各 hover 态/`.cell-group`/`.import-conflict-card`）保持不变——真正的输入井语义不动。`project_audit.py` 的 `WCAG_SURFACE_TOKENS` 加入 `--chrome`（与 `--bg`/`--card`/`--input` 同等受现有 4.5:1 护栏约束）；新增永久断言 `audit_chrome_surface_layering`：亮色 `--chrome` 相对亮度必须严格高于 `--bg`，P35 红灯证明——临时把亮色 `--chrome` 改回 `--bg` 同值后 audit 报 `light --chrome (#eceef3, luminance 0.8545) is not brighter than --bg`，改回后转绿。**SPEC-011 遮条底缘渐变**（真机截图确认遮条本身有效，但内容滑过底缘是硬切边、读起来像渲染缝，规格预留的退路）：`.statusbar-scrim` 新增 `::after`——`height: min(10px, env(safe-area-inset-top, 0px))`、`background: linear-gradient(to bottom, var(--bg), transparent)`、`pointer-events: none`，不新增 DOM 节点/z-index（继承遮条自身的 fixed 定位与 z-index:60 局部层叠上下文），渐变自身高度同样被 `env(safe-area-inset-top)` 钳制——浏览器上下文/无刘海桌面（safe-area=0）时 `min(10px, 0px)=0`，与遮条本身同等零footprint；真实设备（20/47/59px）钳到 10px（落在规格建议的 8–12px 区间）。新增 1 条测试断言渐变存在、非交互、浏览器上下文零高度，P35 红灯证明：临时删除 `::after` 规则后 `backgroundImage` 断言从 `linear-gradient` 判定改为收到 `"none"` 并失败，恢复后转绿。三单合计新增/改动测试详见自测清单章节；`FILES` 未变（无新运行时资产）。 |
| v75 | 2026-07-26 | SPEC-010 阶段二：亮色第三轮图底关系修复（历程：D11 一档折中 v69 → SPEC-004 整体回归冷白 v72 → 本轮）。两阶段流程收尾——阶段一（scratchpad 出变体 A 双主题截图 + WCAG 速算，不合并代码不 bump）经维护者拍板通过，本版落地发版并追加维护者点名的无障碍修正。**令牌 diff**（`styles.css` 两处亮色块，暗色一字不动）：`--bg` `#f7f7fa`→`#eceef3`（底色下沉一档，让纯白 `--card` 靠真实明度差「浮」起来）、`--input` `#eef0f4`→`#e2e5ea`（与新底重新拉开分离）、`--border` `rgba(28,32,44,0.10)`→`rgba(28,32,44,0.08)`（hairline 微降存在感）、`--faint` `#77747f`→`#66646d`、`--danger` `#cf4d5e`→`#ae414f`（后两项是维护者拍板时追加要求：验收复算发现这两个令牌在**v74 就已经低于 WCAG 4.5**——faint 对 bg/input 分别 4.28/4.01、danger 对 bg/card/input 分别 4.03/4.31/3.77——若只做变体 A 会把它们进一步压到 3.94/3.62 与 3.71/3.41，真实错误文案色被动继续变差，本轮一并修正而非只顺延旧缺口）；`--card`/`--track`/`--text`/`--muted`/三桶彩色本体与 tint/`--top-light`/全部阴影令牌不动。锚点同步：`index.html` 与 `src/app.js` 的 `#meta-theme-color` 亮色值、`site/index.html` 亮色 `--bg` 均随新值更新（manifest `theme_color` 是暗色值不动）。**WCAG 全量重校**（新值，vs bg/card/input）：`--text` 10.90/12.65/10.02，`--muted` 4.91/5.70/4.51，`--faint` 5.01/5.82/4.61（**修正后转为全部达标**，此前 4.28/4.58/4.01），`--danger` 4.93/5.72/4.53（**修正后转为全部达标**，此前 4.03/4.31/3.77）；三桶彩色对新 `--bg`/`--card`：`--accent` 5.87/6.82、`--maintain` 4.55/5.28、`--leak` 5.15/5.98，均 ≥4.5。暗色主题未改动，四个文字令牌对三个背景令牌逐一复算全部 ≥4.5（最低 `--danger` vs `--input` 4.54）。**新增永久 audit 护栏**：`scripts/project_audit.py` 新增 `audit_wcag_contrast`，用标准库自实现 sRGB 相对亮度公式解析 `styles.css` 的 `html[data-theme="light"]`/`html[data-theme="dark"]` 令牌块，对 `--text`/`--muted`/`--faint`/`--danger` × `--bg`/`--card`/`--input` 共 12 对逐一计算对比度，任一低于 4.5 即 fail；亮暗两套本轮实测全部达标，故两套都已启用（不是只亮色启用、暗色留空）。**P35 红灯证明**：临时把 `--faint`/`--danger` 两处亮色块改回 v74 旧值后跑 audit，实测输出 5 条 `WCAG contrast below 4.5:1` 失败（`--faint vs --bg/--input`、`--danger vs --bg/--card/--input`）；改回新值后复跑转绿，证明该护栏确实会因这两个令牌回退而失败，不是摆设。P22 滚轮层序回归（未碰 `--accent-bg`）双引擎复跑仍绿。 **验收补正（Opus 5）**：执行方只同步了 `site/index.html` 的 `--bg`，漏了它自己那套内联令牌里的 `--faint`——着陆页 13px 小字（`.cta-sub`/`.usage-note`/页脚）对新底对比度落到 3.94，等于把刚修掉的洞原样留在公开主页上；已同步为 `#66646d`，并把 audit 护栏扩到 `site/index.html` 的亮色 `:root`（护栏原本只看 `styles.css`，正是这个盲区放跑了它），红灯证明：护栏就位、site 未修时 audit 报 `--faint vs --bg = 3.94`，修后转绿。 |
| v74 | 2026-07-25 | v74 合并批次（三单一次版本仪式，`docs/decisions.md` D15 额度裁剪）。**SPEC-012** 修复 v73 回归——导入确认后 toast 被关闭中的 sheet 遮挡：真机 + 无头探针实测坐实，导入 sheet 是从「更多」下钻进入的，`confirmImportShift()` 的 `closeForm()` 命中 v41 既有 `returnToMore` 导航栈（自测清单第 7 条，保留不动），会同步把 `#form-sheet` 内容换回「更多」而不会真正 `hidden`——无论 `showInfoToast` 延迟多久，届时「更多」都已原地盖住屏幕（`elementFromPoint` 命中 `.more-body` 而非 toast），这不是一次性的 320ms 关闭动画窗口而是持续性遮挡；修法因此是反馈语义修法而非时序补丁：延迟 `showInfoToast` 到 `SHEET_CLOSE_MS`（与 `animateSheetClose` 320ms 兜底同源，reduced-motion 立即显示）之后，**并把 `#info-toast` 的 z-index 提到 `.form-sheet` 之上**（85，仍低于 `.cross-tab-banner` 的 90），确保它始终渲染在任何 sheet 状态之上，同时加入场淡入+上移过渡。导入成功用例的 `toContainText` 升级为 `toBeVisible` + 遮挡检测，新增时序回归锁定「延迟真实存在 + 不被更多 sheet 遮挡」。**SPEC-011** 新增 `.statusbar-scrim` 固定遮条：`black-translucent` + `viewport-fit=cover` 让 standalone 下滚动内容与系统状态栏文字互叠（真机截图实录），遮条渲染在 `.app` 之外（不进 v53 boot 快照范围）、高度 `env(safe-area-inset-top, 0px)`（浏览器上下文/无刘海桌面零高度零影响）、底色 `var(--bg)` 随主题、z-index 60（介于页面内容与更新横幅 75/`.form-sheet` 80 之间）、`pointer-events: none`；Playwright 无法仿真非零 safe-area，自动化断言收敛为存在性/fixed/z 序/浏览器上下文零高度不遮挡，真机截图终审留给维护者（本仓库首个如此标注的规格）。**SPEC-009-lite**（D15 裁剪：C6 第二例定案后确认背景里的卡死设备是即将退役的旧 origin 图标，新 origin 从未卡死，故只做手动出口，不做检测/计数器/横幅三态）——「···」更多新增常驻「修复更新通道」cell：在线时首次点击进入「再次点击确认」武装态（4 秒后自动收回，sheet 重渲染即天然失效无需清理），同一按钮第二次点击才 `fetch('sw.js', {cache:'no-store'})` 探活、通过才 `reg.unregister()` + `location.reload()`；离线只提示需要联网、不执行任何操作；任何路径都不自动 unregister/reload，文案写明「本机记录不受影响」（`localStorage` 全程不被触碰）。三单共新增/改动测试双引擎全绿（272 passed，另 2 条与本批次无关的既有测试在单次运行中出现与本改动无关的偶发 flake，重跑后稳定通过）。**CHANGELOG 表管理偏离**：加入本行后表格暂为 9 行（超出「只保留最近八版」的既定策略一行）——`v66` 尚未归档到 `docs/CHANGELOG.md`，执行方按指示未触碰归档文件，留给下一次维护通道处理。 |
| v73 | 2026-07-24 | SPEC-006（流程优雅性批次一）：**A 离线守卫**——`checkForUpdate` 加 `navigator.onLine === false` 判断即跳过 `reg.update()`，消除飞行模式下每次进入 PWA 必弹的 iOS 系统对话框（诚实边界：WebKit 自身按导航节奏的 SW 复查不受 JS 控制，极偶发系统提示仍可能出现，本改动只消除主要来源）。**B 原生弹窗清零**：全仓 4 处 `alert(` 替换——新增 `#info-toast`（复用 `.undo-toast` 视觉形态、无动作按钮、3 秒自动消退，独立于 `#undo-toast` 避免抢占撤销窗口）承接导入完成摘要与区间确认签名过期两处提示；导入解析失败/校验失败改为打开导入检查 sheet 的极简错误态（`renderImportEarlyErrorDialog`，只有「关闭」，复用 `.import-conflicts` 危险色块样式）。`project_audit.py` 新增 grep 规则永久禁止 `alert(`/`confirm(`/`prompt(` 回归。**C 滚轮挂载潜伏缺陷**（SPEC-004 执行方 PR #27 报告、Fable 核实定案）：`ui.js` L556 `plan-time-row` 曾用不存在样式规则的 `class="fl hidden"` 隐藏而非 `hidden` 属性，导致新建-记录（已发生模式）首次展开时间滚轮误挂进计划行的挂载点；修复为与兄弟行一致的属性写法（一行），`getFormWheelMount`/`mountNewTimePicker` 零改动即恢复正确路由。同步修正被 `.first()` 掩盖真实缺陷的现有测试定位符。零布局/交互改动（弹窗替换为应用内反馈本身即是本轮唯一交互变化）。 |
| v72 | 2026-07-24 | SPEC-004：亮色主题整体回归冷白（维护者推翻 D11 折中，「亮色还是怪怪的」）——`styles.css` 两处亮色令牌块（`@media (prefers-color-scheme: light)` + `html[data-theme="light"]`）同步改 `--bg`（`#f6f6f5`→`#f7f7fa`）、`--input`（`#f1efe9`→`#eef0f4`）、`--track`（`#e4e1d9`→`#e2e5eb`）、`--border` 与 `--shadow-1/2/3`（`rgba(48,42,30,…)`→`rgba(28,32,44,…)`，各档 alpha 不变）；`--card`、三桶彩色本体/tint、`--text`/`--muted`/`--faint`、`--top-light` 不动。`src/app.js` 与 `index.html` 的 `#meta-theme-color` 亮色锚点、`site/index.html` 亮色 `--bg` 同步（manifest `theme_color` 是暗色值，不动）。WCAG 重校：新 bg 更亮，对比度只升不降（正文 11.70→11.83、muted 5.27→5.33、danger 3.98→4.03，muted 对新 input 5.00 ≥ 4.5 门槛；三桶彩色对新 bg/card 对比度均高于旧值，无需调整明度）。暗色主题一字不动，零布局/交互改动。 |
| v71 | 2026-07-24 | SPEC-001（多模型协作协议首个执行批次）：旧 origin（`wowayou.github.io/time-logger/`）迁移横幅，host-gated——`src/app.js` 新增 `isLegacyOrigin()`（host + 带尾斜杠的 path 双条件，镜像预览路径 `time-logger-site/app/` 不误命中），新增 `#migration-notice`（渲染在 `.app` 之外、不进 v53 boot 快照范围，普通文档流、不与 fixed 的更新提示/FAB 竞争层级）；「知道了」写 `localStorage['timelog.migrationNotice.dismissed.v1']` 跨会话持久，「···」更多菜单新增仅旧 origin 可见的「迁移到新地址」cell 作为永久重开入口。新站与 localhost 零字节行为差异（门控之外的代码路径未改动）。零新运行时资产，`sw.js` FILES 不变。 |
| v70 | 2026-07-20 | v69 缺陷修复（维护者点名要求修，范围严格限于格言收尾）：① **长格言撑破窄屏**——`.motto-line` 缺断行策略，中文可任意位置断行故从未暴露，但一串不带空格的拉丁字符（粘 URL 即触发）在 320px 下把 480px 的行挤进 279px 容器并把文档撑到 399px，撞「窄屏不得横向溢出」红线；修＝`overflow-wrap: anywhere`（与全站 11 处用户文本同一惯用法）。② **60 字截断留尾空格**——`slice` 在 `trim` 之后，截断点恰落在空格上时渲染成「…… 」；修＝截断后再 `trim` 一次。回归两条，均已按 P35 教训**先证明「没修会红」再落地**（双引擎）。踩坑记录：首版回归是**绿色装饰**——`boot()` 的 `addInitScript` 在每次导航重跑 `localStorage.clear()`，`page.reload()` 把刚写入的格言擦掉，改走真实编辑 UI 才有效；随后又误测到另一个东西——点「完成」后指针停在原坐标、sheet 关闭后压住 header「···」触发其 hover tooltip，那是**先于本功能就存在**的缺陷（320px 下 tooltip 把文档撑到 399px，已登记 C15，本轮**不修**：非阻断、触屏不触发 hover、撞冻结边界），用例里就地移开指针并注明出处。同版本落档：C1 定案观察（v68→v69 交接首次取到 `SW态 a:activated`，无 waiting 悬挂＝C6 反证；但维护者确认期间**完全退出过**，自动链路独立切版仍零正例、3/3 同形态，问题收窄为「触发的那次 reload 没拿到新版本」）；启动诊断三个原始问题全部有答案、**可关闭**（间隔↔就绪相关系数 +0.05，长间隔不比短间隔慢，最快的冷启动恰是间隔最长那次）。见 `docs/decisions.md` D11 追补与 `docs/freeze-candidates.md` C1/C15 |
| v69 | 2026-07-20 | D11 定向开口（维护者批准，冻结期第三次）：① 亮色底色冷移一档 `#f7f5f1`→`#f6f6f5`——仅 `--bg` 两主题块 + `theme-color` 两锚点（index.html/app.js），卡面暖令牌（input/track/border/阴影）保留；WCAG 重校全部文字令牌持平或微升（正文 11.70:1、muted 5.27:1、danger 3.98:1），卡底分离 1.089→1.081。② 阶段格言展示区 v1（C13）：`config.motto` 三态（键缺失=默认「记录是手段，推进主线才是目的。」/空串=显式隐藏/非空=自定义；空白折叠 + 60 字上限，恰等于默认归一化回未设置）；日视图 hero 与时间轴之间一行安静小字 `#motto-line`（textContent 注入、CSS 生成引号、44px 触控高、静态壳空+hidden 同 `#usage-day` 纪律），点行或「···」更多「阶段格言」cell（隐藏态唯一入口）编辑——motto sheet 走 tall + returnToMore + 「恢复默认」；随 config 进完整备份，导入合并本机显式值优先（含显式隐藏），`validateImportData` 校验字符串。踩坑：`.motto-line` 的 `display:block` 压过 UA `[hidden]` 需显式让位；motto-body 沿 P34 判例脱离 `.form-sheet-body` grid 轨道。新增 5 条双引擎回归（三态/更多入口/导入合并/注入惰性）。③ 第三桶改名 漏损→偏航（C14，维护者原话「适时地放空是必要的」）：只改显示名与语义文案——`BUCKETS.leak` 显示名、hero 次要标签、chip 分组标题、config 选项/分节、`bucketHint`、校验错误文案、摘要 Markdown 两处、帮助页「4 桶」段（补「偏航不等于错误、可在标签高级设置改到维持」）；**内部键 `leak` 一律不动**（存量 config/备份/CSS 令牌按键走，改键＝强制迁移且旧备份读不回），故零数据迁移；回归锁「显示名＝偏航 且 落库桶键＝leak」。改名不重新归桶（发呆/娱乐仍在该桶，用户可自助改桶），历史 CHANGELOG 与 D5 候选沿用旧词不回溯改写。决策与诚实代价见 `docs/decisions.md` D11、`docs/freeze-candidates.md` C12/C13/C14 |

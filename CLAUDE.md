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
- `src/stats.js`：纯统计逻辑、按日分段、可选长段待核标记
- `src/pickers.js`：移动滚轮与桌面时间选择器
- `src/ui.js`：渲染模板、图标、tooltip helper 和 DOM 更新
- `sw.js`：Service Worker 离线缓存
- `manifest.webmanifest`：PWA 清单
- `icon.svg` 与 `icons/*.png`：运行时图标资产

允许的开发期工具包括 `scripts/project_audit.py`、`scripts/confirm_logic_smoke.py`、`scripts/bump_version.py`（版本仪式六处锚点一键联动）、`scripts/build_site.py`（D12：解析 `sw.js` FILES 组装 `time.eigentime.org` 部署产物——`site/` 主页 → 根、运行时 → `/app/`；`site/` 是非运行时静态主页源码，不进 SW 缓存）、`scripts/doc_sync_check.py`（改动与文档的同步闸，见下）、`npm run typecheck`（tsc 对 `time/storage/stats/entry_model` 四个纯逻辑模块做 JSDoc 类型检查，devDependency、无构建产物）和 Playwright UI smoke。Python 脚本使用标准库；确认逻辑 smoke 会调用本机 `node` 导入真实 ES modules；Playwright 只用于开发期响应式验证。

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

改动与文档的同步闸（v88 后，`.claude/settings.json` 的 PreToolUse hook → `scripts/doc_sync_check.py`）：

- **时机是提交前与推送前，不是每次编辑后**。编辑中途的形态不是最终形态，那时写文档只会写错再改；会话结束才提醒又太晚（改动已进历史）。`git commit` 前是唯一「已定形、还来得及把文档一起 stage」的时刻；`git push` 前是第二道网，专抓「提交时忘了、后来也没补」。
- **拦一条**：改动集里有运行时文件（`src/`、`index.html`、`styles.css`、`sw.js`、`manifest.webmanifest`、`icons/`、`icon.svg`）却没有 `CLAUDE.md`——运行时一改就要走版本仪式，二者必然同批。
- **提醒两条**（不打断）：动了运行时或对外文案却没动 `docs/HANDOFF.md`；动了对外文案而 README 的 `Updated:` 还停在今天之前。
- **改动集取全量工作区**（`git status --porcelain -z`：暂存 + 未暂存 + 未跟踪），**不是暂存区**。PreToolUse 在整条命令执行前触发，而 `git add -A && git commit` 是一条命令——那一刻还没 add，`git diff --cached` 恒为空、闸恒放行（2026-08-10 实测坐实过）。代价是「改了但这次不打算提交」会误报，逃生开关就是给这种情况的。
- **matcher 只写 `Bash`，不用 hook 的 `if:` 字段**：那是权限规则的前缀语法，`Bash(git commit*)` 匹配不到 `git add -A && git commit`，也匹配不到 `cd x && git commit`；判定放在脚本里的正则。
- **正则锚定命令位置**：`\bgit\s+commit\b` 会把 `echo "记得 git commit"` 也拦下（实测）；合法起点只有行首/`;`/`&`/`|`/换行 + 可选 `VAR=value` 前缀，且要放行 `git -C <path> commit` 这类带值全局选项。
- **粗筛在 hook 命令里用 bash `case` 内建**：`matcher: "Bash"` 会在每条命令上开销一次进程（实测 53ms），命令里没有 `git` 就不启动 python（降到 12ms）。粗筛刻意做宽——只会多调、不会漏调，判据仍只有脚本里那一份。
- 判据全部来自本文件已有的红线，不新增规矩。逃生开关是命令前缀 `SKIP_DOC_CHECK=1`（本仓用 `git commit -F -`，提交信息进不了 hook 的视野，所以开关不能是消息里的标记）；`--amend` 与 `--no-verify` 同样豁免。任何异常一律放行——因为 git 抽风就卡住提交的闸比没有更糟。
- **它只查「有没有碰文档」，查不了「写得对不对」**：防的是彻底忘记，不是敷衍。
- **它看到的是命令执行**前**的状态**：同一条 Bash 命令里「先改文档再提交」会误报（PreToolUse 的时序本性，脚本修不了）。把文档编辑与 `git commit` 分成两次调用即可——提交前那一眼 `git status` 本来也该是独立的一步。

提交与推送前红线：

- 至少跑 `python3 scripts/project_audit.py`、`python3 scripts/confirm_logic_smoke.py`、`npm run test:ui`、`git diff --check`。
- 推送前检查 `git status --short`，确认没有真实记录、真实截图、导出 JSON、Playwright 结果或本机临时文件。
- 产品、架构、隐私、发布存续等决策一旦落入 `docs/decisions.md`，应及时形成边界清晰的独立提交并推送，不长期只留在本地；不得顺带混入无关工作区文件。
- 正式版本推送到 `main` 后，必须创建并推送同版本 Git tag（例如 `v16`），让 GitHub 上有稳定发布锚点。
- 正式版本 tag 推送后，必须创建或更新同版本 GitHub Release；release notes 简短列出用户影响、内部治理和验证结果，不贴真实数据或截图。
- **只改 `site/` 时也要发布一次**：`publish-site` 只在 `v<N>` tag push 时触发，所以纯文案改动会让线上主页无声地停在上一次发布（2026-08-10 实测过一次）。改完 `site/` 走 `gh workflow run publish-site.yml`（已加 `workflow_dispatch`），或按 `scripts/build_site.py` 顶部说明本地组装后推镜像；发布后用 `curl` 复核线上那一行确实变了。**不要**把触发条件改成「push 到 main 就发」——那会把还没打 tag 的运行时一起推上线。
- 除非用户明确要求，不把无关重构、真实数据或工作区外文件混进同一个提交。

## 当前版本

当前版本：`timelog-v1.1.0` / manifest `version: "1.1.0"`。

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
- 本地自然日 00:00 是统计硬边界；空日不继承前一天最后标签；有明确右邻记录的跨日闭合段会切入后续日期，但**最多切入次日**（v87）——右邻落在 D+2 00:00 或更晚时段落止于当日 24:00，中间那些自己一条记录都没有的日子整日无记录（与从未记过的日子同一表现），判据在 `segmentBoundsForEntry`，`confirmSegmentInData` 共用同一函数因此天然一致；有首条记录的日期从 00:00 到首条之间计为未记录；周/月/年汇总按每日独立统计累加。
- **长段待核是本机可选提醒，默认关闭**（v89，`config.longReview === true` 才开启）。关闭时明确标签段无论多长都直接按原桶统计，不显示待核、不要求确认；开启时，超过 3h 的非 `longOk` 段会附加 `pending` 提醒，但仍留在原桶，`pending` 是可与四桶重叠的注记分钟数，不得再并入 `unrecorded` 或从原桶扣除。“确认”只写入与 `startTs` / `endTs` 绑定的 `longConfirm` 以清除提醒；相邻时间变化或中间补录仍使其失效。确认侧与渲染侧都走 `loggedEntriesFrom`。历史 `longConfirm` / `longOk` 不迁移、不删除；导入备份不得替用户开启本机 `longReview`。任何写入路径都不得自动盖确认章。
- 时间戳是本地壁钟值，不做时区转换；跨设备导入可根据备份 `meta.sourceTimezoneOffsetMinutes` 建议“整体平移 ±N 小时”，用户仍可覆盖。
- 续记模型以所看日期为准：空日默认从 00:00 开始；有记录日按**尾点形态**分流（v77）——尾点是空占位条（或今天的进行中段）时默认续该点、FAB 文案「续 hh:mm 起」；尾点是**真实记录**时那天已被它覆盖到 24:00、没有可续之物，默认取**其后一分钟**、文案改「补记 hh:mm 起」（旧行为返回该记录自身的 ts，默认值恒撞同刻冲突，点进去必被拦）；尾点压线到 23:59 时当天不存在合法新增起点，**隐藏 FAB**，绝不把默认值越过午夜写进第二天。补录到已有右邻记录之前时结束点吸附右邻；今天无右邻到当前时间，非今天无右邻到 24:00。**占位条只有在新起点不晚于它时才可以复用**（v87）：复用＝把占位条的 `ts` 挪到新起点，往前挪是「续记」的正常语义（新记录把这段空白整个盖住，前一条相应截短），往**后**挪则是把 `[占位点, 新起点)` 这段「确实没记」静默改写成前一条记录的标签——踩 D13 硬约束③，而且改的往往是主线时长。晚于占位点时新建条目、占位条留在原地。
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
5. 日视图 hero 结论卡显示主线净时长大数字 + 偏航次要数字 + 比例条 + 辅助行（维持/未记录/截至）；周/月/年 ruler/摘要显示主线、维持、偏航、未记录 4 桶；默认关闭长段待核时吃饭 6h 直接计入维持，开启后显示“待核”但维持分钟数不变，睡觉 6h 因 `longOk` 不提醒。
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
| v1.1.0 | 2026-09-21 | **「更多」里的自愿支持入口（D30，修订 D28）**。渠道定爱发电（账号身份＝创作者本人 Eigentime·CG-X，非本项目），应用内只放一条外链指向 `https://eigentime.org/support?from=time-logger` 的**中转页**、**不直连收款平台**——换/加平台时只改那一页，不用为此走一遍发版仪式。入口是「更多」sheet 里排在「高级」之后的一条 `a.cell-btn`（外链，`target=_blank rel=noopener`），旁附三句**事实陈述**：完全自愿 / 所有功能始终免费、无广告无内购 / 支持不购买任何功能、优先权或产品方向（措辞纪律：不制造义务感、不喊紧迫、不卖惨，不提作者处境）。**应用内零支付界面、零埋点**：没有金额档、没有支付控件、不嵌收款页，也不接分析 SDK——规格要的 `support_click` 属于中转页那一侧，「哪个项目带来赞助意愿」由 `from` 参数在网站侧回答。**来源参数逐字 `time-logger`、且 URL 不按 locale 分流**：这与旁边 `PRIVACY_URL` 的分流写法相反，`from` 是归因字段、两种语言必须落进同一个来源桶，照抄 PRIVACY_URL 的分流会把来源桶静默拆成两份（界面上看不出）——`tests/v1_1_0_support_entry.spec.js` ② 留了反向哨兵守这一点。英文文案用 "Support the author" 而非规格给的 "Support Time Logger"（后者撞 D29「英文品牌统一 Eigentime、弃用通用词 Time Logger」）。**显式修订 D28**：D28 原文「`/support` 上线前应用内不放链接（宁可少一行也不给死链）」，而 2026-09-21 实测该页仍 404；AI 提出冲突后**维护者裁定直接发布上线**，接受上线前的死链窗口——缩短窗口的正确动作在网站侧补 `/support`（改一页轻），不是在本仓回滚（重发一版）。若网站最终落成 `/zh/support/` 带前缀形态，须让无前缀 `/support` 保持可达（重定向即可），否则本仓要再发一版改 URL。新增 `tests/v1_1_0_support_entry.spec.js` 6 条（zh 入口位置在「高级」之后 + URL 逐字 + 外链属性；en 同一 URL 反向哨兵；zh/en 诚实声明三要素；核心流程零打扰＝主界面与新建表单里零链接；应用内不直连平台且矮视口 375×600 下入口仍可达＝全 DOM 无 `afdian`/爱发电痕迹）。**不构成任何市场验证**（外部验证至今未开始，D9 未变）；V1 边界＝不接任何支付/Webhook/账号 API，D13 四条硬约束不受影响。零新增运行时资产（`FILES` 不变）；`docs/CHANGELOG.md` 归档 v87。 |
| v1.0.0 | 2026-09-10 | **版本格式改三段式 + 发布防护 + Web→Android 显式契约**。① **版本号从单整数改为 `MAJOR.MINOR.PATCH`**（`v93` → `v1.0.0`，历史 tag 与归档条目保留不改）。digit-only 判据实际散在**七处**而非六处：除六锚点外，`project_audit.py` 还断言 CLAUDE.md 含本表 `| vN.N.N |` 行；`bump_version.py` 推广为三段式，支持 `--patch/--minor/--major` 自增并按元组比大小（旧代码 `int(target) <= int(current)` 在三段式下抛 `ValueError`）。**digit-only 残留实为第八处**：`app.js` 启动诊断的缓存采样与 `sw_cache_scope.spec.js` 的「当前缓存存在」断言都用了 `/^timelog-v\d+$/`，迁移后永远匹配不到——发布闸全量双引擎 2 failed 才逮到（此前门禁只跑了迁移 spec，未跑全量）；采样一并改 semver 排序（三段式恒新于单整数），诊断的「缓存」格恢复有值，回归由 sw_cache_scope ④ 值级断言锁住。**数据兼容性与产品版本完全解耦，本次迁移不动数据**：存储键 `timelog.v1`/`timelog.config`、备份载荷 `version: 1` 都与产品版本无关，`exportMeta()` 不写 app 版本、`validateImportData` 不校验 app 版本——v1.0.0 导出的备份能被 v93 读回，反向亦然。新增 `tests/v1_0_0_version_migration.spec.js` 把这条从文字承诺变成可执行判据（跨版本备份互读、锁死「存储键/载荷 version 不得跟随产品版本改名」的反向哨兵——其探针在夹具写种子**之后**安装并触发真实保存、断言写入键与内容，杜绝夹具污染的假绿）。**一处预期内的一次性行为**：启动快照门 `snap.appVersion !== APP_VERSION` 让升级后第一次冷启动判 `rejected:version` 并退回正常启动路径——设计如此，不是回归。② **Web→Android 契约显式化（两仓）**：新增 `native-contract.json`（开发期文件，刻意不进 sw.js FILES，audit 有反向断言），登记 android 侧真实依赖的 4 模块 15 个 export 与 **7 个 DOM selector**（`body.app-ready` 为审查后补的第 7 个——安卓 `shell_browser_check` 等着它，web 改名原本两仓全绿）。web 侧 `audit_native_contract()` 用 Node 真实导入模块按实际导出键集校验（别名/注释不算），selector 静态预检逐段校验；`tests/native_contract.spec.js` 在真实渲染 DOM 验证全部 selector 可命中（`#form-*` 自动开表单）。安卓侧 `audit_contract_covers_dependencies()` 四向反查：桥 import 的 (模块, 符号) 必须已登记、契约 export 必须真被 import、消费方（MainActivity.kt / shell_browser_check.mjs）用到的 selector 必须被契约覆盖、契约 selector 必须真有消费者——删掉契约条目不能绕过检查，四向红灯逐一验证。套件**不保留**「先破坏 DOM 再断言命中 0」的自证式用例（验证的是 CSS 语义不是应用，契约怎么坏都绿）；红灯证据以「临时变异 → 对应用例/闸红 → 恢复」的过程形式留在提交说明。安卓仓同步适配三段式：`sync_runtime.py` 校验 semver；`build.gradle.kts` 的 versionCode＝major*10_000_000+minor*100_000+patch*1_000+revision（1.0.0.1 = 10_001_001，大于旧方案 9301，跨格式不回退），audit 加编码上界（minor/patch ≤ 99、revision ≤ 999）防跨字段进位撞码；内嵌运行时已同步至本版本。③ **发布防护**：`publish-site.yml` tag glob 同时接受 `v[0-9]+` 与 `v[0-9]+.[0-9]+.[0-9]+`——不匹配的后果不是报错，而是 publish-site 静默不触发、线上主页停在上一次发布（2026-08-10 实测过同形失败）；同批加「tag 与 manifest 版本一致」校验（workflow_dispatch 豁免）。`.gitignore` 补 `*:Zone.Identifier`（Windows 下载伴生文件，主文件已被挡、这个没有）。④ **文档**：HANDOFF 登记 v1.0.0 各批交付、对侧契约闸与审查修复；本 CHANGELOG 行**修订为只含已落地内容**——预写条目曾含未实施声明（安卓 release fail-closed 签名、`app/release.properties` versionCode、`sync_runtime.py --release` 预检、`STATUS.md` 状态治理、site favicon 与首屏文案），已全部移除并登记为 HANDOFF 待办；其中 STATUS.md 状态治理、site favicon 与首屏文案已于 2026-09-12 补齐（site 走 publish-site 直发，不经版本仪式），安卓 fail-closed 签名与 `sync_runtime.py --release` 在安卓仓落地（`release.properties` 计数器方案经定案否决，维持 semver 派生）。零新增运行时资产（`FILES` 不变）。 |
| v93 | 2026-08-15 | **压测补洞：一致数据快照 + 配置页 CAS + 完整年视图压力闸**。审计 v92 的 CAS 写路径发现 `load()` 后再 `readRaw()` 的双读取窗口：另一标签页若在两次读取之间写入，旧数据对象会配上新 raw，`saveChecked` 反而放行并覆盖对方。`storage.js` 新增 `loadSnapshot()`，一次 `getItem` 同时返回解析对象与逐字对应的 raw，app/sheet/io 共 10 条数据写入路径全部改用；配置页、导入合并及即时标签保存同样改用配置快照 CAS，旧表单不会覆盖另一标签页的改名。配置写入失败后的数据补偿回滚也改为带 raw 的 `saveChecked`，并发期间不会再用无条件 `save()` 抹掉新记录；回滚无法安全完成时给出明确提示。新增可控竞态回归，证明对方记录/配置保留、当前动作中止并提示。压测生成器同步纠正为约 15 条/天（旧版 24 小时连续铺点，5000 条只覆盖约 3 个月），新增 5000 条、约 11 个月年视图压力用例：双引擎实测 226/333ms、`timelog.config` 读取 4 次，2s 灾难性退化闸与结构性读次数闸均通过。零新增运行时资产（`FILES` 不变）。 |
| v92 | 2026-08-13 | **压测修复：跨标签页 CAS 保护 + 回滚检查 + 文案对齐**。三个并行子代理对全部源码深度审计，发现并修复三类缺陷。① **跨标签页竞态条件**：`localStorage` 是 last-write-wins，两个标签页同时 `load()` → 修改 → `save()` 时第二次写入静默覆盖第一次。新增 `saveChecked(d, expectedRaw)` + `readRaw()`：所有 10 条写入路径在 `load()` 后捕获 localStorage 原始字符串快照，写入前比较——不一致说明另一个标签页在中间写了，中止写入并提示 `toast.concurrentWrite`。不能完全消除竞态（`readRaw` 和 `setItem` 之间仍有极小窗口），但把窗口从「整个用户操作周期」缩小到「一次同步函数调用内」。② **三处回滚 `save()` 返回值未检查**：`rememberTagOrRollback`（影响全部 6 条记录保存路径）、`saveTagConfig` 回滚、`applyImportedData` 导入回滚——回滚失败时数据留在半事务状态（记录已迁移但配置未更新，标签成为孤儿掉进未记录桶），正是 v90(P38) 本应消除的故障模式。现在检查返回值，失败时显示 `io.importRollbackFailed`。③ **文案对齐**：`manifest.webmanifest` 描述和 `README.md` 仍使用「求职主线」，与 v89 种子中性化矛盾（v89 已将种子从「求职推进」改为「当前主线」）；`docs/external-ai-review-brief.md` 和 `docs/specs/SPEC-014-english-ui-catalog.md` 同步。新增 i18n 键 `toast.concurrentWrite` 和 `io.importRollbackFailed`（zh/en 对等）。零新增运行时资产（`FILES` 不变）；`docs/CHANGELOG.md` 归档 v84。 |
| v91 | 2026-08-13 | **v90 那一批漏网的两条写入路径：确认长段与「标记已发生」吞掉 `save()` 的失败返回值**。v90 统一了配置侧（P38）与删除路径（`app.js` 的 `deleteError`），`sheet_controller.js` 九处写入也全都检查——**只有这两个行内动作漏了**，成因看得出来：它们没有 sheet 可以挂 inline error。后果不是「少一句提示」：`save()` 失败后 `render()` 照常重新 `load()`，界面回到原样，用户只看到**点了没反应**——与 v89 那条「复制没反应」（异常从事件处理器抛出去没人接）逐字同形，只是这次连异常都没有。两处补上 `if (!save(d))` → `showInfoToast(t('toast.writeQuota'))`；`confirmPlanned` 改的是内存对象图，失败后整个丢弃，故不需要回滚。新增 i18n 键 `toast.writeQuota`（zh/en 对等），与既有 `toast.deleteQuota` 并列而不复用——「删除没有执行」和「这次改动没有保存」是两句不同的话。新增 `tests/v91_confirm_quota.spec.js` 3 条（双引擎 6/6）+ **三处 P35 红灯**（撤掉 `confirmPlanned` 守卫→只有「标记已发生」那条红；撤掉 `confirmSegment` 守卫→只有「长段确认」那条红；把提示改成**无条件**弹→只有反向哨兵红）。**红灯③第一次没点亮，暴露出哨兵本身是假的**：`toBeHidden()` 会自动重试到默认 5s 超时，而 toast 自己 3s 后消失——它等到 toast 自然过期再判过，于是「无条件弹提示」照样全绿。改成一次性的 `isVisible()`（前两条断言已证明点击处理器跑完，不存在「还没来得及出现」的竞态）后红灯③才正确点亮。**这条教训与 HANDOFF「已知坑」里的「反馈类断言一律 `toBeVisible()`」是同一枚硬币的反面**：断言「不该出现」时，带自动重试的否定断言会把「暂时出现过」判成通过，必须用一次性读取。缺陷本身由探针先在真实页面复现（前置断言证明拦截器被调用过、数据确实没落库，唯独「用户看到了什么」为空），再转成正式用例。零新增运行时资产（`FILES` 不变）；`docs/CHANGELOG.md` 归档 v83。 |
| v90 | 2026-08-13 | **压测与全量回归发现两条隐藏写入缺陷**。① `saveConfig()` 未捕获 `QuotaExceededError`，且标签改名/合并先写 `timelog.v1` 再写 `timelog.config`：第二步失败会留下记录已迁移、配置仍旧的跨 key 半事务（P38）。配置保存现统一返回失败；单配置动作保留 sheet；标签设置与「记录 + 自定义标签」按写前快照补偿回滚；导入也识别失败返回值。② sheet 打开尾部无条件排队的 `requestAnimationFrame(panel.focus)` 在高负载连续操作中会迟到，抢走已经进入 sheet 的输入/按钮焦点，偶发吞掉第二次格言保存点击（P39）；现仅在焦点仍在 sheet 外时聚焦面板。新增 `tests/v90_storage_pressure.spec.js` 3 条（双引擎 6/6）、纳入 stress；旧 C 类配额 mock 从**给 `localStorage` 实例赋值**改为拦 `Storage.prototype.setItem`——前者不能可靠遮蔽原生方法，那条用例可能一直没真的注入过故障（**看起来在测配额，其实在测什么都没发生**）。格言连续保存用例把第二次点击后的 config 断言**前移到 UI 隐藏断言之前**：原顺序下丢点击表现为等待超时，前移后变成即时硬失败，失败信息直接说明「保存事件没执行」而不是「渲染慢」。**五处 P35 红灯逐一点亮**（原提交漏声明，移植时补齐）：撤掉 `saveConfig` 配额捕获→3 条全红；撤掉标签设置的补偿回滚→只有标签改名那条红；撤掉自定义标签回滚→只有自定义标签那条红；摘掉 sheet 聚焦守卫→**负载下才红**（`--workers=6` 重复 30 次得 6 红，空闲 20/20 全绿——竞态判据必须在负载下点灯，空闲机器上点不亮不等于守卫没用）；把 C 类配额 mock 退回实例赋值→**WebKit 上用例照样绿、但故障根本没注入**（见 P38 的引擎对照表）。修复后同一负载配置双引擎 60/60。**基线更正**：本批最初做在 `de93566` 上，其后 main 已推进七个提交，已移植到最新 main——两条复盘因 P37 被「WebKit 代理白名单」占用而顺延为 **P38/P39**；原报告的「5000 条启动倍率 1.44×/1.92×」描述的是**已被删除的第二代比值判据**，作废。新基线双引擎全量 **436 passed / 0 flaky**；stress 单跑 21 passed + 1 条既有负载敏感 flake（WebKit 500 条档 delta 98ms 撞 80ms 预算，空闲重复 5/5 通过、分布 0–27ms，且本批在启动路径上零改动行，判为既有波动，**未动阈值**）。零新增运行时资产（`FILES` 不变）；`docs/CHANGELOG.md` 归档 v82。 |
| v89 | 2026-08-11 | **移除默认长段确认门槛，改为默认关闭的本机待核提醒**（D25）。真实备份回看表明，3h 阈值会把已明确标注的正常长段整体挪进未记录，制造比漏记更大的统计失真；确认本身又容易被遗忘，不能承担统计真实性的闸门。默认状态下所有明确标签段直接按原桶统计，不再显示待确认。高级设置可显式开启 `longReview:true`：超过 3h 的非 `longOk` 段附加“待核”注记和确认入口，但**原桶分钟数不变**，`pending` 只作可重叠提醒；确认只清提醒。逐标签 `longOk` 在开关关闭时隐藏但保留配置。历史 `longConfirm` / `longOk` 不迁移；导入备份不替用户开启本机偏好。更新 zh/en 文案、帮助、README、HANDOFF、决策与冻结候选记录；文案同步从「减法」改成「加法」（`hero.pending` 待确认 →「**其中**待核」、`io.summaryPending` →「其中时长待核」、`help.p2a` 删掉「未记录＝…待确认长段」）——口径变了而文案没变，等于换一种方式说谎。新增 `tests/v89_long_review.spec.js` 5 条（默认关闭 / 开启后仍保桶色与桶分钟 / 逐标签显隐 / 摘要待核行条件输出 / 摘要遇未记录缺口不抛异常）+ **六处 P35 红灯**（`unrecorded` 改回 `|| pendingConfirm` → 红、`reviewEnabled` 恒 true → 红、让导入能开启 `longReview` → 红、逐标签 `longOk` 恒显示 → 红、`io.summaryPending` 改回无条件输出 → 红、摘除缺口行守卫 → 红），每次只有对应那条变红。**追溯效应如实登记**：本改动会改变历史统计——维护者 633 条真实备份实测，主线 215h49 → **220h40**、未记录 15h27 → **10h36**（四桶加总仍等于 total 1028h41），差额 4h51 是一段曾被确认、又被无关编辑静默撤销确认的主线时间。同批清掉两处：`ui.js` 的 `pending-review` 行级 class 无样式无用例（死类，已删——待核的两个信号是时长列「待核 · X」与行内「确认」，行底色会破坏 v56「竖脊＝唯一颜色语法」）；`io.summaryPending` 由无条件输出改为条件输出（与既有 `io.rowPending` 同一写法，否则从没开过该功能的用户每份摘要都带一行「其中时长待核：0分钟」）。**同批还修掉一条与本功能无关、v88 及更早就存在的静默崩溃**：无主未记录段没有条目（`pushUnknownSegment` 置 `e: null`），而 `io_actions.js` 的日视图明细直接读 `e.what`，于是**任何有前导/中段空白的日子**点「复制当前视图摘要」都抛 `TypeError`——异常从事件处理器抛出去没人接，剪贴板一个字不写、界面也不报错，用户只会以为「复制没反应」。渲染侧 `renderTimeline` 早有 `if (!e)` 分支，明细补齐同一形状（复用 `timeline.gapWhat` / `io.noteUnrecorded`，不新增 i18n 键）。它活到 v88 是因为既有摘要用例用的 `planned-only` 夹具那天恰好没有缺口——**夹具选得太干净，等于没测**。新用例的判据包含 `pageerror` 数组为空：只断言文本会漏掉「异常抛了但恰好不影响这几个字」。零新增运行时资产（`FILES` 不变）。 **同批（原计划单独发 v90，维护者决定折入本批，故本条含两批内容）**：**出厂默认主线不再是维护者自己的目标**（起因：维护者拿来一份外部 AI 生成的 onboarding 方案要我调研。调研结论是那份方案不成立——它把产品说错了四处：以为有「開始計時」按钮（本产品没有计时器，只记起点、时长靠下一条推断）、要设时区（红线明文「不做时区转换」）、要绑 Google Calendar / 通知 / 浏览器扩展（撞铁律与隐私红线）、要「先選擇關注的時間分類」（逐字违反 D13①「不要求先创建标签体系」）。它建议的「概念卡片」也是冗余：四桶概念早就教在**第一次用到它的那一刻**（表单里的 `归类` 分段控件 + 桶提示行），而卡片是在需要之前教。它建议的「預設 Dummy data」在本产品里更是有害：只有 `localStorage['timelog.v1']` 一个权威存储、没有沙箱，假记录会进完整备份、并让 `recordingMilestones` 从第一天就报「已记录 N 天」——而红线写着「一条真实记录都没有时不编造里程碑」，同时撞 D13③。**但实测首次打开时确实发现两条真问题，都不需要引导流程**）。**①「求职推进」/「Job search」是作者当时的处境，不是产品语义**：对外定位（D13 锁定）是目标中立的「5 秒记下真实做了什么」，可新用户第一次打开表单，唯一预填好的主线标签写着「求职推进」，默认格言还在旁边说「推进**主线**才是目的」——**首次体验的毛病不在「缺引导」，恰恰在那个零步骤里唯一的预设值是错的**。种子改为中性占位（zh `当前主线` / en `Current focus`），help 文案同步说明「改名成你自己的」。种子只在 `normalizeConfig` 的 raw 为空分支生效，**存量用户一个字不变、零迁移**，反向哨兵用例锁死这一点。**②「偏航」是三个桶里唯一不自解释的**，而它第一次出现时唯一的解释在「···」更多的说明里——新用户最不会点的地方。解释加进 `bucketHint.leak`：那一行本就随选中的桶实时切换、就在桶控件正下方，是天然位置，零新增 UI、零布局改动。措辞保留「不含褒贬」，红线要求它不得回退成「逃避娱乐」式说法。新增 `tests/v89_neutral_seed.spec.js` 4 条（zh/en 全新安装种子 / 存量 config 逐字不变的反向哨兵 / 选中偏航当场给出解释且不带道德评判）+ **两处 P35 红灯**（种子改回作者目标 → 红、`bucketHint.leak` 去掉语义解释 → 红）。**同批修掉一个比本功能更值钱的测试基建问题**：`tests/ui_fixture.js` 此前只给三个 state（`pending-confirm-lunch`/`custom-chip`/`renamed-default`）显式写 `timelog.config`，其余全部落到产品的出厂种子——于是本仓 200 多条 zh 断言（点「求职推进」chip、按主线桶算分钟数）**隐式**依赖着产品默认值。改种子时它们的症状不是「断言失败」而是**挂起**：定位器等一个永不出现的 chip，每条超时 30s，全量从 2.2min 变成十几分钟仍跑不完，且 `tail` 缓冲让进度完全不可见——**一个隐式依赖能把「改错了」伪装成「机器卡了」**，这是本批最难回溯的一段。夹具改为**总是**显式写下它自己那份 config（内容保留旧的「求职推进」种子，故既有断言逐字不动），产品默认值从此只由 `v89_neutral_seed.spec.js` 一处锁定：夹具钉自己的输入，用例测产品的默认，两件事分开。修好后全量 **215 passed / 0 flaky / 2.1min**。零新增运行时资产（`FILES` 不变）；本批不归档旧版本（表内仍为 v82–v89 八行）。 |
| v88 | 2026-08-10 | **v87 审计登记但当时没修的四条**（都不是阻断级，攒成一批；起因是维护者「bug 要修」）。**① 「标记已发生」会把记录挪进第二天**：同刻躲让原本无条件 `+1min`，`nowStr()` 落在 23:59 且那一分钟已被占用时，记录静默落到**次日 00:00**——改变的是「这件事发生在哪一天」，与 v87 那两条同属静默改写。新增 `freeMinuteOnSameDay`（`entry_model.js`）：先向后（与既有 `+1min` 方向一致）、当天到头再向前，同一天真的排满就返回空串、调用方明说并**放弃写入**，绝不越午夜。**② 计划保存是唯一不过 `normalizeEntries` 的表单写入路径**：于是「今天恒有尾占位」这条不变量会在「今天最后一条是真实记录 + 本次只加了一条计划」时破掉，FAB 随之从「续 12:34 起」退化成「补记 00:06 起」。补上即可——计划条不参与 coalesce，走一遍只补占位、不动已有记录。（**导入路径刻意不补**：`normalizeEntries` 里的 `coalesceRedundant` 会删掉相邻同日同标签同文本的条目，对刚导入的一批数据跑它＝可能静默丢弃备份内容。）**③ 计划与尾占位条可并存在同一时刻**：`saveEntry` 把占位条当「自己」从冲突检测里排除，而 planned 分支是 push 一条新记录、**从不复用**占位条——排除了就会造出重复时间戳，而「同刻唯一」是 `findTimeConflict`、导入的 `byTime` 映射、事务 planner 的 `duplicateTimestamp` 共同依赖的前提。正常路径够不到（计划必须晚于 `now+5min`，占位条在 `now` 之前），导入他机备份或改系统时钟能造出来。**④ 「修复更新通道」的探活被自己的 SW 缓存吞掉**：`sw.js` 在 `FILES` 里，fetch 处理器是 cache-first（`caches.match(req) || fetch(req)`），所以 `fetch('sw.js', {cache:'no-store'})` **断网时照样返回 200**——真注册 SW + `context.setOffline(true)` 实测 `ok=true`，同一请求带查询串才正确抛 `TypeError`（`caches.match` 默认不忽略 search，故必然 miss、落到真实网络；`cache:'no-store'` 只管 HTTP 缓存，管不到 CacheStorage）。**这条不是「少一句提示」**：守卫失效意味着离线用户会在这里`unregister()` 掉 SW 再 `reload()`，而那次 reload 已经没有离线兜底了。改为 `sw.js?probe=${Date.now()}`。新增 `tests/v88_fixes.spec.js` 4 条 + `confirm_logic_smoke.py` 四条纯逻辑断言（含「整天排满 → 返回空串」，1440 条的用例放纯逻辑侧而不是 UI 侧）+ **四处 P35 红灯**（躲让改回无条件 `+1min`→①红、计划保存去掉 `normalizeEntries`→②红、计划仍排除占位条→③红、探活去掉查询串→④红），每次只有对应那条变红。新增 i18n 键 `toast.plannedNoFreeMinute`（zh/en 对等）。零新增运行时资产（`FILES` 不变）；`docs/CHANGELOG.md` 归档 v80。 |

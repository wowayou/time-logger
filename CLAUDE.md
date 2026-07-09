# CLAUDE.md — 时间尺维护规范

## 项目性质

时间尺是**单页静态零运行时依赖 PWA**。运行时结构只包括：

- `index.html`：DOM 壳、PWA/meta 引用、`styles.css` 和 `src/app.js` 模块入口
- `styles.css`：全部样式
- `src/app.js`：启动、状态组合、导航、渲染调度、事件委托、测试 API 和 Service Worker 注册
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

允许的开发期工具包括 `scripts/project_audit.py`、`scripts/confirm_logic_smoke.py` 和 Playwright UI smoke。Python 脚本使用标准库；确认逻辑 smoke 会调用本机 `node` 导入真实 ES modules；Playwright 只用于开发期响应式验证。

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
- `src/entry_model.js`：只放记录日期模型、续记默认起点、占位条、结算点、同刻冲突、`+1min`、补录有界插入（`carveInsert`）、无冗余边界归一化（`coalesceRedundant`）和写后统一出口（`normalizeEntries`，恒保今天尾占位）等纯/低副作用 helper；不访问 DOM / localStorage。
- `src/io_actions.js`：只处理当前视图摘要、复制、下载、导入、分享；通过显式依赖接收 `load/save/render/state`，不拥有全局状态。
- `src/sheet_controller.js`：只处理新建/编辑/config/import sheet、focus trap、picker 重挂载和表单保存；通过显式依赖读写状态和持久化。
- `src/app.js`：只负责启动、状态组合、导航、渲染调度、事件委托、测试 API 和 Service Worker 注册。

提交与推送前红线：

- 至少跑 `python3 scripts/project_audit.py`、`python3 scripts/confirm_logic_smoke.py`、`npm run test:ui`、`git diff --check`。
- 推送前检查 `git status --short`，确认没有真实记录、真实截图、导出 JSON、Playwright 结果或本机临时文件。
- 正式版本推送到 `main` 后，必须创建并推送同版本 Git tag（例如 `v16`），让 GitHub 上有稳定发布锚点。
- 正式版本 tag 推送后，必须创建或更新同版本 GitHub Release；release notes 简短列出用户影响、内部治理和验证结果，不贴真实数据或截图。
- 除非用户明确要求，不把无关重构、真实数据或工作区外文件混进同一个提交。

## 当前版本

当前版本：`timelog-v47` / manifest `version: "47"`。

改动 `index.html`、`sw.js`、`manifest.webmanifest` 或新增运行时资产后，必须同步：

1. `sw.js` 第 1 行 `CACHE = 'timelog-vN'`
2. `manifest.webmanifest` 的 `version`
3. `sw.js` 的 `FILES` 运行时缓存列表
4. `scripts/project_audit.py` 的 `EXPECTED_VERSION`、`REQUIRED_RUNTIME_ASSETS` 和运行时 import 检查列表
5. `src/ui.js` 的 `APP_VERSION`（更多 sheet 底部展示的版本号，audit 脚本校验同步）

运行时资产必须进 SW 缓存；文档和开发脚本不进缓存。

## UI 红线

- 响应式默认用 container query、CSS Grid/Flex 和文档流布局；禁止按 iPhone/iPad/设备名堆叠 viewport 补丁。
- Header 排版固定为三行信息架构：第一行站点标识（图标即 GitHub 入口）和「···」更多入口；第二行天/周/月/年视图切换；第三行 `< 当前周期 >` 与回到今天按钮；不要把日期导航塞回第一行；说明入口在「···」更多菜单里，不放回 header。v46（R5）：回到今天/本周/本月/今年按钮**条件渲染**——只在当前周期已不含今天时出现；`.date-nav` 用 `:has(#today-btn[hidden])` 在 ≥430px 断点收窄 grid 列数，避免显式轨道在按钮隐藏后留死区。当前周期含今天时，`#period-label` 内追加常驻 `.period-today-badge`（「今天」高亮字样）。「···」按钮改 `iconSvg('more')`（三点，零长度 round-linecap 描边），app.js `registerActions` 一次性注入（唯一不走 JS 模板渲染的图标按钮）。
- 低频动作（摘要、备份四项、标签高级设置、主题、说明）收纳在「···」更多 sheet 的 cell 分组里；footer 已退役，不得重新引入常驻底栏；分享 cell 与复制/下载/导入一样**常显**（v43：不再按能力检测显隐——旧 reveal 时序在 footer→更多 迁移后丢失、iOS 卡隐藏态，P24），点击时若无 Web Share 能力则回退下载完整备份。
- 窄屏第一行优先保留站点标识和「···」入口；空间不足时可以隐藏站点标题文字。
- 窄屏日期导航必须允许两行：上一段/周期/下一段一行，回到今天/本周/本月/今年独立一行；周视图窄屏周期标题可用短格式，完整日期保留在可访问标签中。
- 日视图时间轴是卡片列表（v36 回退直接操纵 rail）：按时间倒序排列（最新在最上）。**v47 R6：撤记录行常驻 edit/delete 图标——点整卡即编辑**（卡片是 `role="button" tabindex="0"` 的 `div[data-action]`，键盘 Enter/Space 激活；删除移进编辑 sheet 内的「删除这条」，走智能删除：两侧同标签自动愈合，否则转未记录）。空隙卡点整卡=补录（卡内「补一下」降级为纯提示胶囊 `.e-cta`，无独立 data-action）；已有段落卡 meta 里「补一下/切一刀」`mini-btn` 触发有界补录/切分、可确认长段有「确认这段」`mini-btn`；计划卡点整卡=编辑、meta 有「标记已发生」`mini-btn`——这些卡内 meta 按钮点击**不**触发整卡编辑（委托用 `closest('[data-action]')` 命中最近的，卡内按钮优先于卡片）。**v47 R2+FAB：记一条入口是右下角悬浮 FAB**（原嵌入横条 + 「切换活动」合并；保留 `id=add-btn` 供启动门闩/测试；`data-action=open-form`；只在日视图出现；副文案标注续记起点「续 hh:mm 起 · 已 Ymin」；FAB 有可见文案故**不设 data-tip**——`button[data-tip]` 的 position:relative 会破坏 fixed 悬浮，只设 aria-label）；列表底部预留 ≥72px 避让 + `.list-fade` 渐隐遮罩，均与 FAB 同步显隐。**v47 R4：日视图尺子改 hero 结论卡**（`renderDayHero` 渲染进 `#ruler`：主线净时长唯一大数字 32px/700、漏损 19px 次要、6px 比例条、辅助行「维持/未记录/截至」；周/月/年仍走 `renderRuler`）。v45：可编辑记录卡（真实/计划，非占位/空隙）支持**左滑即编辑**（`app.js registerCardSwipe`，`.entry` 用 `touch-action: pan-y` 让纵向滚动归浏览器、横向手势归左滑；卡片 `data-action=start-edit` 是判据）。v46：gap 卡 dashed 描边、planned 卡实线 + accent 淡色调 视觉区分。
- 表单 sheet 只按宽度适配：`>=720px` 居中 dialog，`<720px` bottom sheet；不要用 `pointer:fine` 决定视觉布局。
- 统一 sheet 头部语法：抓手条 + 左「取消/关闭」右「完成/保存」文字按钮 + 居中标题；正文低频列表用 cell 分组（inset 底 + 内分隔线）；cell 分组容器用块级流布局、不用 grid——iOS WebKit 对 grid auto 轨道内 button 的 min-height 计量有缺陷，会累计裁掉最后一行（P21）。
- 时间选择器只按宽度选择 wheel/desktop picker；打开表单后跨断点 resize 或旋转屏幕时，必须按当前宽度重挂载，不能停留在旧 picker。
- 禁止 `title=`，避免原生 tooltip 与自定义 tooltip 叠加。
- 可见文字按钮不强制 tooltip；图标按钮必须同时有短 `data-tip` 和 `aria-label`。
- tooltip 默认不能生成会撑宽页面的盒子；hover 延迟 800ms 后显示，移开立即隐藏；`focus-visible` 必须无延迟显示；触屏不能靠 hover 触发 tooltip。
- 图标语义固定（v47 起日视图卡片已无图标按钮——点整卡编辑、删除进编辑 sheet；此规则约束将来若再引入图标处）：编辑=铅笔，保存=对勾，删除=垃圾桶，取消=回退/撤销箭头，关闭只读页=细线 ×。当前运行时唯一在用的 `iconSvg` 是 header「···」的 `more`（`edit/trash/check` 定义暂留备用）。
- 删除/取消禁用 x、`×`、`✕`，包括图标定义、按钮文本和渲染模板。
- 输入字号不低于 16px，避免移动端聚焦放大。
- 统一表单 sheet 打开后先把焦点收进 sheet 容器，首个 Tab 进入内部控件；“做了什么”是 textarea，Enter 必须换行，只有 Cmd/Ctrl+Enter 或「完成」按钮保存；定时刷新不能打断新增或编辑中的输入。
- v46（R1）：sheet 关闭走 class 驱动过渡（`.sheet-closing`）+ `transitionend`/320ms 兜底后置 hidden，与进场 `@starting-style` 对称；`sheetCloseCleanup` 挡重入（关闭动画未播完又被重开/重关时立即收尾旧的，不留悬空定时器）；`prefers-reduced-motion` 下直接同步隐藏。
- v46（R3）：编辑态时间选择默认折叠为触发行（点击展开滚轮），与新建态一致；计划编辑（时间本就是核心可改项）例外，始终展开。校验失败但触发行仍折叠时，先展开触发行再显示错误，不能把报错文案落进看不见的容器里。
- v46（R7）：切视图/切周期后内容方向性滑入（280ms，`app.js animateContentEnter`）；列表卡片入场淡入（140ms，纯 `opacity`，`.entry` CSS `@starting-style`）——刻意只过渡 `opacity` 不碰 `transform`，因为 `transform` 是左滑手势（v45）的驱动属性，两者共用 transition 会让拖拽跟手变成带延迟的动画。均不做 FLIP／逐项 diff。

## 隐私红线

- 公开仓库不得含真实记录/真实截图/具体个人线索。
- 不提交导出的 `timelog-*.json` 或真实备份 JSON。
- 只发布 `time-logger/` 独立仓库，不发布父目录、`toolkit/`、`archive/` 或本机路径。
- README 和使用文档只能描述边界与用法，不写真实公司、个人进度或截图线索。
- README 演示图只能来自 `docs/assets/` 的固定 demo 数据 PNG，不得用真实 `localStorage` 或真实个人记录截图。

## 代码约定

- 纯原生 HTML/CSS/JS，使用浏览器原生 `type="module"`；不要引入打包步骤。
- 日期值统一 `YYYY-MM-DDTHH:mm`。
- 颜色走 CSS 变量；按钮白字 `#fff` 可保留。
- 尺子未记录段用 `--track`，不用 `--border`。`.ruler-bar` 分段缝背景用 `--border`（不用 `transparent`——透出父级 `--card` 会导致两主题缝的视觉重量不一致，v46 新发现）。
- 统计以分钟数为权威值：`job` / `maintain` / `leak` / `unrecorded` / `pending` / `total` 先累加分钟；百分比只用于展示，不反向参与统计，不强行凑满 100%。
- 标签 taxonomy 固定 4 桶：主线 `job`、维持 `maintain`、漏损 `leak`、未记录 `unrecorded`。桶在渲染/统计时由 tag→bucket 映射派生；孤儿 tag 落未记录。
- 本地自然日 00:00 是统计硬边界；空日不继承前一天最后标签；有明确右邻记录的跨日闭合段会切入后续日期；有首条记录的日期从 00:00 到首条之间计为未记录；周/月/年汇总按每日独立统计累加。
- 超过 3h 的非 `longOk` 明确标签段确认只绑定 `longConfirm.startTs` 和 `longConfirm.endTs`；相邻时间变化或中间补录自动失效，改成另一个明确标签不自动失效；跨日闭合段使用真实右邻作为确认结束，没有右邻时才使用本地日边界。默认只有“睡觉” `longOk:true`。
- 时间戳是本地壁钟值，不做时区转换；跨设备导入可根据备份 `meta.sourceTimezoneOffsetMinutes` 建议“整体平移 ±N 小时”，用户仍可覆盖。
- 续记模型以所看日期为准：空日默认从 00:00 开始；有记录日默认续最后一条或当天空占位条；补录到已有右邻记录之前时结束点吸附右邻；今天无右邻到当前时间，非今天无右邻到 24:00。
- 数据只存在 `localStorage['timelog.v1']`；标签配置只存在 `localStorage['timelog.config']`。
- 复制/下载/导入/分享都是完整备份，导出前按 `ts` 升序排序；摘要只代表当前视图；所有动作都在浏览器本地完成，不上传。

## v2 锁死 & 别镀金

在累计 **28 天真实记录**之前：

- 不做可扩展分类法
- 不做人类报表 / 更多图表
- 不为滚轮像素手感无限打磨
- 不引入跨设备同步、登录、云端

最大风险 = 用打磨工具逃避面试推进。如果用户或 AI 在没有充分求职进展的情况下要求继续打磨功能，请明确指出这一风险。

## 改动自测清单

每次改完至少跑：

```bash
python3 scripts/project_audit.py
python3 scripts/confirm_logic_smoke.py
npm run test:ui
git diff --check
```

浏览器手动检查：

1. 桌面鼠标 hover 图标按钮约 800ms 后只出现自定义 tooltip，移开立即隐藏；键盘 Tab 到图标按钮时 tooltip 立即出现，不出现原生 title。
2. sheet 头部为「取消/完成」文字按钮；取消不是 x，删除不是 x（删除是编辑 sheet 内的「删除这条」文字按钮）。
3. 移动端新增/编辑输入不自动放大；textarea 回车换行，Cmd/Ctrl+Enter 或「完成」保存。
4. 新增或编辑时，定时刷新不打断输入；无数据变化的 60s tick 不重绘页面。
5. 日视图 hero 结论卡显示主线净时长大数字 + 漏损次要数字 + 比例条 + 辅助行（维持/未记录/截至）；周/月/年 ruler/摘要显示主线、维持、漏损、未记录 4 桶；睡觉 6h 不待确认，吃饭 6h 待确认。
5a. 亮色+暗色各打开一次带滚轮的 sheet（新建/编辑/补录），选中行文字可见、不被高亮带涂掉（P22）。
6. 同时刻新增出现内联冲突提示，可编辑原条或用 +1min。
7. 「···」更多菜单里下载、导入、分享、摘要、复制均可用；导出文件名带秒，JSON 按 `ts` 升序。从「更多」下钻进入标签设置/说明/导入时区平移后，取消、保存、Esc、点遮罩都回到「更多」，不是回主界面；只有在「更多」这一层关闭才整层退出（首次启动自动弹的说明无上级，直接关闭）。
8. PWA 更新链路：改 `index.html` 后升 CACHE 号；旧页面应出现“更新应用”，点击后加载新版，本机 `localStorage['timelog.v1']` 保留。
9. 午夜后重开仍停在上次所看日期；历史日续记无右邻时结束显示 24:00，不漏到当前时间。
10. 日视图卡片（v47）：点整卡开编辑 sheet（可改内容/标签/开始时间，键盘 Enter/Space 也行），删除在编辑 sheet 内「删除这条」（智能删除）；空隙卡点整卡补录、有内容段落卡 meta「补一下/切一刀」打开有界补录/切分、计划卡 meta「标记已发生」；卡内 meta 按钮点击不误触发整卡编辑；右下角悬浮 FAB「记一条」（副文案续记起点）新建/续记；卡片改动后 hero 大数字与统计立即跟着变。
11. 新建/编辑 sheet 点「做了什么」呼出键盘：sheet 头部（取消/完成）置顶常在、键盘开合时面板几何一动不动（v43：`.form-sheet` 恒定满视口、`.tall` 面板定高、头部 `sticky`——不再随键盘缩放，故无任何跳变/悬停/裸露）；焦点控件自动滚到键盘上方；点键盘「完成」收起键盘只是键盘离场，面板不动；两个文本框之间切换焦点也只滚动、不移面板。禁止再引入随 `visualViewport` 移动/缩放整个 sheet 的方案（P16–P23 连修六轮的根源）。

响应式手动矩阵：

1. 320-375px：header 第一行不横向溢出，标题可隐藏；date-nav 两行不溢出；时间轴卡片不溢出。
2. 360/390/412/430px：不刷新页面连续切换宽度，header/date-nav/时间轴卡片立即自适应。
3. 768px：sheet 居中，内容不被遮挡。
4. 横竖屏切换：打开新建/编辑 sheet 后切换宽度，时间 picker 使用当前宽度对应形态。
5. 分享 cell 常显：更多菜单里分享备份始终在（有无 Web Share 都在），分组不留空缝；无能力时点击回退下载。
6. v47 FAB：日视图右下角悬浮「记一条」——窄屏距右/底 16px，宽屏（>600px）锚在居中内容列右边缘内 16px 不飞到屏幕角；非日视图（周/月/年）FAB 与渐隐遮罩一起隐藏；最后一张卡片能滚到 FAB 上方不被遮。

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

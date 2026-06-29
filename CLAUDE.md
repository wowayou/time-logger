# CLAUDE.md — 时间尺维护规范

## 项目性质

时间尺是**单页静态零运行时依赖 PWA**。运行时结构只包括：

- `index.html`：DOM 壳、PWA/meta 引用、`styles.css` 和 `src/app.js` 模块入口
- `styles.css`：全部样式
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

模块边界：

- `src/time.js`：只放日期、时间、周期和格式化工具；不读写 DOM / localStorage。
- `src/storage.js`：只负责本地数据/config、导入校验和合并；不渲染 UI。
- `src/stats.js`：保持统计逻辑集中；不访问 DOM / navigator；桶归类只能通过 `storage.js` 的配置 helper；日边界规则必须在这里测试。
- `src/pickers.js`：只负责时间选择器 DOM；不直接保存业务数据。
- `src/ui.js`：只负责模板、图标、tooltip helper 和 DOM 渲染；不做数据持久化。
- `src/app.js`：只负责状态、事件委托、页面初始化、Service Worker、复制/下载/分享动作。

提交与推送前红线：

- 至少跑 `python3 scripts/project_audit.py`、`python3 scripts/confirm_logic_smoke.py`、`npm run test:ui`、`git diff --check`。
- 推送前检查 `git status --short`，确认没有真实记录、真实截图、导出 JSON、Playwright 结果或本机临时文件。
- 除非用户明确要求，不把无关重构、真实数据或工作区外文件混进同一个提交。

## 当前版本

当前版本：`timelog-v16` / manifest `version: "16"`。

改动 `index.html`、`sw.js`、`manifest.webmanifest` 或新增运行时资产后，必须同步：

1. `sw.js` 第 1 行 `CACHE = 'timelog-vN'`
2. `manifest.webmanifest` 的 `version`
3. `sw.js` 的 `FILES` 运行时缓存列表

运行时资产必须进 SW 缓存；文档和开发脚本不进缓存。

## UI 红线

- 响应式默认用 container query、CSS Grid/Flex 和 sticky 文档流布局；禁止按 iPhone/iPad/设备名堆叠 viewport 补丁。
- Header 排版固定为三行信息架构：第一行站点标识、可选日期、紧凑主题切换、说明/配置/GitHub；第二行天/周/月/年视图切换；第三行 `< 当前周期 >` 与回到今天按钮；不要把日期导航塞回第一行。
- 窄屏第一行优先保留站点标识、主题切换和说明入口；空间不足时可以隐藏日期文字。
- 窄屏日期导航必须允许两行：上一段/周期/下一段一行，回到今天/本周/本月/今年独立一行；周视图窄屏周期标题可用短格式，完整日期保留在可访问标签中。
- Footer 必须在文档流内 sticky 到底部，备份操作必须用响应式 grid，不得固定五按钮单行硬挤；分享按钮默认 hidden，由能力检测后再显示，避免首屏布局跳动。
- 表单 sheet 只按宽度适配：`>=720px` 居中 dialog，`<720px` bottom sheet；不要用 `pointer:fine` 决定视觉布局。
- 时间选择器只按宽度选择 wheel/desktop picker；打开表单后跨断点 resize 或旋转屏幕时，必须按当前宽度重挂载，不能停留在旧 picker。
- 禁止 `title=`，避免原生 tooltip 与自定义 tooltip 叠加。
- 可见文字按钮不强制 tooltip；图标按钮必须同时有短 `data-tip` 和 `aria-label`。
- tooltip 默认不能生成会撑宽页面的盒子；hover 延迟 800ms 后显示，移开立即隐藏；`focus-visible` 必须无延迟显示；触屏不能靠 hover 触发 tooltip。
- 图标语义固定：编辑=铅笔，保存=对勾，删除=垃圾桶，取消=回退/撤销箭头。
- 删除/取消禁用 x、`×`、`✕`，包括图标定义、按钮文本和渲染模板。
- 时间轴记录操作和编辑态保存/取消使用图标；底部备份栏、添加表单按钮继续用文字。
- 输入字号不低于 16px，避免移动端聚焦放大。
- 统一表单 sheet 打开后聚焦在时间/首个输入；“做了什么”是 textarea，Enter 必须换行，只有 Cmd/Ctrl+Enter 或 ✓ 按钮保存；定时刷新不能打断新增或编辑中的输入。

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
- 尺子未记录段用 `--track`，不用 `--border`。
- 统计以分钟数为权威值：`job` / `maintain` / `leak` / `unrecorded` / `pending` / `total` 先累加分钟；百分比只用于展示，不反向参与统计，不强行凑满 100%。
- 标签 taxonomy 固定 4 桶：主线 `job`、维持 `maintain`、漏损 `leak`、未记录 `unrecorded`。桶在渲染/统计时由 tag→bucket 映射派生；孤儿 tag 落未记录。
- 本地自然日 00:00 是统计硬边界；空日不继承前一天最后标签；有首条记录的日期从 00:00 到首条之间计为未记录；周/月/年汇总按每日独立统计累加。
- 超过 3h 的非 `longOk` 明确标签段确认只绑定 `longConfirm.startTs` 和 `longConfirm.endTs`；相邻时间变化或中间补录自动失效，改成另一个明确标签不自动失效；跨日边界使用本地日边界作为段结束。默认只有“睡觉” `longOk:true`。
- 时间戳是本地壁钟值，不做时区转换；跨设备导入只能通过“整体平移 ±N 小时”对齐。
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
2. 编辑、删除、保存、取消均为图标；取消不是 x，删除不是 x。
3. 移动端新增/编辑输入不自动放大；textarea 回车换行，Cmd/Ctrl+Enter 或 ✓ 保存。
4. 新增或编辑时，定时刷新不打断输入；无数据变化的 60s tick 不重绘页面。
5. Ruler/摘要显示主线、维持、漏损、未记录 4 桶；睡觉 6h 不待确认，吃饭 6h 待确认。
6. 同时刻新增/编辑出现内联冲突提示，可编辑原条或用 +1min。
7. 下载、导入、分享、摘要、复制仍保持文字入口并可用；导出文件名带秒，JSON 按 `ts` 升序。
8. PWA 更新链路：改 `index.html` 后升 CACHE 号；旧页面应出现“更新应用”，点击后加载新版，本机 `localStorage['timelog.v1']` 保留。

响应式手动矩阵：

1. 320-375px：header 第一行不横向溢出，日期可隐藏；date-nav 两行不溢出；footer 3+2 或 3+1 换行不遮挡内容。
2. 360/390/412/430px：不刷新页面连续切换宽度，header/footer/date-nav 立即自适应。
3. 768px：sheet 居中，footer 单行或自然列布局，内容不被底栏盖住。
4. 横竖屏切换：打开新建/编辑 sheet 后切换宽度，时间 picker 使用当前宽度对应形态。
5. 分享能力有/无：分享按钮显示/隐藏时 footer 不跳动、不留空列。

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

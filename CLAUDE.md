# CLAUDE.md — 时间尺维护规范

## 项目性质

时间尺是**单页静态零运行时依赖 PWA**。运行时结构只包括：

- `index.html`：DOM 壳、PWA/meta 引用、`styles.css` 和 `src/app.js` 模块入口
- `styles.css`：全部样式
- `src/app.js`：启动、状态组合、导航、渲染调度、事件委托和 Service Worker 注册
- `src/i18n.js`、`src/locales/zh.js`、`src/locales/en.js`：语言选择、中英文文案和格式化；语言偏好的持久化仍归 `storage.js`
- `src/entry_model.js`：记录日期模型、续记默认起点、占位条、结算点、同刻冲突和 `+1min` helper
- `src/io_actions.js`：当前视图摘要、复制、下载、导入、分享等本地 IO 动作
- `src/sheet_controller.js`：新建/编辑/config/import sheet、focus trap、picker 重挂载和表单保存
- `src/time.js`：本地日期解析、格式化、周期范围
- `src/storage.js`：`localStorage['timelog.v1']` 读写、`localStorage['timelog.config']` 标签配置、`localStorage['timelog.quotes']` 文字轮播句库（v1.5.0）、导入合并
- `src/stats.js`：纯统计逻辑、按日分段、可选长段待核标记
- `src/pickers.js`：移动滚轮与桌面时间选择器；段内区间选择器（v1.5.0，切一刀 / 补一下）
- `src/ui.js`：渲染模板、图标、tooltip helper 和 DOM 更新
- `sw.js`：Service Worker 离线缓存
- `manifest.webmanifest`：PWA 清单
- `icon.svg` 与 `icons/*.png`：运行时图标资产
- `packs/*.txt`：主题句库（D36，文字轮播一键追加；支持页下载同一批文件）

允许的开发期工具包括 `scripts/project_audit.py`、`scripts/confirm_logic_smoke.py`、`scripts/bump_version.py`（版本仪式六处锚点一键联动）、`scripts/build_site.py`（D12：按 `sw.js` FILES 组装 `time.eigentime.org`——`site/` → 根、运行时 → `/app/`；`site/` 是非运行时静态页源码，不进 SW 缓存）、`scripts/build_legacy_site.py`（D34，见下方红线；专项 `python3 -m unittest discover -s tests -p 'test_build_legacy_site.py'`）、`scripts/doc_sync_check.py`（同步闸，见下）、`scripts/what_repeat_stats.mjs`（node 只读分析完整备份里正文的重复程度，评估「按事项归并」规则；只出聚合数字、标签名默认打码，D37 同日加入）、`npm run typecheck`（tsc 对 `time/storage/stats/entry_model` 做 JSDoc 类型检查，无构建产物）和 Playwright UI smoke。Python 脚本只用标准库；逻辑 smoke 用本机 `node` 导入真实 ES modules。推广/录屏工具不进本仓，见「隐私红线」。

**铁律：无运行时依赖 / 无构建 / 原生 ES modules。** npm 只允许作为开发期测试依赖；不引入打包器、框架、账号、云同步或后端。

中文品牌为**时间尺**，英文品牌为 **Eigentime**（D29）。本文件是维护规范唯一真源；当前进度只在 [`STATUS.md`](STATUS.md) 维护。决策、故障和已完成规格记录当时的事实，后续修订以现行规则为准，不把历史计划重新当作待办。

## 开发与维护红线

- `package.json` 必须保持 `"private": true` 和 `"type": "module"`；禁止新增 `dependencies`，只能在 `devDependencies` 中放开发期测试工具。
- 改动开发期 npm 依赖时必须提交 `package-lock.json`；不得提交 `node_modules/`、`test-results/`、`playwright-report/`。
- 运行时文件禁止从 npm 包导入代码；`src/*.js` 只能使用相对路径导入本项目模块。
- 不新增应用编译、打包命令、压缩产物或框架初始化文件。旧 origin 只读站由 `.github/workflows/publish-legacy-pages.yml` 只在 **tag 或显式手动触发**时发布（手动必填 `release_tag`）：`scripts/build_legacy_site.py` 要求 tag 存在、manifest 版本与全部运行时路径与之一致，写出前核对归档中全部非隐藏运行时文件与来源提交的 Git 原始字节一致；隐藏路径（任一段以 `.` 开头）不算产物，但提交树比较覆盖整个运行时目录。旧文档 HTML 地址提供指向 GitHub 的兼容页。`github-pages` 环境须分别放行所需分支和版本 tag；两站 workflow 独立、非原子，发版后分别核对。**不要改回 Pages 的「分支直发」**——会绕过 tag 随 main push 发布旧站（D34）。主站由 `scripts/build_site.py` 组装到部署镜像 `wowayou/time-logger-site` 再由 Pages 发布；静态组装不改变「无构建」边界，产物不进源码仓库。
- 新增任何运行时资产时，必须同步 `sw.js` 缓存列表；文档、测试、npm 元数据不进 Service Worker 缓存。
- 本地开发必须通过 HTTP server 打开页面；不要用 `file://` 验证 ES modules 或 Service Worker。UI 测试使用 `127.0.0.1:4173` 的受控 server，只有本进程成功 `listen` 才报就绪（启动最多 10s）；端口被占直接失败，不复用旧服务。
- 多步改动走主线程，逐个顺序做；不要为了加速并发 fan-out 子代理 / workflow——上游 API 不扛并发，连串行 workflow 都会 429。
- 写路径数据一致性：`load()` 每次返回新对象图；任何「先 find 后 save」必须共用**同一次** `load()` 的结果，禁止改一张图、保存另一张图（见 `docs/postmortems.md` P1）。

模块边界：

- `src/time.js`：只放日期、时间、周期和格式化工具；不读写 DOM / localStorage。
- `src/i18n.js` / `src/locales/`：语言解析、取词和格式化，不持久化偏好，不翻译用户标签；新增文案保持中英文词典对等。
- `src/storage.js`：只负责本地数据/config、导入校验和合并；不渲染 UI。非关键界面偏好经 `readUiPreference` / `saveUiPreference`，写不下只保留当前页面会话选择，成功重试后清掉内存覆盖；真实记录/config/句库不得使用这条降级路径。关键写路径的表单/导入快照使用 `loadSnapshotChecked`、`loadConfigSnapshotChecked`、`loadQuotesSnapshotChecked`，同一次读取配对对象与 raw；先处理读取失败，再做源记录、预览和版本比较。写前 CAS 仍严格复读存储。`SecurityError` 返回明确的权限失败，配额失败保持独立提示，未知编程错误继续抛出；展示读取可容错，但不得把读被拒的空值当成可写基线。
- `src/stats.js`：保持统计逻辑集中；不访问 DOM / navigator；桶归类只能通过 `storage.js` 的配置 helper；日边界规则必须在这里测试。主渲染只生成一次分段，时间轴/总览/明细经 `summarizeSegments` / `summarizeSegmentRows` 共用；明细区间须有序且互不重叠，不缓存跨帧的可变对象。大历史只计算当前范围及前邻的边界，但必须保留完整数组中的真实右邻、跨日上限与确认端点；非标准旧时间文本保留全扫描。
- `src/pickers.js`：只负责时间选择器 DOM；不直接保存业务数据。
- `src/ui.js`：只负责模板、图标、tooltip helper 和 DOM 渲染；不做数据持久化。
- `src/entry_model.js`：只放记录日期模型、续记默认起点、占位条、结算点、同刻冲突、`+1min`、区间编辑/切分/删除事务 planner、无冗余边界归一化（`coalesceRedundant`）和写后统一出口（`normalizeEntries`，恒保今天尾占位）等纯/低副作用 helper；不访问 DOM / localStorage。
- `src/io_actions.js`：只处理当前视图摘要、复制、下载、导入、分享；通过显式依赖接收 `load/save/render/state`，不拥有全局状态。
- `src/sheet_controller.js`：只处理新建/编辑/config/import sheet、focus trap、picker 重挂载和表单保存；通过显式依赖读写状态和持久化。
- `src/app.js`：只负责启动、状态组合、导航、渲染调度、事件委托和 Service Worker 注册。

改动与文档的同步闸（`.claude/settings.json` 的 PreToolUse hook → `scripts/doc_sync_check.py`；时机分析、踩过的坑与实现细节以脚本 docstring 为准）：

- 在 `git commit` / `git push` **之前**检查**全量工作区**（`git status --porcelain -z`，不是暂存区——`git add -A && git commit` 是一条命令，触发时还没 add）。
- **拦一条**：改动集有运行时文件（`src/`、`index.html`、`styles.css`、`sw.js`、`manifest.webmanifest`、`icons/`、`icon.svg`）却没有 `CLAUDE.md`。**提醒三条**（不打断）：动了运行时或对外文案没动 `docs/HANDOFF.md`；动了对外文案而 README 的 `Updated:` 早于今天；动了 `src/locales/` 没动 `site/`。
- 逃生开关是命令前缀 `SKIP_DOC_CHECK=1`（`--amend`、`--no-verify` 同样豁免）；任何异常一律放行。matcher 只写 `Bash`、不用 hook 的 `if:`，正则锚定命令位置，粗筛用 bash `case`——改这些前先读脚本说明。
- 它只查「有没有碰文档」，查不了「写得对不对」；它看到的是命令执行**前**的状态，文档编辑与 `git commit` 要分两次调用。

对外口径同步（v1.5.1，维护者要求「项目和文档的口径一致」）：

- **对外表面清单**：应用文案（`src/locales/zh.js`、`src/locales/en.js`，含应用内「说明」）、主页（`site/index.html`、`site/en/index.html`）、支持页（`site/support/`、`site/en/support/`）、隐私政策（`site/privacy/`、`site/en/privacy/`）、`README.md`、`使用与理念.md`、`CONTRIBUTING.md`。新增、改名或移除一个用户可见功能，**同一批**把这些表面里提到它的地方一起改掉；不在同批的，写进 `STATUS.md` 的 OPEN。推广材料不在公开仓库（见「隐私红线」），不属于对外表面。
- **命名见名知意**：对外叫法说清「它是什么」，不用需要解释的隐喻（v1.5.1 把「时间拨号盘」改成「时间分析」、「接通」改成「复制本期摘要」）；版式可以保留隐喻，名字不行。
- **机械判据**（`project_audit.py`，硬拦）：① 隐私政策必须**完整列出**运行时源码里出现的全部 `timelog.*` 存储键，中英两份都要（`audit_privacy_lists_storage_keys`）——新增存储键而不更新政策会红；② 改过名的叫法不得回流到上述对外表面（`audit_retired_public_terms` 的 `RETIRED_PUBLIC_TERMS`；改名时把旧叫法登记进去，记录改名历史的行写「前名」豁免）。
- **提醒判据**（`doc_sync_check.py`，不打断）：动了应用文案却没动 `site/` 时提醒过一眼主页。
- 这些判据只查「有没有漏」，查不了「写得对不对」；发版前仍要人读一遍主页和说明。主页只从 `docs/assets/` 的固定 demo 图取图，文案不得声称市场需求已验证（`audit_site_honesty_guard`）。

提交与推送前红线：

- 至少跑 `python3 scripts/project_audit.py`、`python3 scripts/confirm_logic_smoke.py`、`npm run typecheck`、`npm run test:ui`、`git diff --check`。
- 推送前检查 `git status --short`，确认没有真实记录、真实截图、导出 JSON、Playwright 结果或本机临时文件。
- 产品、架构、隐私、发布存续等决策一旦落入 `docs/decisions.md`，应及时形成边界清晰的独立提交并推送，不长期只留在本地；不得顺带混入无关工作区文件。
- 正式版本推送到 `main` 后，必须创建并推送同版本 Git tag（例如 `v1.4.2`），让 GitHub 上有稳定发布锚点。
- 正式版本 tag 推送后，必须创建或更新同版本 GitHub Release；release notes 简短列出用户影响、内部治理和验证结果，不贴真实数据或截图。
- **只改 `site/` 时也要发布一次**：`publish-site` 的自动触发是版本 tag push（当前为 `v<major>.<minor>.<patch>`，兼容历史整数 tag）。改完 `site/` 走 `gh workflow run publish-site.yml`，或按 `scripts/build_site.py` 顶部说明本地组装后推镜像；手动发布前确认所选提交的运行时已正式发版，发布后用 `curl` 复核线上文案。**不要**把触发条件改成「push 到 main 就发」——那会把还没打 tag 的运行时一起推上线。
- 除非用户明确要求，不把无关重构、真实数据或工作区外文件混进同一个提交。

## 当前版本

当前版本：`timelog-v1.8.4` / manifest `version: "1.8.4"`。

提交、推送、验收、发布与仍未闭合的风险只在 `STATUS.md` 登记。

改动任何运行时文件后，必须用 `python3 scripts/bump_version.py <major.minor.patch>` 联动六处版本锚点：

1. `sw.js` 的 `CACHE = 'timelog-v<major>.<minor>.<patch>'`
2. `manifest.webmanifest` 的 `version`
3. `scripts/project_audit.py` 的 `EXPECTED_VERSION`
4. `src/ui.js` 的 `APP_VERSION`（更多 sheet 底部展示）
5. 本文件的当前版本行
6. `README.md` 的 Release 行

脚本会在锚点漂移时拒绝改写。CHANGELOG 行仍需手写；新增、移除运行时资产还须同步 `sw.js` 的 `FILES`、audit 的 `REQUIRED_RUNTIME_ASSETS` 与 import 检查。运行时资产必须进 SW 缓存；文档和开发脚本不进缓存。纯文档改动不升运行时版本。

## UI 红线

- 可读性按 WCAG 2.2（Web Content Accessibility Guidelines，网页内容无障碍指南）区分：普通文字 4.5:1、大字 3:1；理解内容必需的图形和控件状态 3:1。大字以 18pt 常规或 14pt 粗体为准，不把字号相近的半粗小字误当大字。测浏览器实际解析、叠加透明度后的颜色，不只比较令牌。24×24 CSS px 是 2.5.8 的 AA 目标要求，含间距、行内等例外；44px 是项目主要触控基线及 2.5.5 的 AAA 增强参考，不宣称全部控件达到 AAA。扩展伪元素与圆角的真实命中须实测，不能只看字盒。2.3.3 交互动效是 AAA，项目仍要求尊重减少动效偏好，包含程序触发的滚动。不得用根级 `overflow-x:hidden` 掩盖内容裁切；模态打开时的 body 滚动锁不等于内容尺寸合格。

- 响应式默认用 container query、CSS Grid/Flex 和文档流布局；禁止按 iPhone/iPad/设备名堆叠 viewport 补丁。
- Header 排版固定为三行信息架构：第一行站点标识（图标即 GitHub 入口）和「···」更多入口；第二行天/周/月/年视图切换；第三行 `< 当前周期 >` 与回到今天按钮；不要把日期导航塞回第一行；说明入口在「···」更多菜单里，不放回 header。v46（R5）：回到今天/本周/本月/今年按钮**条件渲染**——只在当前周期已不含今天时出现；`.date-nav` 用 `:has(#today-btn[hidden])` 在 ≥430px 断点收窄 grid 列数，避免显式轨道在按钮隐藏后留死区。当前周期含今天时，`#period-label` 内追加常驻 `.period-today-badge`（「今天」高亮字样）。「···」按钮改 `iconSvg('more')`（三点，零长度 round-linecap 描边），app.js `registerActions` 一次性注入（唯一不走 JS 模板渲染的图标按钮）。
- 低频动作（摘要、备份四项、标签高级设置、主题、启动诊断、说明）收纳在「···」更多 sheet 的 cell 分组里；footer 已退役，不得重新引入常驻底栏；分享 cell 与复制/存储/导入一样**常显**（v43：不再按能力检测显隐——旧 reveal 时序在 footer→更多 迁移后丢失、iOS 卡隐藏态，P24），点击时若无 Web Share 能力则回退下载完整备份。
- 窄屏第一行优先保留站点标识和「···」入口；空间不足时可以隐藏站点标题文字。
- Header 站点标识旁的里程碑（v61 起）**只从当前数据派生**，显示「记录历程第 N 天 · 已记录 N 天」：前者＝最早**非计划、非占位**记录到今天的自然日跨度，后者＝有真实记录的不同自然日数；逻辑集中在 `stats.js` 的 `recordingMilestones`，一条真实记录都没有时隐藏整块、不编造里程碑。计划条和空占位条永远不算「记过」（`normalizeEntries` 恒给今天留尾占位，不排除会让每天都算已记录）。因为派生自 `entries`，它随完整备份天然恢复，**不得**再改回依赖本机安装日。**v1.6.0 里程碑效果（D32，显式修订 D7）**：按累计记录日（同上口径，中断不清零），节点 7 · 30 · 100 · 200 · 365、之后每满 100，判定只在 `stats.js`（`isMilestoneCount` / `milestoneCrossed` / `recordingMilestones().milestoneDay`）。今天恰好是第 N 个记录日时 `#usage-day` 加 `.is-milestone`（accent 浅底胶囊，可见文字不变、读屏多一句），纯派生、不得为它新增存储键；本机记录写入（新建/过夜/补记/编辑/标记已发生）成功后跨过节点才亮一次 `#info-toast`，调用点是这些路径上的显式 `celebrateMilestone`——**不得**挂到 `saveChecked` 等公共写入口，导入、撤销删除、回滚、跨标签同步都不庆祝。不做动效、徽章、连续打卡、进度页。
- 「已记录 N 天」是机器可判定的「有真实记录的自然日数」，**不等于** `docs/dogfood-freeze-handoff.md` 的「有效记录日」（后者要求人工判断当天时间线是否足以重建主要活动），两者不得混用或互相冒充。
- `timelog.firstUsedDate`（本机首次使用日）**只做诊断**，不做用户里程碑：首次初始化写入，老用户以最早本机记录日期迁移，随完整备份导出/导入（v60），导入只允许往**更早**挪且拒绝未来日期。它不得出现在 header 或任何用户里程碑文案里——装了不等于记了。
- 静态壳的 `#usage-day` 必须为空且 `hidden`，由 JS 填充；`styles.css` 的 `body:not(.app-ready):not(.boot-restored) .usage-day{visibility:hidden}` 同时挡住冷启动露出，不得往静态壳里写死任何天数。
- 窄屏日期导航必须允许两行：上一段/周期/下一段一行，回到今天/本周/本月/今年独立一行；周视图窄屏周期标题可用短格式，完整日期保留在可访问标签中。
- 日视图时间轴是**连续日志容器**（v56）：一整块贴地 `--card` 面（`.log`：hairline 边、无阴影——hero 是唯一带内容阴影的主表面），行按时间倒序，行＝时间｜正文+`#标签`｜时长与动作 三列网格。左缘 4px 通高桶色竖脊由 `data-b` 驱动：色相＝桶（与 hero 比例条同源），实色＝已发生、虚线（CSS mask 圆头胶囊，不支持时退化实色）＝计划、`--track` 灰＝未记录；发丝分隔线从 16px 起、放在不滑动的 wrapper 层，**不得横穿竖脊**。今天在计划块与已发生块之间渲染「现在 hh:mm」一线（`.tl-now`，accent 呼吸点，减少动效时静止），非今天不渲染；tag 是素色 `#标签` 小字，不得恢复彩色 tag 胶囊。
  - **行布局三选一**（v1.8.1 起；v1.8.2 维护者看过对比图后选定「全文」取代「两行」并作默认）：`.log[data-density]` 由「更多 → 时间轴」选，偏好键 `timelog.timelineDensity`（非关键偏好、不进备份；缺失/非法＝全文，存量 `double` 按全文读、不改写存储，`index.html` 快照门同一规则）——**全文**（默认，v1.7.0 式内容撑高：正文 `pre-wrap` 完整换行、`#标签` 在正文下、不省略；右列自上而下时长、刻度、链接）、**单行** 52px（同一列表**严格等高**，标签完整显示或整个让位，正文单行省略、全文在编辑页）、**按时长**（`--mins` 分钟数 px，下限 52px、无上限）。**全文布局竖脊仍通高，但长短不代表时长**（v1.8.1「行高与内容无关」只对单行仍成立；维护者明知该取舍而选定）：时长由右列数字和**尺子刻度**表达（v1.8.3 取代 v1.8.2 的 4h 满格时长条——真机上「超过 4h」的末端缺口像条断了，且 1 小时以内的段在 4h 刻度上只剩一个点；维护者看过刻度/热力底对比图后选定「只有尺子刻度」，热力底未采纳）：整小时一道长刻线、余下每刻钟一道短刻线（四舍五入、凑满 4 道进位，不到 8 分钟不画；`ui.js` `timelineTicks`），无上限、宽 56px 超出换行不撑宽右列，色＝竖脊桶色、未记录灰、计划不画，`aria-hidden`（数字是可读真源），只在全文布局渲染；不得改成按当天最长段或分位数的相对刻度（跨天不可比）。v53 启动快照比对归一化布局。
  - 点行编辑（`role="button" tabindex="0"` 的 `div[data-action]`，Enter/Space 激活）；空隙行整行＝补录。行内只留指向缺口/待办的 accent 文字链（`mini-btn` 无底色）：未记录/占位行「补一下」、计划行「标记已发生」（此时不再显示「计划」，只读页仍显示）、超长段「确认」（可见文字只留动词，区间在读屏名）；已发生普通段的「切一刀」在编辑 sheet 内，行内禁止逐行常显动作词。链接在右列：容器最小宽＝链接数×44px+间距，空间不够先省略时长，链接文字单行省略（修订 v1.7.3 的「长标签换行」，读屏名保留全文），热区始终 ≥44×44、在行内、不压正文。
  - 行自带不透明 `--card` 底（左滑时滑过底部轨道）；行入场过渡只碰 `opacity` 不碰 `transform`。
  - **区间编辑**（v48）：普通已发生记录编辑完整开始—结束，不能跨自然日、越过相邻记录或产生零时长；共享边界变化实时预览前/本/后三段。今日尾段可选「至今」或固定结束（固定后自动留下未记录尾段）；计划只编辑计划时刻。
  - **切分 / 补一下**（v48，v1.5.0 先给结果再给选择）：打开时冻结原段边界，只在段内选择，预览内部/贴边/整段，禁止吞掉其它记录。上方原段一行 + 按时长比例的切分条（aria-hidden，文字预览行是可读真源）+ 逐段行（新段未填显示「待填写」）；下方 `mountRangePicker`——窄屏一行四列「时:分 – 时:分」（160px，与 `RANGE_PAD` 同步），宽屏两枚 HH:MM 文本框；**不得**挂带日期列的单点滚轮或「现在」，小时列只列原段覆盖的小时，段外回弹，「开始 < 结束」交给 planner 报错；贴边捷径一键到段首/段尾。真实原段默认切中间三分之一（贴整 5 分钟），缺口/占位/未知标签段默认整段。
  - **删除**（v48）：确认 sheet 显示确切结果；仅前后内容和标签完全一致时接回，其余已发生记录转同区间未记录，计划直接移除；成功后 8 秒撤销，检测到其它标签页修改即取消撤销。**左滑**：仅触摸/触控笔，水平轴锁定、跟手并吸附到 2×72px「编辑/删除」，一次只开一张，纵向滚动或点空白关闭；桌面和键盘点行编辑、编辑页删除。FAB 与 hero 结论卡保持 v47/v55 规则（hero 大数字 36px 墨色）。
- 阶段格言（v69，C13）：`#motto-line` 只在日视图、hero 结论卡与时间轴之间显示；三态逻辑全部在 `storage.js`（`defaultMotto`/`normalizeMotto`/`resolveMotto`——键缺失=默认、空串=显式隐藏、非空=自定义，60 字上限，恰等于默认归一化回未设置）；文案只经 textContent/`esc` 注入，静态壳保持空 + hidden（同 `#usage-day` 纪律，不得写死文案）；隐藏态唯一入口是「···」更多的「阶段格言」cell；motto sheet 召唤键盘走 tall + returnToMore；`.motto-line` 是 `display:block` 按钮，`[hidden]{display:none}` 让位规则不得删除。**v1.5.0 文字轮播（D31 显式修订 D11 的「不做多条轮换」）**：格言 sheet 顶部二选一「单句格言 / 文字轮播」；句库在独立键 `localStorage['timelog.quotes']`（不进 config——一本书的摘录几十 KB，config 每次渲染读多次），展示唯一入口 `resolveMottoLine`，每天一句只由日期决定（`quoteForDay`：起始日显示第一句，逐日往下、读完回头），同一天刷新/快照/分钟 tick 不换句、不新增定时器；句库改动后起始日由 `rebaseQuoteAnchor` 重算（v1.5.1 维护者裁定「接着今天这一句」：今天这句还在就接着它，被删改了停在同一序号，整本换掉才从头）。拆句规则 `splitQuoteText` 必须**幂等**（行首记号剥到不动点、代码块/标题/分隔线判断在剥之后、只有成对的 ``` 才开合代码块、每句产出前再过一遍同样判断；≤100 字的行原样、>100 字按句末标点切、>160 硬切、最多 1000 句），`normalizeQuotes` **逐句**重拆使存量坏句加载即清；逻辑 smoke 以组合记号断言 + 固定种子模糊测试守幂等。文本框即全部管理界面。切回单句格言只关轮播、保留句库；**只有文本框确实为空**才表示删除句库，有字却拆不出句子时拦下说明、绝不静默删除；文本框没动过就原样沿用已存句子。句库保存走 CAS（`saveQuotesChecked`，基线在格言 sheet 新开时取）。随完整备份导出（可选顶层 `quotes`），导入本机优先。仍锁定不做：收藏、出处、逐句编辑界面、历史、按阶段自动切换、定时轮播动效。
- 表单 sheet 只按宽度适配：`>=720px` 居中 dialog，`<720px` bottom sheet；不要用 `pointer:fine` 决定视觉布局。
- 统一 sheet 头部语法：抓手条 + 左「取消/关闭」右「完成/保存」文字按钮 + 居中标题；正文低频列表用 cell 分组（inset 底 + 内分隔线）；cell 分组容器用块级流布局、不用 grid——iOS WebKit 对 grid auto 轨道内 button 的 min-height 计量有缺陷，会累计裁掉最后一行（P21）。**正文层同理（P34，v63）**：承载 cell-group 的 sheet 正文不得让分组坐在会被压缩的 grid/flex 轨道里——`.form-sheet-body` 的 grid（min-height:0 flex 子项）在内容超过面板可用高度时会把 auto 轨道压到低于内容高，分组的 `overflow:hidden` 随即拦腰裁行（双引擎可复现，非 iOS 特有）；更多正文已改 `.form-sheet-body.more-body{display:block}`（复合选择器压过后文同优先级 `display:grid`），超高由正文滚动接住；矮视口（375×600）+ 最大内容量的回归测试同时锁更多与标签设置两处。
- 标签高级设置是**标签云 + 点开就地编辑**（v1.5.3，SPEC-017，取代 v37 两行式 cell）：每个标签收起时是一个 chip（桶色圆点＋名称＋条数，零记录虚线边，当前主线 accent 浅底），点开原地变成整宽编辑卡；**编辑控件始终留在该行 DOM 里（hidden）**，`saveTagConfig`、`captureConfigEdits`/`restoreConfigEdits` 读的仍是每行自己的控件，不得改成「一个共享编辑器」。一次只展开一张；空名草稿收起即移除；chip 面由 `syncConfigRowFace` 按控件现值显示暂存状态（原名→新名、改桶/免确认小点、待删除删除线、「新」），卡内改过名显示「原名「…」」。历史主线 ≥3 个时默认折叠，**折叠只藏没动过、没展开、没待删除的历史行**；标签 ≥12 个时显示筛选框（`tagKey` 包含匹配原名或当前输入值，草稿与展开中的卡始终显示）。收起/折叠/筛选**只是呈现**：被藏的行照常保存；保存被拦或弹出合并提示时必须先 `revealConfigRow`（清筛选、展开）再滚动聚焦。局部重渲（设为当前、默认标签预览/添加/取消）前后连同展开态、折叠态、筛选词一起抓取回填；默认标签三个局部动作重渲后要把结果拉进视口并移交焦点（预览→「添加」、添加→第一个新增 chip、取消→入口），否则用户在正文顶部看不到任何变化。
- 时间选择器只按宽度选择自研 wheel/desktop picker；打开表单后跨断点 resize 或旋转屏幕时，必须按当前宽度重挂载，不能停留在旧 picker。v1.7.1 单点滚轮为 160px、行高仍 40px，`PAD = 60` 与 CSS 同步；首次定位完成前不得把布局滚动的第 0 行当成用户选择。桌面日历在表单文档流内展开，空间足够时日历／时分并排、容器不足时纵排，精确输入始终可见；外部点击先完成动作再收起，内部点击用原事件路径判定（重建后旧按钮已脱离 DOM），不能因收起或重建吞掉点击。
- 禁止 `title=`，避免原生 tooltip 与自定义 tooltip 叠加。
- 可见文字按钮不强制 tooltip；图标按钮必须同时有短 `data-tip` 和 `aria-label`。
- tooltip 默认不能生成会撑宽页面的盒子；tooltip hover 延迟 800ms 后显示，移开立即隐藏；`focus-visible` 必须无延迟显示；触屏不能靠 hover 触发 tooltip。
- 图标语义固定（v47 起日视图卡片已无常驻图标按钮——点整行编辑、删除进编辑 sheet；此规则约束将来若再引入图标处）：编辑=铅笔，删除=垃圾桶，取消=回退/撤销箭头，关闭只读页=细线 ×。当前运行时 `iconSvg` 实际使用 `more/edit/trash`；不存在 `check` 定义，保存使用文字按钮。
- 删除/取消禁用 x、`×`、`✕`，包括图标定义、按钮文本和渲染模板。
- 输入字号不低于 16px，避免移动端聚焦放大。v1.5.2 起经由 `--fs-input` 令牌：audit 校验令牌值 ≥16px、`.inp`（全部文本输入共用）与 `.dt-step-inp` 引用它，且任何输入类选择器设字号只能用它。
- 统一表单 sheet 打开后先把焦点收进 sheet 容器，首个 Tab 进入内部控件、首个 Shift+Tab 到末尾控件，正反向都不得逃到背景；“做了什么”是 textarea，Enter 必须换行，只有 Cmd/Ctrl+Enter 或「完成」按钮保存；定时刷新不能打断新增或编辑中的输入。同源其它标签页改记录、配置、句库或清空存储时，空闲页面刷新；有表单时只提示、不重绘草稿，确认提示或关闭后同步主界面。提示的实测高度（含安全区）须从表单可用空间中扣除，resize/旋转时重测；不能遮住取消/保存，也不能用固定像素猜通知高度。
- v46（R1）：sheet 关闭走 class 驱动过渡（`.sheet-closing`）+ `transitionend`/320ms 兜底后置 hidden，与进场 `@starting-style` 对称；`sheetCloseCleanup` 挡重入（关闭动画未播完又被重开/重关时立即收尾旧的，不留悬空定时器）；`prefers-reduced-motion` 下直接同步隐藏。v1.7.5 让 FAB 与底部渐隐层随已有 `body.sheet-open` 以 180ms opacity 过渡退场、关闭时恢复；不延迟面板、不加位移或计时器，不把临时退场写入 `hidden`/启动快照。减少动效时两者直接切换。
- v46（R3）：编辑态时间选择默认折叠为触发行（点击展开滚轮），与新建态一致；计划编辑（时间本就是核心可改项）例外，始终展开。校验失败但触发行仍折叠时，先展开触发行再显示错误，不能把报错文案落进看不见的容器里。新建／编辑展开后的延迟聚焦必须核对发出请求时的焦点拥有者与实际目标节点；用户已转移焦点、原目标已被重挂移除或表单已关闭时，不得执行旧请求（P40）。
- v46（R7）：切视图/切周期后内容方向性滑入（280ms，`app.js animateContentEnter`）；列表卡片入场淡入（140ms，纯 `opacity`，`.entry` CSS `@starting-style`）——只过渡 `opacity` 不碰 `transform`（`transform` 驱动左滑手势，共用 transition 会让拖拽变迟滞）。不做 FLIP／逐项 diff。
- v53 刷新接帧：每次主渲染后把 `.app` 与 FAB 的已转义 DOM 写入同标签页 `sessionStorage['timelog.bootSnapshot.v1']`；`index.html` 在 ES module 到达前同步恢复该快照并加 `.boot-restored`。只有数据/config/句库（`quotesRaw`）/视图/日期/记录模式/时间轴布局（v1.8.1，按归一化值比）/自然日仍一致才恢复；命中后 `init()` **不得再首轮 render**。左滑「编辑/删除」轨道默认 `visibility:hidden`，只在真实拖动或吸附打开时显现，禁止依赖上层卡片合成层遮盖，避免 Safari 刷新时底层轨道透出。快照不跨标签、不进备份、不替代 `localStorage` 权威数据。快照中的视图/日期/记录模式必须来自实际渲染状态，而非再读存储冒充；偏好未能落盘时，刷新后的存储比对必须拒绝不一致的帧。
- 移动端「更多」短 sheet 的抓手必须可下拉关闭：只从 `.sh-grab` 的至少 44px 高真实命中区响应触摸/笔，短拖回弹，拖动 ≥72px 或快速下甩关闭；正文滚动、桌面布局和新建/编辑等高表单不接管该手势。
- 进行中时长必须按分钟刷新；iOS PWA 从后台恢复时，`visibilitychange`、`pageshow` 或 `focus` 必须立即按当前时间补算并重建分钟 timer，不能等待下一轮或信任暂停前的 timer id。
- v57 新增入口按本地自然日分类：历史日强制已发生；今天沿用并可切换 `timelog.recordMode`；未来 `+1…+7` 日强制计划且不得改写今天偏好；`+8` 日起隐藏 FAB/底部渐隐层，但既有计划仍可查看编辑。计划时刻必须严格晚于 `now +5min`，且早于本地“今天 +8 日 00:00”；编辑既有计划时，只有规范化时间与同一次 `load()` 取得的最新 `ts` 完全相同，才可跳过整个窗口校验。
- v57 过夜续记只由数据形态触发：日视图恰好停在昨天、尾点为未记录 placeholder、且从 FAB 普通新增时，表单显式选择“到今天硬终点”或“只记到 24:00”。过夜起点不提供「现在」捷径：结束点已经是当前时刻或更早的今日首条真实记录，重置起点为现在只会产生非法区间；仅由 sheet 给单点选择器传 `showNow:false`，普通新增/计划/编辑默认保留，跨断点重挂仍需保持该选项。跨午夜原子写成昨/今两条日内记录；提交前必须在同一次最新 `load()` 对象图上重算签名，计划占用必写边界时不得移动或覆盖。
- `#boottrace=1` 只用于启动分段诊断：无 fragment 时不得创建 HUD、监听器、timer 或持久化诊断状态；HUD 只能在 `app-ready` 后挂到 `.app`/FAB 快照范围外，且不得显示记录内容、标签或备份数据。不得用 query 触发、不得改 SW 缓存策略或 `FILES`。**v62 起唯一的持久化例外**是「更多」里用户显式开启的启动诊断（P33 真机取证，fragment 带不进主屏 PWA 冷启动）：开启后每次启动向 `localStorage['timelog.bootDiag.v1']` 追加一条**只含计时、布尔、缓存命中数、固定枚举 SW 注册态（v68 诊断 v2：`i/w/a:Worker.state` 模块顶早读）与首绘毫秒**的样本（环形 ≤30 条，附距上次打开的间隔分钟数），绝不含记录内容、标签或备份数据，不进备份；关闭即整键删除样本；默认关闭时不得有任何读写、监听器或 timer。

## 支持者回馈（D35 → D36）

- 应用「更多」只链接本站静态支持页（中文 `/support/?from=time-logger`、英文 `/en/support/?from=time-logger`）；平台入口只在支持页，核心记录界面与文字轮播面板不加赞助提示。
- 三套各 14 句原创主题句库是运行时资产 `packs/<id>-<locale>.txt`（进 `sw.js` FILES 与 audit `REQUIRED_RUNTIME_ASSETS`，部署于 `/app/packs/`）；id 与顺序只在 `src/ui.js` 的 `QUOTE_PACKS` 定义，`audit_quote_packs` 点名缺失或多余的文件。文字轮播「主题句库」点一下只把草稿里还没有的句子（按拆句结果比较）追加进去，「完成」才保存；读取结果只属于发起时那份草稿；旧 origin 不渲染。支持页下载链接指向同一批文件，`site/` 不留副本。所有原有功能始终免费，完整备份规则照旧。
- 通用 SVG 感谢卡在 `site/support/`（英文页复用），不进应用 SW。不做订单服务、领取码、会员状态、公开名单、定制回信或定期更新承诺；不新增存储键。
- **公开仓库只放愿意让所有人取用的回馈**：只给付款人的致谢由维护者在爱发电、Ko-fi 后台设置；其原文、不公开内容及链接、领取码、后台截图、支持者昵称/人数/金额不进仓库与 `site/`（站点由公开仓库组装），隐藏路径和混淆不算保护。公开页不宣传致谢内容。
- 主站组装的清理边界由 `scripts/build_site.py` 守护：拒绝源码及其祖先/后代、未知输出路径、未标记为镜像的已有目录、输出目录及受管路径符号链接；新空目录或 `.git`/README 镜像骨架可用。所有输入预检完成后才清理；专项为 `python3 -m unittest discover -s tests -p 'test_build_site.py'`。

## 隐私红线

- 公开仓库不得含真实记录/真实截图/具体个人线索。
- 不提交导出的 `timelog-*.json` 或真实备份 JSON。
- 只发布 `time-logger/` 独立仓库与 `wowayou/time-logger-site` 部署镜像（D12：镜像只含 `scripts/build_site.py` 生成的产物，禁止手工维护业务代码、不得含密钥或用户数据），不发布父目录、`toolkit/`、`archive/` 或本机路径。
- **推广与发布材料不入公开仓库**（D33，2026-10-13）：渠道底稿、发帖记录、视频分镜与录制手册、演示数据生成器及其录屏检查，全部放在本地私有目录 `推广/`（在工作区内但被 `.gitignore` 整目录忽略，与 `toolkit/`、`memory/`、`外部/` 同类）。新增这类材料只放 `推广/`，不放进 `docs/`、`scripts/` 或 `tests/`；公开仓库的文档只描述边界与流程，不复述推广文案。演示数据生成器可以只读引用本仓运行时模块做自校验（不新增运行时依赖、不进 SW 缓存）。迁出只影响当前与后续版本：历史上已公开的提交、fork 与镜像仍含旧副本，需要真删必须重写公开历史——本仓不做，也不假装做过。
- README 和使用文档只能描述边界与用法，不写真实公司、个人进度或截图线索。
- README 演示图只能来自 `docs/assets/` 的固定 demo 数据 PNG，不得用真实 `localStorage` 或真实个人记录截图。
- `docs/assets/` 是仓库里唯一的 PNG 白名单目录（`.gitignore` 全局忽略 `*.png`），因此它同时是「最容易被当垃圾桶」的目录：新增任何 PNG 必须同步登记进 `project_audit.py` 的 `REQUIRED_DEMO_ASSETS` 或 `ALLOWED_DOC_ASSETS`，audit 会拒绝未登记的图。当前 `ALLOWED_DOC_ASSETS` 只含 3 张 icon-proto 评审渲染（合成图标，无真实记录）；登记用显式文件名，不用通配。

## 代码约定

- 纯原生 HTML/CSS/JS，使用浏览器原生 `type="module"`；不要引入打包步骤。
- 日期值统一 `YYYY-MM-DDTHH:mm`。
- 颜色走 CSS 变量；按钮白字 `#fff` 可保留。
- 字号、圆角走 `styles.css` 结构令牌（v1.5.2，SPEC-016 A）：字号 `--fs-cap/ui/ui-strong/body/input/title`（12/13/14/15/16/17），圆角 `--r-sm/ctl/card/sheet/pill`（8/12/16/22/999）。令牌块以外只允许 `inherit`/`0`/`50%` 或令牌（含 `calc()` 包令牌，如 `.seg` 内按钮的同心圆角）；确属例外的裸值（展示用大数字、20px 勾选框）在**同一行**附 `raw:` 理由注释，`audit_css_tokens` 按行拦截并**精确**封顶例外条数（`CSS_RAW_EXCEPTION_COUNTS`）。间距令牌 `--sp-1…--sp-6`（4px 刻度）目前只覆盖恰好落在刻度上的值，半档与奇数值尚未收敛（SPEC-016 B 期），不受 audit 约束。
- 尺子未记录段用 `--track`，不用 `--border`。`.ruler-bar` 分段缝背景用 `--border`（不用 `transparent`——透出父级 `--card` 会导致两主题缝的视觉重量不一致，v46 新发现）。
- 统计以分钟数为权威值：`job` / `maintain` / `leak` / `unrecorded` / `pending` / `total` 先累加分钟；百分比只用于展示，不反向参与统计，不强行凑满 100%。
- 标签 taxonomy 固定 4 桶：主线 `job`、维持 `maintain`、偏航 `leak`、未记录 `unrecorded`。桶在渲染/统计时由 tag→bucket 映射派生；孤儿 tag 落未记录。**第三桶 v69 起显示名为「偏航」，内部键仍是 `leak`**（存量 config/备份/CSS 令牌 `--leak`/`.chip-leak` 全按键走，改键＝数据迁移 + 旧备份读不回，明确不做）；语义是「偏离当前主线的时间」，不含道德评判——帮助页必须保留「偏航不等于错误、适时放空是必要的、可在标签高级设置改桶」这层意思，不得回退成「逃避娱乐」式措辞。
- 本地自然日 00:00 是统计硬边界；空日不继承前一天最后标签；有明确右邻记录的跨日闭合段会切入后续日期，但**最多切入次日**（v87）——右邻落在 D+2 00:00 或更晚时段落止于当日 24:00，中间那些自己一条记录都没有的日子整日无记录（与从未记过的日子同一表现），判据在 `segmentBoundsForEntry`，`confirmSegmentInData` 共用同一函数因此天然一致；有首条记录的日期从 00:00 到首条之间计为未记录；周/月/年汇总按每日独立统计累加。
- **长段待核是本机可选提醒，默认关闭**（v89，`config.longReview === true` 才开启）。关闭时明确标签段无论多长都直接按原桶统计，不显示待核、不要求确认；开启时，超过 3h 的非 `longOk` 段会附加 `pending` 提醒，但仍留在原桶，`pending` 是可与四桶重叠的注记分钟数，不得再并入 `unrecorded` 或从原桶扣除。“确认”只写入与 `startTs` / `endTs` 绑定的 `longConfirm` 以清除提醒；相邻时间变化或中间补录仍使其失效。确认侧与渲染侧都走 `loggedEntriesFrom`。历史 `longConfirm` / `longOk` 不迁移、不删除；导入备份不得替用户开启本机 `longReview`。任何写入路径都不得自动盖确认章。
- 时间戳是本地壁钟值，不做时区转换；跨设备导入可根据备份 `meta.sourceTimezoneOffsetMinutes` 建议“整体平移 ±N 小时”，用户仍可覆盖。
- 续记模型以所看日期为准：空日默认从 00:00 开始；有记录日按**尾点形态**分流（v77）——尾点是空占位条（或今天的进行中段）时默认续该点、FAB 文案「续 hh:mm 起」；尾点是**真实记录**时那天已被它覆盖到 24:00、没有可续之物，默认取**其后一分钟**、文案改「补记 hh:mm 起」（旧行为返回该记录自身的 ts，默认值恒撞同刻冲突，点进去必被拦）；尾点压线到 23:59 时当天不存在合法新增起点，**隐藏 FAB**，绝不把默认值越过午夜写进第二天。补录到已有右邻记录之前时结束点吸附右邻；今天无右邻到当前时间，非今天无右邻到 24:00。**占位条只有在新起点不晚于它时才可以复用**（v87）：复用＝把占位条的 `ts` 挪到新起点，往前挪是「续记」的正常语义（新记录把这段空白整个盖住，前一条相应截短），往**后**挪则是把 `[占位点, 新起点)` 这段「确实没记」静默改写成前一条记录的标签——踩 D13 硬约束③，而且改的往往是主线时长。晚于占位点时新建条目、占位条留在原地。
- 无冗余边界归一化只合并正文与**完整标签数组**相同的相邻记录；旧导入的附加标签或正文空格有差异时保留原边界。统计只看首标签不意味着其它已存字段可丢弃，验收须同时比原对象、相邻段与四桶分钟数。
- 数据只存在 `localStorage['timelog.v1']`；标签配置只存在 `localStorage['timelog.config']`；文字轮播句库只存在 `localStorage['timelog.quotes']`（v1.5.0，无句子时整键删除）。
- **录入时的标签归属必须看得见**（v1.5.0）：自定义标签撞上**别的桶**已登记的同名标签（按 `tagKey`，含主线）时，表单把灰字桶提示换成醒目的归属提醒（色相＝真正会记入的桶）+ 一键「改选 X」，联想列表只列所选桶的标签。已登记标签从不因录入改桶（v30）这条规则**不变**，提醒不拦保存；判据走 `storage.js` 的 `configuredBucketForTag`，不得回退成只查 chip、逐字相等。
- **标签同一性按 `tagKey()`（`trim().toLowerCase()`）判定，不按逐字相等**（v85）：`sleep` 与 `Sleep` 是同一个标签，桶归类、longOk、计数、迁移、录入去重、导入占位一律走它；用 `toLowerCase()` 而非 `toLocaleLowerCase()`（后者随设备语言变，标签是数据）。但 `normalizeConfig` 的**去重仍逐字**——存量并存的两种拼写要留到标签设置里显式「合并」，数据层不得静默丢弃或改桶。
- 复制/存储/导入/分享都是完整备份，导出前按 `ts` 升序排序；摘要只代表当前视图；所有动作都在浏览器本地完成，不上传。iPhone/iPad 的「存储备份」优先文件分享面板，让用户明确选择「存储到文件」和目录；取消不得暗中回退下载，能力不足或非 Apple 移动平台才走浏览器下载。
- 区间编辑、切分、删除必须先由 `entry_model.js` 的事务 planner 生成 `resultEntries` / `resultSignature`；UI 预览与最终保存共用同一规则，提交前必须基于最新数据重算，结果变化时要求再次确认。**普通/计划编辑与带源记录的补录/切分还须比对打开时的原记录**（`entriesRevision` 的内容、时间、标签与状态字段），变化或删除则保留草稿并拦下；表单共用 `unchangedFormEntry`，结果签名会被草稿覆盖，不能代替这道检查。删除确认须另存原记录签名，变化时先展示最新内容和删除结果、再次确认才执行；撤销恢复真正删除前的最新数据。无关条目的变化仍允许重算预览后确认；写前 raw 校验不是原子锁。
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

## 功能评审边界

2026-11-18 起取消原「v2 锁死 & 别镀金」门槛（D37）：功能扩张不再以「累计 28 天真实记录 + 求职有实质进展」为前提，也不再预设「不扩张报表、图表、分类体系」；不再在维护者要求打磨功能时提示求职风险。新需求按 `CONTRIBUTING.md` 的判断清单逐项评审。

- 账号、云同步、后端及运行时依赖仍不进入本仓库。安卓载体已按 D26 提前放行到独立仓库；iOS 原生载体仍按 D17 评审。
- 外部用户验证尚未开始，不能把自用、发布或自动化测试当作市场验证。

2026-07 的冻结已提前终止，旧日历与多模型协作流程不再执行（依据 `docs/decisions.md` D9–D16）；候选方向见 `docs/roadmap.md`，当前执行项以 `STATUS.md` 为准。

## 改动自测清单

每次改完至少跑：

```bash
python3 scripts/project_audit.py
python3 scripts/confirm_logic_smoke.py
npm run typecheck
npm run test:ui
git diff --check
```

浏览器手动检查（1–12）与响应式手动矩阵（1–6）在 [`docs/manual-checks.md`](docs/manual-checks.md)，编号沿用：**涉及 UI 的改动提交前必读并逐项过**；只读 `CLAUDE.md` 不算做完自测。

## CHANGELOG

> v1–v93 与 v1.0.0–v1.8.1 的历史条目已移至 `docs/CHANGELOG.md`（2026-07-25，D15 额度治理：本文件是三个模型每次会话都要整读的「法律」，历史流水不必每次付费）。
> **红线、边界、仪式条文全部留在本文件**，只有已归档的版本流水外移。本表保留最近三个版本（2026-11-17 维护者要求精简本文件，由八个改为三个）。

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.8.4 | 2026-11-19 | **时间分析跟随所看周期（已正式发布）**。此前分析页固定用今天的日期（`buildAnalyticsModel` 的 `todayStr()`），主视图翻到上周或上个月再打开，看到的仍是本周，已结束的整期无法复盘。现在打开时锚定主视图所看的日期：周/月/年视图沿用当前粒度，天视图从所在的周开始，分析页内切换周/月/年仍锚定同一日期；所看日期在未来时退回今天（未来周期没有已发生记录）。已结束的整期按既有 `elapsedMatchedRange` 整期对整期比较，`stats.js` / `time.js` 不变。说明、中英主页与《使用与理念》同批改写；零新增运行时资产、存储键或备份字段。新增 `tests/v1_8_4_analytics_period.spec.js`（6 条/引擎），以 v1.8.3 运行时 8/12 红，余下 4 条为「停在今天」哨兵与「未来退回今天」，改动前后都绿。发布见 STATUS。v1.8.1 原文归档。 |
| v1.8.3 | 2026-11-18 | **时间轴尺子刻度取代 4h 满格时长条（已正式发布）**。真机上超过 4h 的末端缺口像条断了，且满格 4h 是 v1.8.2 对比稿里未单独确认的参数、1 小时以内的段只剩一个点。维护者看过刻度与热力底对比图后选「只有尺子刻度」（规则见 UI 红线时间轴条）；热力底未采纳。i18n 改 2 处说明（中英对等），`使用与理念.md` 同步，audit 登记旧叫法「时长条」「full at 4 hours」；零新增运行时资产、存储键或备份字段。`tests/v1_8_2_timeline.spec.js` 改为刻度用例（25 条/引擎），新刻度用例以 v1.8.2 运行时 2/2 红；全量 1213/1/0。发布见 STATUS。v1.8.0 原文归档。 |
| v1.8.2 | 2026-11-18 | **时间轴「全文」布局（已正式发布）**。维护者要正文换行、不点开就能看全文；看过排布与热力底两轮对比图（热力底因对比度与分档不稳未采纳）后选「全文」取代「两行」作默认：正文 `pre-wrap` 完整换行、标签在正文下，竖脊仍通高、明知长短不代表时长，时长由右列数字与 4h 满格时长条表达（v1.8.3 改为尺子刻度）。偏好值 `single/full/scaled`，存量 `double` 按全文读、不改写，快照门同规则。i18n 改 1 键名与 2 处说明；零新增运行时资产、存储键或备份字段。新增 `tests/v1_8_2_timeline.spec.js`（以 v1.8.1 运行时 22/24 红）；全量 20 条失败均为旧用例写死的「默认 72px」，改判后该文件 44/44。发布见 STATUS。v1.7.5 原文归档。 |

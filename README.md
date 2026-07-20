# 时间尺

> Status: active · 核心记录闭环可日常使用；2026-07-16 → 07-29 处于 14 天功能冻结
>
> Release: v69
>
> Updated: 2026-07-20
>
> Intended user: 求职主线时间记录和每日复盘的个人使用者。
>
> Operating boundary: 本地静态 PWA，只记录时间去向，不做云同步、账号管理、KPI 考核或投资/合规判断。
>
> Current blocker: iOS 主屏 PWA 冷启动仍慢；启动诊断已证明页面侧毫秒级健康，慢段收窄指向系统冷拉起进程（页面计时零点之前，待录屏取证判决）。
>
> Risks and failure modes: 忘记记录导致“未记录”偏高、长时间间隔被整体计为未记录、周/月/年视图诱发过度复盘、浏览器本地数据或运行缓存被系统清理。

求职主线时间记录仪 — 每天看清时间进了哪里。

![固定演示数据的移动端时间轴](docs/assets/demo-mobile-timeline.png)

![固定演示数据的移动端编辑表单](docs/assets/demo-mobile-edit-drawer.png)

## 当前项目状态

- **已完成的核心闭环**：记录、计划、补录、完整区间编辑、切分、删除与撤销；天/周/月/年统计；完整 JSON 备份、安全合并导入和本地 Markdown 摘要。
- **当前形态**：纯静态、零运行时依赖、无构建的原生 ES modules PWA；数据只在当前设备和 origin 的 `localStorage`，没有账号、后端或云同步。
- **可靠性基础**：写操作使用事务 planner、最新数据复核和结果签名；Service Worker 提供离线缓存与显式更新；Chromium + WebKit 自动化覆盖主要交互、存储、导入和跨标签冲突路径。
- **当前首要未解问题**：iOS 主屏 PWA 冷启动仍明显迟缓。v58 提前注册 Service Worker 并加入 `modulepreload` 后，用户已在确认显示 v58 的设备上复测，主观上没有任何缓解；现阶段不能把模拟网络数据当作真机成功证据。详见 [P33](docs/postmortems.md#p33--pwa-冷启动-38s模块执行很轻时间耗在网络--sw-缓存未命中v58)。
- **当前阶段**：2026-07-16 → 07-29 处于 **14 天功能冻结**，首要活动是真实使用、空环境恢复演练、冷启动真机取证和求职推进；冻结期只处理阻断级缺陷（数据损坏、无法启动、无法记录/编辑/导出/恢复、离线不可用）。见[《14 天 Dogfood 冻结交接》](docs/dogfood-freeze-handoff.md)与 `docs/decisions.md` D9。
- **验证状态**：外部用户验证**已延期，尚未开始**——这不代表验证通过或失败。本项目当前只被证明对维护者个人有用，**不声称市场需求已被验证**。
- **当前治理状态**：功能扩张仍受“累计 28 天真实记录 + 求职有实质进展”门槛约束；14 天冻结比该门槛更严格——达到 28 天只表示可以重新评审，不自动解锁 roadmap。外部建议可以挑战现有铁律，但必须把破界成本、证据和停止条件讲清楚，经评审后才实施。

供外部 AI 或评审者使用的完整上下文、阅读顺序和固定输出要求见[《外部 AI 评审上下文》](docs/external-ai-review-brief.md)。它是评审入口，不替代 `CLAUDE.md` 的维护规范，也不授权直接改代码。

## 和「屏幕使用时间」类工具的区别

自动统计（iPhone 屏幕使用时间等）回答「设备被用了多久」，时间尺回答「你的一天去了哪里」：覆盖不在屏幕上的时间（面试、睡觉、通勤），由你自己按主线/维持/偏航/未记录做相对目标的价值归类（自动埋点分不清同一个 App 里的推进和逃避），并把说不清去向的时间显式呈现为「未记录」而不是让它消失；手动记录动作本身就是复盘干预。完整论述见[《使用与理念》](使用与理念.md)。

应用离线优先：首次联网加载让 Service Worker 缓存运行时文件后，断网也能记录、编辑、统计和备份，数据始终只在本机。

这里的「完整备份」指把当前记录与标签配置完整导出为 JSON。当前导入采用安全合并：会保留备份中没有的本机记录，也不会删除它们，因此它不是精确恢复、版本回退或“用备份整体替换当前状态”。

## 本地运行

应用使用原生 ES modules，本地请通过 HTTP server 打开，不要直接双击 `index.html`。

```bash
cd time-logger
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
```

真机移动端验证不需要推送或部署。手机和电脑同 Wi-Fi 时，可在本机启动：

```bash
python3 -m http.server 8080 --bind 0.0.0.0
# 手机尝试打开 http://192.168.101.101:8080/
```

若手机打不开，先检查服务是否绑定 `0.0.0.0`、Windows 防火墙、手机和电脑是否同网，以及 WSL2 端口隔离。

## 装到手机主屏（PWA）

iOS Safari：打开页面 → 分享 → 添加到主屏幕。  
Android Chrome：打开页面 → 菜单 → 添加到主屏幕。

应用已包含 SVG 源图标、192/512 PNG、maskable PNG 和 Apple touch icon。Android Chrome 的安装入口仍由浏览器根据 manifest、Service Worker、HTTPS/Pages 访问环境综合判断。

## GitHub Pages 发布（隐私边界）

只把 `time-logger/` 作为独立仓库发布，例如 `github.com/<your-name>/time-logger`。不要把父目录、`toolkit/`、`archive/`、导出的 `timelog-*.json`、真实记录 JSON、真实截图或具体个人线索提交到 GitHub。README 展示图只允许使用 `docs/assets/` 中的固定演示数据 PNG。

推荐发布方式：

1. 在 `time-logger/` 内初始化独立仓库。
2. 推送到 `github.com/wowayou/time-logger`。
3. GitHub Pages 选择从仓库根目录发布。
4. 其他设备通过 Pages URL 打开，再添加到主屏幕。

代码和界面文案可以公开；数据不能公开。每台设备的数据仍只保存在本机 `localStorage['timelog.v1']`，访问 Pages 不会上传、同步或合并记录。

## 多设备使用

- 同一个 Pages URL 只是同一个应用入口，不是云同步。
- 新设备首次打开时本地数据为空。
- 迁移数据靠原设备「存储备份」JSON，再到新设备「导入」。
- iPhone/iPad 的「存储备份」会优先打开系统菜单，可选择「存储到文件」及明确目录；其他浏览器使用原生下载能力，保存位置由浏览器或系统设置决定。
- 不提交导出的备份 JSON，不提交真实记录截图。

## 文件地图

| 文件 | 作用 |
|---|---|
| `index.html` | DOM 壳、PWA/meta 引用、`styles.css` 和 `src/app.js` 模块入口 |
| `styles.css` | 全部样式，包含主题、布局、控件、sheet、更多菜单和响应式规则 |
| `src/app.js` | 启动、状态组合、导航、渲染调度、事件委托和 Service Worker 注册 |
| `src/entry_model.js` | 记录日期模型、续记/占位/结算点、统一区间编辑/切分/删除事务 planner，以及写后归一化 helper |
| `src/io_actions.js` | 当前视图摘要、复制、下载、导入、分享等本地 IO 动作 |
| `src/sheet_controller.js` | 新建/编辑/config/import sheet、focus trap、picker 重挂载和表单保存 |
| `src/time.js` | 本地日期解析、格式化、周期范围 |
| `src/storage.js` | `localStorage` 数据/config 读写、导入整批预检和安全合并 |
| `src/stats.js` | 纯统计逻辑、按日分段、长段确认绑定 |
| `src/pickers.js` | 移动滚轮与桌面日期时间选择器 |
| `src/ui.js` | 渲染模板、图标、tooltip helper 和 DOM 更新 |
| `package.json` / `package-lock.json` | 开发期 Playwright UI smoke 依赖锁定，不参与运行时 |
| `playwright.config.js` / `tests/` | 响应式 UI smoke，启动本地静态 server 验证 |
| `sw.js` | Service Worker，离线缓存 |
| `manifest.webmanifest` | PWA 清单（名称、图标、版本） |
| `icon.svg` | 应用源图标 |
| `icons/` | PWA、maskable 和 Apple touch PNG 图标 |
| `docs/assets/` | README 固定演示数据截图，不放真实记录 |
| `ROADMAP.md` | 文档指针：postmortems / decisions / roadmap 导航 |
| `scripts/project_audit.py` | 开发期红线审计脚本，零运行时依赖 |
| `scripts/confirm_logic_smoke.py` | 确认逻辑、百分比格式和日边界 smoke，调用本机 `node` 执行真实 ES modules |

## 维护审计

```bash
python3 scripts/project_audit.py
python3 scripts/confirm_logic_smoke.py
npm run test:ui
git diff --check
```

审计脚本检查 PWA 版本、图标资源、Service Worker 缓存与可靠性护栏、tooltip/icon 红线、README 演示截图白名单和文档隐私红线。确认逻辑 smoke 覆盖区间编辑/切分/删除事务、日边界和随机压测。Playwright 同时跑 Chromium 与 WebKit，覆盖响应式布局、完整区间编辑、删除确认/撤销、左滑轨道、导入冲突、分享降级、跨标签同步和更新提示。

开发期 npm 只允许用于测试：`package.json` 保持 `"private": true`、`"type": "module"`，禁止新增运行时 `dependencies`，禁止提交 `node_modules/`、`test-results/`、`playwright-report/`。应用运行时仍是原生 ES modules + 静态文件，不引入构建流程。

## 数据模型

记录存在 `localStorage['timelog.v1']`，标签配置存在 `localStorage['timelog.config']`。导出的完整备份会同时包含 `entries`、`config` 和可选 `meta`；旧备份没有 `meta` 仍可导入。

```json
{
  "version": 1,
  "meta": {
    "exportedAt": "2026-06-30T04:00:00.000Z",
    "sourceTimezoneOffsetMinutes": -480,
    "sourceTimeZone": "Asia/Shanghai"
  },
  "entries": [
    {
      "id": "abc123",
      "ts": "2026-06-28T09:00",
      "what": "写简历",
      "tags": ["求职推进"],
      "longConfirm": { "startTs": "2026-06-28T09:00", "endTs": "2026-06-28T13:10" }
    }
  ]
}
```

底层是**点存储 + 区间 UX**：每条记录只存一个起点 `ts`，段的结束由右邻记录（或结算点）实时派生，不额外存区间。v48 的完整编辑、切分和删除都先由纯事务 planner 计算 `resultEntries` 与预览：边界不得跨自然日、越过相邻记录或产生零时长；提交前会在最新本机数据上重算，若结果变化则要求再次确认。所有写路径最终仍经归一化，去掉冗余边界并维持诚实的未记录占位。

续记模型以所看日期为准：空日默认从 00:00 开始；有记录日默认续最后一条，若当天已有空占位条则续占位条；补录到已有右邻记录之前时，结束点吸附到右邻记录。今天无右邻时结算到当前时间，非今天无右邻时结算到 24:00。时长 = 当前条到下一条 ts 的间隔，渲染时实时算，不存储。统计以本地自然日 00:00 为硬边界：空日不继承前一天最后标签；有明确右邻记录的跨日闭合段会切片进入后续日期；某天第一条记录之前从 00:00 起计为未记录；周/月/年汇总按每日独立统计累加。统计以分钟数为权威值：`job` / `maintain` / `leak` / `unrecorded` / `pending` / `total` 都先按分钟累加，条形图按分钟比例显示，百分比只用于展示，不反向参与统计，也不强行凑满 100%。

标签渲染时派生为 4 桶：主线 `job`、维持 `maintain`、偏航 `leak`、未记录 `unrecorded`（第三桶 v69 起显示为「偏航」，内部键仍是 `leak`，存量备份与配置无需迁移）。自定义标签默认进入主线；固定 chip 可在本机配置；孤儿标签和“未知”计为**未记录**。超过 3h 的非 `longOk` 明确标签段先显示为**待确认**并并入未记录；确认按钮会显示该段起止时间，确认后才按标签统计。默认只有“睡觉” `longOk:true`，吃饭/洗漱等过长仍需确认。

## 功能清单

- 记录 / 编辑完整开始—结束区间；今日尾段可选「至今」或固定结束，固定后自动留下未记录尾段
- 删除前展示确切结果：仅两侧内容和标签完全一致时接回，否则原区间转未记录；删除后 8 秒可撤销，跨标签修改会使撤销失效
- 段内有界补录与切分：冻结原段边界，支持内部、贴边和整段改写，不会吞掉其它记录
- 触摸/触控笔左滑揭示 2×72px 编辑/删除轨道；鼠标与键盘继续使用点卡编辑和编辑页删除
- 计划模式：计划条不计入 4 桶统计，时间到可点「发生了」转为已发生记录
- 超过 3h 的非 `longOk` 明确标签段需确认后才按标签统计
- 天 / 周 / 月 / 年视图：天视图可编辑，周/月/年只读汇总并可下钻
- 移动端日期滚轮选择器（补录用），支持触控、鼠标滚轮、方向键
- 桌面端自定义日期/时间选择器（popover 日历 + 时分步进），并保留 `YYYY-MM-DD HH:mm` 精确输入文本框
- 文本时间输入接受 `2026/6/28 9:5`、`2026.6.28 9:05`、`2026-06-28T09:05` 等完整日期时间；不接受仅 `9:30` 这类省略日期输入
- 时间尺：主线 / 维持 / 偏航 / 未记录 占比可视化
- 桌面鼠标悬停 tooltip 延迟约 800ms 显示，移开立即隐藏；键盘 `focus-visible` 立即显示；触屏不显示 hover tooltip
- 自动 / 亮色 / 暗色分段主题控件
- 阶段格言：日视图结论卡下方一行小字（未设置显示默认句「记录是手段，推进主线才是目的。」），点行或经「···」更多编辑，清空即隐藏；随完整备份迁移
- 低频动作收纳在「···」更多菜单：摘要、备份四项、标签高级设置、阶段格言、主题、说明
- 数据完整备份（复制 JSON / 存储 / 分享；iPhone/iPad 存储优先系统文件面板，分享按文件→文本→下载降级，用户取消不会误下载）
- 导入先整批检查；全部冲突都会展开，可逐条保留本机、使用备份或合并文字，全部处理并复核最新本机数据后才原子写入
- 导入是安全合并，不会删除备份中不存在的本机记录；当前不提供精确恢复或版本回退
- JSON 导入先整批预检：相同记录跳过，同 ID 不同内容或同时刻冲突会阻止整批写入并列出原因；可按时区 meta 建议整体平移
- 当前视图摘要复制（Markdown，可直接贴给 AI）
- 离线可用；新版 worker 等待时始终提示，只有点击「更新应用」后才刷新，预缓存失败会继续保留旧版本

## 许可证与版权

时间尺由 **wowayou** 开发并版权所有（© 2026 wowayou）。

- **开源许可**：以 [AGPL-3.0-or-later](LICENSE) 发布。你可以自由使用、研究、修改与再分发；**通过网络对外提供服务时也必须向用户开放对应源码**（AGPL §13），衍生作品须以同一许可证开源。
- **商用 / 双许可**：作为唯一著作权人，作者保留在 AGPL 之外另行授权的权利。若需在闭源或无法满足 AGPL 义务的场景下商用，可通过 [项目仓库](https://github.com/wowayou/time-logger) 联系另谈授权。

每个运行时文件顶部都带 `SPDX-License-Identifier` 标识；界面文案与代码可公开，个人数据始终只留在本机、永不上传。

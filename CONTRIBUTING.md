# 贡献指南

时间尺是一把**尺子，不是产品**：本地优先、零后端、零运行时依赖的单页 PWA。它的价值来自克制——大多数"能加的功能"都不该加。所以本指南的核心不是代码风格，而是一份**"这个改动该不该做"的判断清单**。

维护红线（模块边界、隐私、UI、版本仪式、代码约定）的**唯一真源是 [`CLAUDE.md`](CLAUDE.md)**，本文件不复述、只引用。动手前请先读它。

---

## 该不该加这个改动？

按顺序自问，任一步卡住就停下：

1. **过了门槛吗？** 在累计 **28 天真实记录**、且求职有实质进展之前，不做可扩展分类法、人类报表 / 更多图表、滚轮像素级打磨、跨设备同步 / 登录 / 云端。见 `CLAUDE.md`「v2 锁死 & 别镀金」。
   - **最大风险 = 用打磨工具逃避面试推进。** 每次"再加个功能"冒出来，先问：目标公司的约面今天推进了吗？

2. **契合核心模型吗？** 时间尺的骨架是**点存储 + 区间 UX + 4 桶标签（主线 / 维持 / 漏损 / 未记录）+ 本地自然日 00:00 硬边界 + 本地优先**。撞这些前提的想法（时区转换、跨天汇总覆盖每日独立统计、账号、后端）默认不做。

3. **不破铁律吗？** 无运行时依赖 / 无构建 / 原生 ES modules。运行时文件只能相对路径导入本项目模块，禁止引入打包器、框架、npm 运行时依赖。npm 只能放开发期测试工具。

4. **归哪个模块？** 按 `CLAUDE.md`「模块边界」落位，别跨界：
   - 纯时间/日期/格式化 → `src/time.js`（不碰 DOM / localStorage）
   - 本地数据、config、导入合并 → `src/storage.js`（不渲染）
   - 统计、按日分段、长段确认 → `src/stats.js`（不碰 DOM / navigator）
   - 记录日期模型、续记起点、占位、结算点、`carveInsert` / `coalesceRedundant` / `normalizeEntries` → `src/entry_model.js`（纯/低副作用）
   - 时间选择器 DOM → `src/pickers.js`；模板/图标/tooltip/渲染 → `src/ui.js`
   - sheet、focus trap、表单保存 → `src/sheet_controller.js`；摘要/复制/下载/导入/分享 → `src/io_actions.js`
   - 启动、导航、渲染调度、事件委托、SW 注册 → `src/app.js`

5. **动了运行时文件吗？** 那就走**版本仪式**：`sw.js` 的 `CACHE`、`manifest.webmanifest` 的 `version`、`scripts/project_audit.py` 的 `EXPECTED_VERSION`、`CLAUDE.md` 的当前版本行 + CHANGELOG 一起升。新增运行时资产还要同步 `sw.js` 的 `FILES` 列表。文档 / 测试 / npm 元数据不进 SW 缓存。

6. **测过吗？** 见下。

如果一个改动过不了第 1、2、3 步，正确做法通常是**记进 `docs/decisions.md` 或 `docs/roadmap.md` 然后不做**，而不是实现它。

---

## 改动自测清单

每次改完，提交前至少跑全这四条（等价于 `CLAUDE.md`「改动自测清单」）：

```bash
python3 scripts/project_audit.py       # 版本 / 缓存 / 图标 / tooltip / icon / 隐私红线
python3 scripts/confirm_logic_smoke.py # 真实 ES modules 压测长段确认、4 桶统计、日边界
npm run test:ui                        # 响应式 UI smoke（Playwright）
git diff --check                       # 行尾空白 / 冲突标记
```

改了统计或日边界，务必在 `scripts/confirm_logic_smoke.py` 补用例；改了布局或 sheet，务必在 `tests/` 补 UI smoke。真机相关的行为（iOS 键盘、visualViewport、PWA 更新）无法在 headless 稳定复现，按下面的「本地真机调试」手验，并在 `docs/postmortems.md` 记根因与验证方式。

提交/推送前还需：`git status --short` 确认没有真实记录、真实截图、导出的 `timelog-*.json`、Playwright 结果或本机临时文件混入。隐私红线见 `CLAUDE.md`。

---

## 本地真机调试

WSL2 用 NAT，手机和 Windows 不在同一网段，**iPhone 无法直接访问 WSL 里起的服务**。两条可行路径：

### A. 纯 HTTP，测交互（不含 SW / PWA）

从 **Windows PowerShell**（不是 WSL）在项目目录起静态 server：

```powershell
cd D:\dev\time-logger
python -m http.server 8000
```

查本机 LAN IP（`ipconfig` 里的 IPv4，例如 `192.168.x.x`），iPhone 同 Wi-Fi 打开 `http://<Windows-LAN-IP>:8000`。首次可能要在 Windows 防火墙放行 Python。

这条能测布局、表单、键盘、滚轮等**交互**，但纯 HTTP 下 Service Worker 不注册，**测不了离线缓存和 PWA 更新链路**。

### B. HTTPS 隧道，测 SW / PWA

SW 需要安全上下文。用隧道把本地 server 暴露成 HTTPS：

```powershell
# 先按 A 起本地 server，再另开一个窗口
cloudflared tunnel --url http://localhost:8000
# 或 ngrok http 8000
```

用隧道给出的 `https://…` 地址在 iPhone 打开，即可测 SW 注册、离线可用和「更新应用」提示（改 `index.html` 后升 CACHE 号，旧页面应提示更新，点后加载新版且本机 `localStorage['timelog.v1']` 保留）。

### 为什么不用 WSL 起服务给手机

WSL2 端口默认只在 Windows 本机可达，手机访问 WSL IP 会超时。要么用上面从 Windows 侧起服务，要么配 `netsh portproxy`——但从 Windows 直接起 `python -m http.server` 更省事。

---

## 提交与发布

- 只把 `time-logger/` 作为独立仓库发布，GitHub Pages 从仓库根目录直接发布静态文件。
- 正式版本推 `main` 后建并推同版本 tag（如 `v31`），再建/更新同版本 GitHub Release，简短列用户影响 / 内部治理 / 验证结果，不贴真实数据或截图。
- 除非明确要求，不把无关重构、真实数据或工作区外文件混进同一个提交。

## 许可证

本项目以 **AGPL-3.0-or-later** 授权（见 [`LICENSE`](LICENSE)）。提交贡献即表示你同意你的贡献以同一许可证授权。作者保留以其它条款（含商业）另行授权本项目的权利；如需商业授权，通过 <https://github.com/wowayou/time-logger> 联系。

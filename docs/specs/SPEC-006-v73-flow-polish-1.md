# SPEC-006 · v73：流程优雅性批次一——离线时不打系统弹窗 + 原生 alert 清零

status: ready
owner: 执行方认领后填分支名
验收人: Fable

## 背景（真机证据，2026-07-24）

1. **飞行模式下每次进入 PWA，iOS 弹系统对话框** "Turn Off Airplane Mode or Use Wi-Fi to Access Data"。根因是我们自己的更新检查：`src/app.js:1029` `checkForUpdate = () => reg.update()` 在冷启动与每次 `visibilitychange`/`pageshow`/`focus` 转前台时发起网络请求（v44 链路），飞行模式下该请求触发 iOS 系统提示。应用本体离线完全正常（截图为证）——弹窗纯属更新检查的副作用。关飞行模式后短暂出现的「开流量」提示同源。
2. **导入流程以原生 alert 收尾**（维护者录屏「导入实录」）：全仓共 4 处原生 `alert()`，与应用自定义 sheet 语言不一致：
   - `src/app.js:461`（区间确认签名过期「这段时间已经变化…」）
   - `src/io_actions.js:495`（「导入完成：写入 N 条…」成功摘要）
   - `src/io_actions.js:517`（「文件解析失败…」）
   - `src/io_actions.js:519`（校验失败 `checked.msg`）

## 范围

### A. 离线守卫

- `checkForUpdate` 加守卫：`navigator.onLine === false` 时跳过 `reg.update()`（恢复在线后的下一次前台事件照常检查，不需要补偿逻辑）。
- **诚实边界（写进 CHANGELOG）**：WebKit 自身按导航节奏的 SW 更新复查不受 JS 控制，极偶发的系统提示仍可能出现；本改动消除的是每次进入必弹的主要来源。
- 不改 v44 链路的其它行为（横幅、静默 reload、C1 兜底指引全部不动）。

### B. alert 清零（替换为应用内反馈，语言与既有模式一致）

- **导入成功摘要**（io_actions:495）：改用 v48 撤销提示同款 toast 形态（非阻塞、自动消退；不需要撤销按钮）——文案不变。
- **导入解析/校验失败**（io_actions:517/519）：导入检查 sheet 已存在——错误改为该 sheet 内的 inline 错误块展示（`showInlineError` 同款样式）；若失败发生在 sheet 打开前（选完文件即解析失败），打开导入检查 sheet 只显示错误与「关闭」。错误文案保持「说清发生了什么 + 怎么办」，不道歉不含糊。
- **区间确认签名过期**（app.js:461）：改为已有的内联提示模式（该 alert 本就只是提醒后重渲染——改为渲染后在对应行位置出现一条非阻塞提示，或复用 toast；执行方按最小改动选择，PR 里说明取舍）。
- 替换后运行时**不得再含任何 `alert(`/`confirm(`/`prompt(`**（grep 断言进测试或 PR 自查贴输出）。
- **平台边界（不做）**：导入的文件选择器是 OS 系统 UI，Web 内不可定制；那是未来原生载体阶段的事（D8-B）。

### C. 滚轮挂载潜伏 bug（SPEC-004 执行方发现并报告，2026-07-24 Fable 核实定案）

- **事实**：`src/ui.js:556` 的 plan-time-row 用 `class="fl hidden"` 隐藏——但 `styles.css` 里**不存在** `.hidden` 类；兄弟行 log-time-row（`ui.js:552`）用的是 `hidden` **属性**。挂载点解析（`sheet_controller.js:123-124`）检查的是 `planRow.hidden` 属性，因此首渲染窗口内（`updateRecordModeUI` 尚未把属性写正之前）新建-记录模式的时间滚轮会挂进 plan 行的挂载点。v46 R3 的折叠触发行掩盖了日常可见影响（滚轮展开时属性已被纠正），属**潜伏缺陷**。
- **修复**：`ui.js:556` 改为与兄弟行一致的 `hidden` 属性渲染（一行）；顺带删掉无效的 `hidden` class 引用。
- **测试**：修正现有用例中被 `.first()` 掩盖的定位（按执行方 PR #27 描述里指认的用例），断言首渲染时滚轮挂载点位于 log-time-row 内；P35 红灯证明。

## 版本仪式

`bump_version.py 73` + CHANGELOG 行；FILES 不变、零新资产。

## 测试要求

- 离线守卫：Playwright `context.setOffline(true)` 下模拟 `visibilitychange` 转前台，断言未发起 sw.js 请求（可通过 route 计数）；在线时照常发起。
- alert 清零：导入成功/解析失败/校验失败三路径断言应用内反馈出现且无 dialog 事件（`page.on('dialog')` 计数为 0）；P35 红灯证明。
- 全套自测绿。

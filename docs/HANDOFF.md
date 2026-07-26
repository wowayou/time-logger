# 当前交接状态（接手先读这一份）

> 用途：额度用尽 / 换模型 / 换人时，**任何人读完这一页就能接着干**。
> 维护纪律：每完成一个里程碑就更新本文件并提交，不要攒到最后写。
> 权威文档分工：法律＝`CLAUDE.md`；决策史＝`docs/decisions.md`；协作流程＝`docs/collab-protocol.md`；人肉步骤＝`docs/launch-runbook.md`；规格＝`docs/specs/`。本文件只讲**此刻**。

最后更新：2026-07-25 · 更新人：Claude Opus 5（本地会话）

---

## 一句话现状

**v74 三单已全部实现并提交在分支 `spec/074-batch`（PR #30，draft）**，版本仪式已做（六锚点 + CHANGELOG）；剩下的是复跑确认、PR 转 ready、维护者真机截图、以及维护者点头后的 merge + tag + Release。

## ⚠️ 额度事件（2026-07-25）

执行方（本地派发的 Sonnet 5 子代理）在收尾自检阶段**撞上周额度上限**（提示「resets 2pm Asia/Tokyo」）而中断。中断时三单的实现提交都已落地，只有版本仪式的六锚点改动停在暂存区——已由验收方补提交，**没有工作丢失**。若你接手时仍在限额内，本页下方「下一步」全部是本地命令，不消耗模型额度。

## 角色（本轮与协议默认不同）

| 角色 | 谁 | 说明 |
|---|---|---|
| 规格 | Fable（另一会话） | SPEC-009/010/011/012 均由它起草 |
| 裁剪与记录 | Claude Opus 5（本地会话） | D15 额度裁剪、本文件 |
| 执行 | Sonnet 5 子代理（本地派发） | 维护者 2026-07-25 指定，替代「另一台机器的执行方」 |
| 验收 | Claude Opus 5（本地会话） | 维护者 2026-07-25 指定 |
| 真机终审 | **维护者** | SPEC-011 的验证环只能由真机截图关闭 |

## v74 批次进度

| # | 规格 | 状态 | 提交 |
|---|---|---|---|
| 1 | SPEC-012 导入 toast 回归 | ✅ 已实现 | `6933903` |
| 2 | SPEC-011 状态栏遮条 | ✅ 已实现 | `21647fe` |
| 3 | SPEC-009-lite 修复更新通道 | ✅ 已实现 | `a6d5247` |
| 4 | 版本仪式 v74 | ✅ 已完成 | `64b8812` |
| 5 | 验收复核（读实现 diff + 全套双引擎复跑） | ✅ 已完成，两处补正 | `2aadf2d` |
| 6 | PR #30 转 ready + 贴 P35 证据 | ✅ 证据已贴 PR 评论 | — |
| 7 | 维护者真机截图（SPEC-011 亮暗各一张、滚动态） | ⏸ 等维护者 | — |
| 8 | merge + tag `v74` + Release + 镜像发布 | ⏸ **等维护者点头**（对外发布） | — |

实现总量：`index.html` / `styles.css` / `src/app.js` / `src/io_actions.js` / `src/ui.js` 共 130 行增删，`tests/ui_smoke.spec.js` +228 行。

## 执行方报告的一处**重要偏离**（需回流给 Fable）

SPEC-012 规格写的根因是「sheet 动画关闭的 320ms 窗口里盖住 toast」。执行方用探针实测校正：导入 sheet 是从「更多」下钻进入的，`closeForm()` 命中 v41 既有的 `returnToMore` 导航栈，会把 sheet 内容**换回「更多」而不是真正 hidden**——所以那是**持续性遮挡**，不是一次性的 320ms 窗口，「让 toast 晚 320ms 出现」这类时序补丁根本修不好。

最终修法（两条一起才成立）：① `showInfoToast` 延到 `SHEET_CLOSE_MS` 之后（`prefers-reduced-motion` 下立即显示）；② `#info-toast` 的 z-index 提到 `.form-sheet` 之上（85，仍低于 `.cross-tab-banner` 的 90）。**规格正文的根因段落应由 Fable 据此更正**，否则下次有人照着旧描述改会重蹈覆辙。

## 验收结论（Opus 5，逐行读过 130 行实现）

**通过，但补了两处**（提交 `2aadf2d`，均按 P35 先证明红灯）：

1. **失败要说出来**：`unregister()` 返回 `false` 或抛错时，原实现照样 `reload()`——用户看到页面刷新、卡死照旧、零反馈，正是 v64 花一个版本根治的「点了没反应」。改为只有真注销成功（或本就没有注册，reload 后会全新注册）才刷新；失败给出「完全退出应用后重新打开」并复位按钮。
2. **可访问名要跟随**：武装态只改了可见文字，`aria-label` 仍是原文案——它覆盖按钮内容，读屏用户会停在旧名称上。两态现在同步改、复位还原。

**全套复跑**：补正后双引擎 **276 passed / 0 failed（5.1m）**。补正前那轮是 273 passed / 1 failed，挂的是压测 A 类启动耗时阈值——单独复跑 8 条全过、本轮全套也过，判定为满负载并行下的抖动，与本批改动无关（该测试历史上就有冷启动误报，v38 为它加过预热导航）。

核过没问题的三处：遮条与 `.undo-toast` 同层级（不在 `@media` 里，浏览器上下文恒零高度）、`.undo-toast` 基础规则有 `translateX(-50%)`（`@starting-style` 不会跳位）、`applyImportedData` 返回值从布尔改对象只有一个调用方。

**遗留的最小耦合**（不阻断，登记备查）：`io_actions.js` 的 `SHEET_CLOSE_MS = 320` 是 `sheet_controller.js` 里 `animateSheetClose` 兜底时长的手抄副本，执行方已在注释里标注。将来改动画时长要两处一起改，或把常量导出共享。

## P35 红灯证明（已完成，双引擎）

三单各自 stash 实现 → 跑受影响用例见红 → `stash pop` 恢复 → 复跑见绿：

- SPEC-012：4 failed → 4 passed（红灯断言含 `importToastOnTop` 与 `toBeVisible`）
- SPEC-011：3 failed / 1 passed → 4 passed
- SPEC-009-lite：4 failed（两引擎各 2 条）→ 4 passed（连跑两轮零 flake）

证据全文在会话 scratchpad（**session 级，会丢**），已贴进 PR #30 评论作为持久留档。

## 下一步（接手就跑这些；纯本地，不吃额度）

```bash
git checkout spec/074-batch && git pull
python3 scripts/project_audit.py && python3 scripts/confirm_logic_smoke.py && npm run typecheck
ss -ltnp | grep 4173 || echo "4173 空闲"    # v65 端口陷阱：先确认端口不是别的项目
npm run test:ui                              # 274×2 双引擎
git diff --check && git status --short
gh pr ready 30                               # 全绿后转 ready
```

## 验收门槛（一条都不能减）

- 四件套全绿 + `git diff --check` 干净。
- P35 红灯证明齐全（已完成，见上）。
- `git status --short` 不夹带真实记录、截图、导出 JSON、`外部/`、测试产物。
- 改动范围严格等于三份规格 scope（已核：130 行实现全部落在规格描述的文件与机制里）。

## 已知风险 / 坑

- **SPEC-011 的验证环 headless 关不上**：Playwright 仿真不了 `env(safe-area-inset-top)`，自动化只断言存在性/fixed/`pointer-events:none`/z 序/浏览器上下文零高度不遮挡。真机截图（standalone、滚动态、亮暗各一张）**只能由维护者补**——这是本仓库首个如此标注的规格，不要假装它已闭环。
- **端口陷阱（v65）**：`reuseExistingServer: true` 会把 4173 上任何陈旧 server 当被测应用，整套假超时。
- **反馈类断言一律 `toBeVisible()`**：`toContainText` 对 `display:none` 和被遮挡元素照样通过——SPEC-012 这个回归就是这么漏网的。
- 工作区有未跟踪的 `外部 /` 目录，协议点名不得提交；不要 `git add -A`。

## 不要碰（已 park，D15）

- SPEC-007（标签设置重设计 + 主线可编辑）、SPEC-008（landing 活体 mock）：推到 2026-07-30 阶段复盘重排。park ≠ 取消。
- SPEC-010：阶段一只出**变体 A** 截图，不合并代码、不 bump；阶段二只在维护者拍板后并入某次仪式。
- SPEC-002：仍 blocked，等 runbook Phase C/D 浸泡后由 Fable 解锁；解锁后并入当时最近一次仪式，不单独发版。

## 维护者手上的信号（AI 侧在等）

1. **v74 能不能 merge + tag + 发 Release**（对外发布，等你点头）。
2. SPEC-011 真机截图（亮暗各一张、滚动态）——它的验证环只有你能关。
3. 冷白变体 A 拍板（SPEC-010 阶段二的前置）。
4. 浸泡结束 → 解锁 SPEC-002 旧站只读冻结。
5. 推广草稿改写完 → 要事实核查就丢给 AI（runbook Phase E）。

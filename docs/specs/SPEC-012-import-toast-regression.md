# SPEC-012 · v73 回归修复：导入确认后「什么都没弹」

status: ready（D15：v74 合并批次的第一项，优先级最高）
owner: 执行方认领后填分支名
验收人: Fable
优先级: 高（v73 刚引入的回归 + 维护者日常导入流程必经；插在 SPEC-009 之后、SPEC-011 之前）

## 背景（真机 + 无头探针双证据，2026-07-25）

SPEC-006 B 把导入完成的原生 `alert()` 换成了 `#info-toast`。维护者真机反馈：v73 导入确认之后**直接没有任何弹窗**，比原生 alert「更加不优雅」——原生 alert 至少是一个明确的「完成了」确认，现在是一片静默，用户无法确认导入是否成功。

**根因（已用抛弃式探针在无头环境实测坐实，非推测）**：

`io_actions.js` `confirmImportShift` 的调用顺序是——
1. `applyImportedData()` 内 `deps.showInfoToast(...)`：t=0 立即把 `#info-toast` 的 `hidden=false`（z-index **70**）；
2. 紧接 `deps.closeForm()`：表单 sheet（z-index **80**）走**动画关闭**，DOM 里最多再停留 **320ms**（`animateSheetClose` 的 transitionend 或兜底 timer）才真正 `hidden`。

这段 ~320ms 里，正在向下滑出的 sheet + 半透明遮罩盖在 z-index 更低的 toast 上方，而 toast 恰好在 `bottom:88px`（sheet 滑出的必经路径上）。等 sheet 滑完露出 toast，人眼已错过它的出现；叠加 toast 无入场动画、3 秒即自动消失、位置贴底且小——真机上综合表现为「什么都没发生」。

无头探针实测：toast 确实 `display:flex opacity:1 zIndex:70`、文字正确、`isVisible=true`——**所以套件是绿的，问题从未被测出**。

**验收盲区（本规格必须一并堵上）**：`tests/ui_smoke.spec.js` 导入成功用例（约 L503）只断言 `toContainText('导入完成')`。`toContainText` 对 `display:none`、被遮挡、opacity:0 的元素照样匹配文本——它证明「文本写进了 DOM」，**没有证明「用户能看见」**。对比同文件区间确认签名过期用例（约 L627）正确地用了 `toBeVisible()`。这是执行方 SPEC-006 P35 红灯证明的缺口：红灯证明了文本存在会变红，没证明可见性会变红。

## 目标

导入成功后，用户能**明确、及时地**看到一次「导入完成」反馈，且该反馈不被正在关闭的表单遮挡。原生 alert 的「明确确认」价值要用应用内手段还原回来，而不是降级为一片静默。

## 方案（维护者拍板前，执行方先按此实现；如认为有更优解在 PR 里提，勿擅自换向）

**核心：把 toast 的亮出时机挪到 sheet 关闭动画之后，而不是之前。** 让 `confirmImportShift` 先 `closeForm()`、待关闭收尾后再 `showInfoToast()`——toast 在一个干净的、没有 sheet 遮挡的屏幕上出现。

实现要点：
- `closeForm` 当前不接受回调。不要为此改动 `closeForm` 的公共签名去牵连所有调用点。改为在 `confirmImportShift` 里，把 `showInfoToast` 延迟到关闭动画时长之后触发——复用既有的 `prefersReducedMotion()` 判断：reduced-motion 时立即 show，否则用与 `animateSheetClose` 同源的延迟（≈320ms，建议抽一个共享常量 `SHEET_CLOSE_MS`，避免魔法数字与动画时长漂移）。**诚实边界写进代码注释**：这是时序协调而非硬同步，若将来 sheet 动画时长改变，此处需跟随。
- 保留 `#info-toast` 的其余行为（3 秒自动消失、无动作按钮、独立于 `#undo-toast`）。
- **可见性增强**（消除「太隐蔽」那一环）：给 `#info-toast` 加一个入场过渡（与 `.undo-toast` 一致的克制淡入/上移，尊重 `prefers-reduced-motion`），让它「到达」这件事本身可感知。不要做花哨动效——克制，和撤销提示同一视觉语言。
- 区间确认签名过期那条 `showInfoToast`（app.js:461）**不经过 sheet 关闭路径**，不受本 bug 影响，其调用点不要动——那条已经是 `toBeVisible()` 覆盖的、真机可见的。只修导入这一条。

## 验证环

- **补齐可见性断言**：把导入成功用例的 `toContainText` 升级为 `toBeVisible()` + 文本断言两者都要。这是本规格的硬性要求——修了 bug 但没堵测试缺口＝下次还会回归。
- **新增时序回归用例**：断言在 `确认导入` 点击后的 sheet 关闭窗口内，toast 最终变为 `toBeVisible()`（用 `expect(...).toBeVisible()` 的自动重试即可覆盖「延迟出现」）；并断言此刻 form-sheet 已 `hidden`（证明 toast 出现在 sheet 消失之后，而非被其遮挡）。
- **P35 红灯证明**：stash 实现，确认新增/升级后的用例变红；恢复，确认全绿。红灯必须由「可见性」触发，不是由「文本缺失」触发——执行方需在 PR 里贴出红灯输出证明这一点。
- 全套双引擎 + audit + typecheck 全绿。
- **真机验收（维护者，本规格闭环条件）**：v 版本上线后，维护者在真机实际走一次导入，确认导入确认后能明确看到「导入完成」提示。无头环境测不出遮挡的时间差与真机观感——这一环只能由维护者的真机确认关闭，与 SPEC-011 同属「真机验收」类规格。

## 非目标

- 不改导入的数据逻辑、平移逻辑、冲突解决——纯反馈时机与可见性。
- 不引入通用 toast 队列/管理器——当前两处 toast（undo/info）用现有的 `body:has` 错位规则已足够，YAGNI。
- 不动原生 alert 清零的其余三处（解析失败、校验失败已改为导入检查 sheet 内联错误态，那些是正确的）。

## 备注：验收方法论的教训

本 bug 暴露的不是执行方不认真——P35 流程被严格执行了，红灯证明也做了。暴露的是**「文本存在」被当成了「用户可见」的代理指标**。`toContainText` 与 `toBeVisible` 的区别在无头环境里很容易被忽略，因为无头下元素几乎总是「技术上可见」。今后凡是「给用户看的反馈」类断言，一律要求 `toBeVisible()` 而非 `toContainText()` 单独使用。此条建议吸收进 CLAUDE.md 的测试规范或 collab-protocol 的 PR 检查单（执行方或 Fable 择一落地）。

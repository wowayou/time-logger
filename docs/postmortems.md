# 排查记录（Postmortems）

记录已发生并已修复（或已确诊待修）的功能/逻辑 bug：**现象 → 根因 → 修法 → 护栏 → 范围**。
与 `docs/decisions.md`（评估过但不落地）区分：这里只放真实出过问题的东西。

---

## P1 · 编辑记录静默不落库（v28 热修）

**确诊日期**：2026-07-01 · **状态**：已修复（v28）· **严重度**：高（静默数据丢失）

**现象**：
- 点已有记录的铅笔 → 改「做了什么」/ 改标签 chip / 改时间 → 点 ✓ 保存 → 看似没反应，记录仍是原样。
- 不分标签：改自定义标签不生效，改已有 chip 也不生效；进一步发现改内容、改时间同样丢失。表现像「整个修改功能没实现」。
- 新建 / 续记 / 补录的「新增」能存下（受其它守卫拦截除外），唯独**编辑**全丢。

**根因**：`src/storage.js` 的 `load()` 每次都 `JSON.parse(localStorage)`，**每次返回一张全新的对象图**。而 `src/sheet_controller.js` 的 `commitEdit` 调了**两次** `load()`：

- `entry` 取自 **load #1**；
- 真正被保存的 `d` 取自 **load #2**，与 `entry` 不是同一张图。

于是 `entry.ts/what/tags = …` 改的是 load #1 的对象，`deps.save(d)` 写回的是 load #2（从未被改过）。**所有编辑都写进一个随后被丢弃的对象，等于没存。** `saveEntry`（新增/续记/补录）只用了一个 `d`，所以新增能存、编辑不能——正好对上现象。

**修法**：`commitEdit` 收敛为**单次** `load()`，在被保存的同一张图里取 `entry`：

```js
const d = deps.load();
const entry = d.entries.find(e => e.id === id);
// …校验、冲突检查…
if (entry) { entry.ts = …; entry.what = …; entry.tags = [tag]; deps.save(d); }
```

外科手术级改动，只动 `commitEdit` 两行；不碰续记/结算/跨日等精密逻辑。

**护栏**：
- 新增 UI smoke：`editing an existing record persists content and tag (① commitEdit single load)`——打开已有记录、同时改内容与标签、保存、断言 localStorage 落库，并 reload 后仍在。
- 全量审查运行时所有 `load()` 调用点，确认「在一张图里改、却保存另一张图」只此一处（`saveTagConfig`/`confirmPlanned`/`saveEntry` 均为单次 load，安全）。

**经验**：`load()` 是纯函数式（每次新图），任何「先 find 后 save」的写路径**必须共用同一次 load 的结果**。后续新增写路径沿用此约束。

---

## 待修（已确诊，编入 v29 成批扫描）

v28 按「数据丢失先热修」只发了 P1。下列在排查中一并确诊，数据当前可达性较低或属打磨，未塞进热修：

- **② 补录计划模式泄漏**：`openFormSheet` 让补录沿用持久化的记录模式 pref，且只在「历史日」强制「已发生」。补**今天**的空档时若 pref 停在「计划中」，表单以计划模式开、预填过去时刻，`validatePlannedTs` 拒「计划时间应晚于现在」→ ✓ 静默失败（与标签无关）。修法：补录强制 log 并隐藏计划开关。
- **③ 补录撞中间空占位条**：`saveEntry` 只经 `openPlaceholderForDate`（仅看当天最后一条）识别可复用占位条；中间被遗落的占位条不被识别 → 撞 `findTimeConflict` 被当冲突拦下。修法：**局部并入**——`saveEntry` 内发现撞上的是空 placeholder 就就地并入，不改共享的 `openPlaceholderForDate`，影响面锁在补录路径。
- **④ ✓ 静默失败**：所有被拦保存（时间非法 / 内容空 / 同刻冲突）都只留一条不显眼的内联提示，✓ 看起来像坏的。修法：被拦时给视野内、靠近 ✓ 的可见反馈（含 `scrollIntoView`）。
- **⑤ 滚轮日期窗口静默改值**：`pickers.js` 窗口固定 ±90/7 天，`Math.max(0, findIndex)` 让窗口外的初始值落到 index 0（90 天前）；保存即把记录日期**静默搬到边界**。修法：窗口动态扩到包含当前值（span 设上限防性能，极远值钉为边界项）。
- **⑥ confirmPlanned 撞同刻无守卫**：把计划标记「已发生」时 `ts→now`，但不走 `findTimeConflict`，可造出同刻重复条。修法：撞车时静默 +1min 向后逆推到空位（复用现有 helper）。
- **闪烁（iPhone SE2 刷新）**：未锁定具体形态。两个零风险嫌疑——内联启动脚本只设 `data-theme` 未设 `theme-color`（亮色模式状态栏先暗后亮）、`opacity:0 → app-ready` 双 rAF 揭露蹦出。计划「先修后验」。

### v28 协作约束补记

- 多步改动走主线程；避免并发 fan-out 子代理 / workflow（上游会 429，串行 workflow 亦然）。已同步进 `CLAUDE.md` / `AGENTS.md`「开发与维护红线」。

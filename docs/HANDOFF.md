# 当前交接状态（接手先读这一份）

> 用途：额度用尽 / 换模型 / 换人时，**任何人读完这一页就能接着干**。
> 维护纪律：每完成一个里程碑就更新本文件并提交，不要攒到最后写。
> 权威文档分工：法律＝`CLAUDE.md`；决策史＝`docs/decisions.md`；协作流程＝`docs/collab-protocol.md`；人肉步骤＝`docs/launch-runbook.md`；规格＝`docs/specs/`。本文件只讲**此刻**。

最后更新：2026-07-25 · 更新人：Claude Opus 5（本地会话）

---

## 一句话现状

v73 已上线；当前在做 **v74 合并批次**（三单一次版本仪式，依据 `docs/decisions.md` D15 额度裁剪），分支 `spec/074-batch`，尚未合并。

## 角色（本轮与协议默认不同）

| 角色 | 谁 | 说明 |
|---|---|---|
| 规格 | Fable（另一会话） | SPEC-009/010/011/012 均由它起草 |
| 裁剪与记录 | Claude Opus 5（本地会话） | D15 额度裁剪、本文件 |
| 执行 | **Sonnet 5 子代理（本地派发）** | 维护者 2026-07-25 指定，替代「另一台机器的执行方」 |
| 验收 | **Claude Opus 5（本地会话）** | 维护者 2026-07-25 指定 |
| 真机终审 | 维护者 | SPEC-011 的验证环只能由真机截图关闭 |

## v74 批次内容（顺序即实施顺序）

| # | 规格 | 范围 | 状态 |
|---|---|---|---|
| 1 | SPEC-012 | 导入确认后 toast 被关闭中的 sheet 盖住（v73 回归）；连带堵上 `toContainText` 的可见性盲区 | 未开始 |
| 2 | SPEC-011 | 状态栏遮条（`env(safe-area-inset-top)` 高的 fixed 条，`var(--bg)` 底、`pointer-events:none`） | 未开始 |
| 3 | SPEC-009-lite | 「···」里常驻「修复更新通道」cell（在线检查 → `sw.js` 探活 → `unregister` → `reload`）；**不做**检测/计数器/横幅三态 | 未开始 |
| 4 | 版本仪式 | `python3 scripts/bump_version.py 74` + `CLAUDE.md` CHANGELOG 手写一行（三单合并成一行） | 未开始 |

## 下一步（接手就跑这些）

```bash
git checkout spec/074-batch && git pull origin spec/074-batch
python3 scripts/project_audit.py && python3 scripts/confirm_logic_smoke.py && npm run typecheck
npx playwright test          # 264×2 双引擎；跑之前确认 4173 端口是本项目或为空（v65 教训）
```

## 验收门槛（一条都不能减）

- 四件套全绿：`project_audit.py` / `confirm_logic_smoke.py` / `npm run typecheck` / `npm run test:ui`，外加 `git diff --check`。
- **P35 红灯证明**：每条新回归测试都要先证明「没修会红」，证据贴 PR。
- `git status --short` 干净，不夹带真实记录、截图、导出 JSON、`外部/`、测试产物。
- 改动范围严格等于三份规格的 scope；顺手修无关问题＝拒收。

## 已知风险 / 坑

- **SPEC-011 的验证环 headless 关不上**：Playwright 仿真不了 `env(safe-area-inset-top)`，自动化只能断言存在/fixed/`pointer-events:none`/z 序/浏览器上下文高度为 0。真机截图（亮暗各一张、滚动态）由维护者补，这是本仓库第一个如此标注的规格。
- **SPEC-012 的教训要落进测试习惯**：`toContainText` 对 `display:none` 和被遮挡元素照样通过。反馈类断言一律用 `toBeVisible()` + 必要时断言未被遮挡。
- **端口陷阱（v65）**：`reuseExistingServer: true` 会把 4173 上任何陈旧 server 当被测应用，导致整套假超时。跑套件前确认端口。
- 工作区里有个未跟踪的 `外部 /` 目录，协议点名不得提交；`git add -A` 会把它带进去，用显式路径 add。

## 不要碰（已 park，D15）

- SPEC-007（标签设置重设计 + 主线可编辑）、SPEC-008（landing 活体 mock）：推到 2026-07-30 阶段复盘重排。park ≠ 取消。
- SPEC-010：阶段一只出**变体 A** 截图，不合并代码、不 bump；阶段二只在维护者拍板后并入某次仪式。
- SPEC-002：仍 blocked，等 runbook Phase C/D 浸泡后由 Fable 解锁；解锁后并入当时最近一次仪式，不单独发版。

## 维护者手上的信号（AI 侧在等）

1. 冷白变体 A 拍板（SPEC-010 阶段二的前置）。
2. 浸泡结束 → 解锁 SPEC-002 旧站只读冻结。
3. 推广草稿改写完 → 要事实核查就丢给 AI（runbook Phase E）。

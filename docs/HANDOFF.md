# 当前交接状态（接手先读这一份）

> 用途：额度用尽 / 换模型 / 换人时，**任何人读完这一页就能接着干**。
> 维护纪律：每完成一个里程碑就更新本文件并提交，不要攒到最后写。
> 权威文档分工：法律＝`CLAUDE.md`；决策史＝`docs/decisions.md`；协作流程＝`docs/collab-protocol.md`；人肉步骤＝`docs/launch-runbook.md`；规格＝`docs/specs/`。本文件只讲**此刻**。

最后更新：2026-07-26 · 更新人：Claude Opus 5（本地会话）

---

## 一句话现状

**v74 已发布**（PR #30 合并 → tag `v74` → Release → 镜像 `publish: v74` 绿灯，`app/sw.js` 已是 `timelog-v74`）。当前**没有进行中的实现任务**；下一步是 SPEC-010 阶段一（只出变体 A 截图给维护者拍板）。

## v74 交付了什么

| 规格 | 用户能感知的变化 |
|---|---|
| SPEC-012 | 导入确认后终于有反馈（v73 回归：确认后「什么都没弹」） |
| SPEC-011 | 主屏 PWA 滚动时页面文字不再与系统状态栏字形互叠 |
| SPEC-009-lite | 「···」新增常驻「修复更新通道」，更新卡死时两次点击自救 |

验收：`276 passed / 0 failed`（chromium + webkit），四件套全绿，P35 红灯证明四组（见 PR #30 评论）。

## ⚠️ 唯一还开着的验证环

**SPEC-011 的真机截图**：Playwright 仿真不了 `env(safe-area-inset-top)`，自动化只断言了存在性/fixed/`pointer-events:none`/z 序/浏览器上下文零高度不遮挡。需要维护者在**主屏 PWA（standalone）滚动状态下，亮暗各截一张**确认状态栏区域不再互叠。这是本仓库首个凭真机截图关闭验证环的规格——**不要在任何文档里把它写成已闭环**。真机不对就 revert `21647fe`，另外两单不受影响。

## 下一个任务：SPEC-010 阶段一（只出变体 A）

- 只做变体 A（`--bg` 下沉一档到 `#eceef3` 区间、`--card` 保持纯白、`--input` 约 `#e2e5ea`），B/C 按 D15 不做。
- 产出：双主题截图（day 视图 / 更多 sheet / 标签设置，320px 与 390px）+ WCAG 关键比值速算，交维护者拍板。
- **阶段一不合并任何代码、不 bump、不提交 PNG**（`docs/assets/` 是唯一 PNG 白名单目录且需登记进 audit，临时评审图不要往那儿放）。
- 拍板通过后才进阶段二（全量令牌落 `styles.css` 两处亮色块 + theme-color 锚点 + `site/index.html`），并入当时最近一次仪式。

## 角色（本轮与协议默认不同）

| 角色 | 谁 |
|---|---|
| 规格 | Fable（另一会话） |
| 裁剪与记录 | Claude Opus 5（本地会话） |
| 执行 | Sonnet 5 子代理（本地派发；2026-07-25 曾撞周额度上限中断，工作未丢） |
| 验收 | Claude Opus 5（本地会话） |
| 真机终审 | **维护者** |

## 常用命令（纯本地，不吃额度）

```bash
python3 scripts/project_audit.py && python3 scripts/confirm_logic_smoke.py && npm run typecheck
ss -ltnp | grep 4173 || echo "4173 空闲"    # v65 端口陷阱：先确认端口不是别的项目
npm run test:ui                              # 276×2 双引擎，约 5 分钟
git diff --check && git status --short
```

## 验收门槛（一条都不能减）

- 四件套全绿 + `git diff --check` 干净。
- **P35 红灯证明**：每条新回归先证明「没修会红」，证据贴 PR。
- `git status --short` 不夹带真实记录、截图、导出 JSON、`外部/`、测试产物。
- 改动范围严格等于规格 scope；顺手修无关问题＝拒收。

## 已知坑（踩过的，别再踩）

- **P35 证明不了「规格本身够不够」**：v74 验收时读实现 diff 又抓出两处规格没写的问题（unregister 失败静默 reload、武装态 `aria-label` 不跟随）。红灯证明保证的是「规格要求的行为在不在」，验收环读 diff 仍然必要。
- **反馈类断言一律 `toBeVisible()`**：`toContainText` 对 `display:none` 和被遮挡元素照样通过——SPEC-012 那个回归就是这么漏网的。
- **`returnToMore` 会让 sheet「关不掉」**：从「更多」下钻的 sheet，`closeForm()` 是把内容换回「更多」而非 hidden，构成持续性遮挡（详见 SPEC-012 文末的实测校正）。
- **端口陷阱（v65）**：`reuseExistingServer: true` 会把 4173 上任何陈旧 server 当被测应用，整套假超时。
- **`gh pr edit` 会撞 Projects classic 弃用报错**：改用 `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> --input -`；转 ready 用 GraphQL `markPullRequestReadyForReview`。
- 工作区有未跟踪的 `外部 /` 目录，协议点名不得提交；不要 `git add -A`。

## 不要碰（已 park，D15）

- SPEC-007（标签设置重设计 + 主线可编辑）、SPEC-008（landing 活体 mock）：推到 2026-07-30 阶段复盘重排。park ≠ 取消。
- SPEC-002：仍 blocked，等 runbook Phase C/D 浸泡后由 Fable 解锁；解锁后并入当时最近一次仪式，不单独发版。

## 维护者手上的信号（AI 侧在等）

1. **SPEC-011 真机截图**（standalone 滚动态、亮暗各一张）——唯一还开着的验证环。
2. **冷白变体 A 拍板**（SPEC-010 阶段二的前置）。
3. 浸泡结束 → 解锁 SPEC-002 旧站只读冻结。
4. 推广草稿改写完 → 要事实核查就丢给 AI（runbook Phase E）。
5. 顺带留意：你手机上 v73→v74 这次更新交接的启动诊断样本，是 C1 档案的又一个观察点。

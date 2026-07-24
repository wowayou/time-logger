# 多模型协作协议（D13）

> 角色：**Fable**＝方向/规格/验收；**执行方**（另一台机器上的 Sonnet 5 / Opus 4.8 / GPT）＝按规格实现；**维护者**＝只有人能做的步骤（凭据、DNS、真机验收、发帖账号）。
> 通讯通道：本 GitHub 仓库（`wowayou/time-logger`）。规格文件 + 分支 + PR，不依赖仓库外的口头约定。

## 给执行方的开工须知（每个任务开始前必读）

1. **先读 `CLAUDE.md` 全文**——它是本仓库的法律，对所有模型同等生效。铁律：零运行时依赖 / 无构建 / 原生 ES modules；隐私红线（不提交真实记录/截图/个人线索）；版本仪式六锚点。
2. `git pull origin main`，读 `docs/specs/` 里状态为 **ready** 的规格，按编号从小到大认领。
3. 在分支 `spec/NNN-短slug` 上工作，**永远不要直接 push main**。
4. 规格有歧义时：在 PR（可先开 draft PR）里留评论提问，等 Fable 或维护者答复；**不要自行扩大或缩小范围**。
5. 涉及版本号的改动必须用 `python3 scripts/bump_version.py <N>` 联动六锚点，CHANGELOG 行手写。
6. 回归测试遵守 P35 教训：**先证明「没修会红」再落地**（在 PR 里贴出证明过程）。

## 工作流

```
Fable 写规格（docs/specs/SPEC-NNN-*.md，status: ready）并 push main
  → 执行方 pull，认领，分支 spec/NNN-slug 实现
  → 执行方跑完自测（规格里列的命令），开 PR：
      标题 "SPEC-NNN: <一句话>"
      正文 = 规格验收清单逐条勾选 + 各自测命令的输出摘要 + P35 证明
  → Fable 本地 checkout PR、复跑自测、对照验收标准评审
      通过 = merge（即验收）；不通过 = PR review 提修改意见，执行方继续
  → 涉及发版的：merge 后由 Fable 或维护者打 tag（tag push 自动触发 publish-site）
```

## 状态约定

规格文件头部有 `status:` 字段：

| 状态 | 含义 |
|---|---|
| draft | Fable 起草中，不要认领 |
| ready | 可认领执行 |
| in-progress | 已有 PR 关联（PR 链接写回规格文件或 PR 标题可查） |
| blocked | 等外部条件（规格内注明等什么，通常是维护者 runbook 步骤） |
| done | PR 已合并、验收通过 |

执行方认领时把 `status: ready` 改为 `in-progress` 并写上分支名（这个改动随功能分支一起提交即可，不必单独 push）。

## 验收标准（所有 PR 通用底线）

- `python3 scripts/project_audit.py`、`python3 scripts/confirm_logic_smoke.py`、`npm run typecheck`、`npm run test:ui`、`git diff --check` 全绿（规格可额外加项，不可减项）。
- `git status --short` 干净：不夹带真实数据、截图、导出 JSON、`外部/`、`node_modules/`、测试产物。
- 改动范围严格等于规格 scope；顺手修无关问题＝拒收（另开规格）。
- 提交信息与 PR 描述不含真实记录内容。

## 维护者的人肉步骤

唯一权威清单：`docs/launch-runbook.md`。执行方与 Fable 不得代做其中标注「仅维护者」的步骤。

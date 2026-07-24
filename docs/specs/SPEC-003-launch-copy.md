# SPEC-003 · 上线文案包：README 定位、主页 tagline、首轮社区推广草稿

status: ready
owner: 执行方认领后填分支名
验收人: Fable

## 目标

按 D13 核心定位统一对外文案，并产出首轮中文社区推广草稿（发帖动作由维护者执行，见 runbook Phase E）。

核心定位（唯一权威表述，CLAUDE.md「产品硬约束」节）：
**「5 秒记下真实做了什么——本地、离线、可信的一天时间线」**

## 范围

1. **README.md**：
   - 顶部加入定位一句话与新地址 `https://time.eigentime.org/app/`（作为 canonical 入口），旧地址标注「迁移中，将转为只读」；
   - ⚠️ 审计约束：README 必须继续包含四条维护命令原文（`python3 scripts/project_audit.py` 等，见 `project_audit.py` 的 `REQUIRED_MAINTENANCE_COMMANDS`）与两张 demo PNG 引用，编辑时不得碰掉。
2. **site/index.html**：tagline（`.tagline`）改为定位句；其余不动。注：主页改动要等下一次 tag push 或手动跑 `build_site.py` 才会出现在线上，PR 里注明即可。
3. **推广草稿**（新目录 `docs/promo/`，纯 Markdown，每渠道一份）：
   - `shaoshupai.md`（少数派，长文）、`v2ex.md`（V2EX 分享创造节点，中短文）、`jike.md`（即刻，短文）；
   - 内容骨架：一句话定位 → 为什么做（真实一天难以重建）→ 与常见计时器的区别（记「实际做了什么」而非打卡；四桶统计；未记录是诚实信号）→ 隐私边界（本地 localStorage、零账号零后端零追踪、完整 JSON 备份、AGPL 开源）→ 新地址 + GitHub 链接；
   - **诚实纪律（硬约束）**：只用 D3 已核实的事实卖点（不主动保持屏幕常亮；Markdown 摘要 + JSON 完整备份可贴给 AI 复盘）；明示「作者本人 30+ 天自用，个人工具起步」；**禁止**声称市场需求已验证、禁止编造用户数、禁止真实记录内容/截图；如需配图只能引用 `docs/assets/` 白名单内的 demo PNG。

## 明确不做

- 不新增 PNG；不动 CHANGELOG/版本号（本 spec 零运行时改动——site/index.html 不在 SW FILES 内）；不发帖（维护者做）；不写英文版。

## 验收清单

- [ ] audit / `git diff --check` 绿（本 spec 无运行时改动，confirm smoke / typecheck / test:ui 跑一遍确认零回归即可）
- [ ] README 四条维护命令与 demo PNG 引用原样保留（audit 会拦，但请自查）
- [ ] 三份草稿无真实数据、无夸大表述、含隐私边界段
- [ ] 定位句三处（README / 主页 / 草稿）逐字一致

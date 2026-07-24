# SPEC-005 · 产品主页 v2：landing 叙事升级（参考 otty.sh 的结构语言）

status: ready（可与 SPEC-004 并行；亮色 `--bg` 直接写死 SPEC-004 的 `#f7f7fa`）
owner: 执行方认领后填分支名
验收人: Fable

## 背景

维护者 2026-07-24 提出参考 https://otty.sh/ 的宣传设计。Fable 对该页的结构分析（执行时以此为设计语言基准，不是像素抄袭）：

- hero 极简：产品名 + 一句话身份 + 直接下载 CTA；
- 特性区用**短句诗式小标题**（"One window, many threads." / "Every command, a shortcut away."），每条配一行说明，不堆形容词；
- 每个特性紧贴一个真实产品画面；
- 结尾重复一次 CTA（"Want Otty?"）；
- footer 分组（Product / Legal / Contact），克制。

## 范围

重写 `site/index.html`（仍是单文件、内联 CSS、零第三方、零 JS 或最小 JS、双主题跟随 `prefers-color-scheme`）：

1. **hero**：τ 图标 + 「时间尺」 + 定位句（逐字用 CLAUDE.md 权威表述）+ 「打开应用」CTA + 「免费 · 无账号 · 数据只在你的设备上」副行。
2. **特性区**（3–4 节，短句标题风格，Fable 给定标题草案，执行方可微调措辞但保持节奏与诚实度）：
   - 「一天的形状，一眼看清。」——连续日志时间轴 + 四桶竖脊（配 demo 截图）；
   - 「没记的时间，不会被抹掉。」——「未记录」是显式的诚实信号，不凑 100%；
   - 「你的数据只在你手里。」——本地 localStorage、离线 PWA、完整 JSON 备份随时导出；
   - 「偏航不是错误。」——四桶语义一句话（主线/维持/偏航/未记录，不做道德评判）。
3. **截图**：只能用 `docs/assets/` 白名单内的两张 demo PNG。**需要顺带扩展 `scripts/build_site.py`**：把 `REQUIRED_DEMO_ASSETS`（从 `project_audit.py` 读或直接列这两个路径）复制到产物 `assets/` 目录，`site/index.html` 以 `./assets/…` 引用；本仓库 `site/` 目录内**不放 PNG**（`.gitignore` 全局忽略 `*.png` 的白名单机制不动）。
4. **保留区块**（可收进更紧凑的形式，信息不得丢）：安装到主屏幕、从旧地址迁移、数据边界、开源（AGPL + 仓库链接）。
5. **结尾重复 CTA** + footer（源码 / 许可 / eigentime.org）。
6. 亮色 `--bg: #f7f7fa`（与 SPEC-004 对齐）；暗色维持 `#0e0f13` 石墨系。

## 诚实纪律（硬约束）

- 不写用户数、不写评价引语、不声称市场验证；「作者自用 30+ 天」是唯一可用的使用陈述。
- `title=` 禁用、图片必须有 alt、对比度 AA。

## 验证

- 产物本地 `build_site.py` 实跑 + HTTP serve 双主题截图贴 PR（320px 与 768px 各一，无横向溢出）；
- audit / diff --check 绿（零运行时改动，无版本号变更；build_site.py 属开发期工具可改）；
- `site/` 内无 PNG 入库；产物 `assets/` 里两张图与 `docs/assets/` 字节一致。

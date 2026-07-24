# SPEC-004 · v72：亮色主题整体回归冷白（推翻 D11 折中）

status: ready
owner: 执行方认领后填分支名
验收人: Fable

## 背景与授权

维护者 2026-07-24 明确决定：「亮色还是怪怪的，整体亮色风格还是回归原本的冷白色」。这推翻 D11 的一档折中（`#f6f6f5`），执行 C12 评估过的「整体回退」选项。C12 已写明代价：需重校文字令牌与三桶彩色对比度、同步 theme-color 锚点。暗色主题**一字不动**。

## 目标色值方向（Fable 定案，执行时按此实施）

`styles.css` 亮色令牌出现在**两处**（`@media (prefers-color-scheme: light)` 块约 L48 起 + `html[data-theme="light"]` 手动覆盖块约 L72 起），必须同步改：

| 令牌 | 现值（暖） | 新值（冷白） |
|---|---|---|
| `--bg` | `#f6f6f5` | `#f7f7fa` |
| `--card` | `#ffffff` | 不变 |
| `--input` | `#f1efe9` | `#eef0f4` |
| `--track` | `#e4e1d9` | `#e2e5eb` |
| `--border` | `rgba(48,42,30,0.10)` | `rgba(28,32,44,0.10)` |
| `--shadow-1/2/3` | `rgba(48,42,30,…)` | `rgba(28,32,44,…)`（各档 alpha 不变） |

- **不动**：三桶彩色本体（`--accent`/`--maintain`/`--leak`/`--danger`）与各 `*-bg` 色调 tint（它们是按桶色相派生的，不是「暖纸」残留）；`--text`/`--muted`/`--faint`；`--top-light`。
- **theme-color 三锚点同步**：`src/app.js` L185 的 `'#f6f6f5'` → `'#f7f7fa'`；`index.html` 顶部内联启动脚本里若硬编码了亮色值同步改（`#meta-theme-color` 解析逻辑，约 L34–44）；manifest `theme_color` 是暗色值，不动。
- **site/ 主页跟随**：`site/index.html` 亮色 `--bg: #f6f6f5` → `#f7f7fa`（跨表面一致；主页改动随下次 tag 发布，PR 注明即可）。

## 验证要求

1. **WCAG 重校**（PR 正文贴计算结果，可用一次性脚本，不必入库）：`--text`/`--muted`/`--danger` 对新 `--bg` 与对 `--card` 的对比度 ≥ v69 记录值（11.70 / 5.27 / 3.98——新 bg 更亮，理论上只升不降，贴数为证）；`--muted` 对 `--input` 新值 ≥ 4.5。
2. **三桶彩色**：`--accent`/`--maintain`/`--leak` 对 `--bg`/`--card` 的对比度贴数确认不低于现值；不达标时只微调明度、不换色相（保持桶色身份）。
3. **P22 回归**：亮色滚轮选中行文字可见（既有层序断言必须绿）；自测清单 5a 手动过一遍。
4. 双主题截图（day 视图 + 打开一个滚轮 sheet）贴 PR——只能用固定 demo 数据。
5. 版本仪式：`bump_version.py 72` + CHANGELOG 行；FILES 不变、零新资产。
6. 全套自测绿（audit / smoke / typecheck / test:ui / diff --check）。

## 明确不做

- 不动暗色主题任何令牌；不动布局/间距/字阶；不重做 v33 结构令牌层；不改桶色相。

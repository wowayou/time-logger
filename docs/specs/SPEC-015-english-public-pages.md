# SPEC-015 · 英文对外页面包：英文 landing + 隐私政策页（中/英）+ 应用内入口

status: in-progress（分支 `spec/015-en-public-pages`；本单只做 §1–§3，§4 拆给 SPEC-014 批次，见规格正文与 PR 说明）
owner: `spec/015-en-public-pages`
执行模型: **Sonnet 5**（文案底稿在本规格内，执行是静态页面）
验收人: Opus 5

## 背景

1. `site/index.html` 全中文（`<html lang="zh">`），英文渠道推广没有落地页。
2. **App Store Guideline 5.1.1(i)**（2026-07-31 核）要求：「All apps must include a link to their privacy policy in the App Store Connect metadata field **and within the app** in an easily accessible manner.」本项目当前**既没有隐私政策 URL，也没有应用内入口**——`site/index.html#privacy` 是一段「数据边界」说明，不是隐私政策。
3. **成本红利**：`site/` 不进 SW 缓存（CLAUDE.md），`build_site.py` 用 `rglob` 递归复制整个 `site/`——**新增子目录零脚本改动、零版本仪式**。只有 §4 的应用内 cell 是运行时改动。

## 1. 目录与路由（零 `build_site.py` 改动）

```
site/index.html            → /            （中文主页，现状）
site/en/index.html         → /en/         （英文主页，新增）
site/privacy/index.html    → /privacy/    （隐私政策 中文，新增）
site/en/privacy/index.html → /en/privacy/ （隐私政策 English，新增）
```

四页互相用 `<link rel="alternate" hreflang="zh-Hans|en|x-default">` 声明；中/英主页各自在 header 放一个语言切换链接（纯 `<a>`，**不加 JS**——`site/` 是零 JS 区）。`x-default` 指向中文主页。

样式：英文页**复用中文页那套内联令牌与结构**（同一份 CSS 复制进各自文件；`site/` 是单文件自包含区，不引入共享 CSS 文件以免破坏「零构建」）。

## 2. 英文 landing 文案（底稿，可按语感微调，**事实与纪律不可动**）

- H1：**Log what you actually did, in five seconds.**
- 副标：A local, offline, trustworthy timeline of your day.
- CTA：**Open the app** → `/app/`（重复出现，沿用 SPEC-005 的结构语言）
- 特性段（短句诗式，沿用中文页节奏）：
  - *Your day has a shape.* — Focus, Upkeep, Drift, Unlogged. Four buckets, one glance.
  - *Nothing leaves this device.* — No account, no server, no analytics, no third-party script.
  - *Works on a plane.* — Installed as a PWA, it opens and records with no network at all.
  - *Your data is a file you own.* — Full backup as JSON, any time, free, forever.
- 迁移段（对应中文页「从旧地址迁移」）照译。
- 收尾诚实声明（**必须保留，D3 纪律**）：
  > Built by one person, used daily by that person for 30+ days. It has not been validated with outside users yet.

  **严禁**出现 "trusted by" / "loved by" / "thousands of users" / 任何未经验证的社会证明或市场声明。
- 术语必须与 SPEC-014 术语表逐字一致（**Focus / Upkeep / Drift / Unlogged**；出现 "Leak"/"Waste"/"Distraction"＝拒收）。

## 3. 隐私政策页文案（底稿；**诚实边界高于简洁**）

标题：Privacy Policy / 隐私政策 · Last updated: 2026-07-31

必须覆盖的条目（App Store 与 GDPR/CCPA 通用最小集）：

1. **What we collect: nothing.** 应用不采集、不上传、不同步任何数据；无账号、无后端、无分析、无广告、无第三方脚本、无 cookie。
2. **Where your data lives.** 全部记录存在你浏览器的 `localStorage`（键 `timelog.v1`、`timelog.config`、`timelog.locale` 等），只在你这台设备上。清除站点数据或卸载 PWA 会删除记录——请定期导出备份。
3. **Hosting.** 站点由 GitHub Pages 静态托管。**如实写**：任何网站的托管方在提供页面时都会按常规记录访问请求（IP、User-Agent 等传输层日志）；本项目不接触、不留存、不分析这些数据，也不向其中注入任何标识符。（这一条不许省——省了就是把「零追踪」说过头。）
4. **Your data is portable.** 完整备份随时可复制/下载/分享为 JSON，免费、不需要账号、不需要网络。
5. **Children.** 应用不面向儿童定向收集任何信息（因为不收集任何信息）。
6. **Changes.** 政策变更会更新本页的 Last updated 日期；变更历史可在公开仓库的 Git 历史中查证。
7. **Contact.** GitHub issues 链接 + `eigentime.org`。

中英两版内容必须等价（不是逐字直译，但**不得一版有一条另一版没有**）。

## 4. 应用内隐私政策入口（唯一的运行时改动）

「···」更多 sheet 的**说明所在分组**新增一个 cell：`隐私政策` / `Privacy Policy`，外链到 `/privacy/`（en locale 下指向 `/en/privacy/`），`target="_blank" rel="noopener"`。

- 走 SPEC-013 的 catalog 取词（key：`more.privacy`）。
- 这一条即满足 5.1.1(i) 的「within the app」——Apple 要求的是**链接**，不是内嵌全文；内嵌会产生两份文本的漂移风险，明确不做。
- **此项属版本仪式**：并入 D17 定的 **v78** 合并批次；`FILES` 不变（无新增运行时资产）。

## 5. 版本仪式

§1–§3（`site/` 全部内容）**不需要 bump**，不进 `sw.js` FILES。§4 并入 v78。若本单先于 013/014 合并，§4 拆出来跟着 014 走，PR 里注明。

## 验收清单

- [ ] `python3 scripts/build_site.py --out <repo 外临时目录> --no-cname` 成功，产物中 `/en/`、`/privacy/`、`/en/privacy/` 四页齐全且相对链接可通（`/app/`、`/assets/` 引用不 404）
- [ ] **WCAG 护栏扩面**：`project_audit.py` 现有 `audit_wcag_contrast` 目前只覆盖 `styles.css` 与 `site/index.html` 的亮色 `:root`——本单必须把**三个新页面**纳入同一护栏（v75 验收的教训原文：漏了 `site/index.html` 自己那套内联令牌里的 `--faint`，13px 小字对比度落到 3.94）。P35 红灯证明：临时把某新页的 `--faint` 改成 v74 旧值 → audit fail；改回 → 绿
- [ ] **诚实纪律护栏**（新增 audit，永久）：`site/**/*.html` 全文不得出现 `trusted by` / `loved by` / `users love` / `market-validated`（大小写不敏感）。红灯证明：临时插入一句 → fail
- [ ] **术语一致护栏**：`site/en/**` 不得出现 `Leak`/`Waste`/`Distraction`/`Unproductive` 作为桶名（与 SPEC-014 同一条规则，可复用同一实现）
- [ ] hreflang 四页互指、`x-default` 存在（audit 里加一条结构断言即可，无需 E2E）
- [ ] 隐私政策中英两版条目数一致（§3 的 7 条逐条在场）
- [ ] §4：更多 sheet 里 cell 可见可点、外链正确、zh/en 各一次；`npm run test:ui` 双引擎全绿
- [ ] `git status --short` 干净；`site/` 下**不得**出现任何 PNG（PNG 白名单只有 `docs/assets/`，CLAUDE.md）

## 明确不做

日文页、博客、任何统计/分析脚本（哪怕自称隐私友好）、`site/` 引入 JS 或外部字体、landing 活体 mock（那是 park 中的 SPEC-008）、App Store 相关的截图/预览素材（属 D17 第三层，另立仓库）。

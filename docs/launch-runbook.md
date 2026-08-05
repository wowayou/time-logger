# 上线 Runbook——维护者手动步骤（唯一权威清单）

> 这些步骤**只有你能做**（涉及你的账号凭据、DNS 控制台、真机、社区账号）。
> 每完成一个 Phase，在对应勾选框打勾并 push（或口头告知任一 AI，由它代为勾选）。
> AI 侧的对应工作见 `docs/collab-protocol.md` 与 `docs/specs/`。

## Phase A · 现在就做（不依赖任何代码进度）

### A1. 创建部署 PAT 并存入 Secret（仅维护者）

1. GitHub 右上角头像 → **Settings** → 左栏最底 **Developer settings** → **Personal access tokens → Fine-grained tokens** → **Generate new token**。
2. 填写：
   - Token name：`time-logger-site-deploy`
   - Expiration：**366 days**（到期前 GitHub 会发邮件提醒；到期后 workflow 会红灯，届时重新生成并更新 Secret 即可）
   - Resource owner：`wowayou`
   - Repository access：**Only select repositories** → 只勾 `wowayou/time-logger-site`
   - Permissions → Repository permissions → **Contents: Read and write**（其余全部 No access）
3. Generate 后**立即复制** token（只显示一次）。
4. 打开 `wowayou/time-logger` 仓库 → **Settings** → **Secrets and variables → Actions** → **New repository secret**：
   - Name：`DEPLOY_TOKEN`（必须逐字一致）
   - Secret：粘贴 token
5. 完成后，下一次 `vN` tag push 会自动发布镜像；在 Actions 页看 `publish-site` workflow 是否绿灯。

- [x] A1 完成 —— AI 按可验证事实勾选（2026-07-26）：`publish-site` 连续两次绿灯（v74/v75），没有有效 `DEPLOY_TOKEN` 不可能成功

### A2. Cloudflare DNS（仅维护者）

1. Cloudflare Dashboard → zone `eigentime.org` → **DNS → Records → Add record**：
   - Type：`CNAME`
   - Name：`time`
   - Target：`wowayou.github.io`
   - Proxy status：**DNS only**（灰云，务必不要橙云——ADR 0001 要求 DNS-only，避免 Cloudflare 注入/代理）
   - TTL：Auto
2. 保存即可。此时 `time.eigentime.org` 还不会有站点（GitHub 侧尚未绑定），正常。

- [x] A2 完成 —— AI 按可验证事实勾选（2026-07-26）：`https://time.eigentime.org/` 已解析并返回 200

### A3.（推荐，防域名接管）GitHub 账号级域名验证（仅维护者）

1. GitHub → Settings → **Pages**（个人账号设置里的 Pages，不是仓库的）→ **Add a domain** → 填 `eigentime.org`。
2. 按提示在 Cloudflare 加一条 TXT 记录（名称形如 `_github-pages-challenge-wowayou.eigentime.org`，值照抄）。
3. 回到 GitHub 点 Verify。验证账号级 apex 后，所有子域（含 `time.`）受保护。

- [ ] A3 完成 —— **AI 无法验证**（账号级域名验证在 GitHub 设置页内），仅维护者可确认

## Phase B · 绑定自定义域名（A1+A2 完成后；可自己做，也可告知 AI 用命令做）

**方式一（自己点，5 分钟）**：
1. `wowayou/time-logger-site` → Settings → Pages → **Custom domain** 填 `time.eigentime.org` → Save。
2. 等 DNS check 通过、证书签发（几分钟到一小时）；出现后勾选 **Enforce HTTPS**。

**方式二（告知 AI）**：说「DNS 已就绪，执行 Phase B」，AI 会跑：
```bash
python3 scripts/build_site.py --out ../time-logger-site   # 这次不带 --no-cname，产出 CNAME 文件
# commit + push 镜像仓库，然后：
gh api -X PUT repos/wowayou/time-logger-site/pages --input - <<< '{"cname":"time.eigentime.org","source":{"branch":"main","path":"/"}}'
# 证书就绪后：
gh api -X PUT repos/wowayou/time-logger-site/pages -F https_enforced=true
```

**验收**：浏览器打开 `https://time.eigentime.org/`（主页）与 `https://time.eigentime.org/app/`（应用）均正常、挂锁无警告。

- [x] B 完成 —— AI 按可验证事实勾选（2026-07-26）：`/` 与 `/app/` 均 HTTP 200、TLS 握手正常。**Enforce HTTPS 是否勾选未验证**，请自查一次

## Phase C · v71 发布后的真机动作（SPEC-001 合并、tag v71 推送之后）

### C1. 旧地址真机确认横幅

1. iPhone SE 打开旧 PWA / Safari 旧地址；更新到 v71 需要**完全退出后重开**（App 切换器上滑杀掉；Safari 则关掉该站全部标签页）——这是 C1 已证实的唯一可靠更新路径。
2. 「···」→ 底部版本号应显示 v71；页面顶部应出现迁移横幅。

### C2. 权威设备迁移（数据零丢失流程，与 C6 绕法同源）

1. 旧 PWA：「···」→ **存储备份** → 系统文件面板 → 存到「文件」（确认文件名 `timelog-….json`）。
2. Safari 打开 `https://time.eigentime.org/app/`。
3. 新站「···」→ **导入** → 选刚才的备份文件 → 核对预览（记录总数、无冲突）→ 导入。
4. 抽查：记录总数、标签配置、任意 3 个日期（含一个跨日/长段日）与旧 PWA 一致；header 里程碑数字一致（`firstUsedDate` 随备份，v60 起）。
5. 分享 → **添加到主屏幕**（新图标即新 origin PWA）。
6. **暂时保留旧 PWA 图标**（浸泡期对照；v72 只读版落地后再删）。
7. 开飞行模式，冷启动新 PWA 一次——离线必须照常可用（这一步同时补上 headless 无法验证的离线证据）。

- [ ] C 完成（完成后告知 AI，SPEC-002 解锁）—— **AI 无法验证**（真机操作）。旁证：启动诊断显示权威设备已在新 origin 连续运行 v73→v75

## Phase D · 浸泡与旧站冻结

1. 在新 origin 正常记录 2–3 天，无异常后告知 AI「解锁 SPEC-002」。
2. v72 合并、tag 推送后，旧地址同 C1 方式更新并确认只读；此后可删旧 PWA 图标。

- [ ] D 完成 —— **AI 无法验证**（浸泡判断在你手上）

## Phase E · 首轮推广（SPEC-003 合并后）

0. **按 `docs/promo/checklist.md` 走**（2026-08-05 新增：发帖前自检、渠道节奏、回帖纪律、48 小时后的信号归类，逐条可勾）。
1. 读 `docs/promo/` 的草稿（中文三份 + 英文三份），按自己口吻修改（AI 草稿只是底稿）。
2. 发布渠道与顺序（D3 建议）：少数派 → V2EX（分享创造）→ 即刻。
3. 发帖纪律：不贴真实记录截图（只用 README 那两张 demo 图）；不声称市场验证；留 GitHub 与 `time.eigentime.org` 两个链接。
4. 发完把各帖 URL 记到 `docs/promo/posted.md`（已建好表头），便于后续跟进反馈。
5. **英文渠道的前提已变**：D3 当时限定「只推 dev-story、不推应用」，理由是应用 UI 是中文；v78 之后界面/主页/隐私政策都有英文版，故英文渠道可直接推应用——但排在中文轮之后，一次只开一个战场。

- [ ] E 完成 —— 未开始（底稿六份 + `checklist.md` 已就位，缺的只有你按自己口吻改写并发出去）

## Phase F · App Store 前置项（**gated**，D17 第二层触发前不启动）

> D17 裁决：原生载体是 gated 项，触发条件是「首轮推广已发生 + 出现非维护者真实留存用户 + 对 Widget/锁屏记录类原生能力的反复请求」。
> 本节**只登记前置清单**，不是待办。唯一有时效、建议提前处理的是 F1。

### F1. 商业双许可自签（**有时效，建议在接受第一个外部 PR 之前做**）

AGPL 与 App Store Usage Rules 冲突有先例（GNU Go、VLC 的 iOS 移植均被下架）。出口是 v31 保留的「唯一著作权人商业双许可」。**当日核实：全部提交与全部已合并 PR 的作者仍只有你一人，窗口开着**；一旦合入第一个外部贡献，就需要 CLA 或与贡献者重谈。

做法（半小时）：在仓库加 `LICENSING.md`，写明「本项目以 AGPL-3.0-or-later 公开发布；著作权人 wowayou 同时保留以其它条款另行授权的权利，并在此向自身/自有发行主体授予非独占商业授权用于应用商店分发」，并注明**自该文件之后接受的外部贡献需签 CLA**。

- [x] F1 完成（2026-07-31）—— `LICENSING.md` 已落地，`CONTRIBUTING.md` 许可证节同步指向；入站授权补到「可再许可」，此后的外部贡献自带该授权，**时效项已关闭**。⚠️ 文本由 AI 起草，**法律效力判断仍在你**：若将来真的走商店分发，建议届时请专业人士过一眼。

### F2. Apple Developer Program 注册（$99/年）

- **不存在「美区账号」「日区账号」**：一个账号即向 175 个国家/地区分发，美区/日区只是 App Store Connect 里的 Availability 勾选。
- 个人主体：**法定姓名会作为 Seller Name 公开显示**。要显示品牌名需公司主体 + D-U-N-S 编号（申请通常数日至两周）。**这是一个隐私决策，先想清楚再交钱。**
- 免费 App 不需签 Paid Apps 协议；一旦收费才涉及税务表（非美籍个人的 W-8BEN）与银行信息。

- [ ] F2 完成 —— **仅维护者**

### F3. 原生载体（独立仓库，**不进本仓库**）

铁律：本仓库是单页静态 / 无构建 / 无运行时依赖 PWA。原生壳必须另立仓库（D8 路径 B / ADR 0001 / D14 第 1 条）。

过审底线（Apple 官方文本，2026-07-31 核）：

- **4.2**：不能是 repackaged website ⇒ 必须有至少一项真实系统集成（Widget / Live Activity / Shortcuts / 分享扩展），**不是套壳 + 上架**。
- **2.5.2**：App 必须自包含 ⇒ **不得远程加载** `time.eigentime.org/app/`，运行时文件随包分发。

- [ ] F3 完成 —— gated，触发前不启动

### F4. 提交材料（触发后）

- **Privacy Policy URL**（5.1.1(i) 强制）+ **应用内入口**：SPEC-015 已把两者一起做掉，届时直接复用。
- Support URL、App Privacy 营养标签（本项目可如实全填「不收集」——最强的一张牌）。
- 英文 App 名 + 商标/重名检索（D17 推荐 `Eigentime`，需你拍板）。
- **数据迁移必须写进 App 描述**：WKWebView 的 `localStorage` 与网页 origin 是两个容器，网页版用户的记录**不会自动进 App**，必须「导出备份 → App 内导入」。漏写＝第一个用户丢数据。

- [ ] F4 完成 —— gated

## 异常与回退

- workflow 红灯：多为 `DEPLOY_TOKEN` 缺失/过期 → 重走 A1；期间可本地 `build_site.py` + push 镜像手动兜底。
- 新站异常：旧地址在 v72 之前始终是完整可用的应用，随时可退回继续记录；两边数据以「最后一次导出的备份」为迁移事实。
- 域名故障（DNS/证书）：`wowayou.github.io/time-logger-site/app/` 是镜像的无域名后备入口，功能完全一致。

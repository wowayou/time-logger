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

- [ ] A1 完成

### A2. Cloudflare DNS（仅维护者）

1. Cloudflare Dashboard → zone `eigentime.org` → **DNS → Records → Add record**：
   - Type：`CNAME`
   - Name：`time`
   - Target：`wowayou.github.io`
   - Proxy status：**DNS only**（灰云，务必不要橙云——ADR 0001 要求 DNS-only，避免 Cloudflare 注入/代理）
   - TTL：Auto
2. 保存即可。此时 `time.eigentime.org` 还不会有站点（GitHub 侧尚未绑定），正常。

- [ ] A2 完成

### A3.（推荐，防域名接管）GitHub 账号级域名验证（仅维护者）

1. GitHub → Settings → **Pages**（个人账号设置里的 Pages，不是仓库的）→ **Add a domain** → 填 `eigentime.org`。
2. 按提示在 Cloudflare 加一条 TXT 记录（名称形如 `_github-pages-challenge-wowayou.eigentime.org`，值照抄）。
3. 回到 GitHub 点 Verify。验证账号级 apex 后，所有子域（含 `time.`）受保护。

- [ ] A3 完成

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

- [ ] B 完成

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

- [ ] C 完成（完成后告知 AI，SPEC-002 解锁）

## Phase D · 浸泡与旧站冻结

1. 在新 origin 正常记录 2–3 天，无异常后告知 AI「解锁 SPEC-002」。
2. v72 合并、tag 推送后，旧地址同 C1 方式更新并确认只读；此后可删旧 PWA 图标。

- [ ] D 完成

## Phase E · 首轮推广（SPEC-003 合并后）

1. 读 `docs/promo/` 三份草稿，按自己口吻修改（AI 草稿只是底稿）。
2. 发布渠道与顺序（D3 建议）：少数派 → V2EX（分享创造）→ 即刻。
3. 发帖纪律：不贴真实记录截图（只用 README 那两张 demo 图）；不声称市场验证；留 GitHub 与 `time.eigentime.org` 两个链接。
4. 发完把各帖 URL 记到 `docs/promo/posted.md`（新建即可），便于后续跟进反馈。

- [ ] E 完成

## 异常与回退

- workflow 红灯：多为 `DEPLOY_TOKEN` 缺失/过期 → 重走 A1；期间可本地 `build_site.py` + push 镜像手动兜底。
- 新站异常：旧地址在 v72 之前始终是完整可用的应用，随时可退回继续记录；两边数据以「最后一次导出的备份」为迁移事实。
- 域名故障（DNS/证书）：`wowayou.github.io/time-logger-site/app/` 是镜像的无域名后备入口，功能完全一致。

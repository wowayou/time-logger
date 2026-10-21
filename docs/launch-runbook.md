# 上线操作单

> 发布规范以 [CLAUDE.md](../CLAUDE.md) 为准；本页保留账号、迁移、真机和推广操作。总体状态只在 [STATUS.md](../STATUS.md) 维护。
> 保留原 Phase 编号以便追溯；已完成步骤用于维护，不要求重新执行。账号内设置、真机结果由维护者确认。**社区发帖默认由维护者本人执行**；AI 代发需维护者显式指令，并按 `推广/checklist.md` 自检、记入 `推广/posted.md`（底稿不进本仓库）。

## Phase A · 部署凭据与域名

### A1. 部署令牌维护

- 源码仓库 `wowayou/time-logger` 的 Actions Secret 名为 `DEPLOY_TOKEN`。
- 使用 GitHub fine-grained PAT（精细权限的个人访问令牌），仅授权 `wowayou/time-logger-site` 的 Contents 读写；令牌到期时更新 Secret，不入库。
- 正式版本 tag 推送后**分别**检查 `publish-site` 和 `publish-legacy-pages`；两站独立执行，不是原子发布，仅一边成功不能登记两站完成。仅改主页的发布方式见 `CLAUDE.md`。

- [x] A1 完成（2026-07-26）：v74/v75 连续发布成功。

### A1a. 旧 origin 的 Pages Actions（D34）

- 源码仓库 Pages 的 Build and deployment → Source 必须为 **GitHub Actions**，不能退回 main 分支直发。
- `github-pages` 环境的 Selected branches and tags 必须**分别**有分支规则与 tag 规则：保留 `main` / `gh-pages` 分支，新增 `type: tag`、`name: v[0-9]*`。环境使用 `File.fnmatch` 风格，不能照搬 workflow 的 `+`；版本格式和字节一致性由脚本严格校验，不改成无限制环境。
- 仅刷新旧站的文档/发布工具时，从已核对的来源 ref 手动发布：`gh workflow run publish-legacy-pages.yml --ref main -f release_tag=<已存在的版本tag>`。脚本比对 manifest 和全部 `src/`、`icons/`、壳、样式、SW、manifest、SVG；即使版本号相同，运行时有任何差异也拒绝。不得为了绕过检查新造或移动 tag。
- 组装只复制提交树中的非隐藏文件（不读取本机临时文件），保留原 Markdown，旧 `.html` 文档地址提供无脚本兼容页跳至 GitHub；不恢复 Jekyll，旧生成样式退役。全部非隐藏运行时写出前再按提交树枚举核对存在性与 Git 原始字节；枚举与归档共用隐藏路径策略（任一路径段以 `.` 开头即排除），不要求产物包含目录级 `.gitattributes` 等隐藏元数据。来源/tag 的完整目录比较不变；`git archive` 的 `export-ignore` / `export-subst` 导致非隐藏运行时缺失或改变时拒绝，且不创建或填充输出目录。
- 自动化边界：单个标准 `ubuntu-latest` runner、15 分钟超时、串行部署、不自动重试，Pages artifact 只保留 1 天。公开仓库标准 runner 的免费规则已核对；不切换私有仓库、付费 runner 或增配额。
- 发布后核对旧站 23 个运行时文件、所有文档兼容地址，以及 `.git/`、`.claude/`、`.gitignore` 不可获取；独立浏览器验证只读、在线/离线导出且原记录不变。新 tag 的事件端到端验证留待下一次真实版本，手动部署不能代替该结论。

### A2. DNS

`time.eigentime.org` 的 CNAME 指向 `wowayou.github.io`，使用 DNS only（仅 DNS 解析，不经代理）；GitHub Pages 自定义域名绑定在部署镜像仓库。

- [x] A2 完成（2026-07-26）：域名解析及 HTTPS 访问已核验。

### A3. GitHub 账号级域名验证

GitHub 个人 Settings → Pages → Add a domain，验证 `eigentime.org`；按提示配置 TXT 记录后 Verify。验证账号级域名可防止子域接管。

- [ ] A3 完成 —— 仅维护者可确认账号设置。

## Phase B · 自定义域名与 HTTPS

`wowayou/time-logger-site` → Settings → Pages：Custom domain 为 `time.eigentime.org`；确认 DNS 检查、证书和 Enforce HTTPS。

- [x] B 访问验证完成（2026-07-26）：`/` 与 `/app/` 均 HTTP 200、TLS 正常。**Enforce HTTPS 勾选状态仍需维护者自查**。

## Phase C · 真机迁移确认

> 旧站已随 v76 转为只读；以下只保留数据迁移与人工确认，不再要求安装 v71 或等待 SPEC-002 解锁。

1. 旧站「更多 → 备份与导入 → 存储备份」，把 JSON 保存到可确认的位置。
2. 打开 `https://time.eigentime.org/app/`，导入备份；核对新增、跳过与冲突，处理完再提交。
3. 抽查记录总数、标签配置和至少 3 个日期（含跨日/长段）。迁入空环境时，头部记录里程碑应与原数据一致；它由记录派生，**不是** `firstUsedDate`。
4. 添加新地址到主屏幕，开飞行模式验证可打开、可记录、可导出。
5. 确认备份与新站均可用前，保留旧站及其数据。新站已有数据时导入会安全合并，不作整体替换。

- [ ] C 完成 —— 缺维护者真机确认；已有新 origin 运行记录不能代替勾选。

## Phase D · 迁移后使用确认

新站正常记录 2–3 天后复核数据和离线使用；旧站只读发布已经完成，无需再次解锁或发版。确认备份安全后，由维护者决定是否移除旧图标。

- [ ] D 完成 —— 缺维护者确认。

## Phase E · 首轮推广（SPEC-003 合并后）

推广与发布材料（渠道底稿、发帖记录、视频分镜与录制手册、演示数据生成器及其录屏检查）**不在本仓库维护**，放在本地私有目录 `推广/`（`.gitignore` 整目录忽略）；本页只保留流程边界，规则见 `CLAUDE.md`「隐私红线」与 D33。

按 `推广/checklist.md` 做发帖前自检，用自己的口吻改写各渠道底稿；实际链接和反馈写入 `推广/posted.md`。中文建议顺序为少数派 → V2EX → 即刻，英文轮在中文轮之后。推广视频按 `推广/video-recording.md` 与 `推广/video-scripts.md` 准备，B站长版先发并嵌入图文；演示数据用 `node 推广/make_demo_backup.mjs` 生成，只导入专门录屏的浏览器。

配图只用固定演示数据，不公开真实记录或个人线索，不声称市场已验证，不承诺未批准功能。英文界面与页面均已可用，不再沿用「英文渠道只能推开发故事」的旧限制。

- [x] E 已开工（2026-10-21）：阮一峰《科技爱好者周刊》自荐 issue [#12623](https://github.com/ruanyf/weekly/issues/12623) 已发（维护者显式指令下的 AI 代发，按 `推广/checklist.md` 自检后登记）。D3 顺序的少数派 / V2EX / 即刻仍未开始，E 未完成——一条外部投稿不等于首轮推广收尾。

## Phase F · iOS / App Store 前置候选

> iOS 原生载体仍按 D17 评审：首轮推广、非维护者真实留存与原生能力的重复请求。安卓独立仓库已按 D26 提前放行，其发布清单在安卓仓；这不解锁本节。

### F1. 授权条款

- [x] F1 完成（2026-07-31）：[LICENSING.md](../LICENSING.md) 和 [CONTRIBUTING.md](../CONTRIBUTING.md) 已说明公开许可、作者另行授权权利和外部贡献入站授权。实际商店分发前重新核对平台条款与授权适用性。

### F2. Apple Developer Program

- [ ] 仅在放行后注册；申请时核对最新费用、个人或组织主体要求及公开姓名的隐私影响。

### F3. iOS 原生载体

- [ ] 独立仓库，运行时随包分发；按申请时有效的 App Store 规则评估真实系统集成和最低功能要求，不把远程网页包装当成已满足审核条件。

### F4. 提交材料

- [ ] 复用已上线的中英文隐私政策与应用内入口，准备 Support URL 和隐私声明。
- [ ] 品牌已定为中文「时间尺」、英文「Eigentime」（D29），不再等待命名决定；上架前仍需完成商标/重名核查。
- [ ] 写清数据迁移：原生 WebView 与网页存储独立，需导出备份再导入，不自动同步。

## 异常处理

- 主站 `publish-site` 失败：按失败步骤定位，再检查 `DEPLOY_TOKEN` 是否缺失或过期；手动组装方法见 `scripts/build_site.py`，仍须核对发布版本，不能把旧站成功当成主站成功。
- 旧站 `publish-legacy-pages` 失败：先查日志及 `github-pages` 环境的**tag 类型**规则，上传/激活失败时实际旧站状态须另查，不能一概断言仍是上一版。修复后最多手动触发一次并填写已存在的 `release_tag`；失败即停，不循环重跑。旧站承载旧来源数据的查看和导出，不可关闭 Pages 或强制跳到新域名。
- 旧站回退：优先从包含可用 workflow 的已验证来源 ref 重新组装，且通过与目标版本 tag 的运行时比对；若旧 ref 没有新 workflow，则在 main 做正常的修复/回退提交并重新核对，不移动 tag、不 force-push，不靠退回分支自动发布绕过检查。过期 artifact 不能当永久回退备份，执行回退发布需维护者授权。
- 新站异常：先保留数据与备份，再诊断部署或回退应用文件。旧站是只读导出入口，不能当作继续写入的回退站。
- 域名或证书故障：修复 DNS/Pages 绑定；**不要把镜像的 github.io 地址承诺为无损后备入口**，它可能重定向到自定义域名，且不同 origin 的本地数据不共享。

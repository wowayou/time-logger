# STATUS — 当前状态唯一入口

> DONE＝已落地且有验证记录；OPEN＝仍需处理或确认；BLOCKED＝缺维护者侧资源。
> 维护规范见 [CLAUDE.md](CLAUDE.md)，交接须知见 [docs/HANDOFF.md](docs/HANDOFF.md)。本页只留当前结果与未闭合事项，版本细节由 CHANGELOG 保存。

**状态整理：2026-10-01。最近发布核验：2026-10-01，Web `v1.5.2`；安卓 `aab025d` 已推送、未发版。** 跨仓结论沿用已有核验记录，不代表安卓侧已重新验收。

## DONE

- **Web v1.5.2 已发布上线**：main `6a58428`、tag [v1.5.2 / Release](https://github.com/wowayou/time-logger/releases/tag/v1.5.2)、`publish-site` 与镜像 Pages 部署成功；已复核线上 CACHE `timelog-v1.5.2`、manifest `1.5.2`、`APP_VERSION`，线上 `styles.css` 与仓库逐字节一致。本版是设计系统 A 期（SPEC-016）：字号与圆角收敛到结构令牌并由 audit 守卫防回流；另以独立提交 `aea59c8` 修复导入冲突按钮自 v52 起的无效字体声明。无功能变化。
- **发布验证已有记录**：audit（新守卫十种破坏情形逐一红灯）、逻辑 smoke、typecheck、diff 检查通过；60 张固定 demo 截图逐像素对照无意外变化；全量 UI **576 passed / 2 flaky / 0 failed**，flaky 为启动计时用例，对照实验与样式重算基准归因于机器负载（细节见 CHANGELOG v1.5.2）。v1.5.1 及更早的发布记录保留在 CHANGELOG。
- **已交付能力**：记录、编辑、切分、撤销、四桶统计、备份与逐条冲突导入、中英文界面、时间分析（v1.3.0，v1.5.1 前名「时间拨号盘」）、「正在做」状态条（v1.4.0）、标签设置暂存与并发写保护（v1.4.1–1.4.2）、标签归属提醒 / 切一刀区间选择 / 文字轮播（v1.5.0–1.5.1）。细节见 [CLAUDE.md 的版本表](CLAUDE.md#changelog) 与 [历史版本](docs/CHANGELOG.md)。
- **Web 发布链路已就绪**：主站 `time.eigentime.org/app/` 正常发布，旧地址自 v76 起只读；版本使用三段式，Web→Android 接口约定由 `native-contract.json` 和两仓审计守护。
- **自愿支持入口已闭环**：应用、主页与 README 指向 `https://eigentime.org/support?from=time-logger`；2026-09-23 已核验其跳转至 `/zh/support/` 且保留来源参数。应用内无支付界面，所有功能免费。
- **安卓代码侧发版防护已就绪**：独立仓库已实现内嵌运行时、签名缺失即拒绝 Release、`sync_runtime.py --release` 预检及从 Web 三段式版本派生版本号；不代表已上架。

## OPEN

- **首轮推广尚未开始**：LINUX DO 底稿已备（`docs/promo/linuxdo.md`，分类与版规须发帖前人工核对）；当前已放行但未完成的产品行动。按 [推广清单](docs/promo/checklist.md) 和 [runbook Phase E](docs/launch-runbook.md#phase-e--首轮推广spec-003-合并后) 执行，底稿不等于已发布。
- **维护者确认未闭合**：runbook A3（账号级域名验证）、C（真机迁移）、D（迁移后使用确认）仍未勾选，B 的 Enforce HTTPS 设置也未核验；不能因站点已上线而代填通过。
- **真机验收缺口**：v1.5.0 三项、v1.5.1 修正与 v1.5.2 令牌收敛（字重 650→600 在无头环境看不出差别，只能真机看）待真机确认（维护者 2026-09-30 反馈「切一刀确实挺好的」，其余无结论）；标签合并缺真机验收结果；长段提醒的旧验收项需按 v89 起「默认关闭、开启后不改桶」的规则核对。见 [真机验收单](docs/device-acceptance.md)，自动化通过不代替真机结论。

- **设计系统（SPEC-016）B–D 未开始**：A 期已随 v1.5.2 发布（执行记录与偏差见 SPEC-016 §7，含顺延到 B 期的 169 处间距值）。是否继续由维护者按首轮推广反馈决定——按 D9 的精神，求职与推广没有进展时先停在 A。
- **访问统计（roadmap R4）未放行**：不必迁移托管，但需先改主页与隐私政策的「零追踪」承诺并另立决策；维护者尚未决定是否需要。

## BLOCKED

- **安卓正式发版与 Play 上传**：缺上传密钥、开发者账号和真机复验；最近登记的待发 tag 为 `a1.0.0.1`。清单在安卓仓 `docs/release-checklist.md`，实际发版前须重新核对其 Web 来源与版本——Web 已到 v1.5.0，内嵌运行时同步时注意完整备份新增可选字段 `quotes` 与存储键 `timelog.quotes`，安卓仓 `docs/DATA-CONTRACT.md` 若列举备份字段需一并补上。

## 未放行的方向与证据边界

- SPEC-008 着陆页演示仍暂停；iOS 原生载体、其它功能扩张按 [候选路线图](docs/roadmap.md) 与现行规范逐项评审，不因安卓或某一功能放行而整体解锁。
- 28 天真实记录门槛已有记录支持；求职进展仍由维护者判断。外部用户验证已延期、尚未开始，不能声称市场需求已验证。
- 2026-07 的冻结已提前结束，不再执行旧复盘日历或已停用的多模型协作流程。

# STATUS — 当前状态唯一入口

> 打开仓库先看这一页。DONE＝已发布/已落地且有判据守护；OPEN＝已排期未完成；BLOCKED＝缺维护者侧资源。
> 历史与规范不在这里：规范＝[`CLAUDE.md`](CLAUDE.md)；决策史＝`docs/decisions.md`；版本流水＝`CLAUDE.md` 表 + `docs/CHANGELOG.md`；交接须知＝[`docs/HANDOFF.md`](docs/HANDOFF.md)。

**Last Verified：2026-09-22 · web `v1.3.0`（时间拨号盘分析页：周期对比+趋势，只读；四道闸全绿 + 全量 test:ui 488 passed（chromium 244 / webkit 244，0 failed）；本地 commit `09b882e`，push/tag/Release/publish 见 OPEN） · android `aab025d`（已推送，未发版） · 核验人：AI 代理**

## DONE

- **v1.3.0 时间拨号盘分析页已落地（本地就绪）**：「更多」下新增只读可视化页（`mode:'analytics'` 走既有 `openFormSheet` 二级页与返回栈，非新视图，不动 day/week/月/年 主视图与 native-contract selector）。顶部结论区 + 3 列圆盘拨号键（前 4 键＝四桶、其余按时长降序续排标签）+「接通」键复制本期摘要。**纯逻辑层**（`stats.js` +164 / `time.js` +33，config 由调用方注入、不碰 DOM/localStorage）：`comparePeriods`（同步进度对比、覆盖率按已历天数）、`periodTrend`（只用已完成周期、可比 <3 判 insufficient、flat 死区 max(30min,10%)、runLength 仅 up/down 计数）、`tagMinutes`、`elapsedMatchedRange`/`previousPeriodRange`。**自查出并修了一个真 bug**：`elapsedMatchedRange` 早期只对周视图正确，月/年已完成且短于上期时会漏上期尾几天——改为整期对整期，加月/年回归断言。UI 只读：不写记录、不改 config、无支付/埋点/网络；零新增运行时资产（`FILES` 不变）。判据＝`tests/v1_3_0_analytics_dialpad.spec.js` 5 条双引擎全绿 + `confirm_logic_smoke.py` 周期/趋势断言 + 月/年回归；`v84_polish` 行数 10→11。本地 commit `09b882e`；push/tag/Release/publish 见 OPEN。
- **v1.2.1 导入预览新增组弱化呈现（B）已发布上线**：纯 UI/文案改动。新增项**不需逐条确认**（从未需要，导入按钮只被冲突拦），本版把新增组前置安心文案（随导入一次性全部加入、展开仅供核对）、去主线色边框、标题降为 muted 小字，消除“像待办勾选表”错觉。冲突逐条决策、CAS 写入、字段全部不改。判据＝`tests/v1_2_0_import_preview.spec.js` 加安心文案断言；四闸全绿 + 全量 478 passed；main `f135db4` + tag `v1.2.1` + Release + publish-site 绿灯 + 线上复核 CACHE `timelog-v1.2.1`。
- **v1.2.0 导入预览逐条化已发布上线**（D13 ③ 透明度硬化）：main `d4fc7cf` + tag `v1.2.0` + Release + publish-site 绿灯 + 线上复核 CACHE `timelog-v1.2.0`。内容＝导入检查把新增/已跳过从一行计数升级为可展开逐条清单；`preflightImportedEntries` 新暴 `additions`/`skippedEntries`。顺手修了 v1.1.0 遗留的 v84 静默破缺（「更多」9→0 行）。
- **v1.1.0 已发布上线**（D30，修订 D28）：main `860898d` + tag [`v1.1.0`](https://github.com/wowayou/time-logger/releases/tag/v1.1.0) + [Release](https://github.com/wowayou/time-logger/releases/tag/v1.1.0) + publish-site 绿灯 + 线上复核（cache-bust 后线上 `const CACHE = 'timelog-v1.1.0'`、manifest `1.1.0`）。内容＝「更多」sheet 里排在「高级」之后的一条外链（`a.cell-btn`，`target=_blank rel=noopener`），指向 `https://eigentime.org/support?from=time-logger` 的**中转页**（不直连收款平台），旁附三句事实声明（自愿 / 功能始终免费 / 支持不购买任何东西）。应用内零支付界面、零埋点、零分析 SDK。判据＝`tests/v1_1_0_support_entry.spec.js` 6 条双引擎 10/10；四道闸全绿。**⚠ 已知死链窗口见 OPEN**。
- **v1.0.0 已发布上线**：tag + [Release](https://github.com/wowayou/time-logger/releases/tag/v1.0.0) + publish-site 绿灯 + 线上复核（CACHE `timelog-v1.0.0`）。内容＝版本格式三段式 + Web→Android 显式契约（两仓 audit 双向咬合）+ 发布防护 + digit-only 第八处修复。发布闸：双引擎全量 463 passed / 0 failed / 1 flaky（webkit 既有时序类）。
- **v1.0.0 预写计划的未实施项已全部补齐**（2026-09-12，本批）：
  - 安卓 release 签名 **fail-closed**（缺 `keystore.properties` 时 Release 任务直接失败，不再产 debug 签名假产物）＋ `sync_runtime.py --release` 发版预检（clean/commit/版本/契约全过才动资产）＋ **versionCode 方案定案**：web semver 派生（`release.properties` 计数器方案否决）——安卓仓 `fec5a23`，判据与红灯见其提交说明；
  - site 四页 **favicon**（按部署镜像逐页相对深度，`audit_site_favicon` 锁「目标必须是真实运行时资产」）＋ 首屏文案（「不用记得先按开始，做完再补记」，en 对应）；
  - **`STATUS.md` 状态治理 + `docs/HANDOFF.md` 收缩为交接入口**（历史原文迁 `docs/handoff-archive-2026-09.md`）。

## OPEN

- **v1.3.0 发布收尾**（本地 commit `09b882e` 就绪、四闸全绿 + 全量 test:ui 488 passed）：维护者审阅通过后 push main → tag `v1.3.0` → Release → publish-site → 线上复核 CACHE `timelog-v1.3.0`。以实际 git/gh 记录为准。
- `- [ ] E`（runbook Phase E，首轮推广）——**唯一非 gated 的产品未完成项**，底稿在 `docs/promo/`。
- **无前缀 `/support` 仍 404**（2026-09-21 实测：`/zh/support/` 与 `/en/support/` 均 200，但 app 逐字链接的无前缀 `https://eigentime.org/support?from=time-logger` 跟到底不重定向、仍 404）：v1.1.0 的应用内链接已按维护者裁定**先行发布**（D30 显式修订 D28 的「上线前不放链接」），因此在网站侧给无前缀 `/support` 补重定向（→ `/zh/support/`）之前存在**已知死链窗口**。收口动作在网站侧（改一页轻），不是在本仓回滚或改 URL（会重走发版仪式）。
- runbook `- [ ] A3 / C / D` 的勾选动作（AI 无法验证，维护者自查）；SPEC-008 已 park；技术债与裁定详单见 `docs/HANDOFF.md`「还没做的」。

## BLOCKED

- **安卓发版**（tag `a1.0.0.1` + Release + Play 上传）：上传密钥、开发者账号、真机复验——全在维护者侧，清单见安卓仓 `docs/release-checklist.md`。代码侧已就绪：`bundleRelease` 走 fail-closed 守卫，密钥配好即可出包。

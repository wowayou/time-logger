# STATUS — 当前状态唯一入口

> 打开仓库先看这一页。DONE＝已发布/已落地且有判据守护；OPEN＝已排期未完成；BLOCKED＝缺维护者侧资源。
> 历史与规范不在这里：规范＝[`CLAUDE.md`](CLAUDE.md)；决策史＝`docs/decisions.md`；版本流水＝`CLAUDE.md` 表 + `docs/CHANGELOG.md`；交接须知＝[`docs/HANDOFF.md`](docs/HANDOFF.md)。

**Last Verified：2026-09-23 · web `v1.4.0`（日视图「现在」条：一眼看到「正在做：X · 已 Ymin」，只读；**已发布上线**——main `156101c` + tag `v1.4.0` + Release + publish-site 绿灯 + 线上复核 CACHE `timelog-v1.4.0`、manifest `1.4.0`；四道闸全绿 + 全量 test:ui 496 passed（chromium/webkit 248+248，0 failed）；同批赞助落地页/README 链接已随本版上线并线上复核可见） · android `aab025d`（已推送，未发版） · 核验人：AI 代理**

## DONE

- **v1.4.0 日视图「现在」条已发布上线**：R2 方案 1（应用内「当前段」计时）的最小落地，gate 由维护者裁定解锁。调研确认计时能力早已在（时长由下一条派生、时间轴尾段用 `dur.ongoing`＝「已 Ymin」标进行中、FAB 副文案也报「续 X 起 · 已 Ymin」），真正缺口只是**在做什么**这一眼要滚到长列表底部才看得到。本版在 hero 结论与时间轴之间加只读状态条 `#now-strip`：**仅**日视图看今天、且尾段是**非空 what 的已发生段**时显示「正在做：X · 已 Ymin」；未记录尾段沿用 FAB「续 X 起」入口不重复；切周/月/年或非今天即隐藏（`renderNowStrip([], false)`）。**纯展示**：把 `day.timeline` 里 `isOngoing` 那条的 what/mins/桶色前置，不新增数据字段、不加真计时器、不碰统计与写路径；点整条＝编辑该段（复用 `start-edit`+`data-id`），左侧桶色竖脊沿用 `.entry` 的 `data-b→--rail`。新增 i18n `nowStrip.label`/`nowStrip.doingAria`（zh/en 对等），英文 "Now doing"、桶名沿用 Drift 不触禁词。零新增运行时资产（`FILES` 不变）。判据＝`tests/v1_4_0_now_strip.spec.js` 4 条双引擎全绿 + 四道闸全绿 + 全量 496 passed。已发布上线：main `156101c` + tag [`v1.4.0`](https://github.com/wowayou/time-logger/releases/tag/v1.4.0) + Release + publish-site 绿灯 + 线上复核 CACHE `timelog-v1.4.0`、manifest `1.4.0`。
- **v1.1.0 自愿支持入口的落地页/README 链接已随 v1.4.0 上线**：`site/` 中英两页 footer + `README.md`「支持作者（自愿）」小节各加一条指向 `https://eigentime.org/support?from=time-logger`（逐字复用已登记 `from`、不分 locale）。线上已复核 zh footer「支持作者」、en footer "Support the author" 可见。**死链窗口已闭合**（2026-09-23 实测：网站侧对无前缀 `/support` 设了 301 → `/zh/support/`，且**保留 `?from=time-logger` query**：`curl -sIL https://eigentime.org/support?from=time-logger` 终态 `https://eigentime.org/zh/support/?from=time-logger` 200，归因参数完整跟随）。

- **v1.3.0 时间拨号盘分析页已发布上线**：「更多」下新增只读可视化页（`mode:'analytics'` 走既有 `openFormSheet` 二级页与返回栈，非新视图，不动 day/week/月/年 主视图与 native-contract selector）。顶部结论区 + 3 列圆盘拨号键（前 4 键＝四桶、其余按时长降序续排标签）+「接通」键复制本期摘要。**纯逻辑层**（`stats.js` +164 / `time.js` +33，config 由调用方注入、不碰 DOM/localStorage）：`comparePeriods`（同步进度对比、覆盖率按已历天数）、`periodTrend`（只用已完成周期、可比 <3 判 insufficient、flat 死区 max(30min,10%)、runLength 仅 up/down 计数）、`tagMinutes`、`elapsedMatchedRange`/`previousPeriodRange`。**自查出并修了一个真 bug**：`elapsedMatchedRange` 早期只对周视图正确，月/年已完成且短于上期时会漏上期尾几天——改为整期对整期，加月/年回归断言。UI 只读：不写记录、不改 config、无支付/埋点/网络；零新增运行时资产（`FILES` 不变）。判据＝`tests/v1_3_0_analytics_dialpad.spec.js` 5 条双引擎全绿 + `confirm_logic_smoke.py` 周期/趋势断言 + 月/年回归；`v84_polish` 行数 10→11。已发布上线：main `e2c301d` + tag [`v1.3.0`](https://github.com/wowayou/time-logger/releases/tag/v1.3.0) + Release + publish-site 绿灯 + 线上复核 CACHE `timelog-v1.3.0`、manifest `1.3.0`。
- **v1.2.1 导入预览新增组弱化呈现（B）已发布上线**：纯 UI/文案改动。新增项**不需逐条确认**（从未需要，导入按钮只被冲突拦），本版把新增组前置安心文案（随导入一次性全部加入、展开仅供核对）、去主线色边框、标题降为 muted 小字，消除“像待办勾选表”错觉。冲突逐条决策、CAS 写入、字段全部不改。判据＝`tests/v1_2_0_import_preview.spec.js` 加安心文案断言；四闸全绿 + 全量 478 passed；main `f135db4` + tag `v1.2.1` + Release + publish-site 绿灯 + 线上复核 CACHE `timelog-v1.2.1`。
- **v1.2.0 导入预览逐条化已发布上线**（D13 ③ 透明度硬化）：main `d4fc7cf` + tag `v1.2.0` + Release + publish-site 绿灯 + 线上复核 CACHE `timelog-v1.2.0`。内容＝导入检查把新增/已跳过从一行计数升级为可展开逐条清单；`preflightImportedEntries` 新暴 `additions`/`skippedEntries`。顺手修了 v1.1.0 遗留的 v84 静默破缺（「更多」9→0 行）。
- **v1.1.0 已发布上线**（D30，修订 D28）：main `860898d` + tag [`v1.1.0`](https://github.com/wowayou/time-logger/releases/tag/v1.1.0) + [Release](https://github.com/wowayou/time-logger/releases/tag/v1.1.0) + publish-site 绿灯 + 线上复核（cache-bust 后线上 `const CACHE = 'timelog-v1.1.0'`、manifest `1.1.0`）。内容＝「更多」sheet 里排在「高级」之后的一条外链（`a.cell-btn`，`target=_blank rel=noopener`），指向 `https://eigentime.org/support?from=time-logger` 的**中转页**（不直连收款平台），旁附三句事实声明（自愿 / 功能始终免费 / 支持不购买任何东西）。应用内零支付界面、零埋点、零分析 SDK。判据＝`tests/v1_1_0_support_entry.spec.js` 6 条双引擎 10/10；四道闸全绿。**死链窗口已于 2026-09-23 闭合**（网站侧 301 无前缀 `/support` → `/zh/support/`，`?from=` 完整保留；D30 附带约束满足，本仓无需再发版改 URL）。
- **v1.0.0 已发布上线**：tag + [Release](https://github.com/wowayou/time-logger/releases/tag/v1.0.0) + publish-site 绿灯 + 线上复核（CACHE `timelog-v1.0.0`）。内容＝版本格式三段式 + Web→Android 显式契约（两仓 audit 双向咬合）+ 发布防护 + digit-only 第八处修复。发布闸：双引擎全量 463 passed / 0 failed / 1 flaky（webkit 既有时序类）。
- **v1.0.0 预写计划的未实施项已全部补齐**（2026-09-12，本批）：
  - 安卓 release 签名 **fail-closed**（缺 `keystore.properties` 时 Release 任务直接失败，不再产 debug 签名假产物）＋ `sync_runtime.py --release` 发版预检（clean/commit/版本/契约全过才动资产）＋ **versionCode 方案定案**：web semver 派生（`release.properties` 计数器方案否决）——安卓仓 `fec5a23`，判据与红灯见其提交说明；
  - site 四页 **favicon**（按部署镜像逐页相对深度，`audit_site_favicon` 锁「目标必须是真实运行时资产」）＋ 首屏文案（「不用记得先按开始，做完再补记」，en 对应）；
  - **`STATUS.md` 状态治理 + `docs/HANDOFF.md` 收缩为交接入口**（历史原文迁 `docs/handoff-archive-2026-09.md`）。

## OPEN

- `- [ ] E`（runbook Phase E，首轮推广）——**唯一非 gated 的产品未完成项**，底稿在 `docs/promo/`。
- runbook `- [ ] A3 / C / D` 的勾选动作（AI 无法验证，维护者自查）；SPEC-008 已 park；技术债与裁定详单见 `docs/HANDOFF.md`「还没做的」。

## BLOCKED

- **安卓发版**（tag `a1.0.0.1` + Release + Play 上传）：上传密钥、开发者账号、真机复验——全在维护者侧，清单见安卓仓 `docs/release-checklist.md`。代码侧已就绪：`bundleRelease` 走 fail-closed 守卫，密钥配好即可出包。

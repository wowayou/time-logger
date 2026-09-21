# STATUS — 当前状态唯一入口

> 打开仓库先看这一页。DONE＝已发布/已落地且有判据守护；OPEN＝已排期未完成；BLOCKED＝缺维护者侧资源。
> 历史与规范不在这里：规范＝[`CLAUDE.md`](CLAUDE.md)；决策史＝`docs/decisions.md`；版本流水＝`CLAUDE.md` 表 + `docs/CHANGELOG.md`；交接须知＝[`docs/HANDOFF.md`](docs/HANDOFF.md)。

**Last Verified：2026-09-21 · web `v1.1.0`（已发布上线：main + tag + Release + publish-site 绿灯 + 线上复核 CACHE `timelog-v1.1.0`） · android `aab025d`（已推送，未发版） · 核验人：AI 代理**

## DONE

- **v1.1.0 已发布上线**（D30，修订 D28）：main `860898d` + tag [`v1.1.0`](https://github.com/wowayou/time-logger/releases/tag/v1.1.0) + [Release](https://github.com/wowayou/time-logger/releases/tag/v1.1.0) + publish-site 绿灯 + 线上复核（cache-bust 后线上 `const CACHE = 'timelog-v1.1.0'`、manifest `1.1.0`）。内容＝「更多」sheet 里排在「高级」之后的一条外链（`a.cell-btn`，`target=_blank rel=noopener`），指向 `https://eigentime.org/support?from=time-logger` 的**中转页**（不直连收款平台），旁附三句事实声明（自愿 / 功能始终免费 / 支持不购买任何东西）。应用内零支付界面、零埋点、零分析 SDK。判据＝`tests/v1_1_0_support_entry.spec.js` 6 条双引擎 10/10；四道闸全绿。**⚠ 已知死链窗口见 OPEN**。
- **v1.0.0 已发布上线**：tag + [Release](https://github.com/wowayou/time-logger/releases/tag/v1.0.0) + publish-site 绿灯 + 线上复核（CACHE `timelog-v1.0.0`）。内容＝版本格式三段式 + Web→Android 显式契约（两仓 audit 双向咬合）+ 发布防护 + digit-only 第八处修复。发布闸：双引擎全量 463 passed / 0 failed / 1 flaky（webkit 既有时序类）。
- **v1.0.0 预写计划的未实施项已全部补齐**（2026-09-12，本批）：
  - 安卓 release 签名 **fail-closed**（缺 `keystore.properties` 时 Release 任务直接失败，不再产 debug 签名假产物）＋ `sync_runtime.py --release` 发版预检（clean/commit/版本/契约全过才动资产）＋ **versionCode 方案定案**：web semver 派生（`release.properties` 计数器方案否决）——安卓仓 `fec5a23`，判据与红灯见其提交说明；
  - site 四页 **favicon**（按部署镜像逐页相对深度，`audit_site_favicon` 锁「目标必须是真实运行时资产」）＋ 首屏文案（「不用记得先按开始，做完再补记」，en 对应）；
  - **`STATUS.md` 状态治理 + `docs/HANDOFF.md` 收缩为交接入口**（历史原文迁 `docs/handoff-archive-2026-09.md`）。

## OPEN

- `- [ ] E`（runbook Phase E，首轮推广）——**唯一非 gated 的产品未完成项**，底稿在 `docs/promo/`。
- **无前缀 `/support` 仍 404**（2026-09-21 实测：`/zh/support/` 与 `/en/support/` 均 200，但 app 逐字链接的无前缀 `https://eigentime.org/support?from=time-logger` 跟到底不重定向、仍 404）：v1.1.0 的应用内链接已按维护者裁定**先行发布**（D30 显式修订 D28 的「上线前不放链接」），因此在网站侧给无前缀 `/support` 补重定向（→ `/zh/support/`）之前存在**已知死链窗口**。收口动作在网站侧（改一页轻），不是在本仓回滚或改 URL（会重走发版仪式）。
- runbook `- [ ] A3 / C / D` 的勾选动作（AI 无法验证，维护者自查）；SPEC-008 已 park；技术债与裁定详单见 `docs/HANDOFF.md`「还没做的」。

## BLOCKED

- **安卓发版**（tag `a1.0.0.1` + Release + Play 上传）：上传密钥、开发者账号、真机复验——全在维护者侧，清单见安卓仓 `docs/release-checklist.md`。代码侧已就绪：`bundleRelease` 走 fail-closed 守卫，密钥配好即可出包。

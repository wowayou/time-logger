# STATUS — 当前状态唯一入口

> 打开仓库先看这一页。DONE＝已发布/已落地且有判据守护；OPEN＝已排期未完成；BLOCKED＝缺维护者侧资源。
> 历史与规范不在这里：规范＝[`CLAUDE.md`](CLAUDE.md)；决策史＝`docs/decisions.md`；版本流水＝`CLAUDE.md` 表 + `docs/CHANGELOG.md`；交接须知＝[`docs/HANDOFF.md`](docs/HANDOFF.md)。

**Last Verified：2026-09-21 · web `v1.1.0`（自愿支持入口已落地，四道闸全绿；tag/Release/推送状态见下方 OPEN） · android `aab025d`（已推送，未发版） · 核验人：AI 代理**

## DONE

- **v1.1.0 自愿支持入口已落地**（D30，修订 D28）：「更多」sheet 里排在「高级」之后的一条外链（`a.cell-btn`，`target=_blank rel=noopener`），指向 `https://eigentime.org/support?from=time-logger` 的**中转页**（不直连收款平台），旁附三句事实声明（自愿 / 功能始终免费 / 支持不购买任何东西）。应用内零支付界面、零埋点、零分析 SDK。判据＝`tests/v1_1_0_support_entry.spec.js` 6 条双引擎 10/10；四道闸全绿。**⚠ 前置未满足见 OPEN**。
- **v1.0.0 已发布上线**：tag + [Release](https://github.com/wowayou/time-logger/releases/tag/v1.0.0) + publish-site 绿灯 + 线上复核（CACHE `timelog-v1.0.0`）。内容＝版本格式三段式 + Web→Android 显式契约（两仓 audit 双向咬合）+ 发布防护 + digit-only 第八处修复。发布闸：双引擎全量 463 passed / 0 failed / 1 flaky（webkit 既有时序类）。
- **v1.0.0 预写计划的未实施项已全部补齐**（2026-09-12，本批）：
  - 安卓 release 签名 **fail-closed**（缺 `keystore.properties` 时 Release 任务直接失败，不再产 debug 签名假产物）＋ `sync_runtime.py --release` 发版预检（clean/commit/版本/契约全过才动资产）＋ **versionCode 方案定案**：web semver 派生（`release.properties` 计数器方案否决）——安卓仓 `fec5a23`，判据与红灯见其提交说明；
  - site 四页 **favicon**（按部署镜像逐页相对深度，`audit_site_favicon` 锁「目标必须是真实运行时资产」）＋ 首屏文案（「不用记得先按开始，做完再补记」，en 对应）；
  - **`STATUS.md` 状态治理 + `docs/HANDOFF.md` 收缩为交接入口**（历史原文迁 `docs/handoff-archive-2026-09.md`）。

## OPEN

- `- [ ] E`（runbook Phase E，首轮推广）——**唯一非 gated 的产品未完成项**，底稿在 `docs/promo/`。
- **`eigentime.org/support` 尚未上线**（2026-09-21 实测 `/support` 与 `/zh/support/` 均 404）：v1.1.0 的应用内链接已按维护者裁定**先行发布**（D30 显式修订 D28 的「上线前不放链接」），因此在 Agent A 补上 `/support` 之前存在**已知死链窗口**。缩短窗口的正确动作在网站侧补页面（改一页轻），不是在本仓回滚（重发一版）。若网站落成 `/zh/support/` 带前缀形态，须让无前缀 `/support` 保持可达（重定向即可）。
- **v1.1.0 发布收尾**（本批 AI 完成到「四闸全绿、本地就绪」为止）：push main → tag `v1.1.0` → GitHub Release → publish-site → 线上复核 CACHE 是否变 `timelog-v1.1.0`。这几步的执行状态以实际 git/gh 记录为准，勿凭本文件推断。
- runbook `- [ ] A3 / C / D` 的勾选动作（AI 无法验证，维护者自查）；SPEC-008 已 park；技术债与裁定详单见 `docs/HANDOFF.md`「还没做的」。

## BLOCKED

- **安卓发版**（tag `a1.0.0.1` + Release + Play 上传）：上传密钥、开发者账号、真机复验——全在维护者侧，清单见安卓仓 `docs/release-checklist.md`。代码侧已就绪：`bundleRelease` 走 fail-closed 守卫，密钥配好即可出包。

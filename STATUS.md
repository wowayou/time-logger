# STATUS — 当前状态唯一入口

> 打开仓库先看这一页。DONE＝已发布/已落地且有判据守护；OPEN＝已排期未完成；BLOCKED＝缺维护者侧资源。
> 历史与规范不在这里：规范＝[`CLAUDE.md`](CLAUDE.md)；决策史＝`docs/decisions.md`；版本流水＝`CLAUDE.md` 表 + `docs/CHANGELOG.md`；交接须知＝[`docs/HANDOFF.md`](docs/HANDOFF.md)。

**Last Verified：2026-09-12 · web `v1.0.0`（tag 锚点）已发布上线 · android `fec5a23`（领先 origin，未发版） · 核验人：AI 代理**

## DONE

- **v1.0.0 已发布上线**：tag + [Release](https://github.com/wowayou/time-logger/releases/tag/v1.0.0) + publish-site 绿灯 + 线上复核（CACHE `timelog-v1.0.0`）。内容＝版本格式三段式 + Web→Android 显式契约（两仓 audit 双向咬合）+ 发布防护 + digit-only 第八处修复。发布闸：双引擎全量 463 passed / 0 failed / 1 flaky（webkit 既有时序类）。
- **v1.0.0 预写计划的未实施项已全部补齐**（2026-09-12，本批）：
  - 安卓 release 签名 **fail-closed**（缺 `keystore.properties` 时 Release 任务直接失败，不再产 debug 签名假产物）＋ `sync_runtime.py --release` 发版预检（clean/commit/版本/契约全过才动资产）＋ **versionCode 方案定案**：web semver 派生（`release.properties` 计数器方案否决）——安卓仓 `fec5a23`，判据与红灯见其提交说明；
  - site 四页 **favicon**（按部署镜像逐页相对深度，`audit_site_favicon` 锁「目标必须是真实运行时资产」）＋ 首屏文案（「不用记得先按开始，做完再补记」，en 对应）；
  - **`STATUS.md` 状态治理 + `docs/HANDOFF.md` 收缩为交接入口**（历史原文迁 `docs/handoff-archive-2026-09.md`）。

## OPEN

- `- [ ] E`（runbook Phase E，首轮推广）——**唯一非 gated 的产品未完成项**，底稿在 `docs/promo/`。
- site 一次性支持页（D28）：等收款渠道定案，上线前应用内不放链接。
- runbook `- [ ] A3 / C / D` 的勾选动作（AI 无法验证，维护者自查）；SPEC-008 已 park；技术债与裁定详单见 `docs/HANDOFF.md`「还没做的」。

## BLOCKED

- **安卓发版**（tag `a1.0.0.1` + Release + Play 上传）：上传密钥、开发者账号、真机复验——全在维护者侧，清单见安卓仓 `docs/release-checklist.md`。代码侧已就绪：`bundleRelease` 走 fail-closed 守卫，密钥配好即可出包。

# Licensing

This file records the licensing position of **Eigentime / 时间尺** (`wowayou/time-logger`).
It supplements, and does not modify, [`LICENSE`](LICENSE).

Established: 2026-07-31. Copyright holder: **wowayou**.

## 1. Public license

The project is published under **AGPL-3.0-or-later**. Every runtime file carries an
`SPDX-License-Identifier: AGPL-3.0-or-later` header. Anyone may use, study, modify and
redistribute the software under those terms.

## 2. The distributed work contains no third-party code

The application has **zero runtime dependencies** — no bundler, no framework, no vendored
libraries. The only npm packages in the repository are development-time test tooling
(`@playwright/test`, `typescript`), declared as `devDependencies`, never imported by
`src/*.js`, and never shipped to a browser. Consequently the distributed artifact is
entirely the copyright holder's own work, and carries no third-party copyleft obligations
beyond the project's own license.

## 3. Sole ownership, and dual licensing

As of the date above, the copyright holder is the **sole author** of all code in this
repository: every commit and every merged pull request originates from that person's own
accounts (including pull requests whose code was drafted by AI assistants working under
the copyright holder's direction — such output is not a third-party contribution).

Because AGPL-3.0-or-later is a licence *granted by* the copyright holder rather than a
constraint *upon* them, the copyright holder may also distribute the same code under other
terms. The copyright holder therefore **expressly reserves the right to license this
project, in whole or in part, under separate terms — including proprietary or commercial
terms — concurrently with its public AGPL release.**

This reservation exists for one concrete, known reason: **application-store distribution
terms conflict with the GPL family.** App Store Usage Rules (device-count limits and
similar restrictions) have been held by the Free Software Foundation to be additional
restrictions incompatible with the GPL; the iOS ports of GNU Go and VLC were removed from
the App Store on those grounds. Should this project ever be distributed through such a
store, it will be distributed under separate terms issued by the copyright holder, while
the public source release remains AGPL-3.0-or-later and freely available. **No user of the
AGPL release loses any right by that happening.**

## 4. Contributions from this date onward

Contributions are welcome, but the reservation in §3 only survives if inbound rights are
broad enough to support it. A contribution licensed to the project under AGPL alone would
make the project unable to issue the separate licence described above without that
contributor's later agreement.

Therefore, **from 2026-07-31 onward, by submitting a contribution (pull request, patch, or
any other form) you agree that:**

1. you are the author of the contribution, or are otherwise entitled to submit it;
2. your contribution is licensed to the public under **AGPL-3.0-or-later**; **and**
3. you grant the copyright holder a perpetual, worldwide, non-exclusive, irrevocable,
   royalty-free right to **relicense your contribution under other terms**, including
   proprietary or commercial terms, as part of this project.

Point 3 is what makes app-store distribution possible without hunting down every past
contributor. If you are not willing to grant it, please say so in the pull request — the
contribution may still be accepted as an issue, a suggestion, or a separately maintained
fork under AGPL, and no hard feelings.

The copyright holder does **not** ask for copyright assignment. You keep the copyright in
your contribution.

## 5. Commercial licensing enquiries

Via <https://github.com/wowayou/time-logger> (issues) — or, for anything you would rather
not discuss in public, the contact listed at <https://eigentime.org/>.

---

## 中文摘要（以上英文正文为准）

- 项目公开发布于 **AGPL-3.0-or-later**，不变。
- 分发产物**零运行时依赖**，不含任何第三方代码；npm 里只有开发期测试工具，不随应用分发。
- 截至 2026-07-31，**全部代码的著作权人只有 wowayou 一人**（AI 助手在著作权人指导下产出的代码不构成第三方贡献）。著作权人**明确保留以其它条款（含商业）另行授权本项目的权利**，与公开的 AGPL 发布并行。
- 之所以需要这条保留：**应用商店条款与 GPL 系许可存在既有冲突**（App Store Usage Rules 的设备数限制被 FSF 认定为附加限制，GNU Go 与 VLC 的 iOS 移植曾因此下架）。若将来经商店分发，将由著作权人另行授权；**公开源码仍是 AGPL，AGPL 使用者不因此失去任何权利**。
- **自 2026-07-31 起提交贡献即表示**：① 你是作者或有权提交；② 贡献以 AGPL-3.0-or-later 向公众授权；③ 你另行授予著作权人**永久、全球、非独占、不可撤销、免版税的「以其它条款再许可你的贡献」的权利**。不接受第 ③ 条也没关系，在 PR 里说明即可——仍可以 issue、建议或独立 fork 的形式参与。
- **不要求著作权转让**，你的贡献仍归你。

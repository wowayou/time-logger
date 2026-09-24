# 交接入口（原「当前交接状态」）

> 用途：换模型 / 换人时从这里进入。**此刻状态（DONE/OPEN/BLOCKED、两仓 commit、Last Verified）在根目录 [`STATUS.md`](../STATUS.md)——那是唯一当前状态入口**，2026-09-12 起 HANDOFF 不再维护时点状态。
> 历史交付记录：`CLAUDE.md` 版本表 + `docs/CHANGELOG.md`；2026-07→09 的交接原文在 `docs/handoff-archive-2026-09.md`。
> 维护纪律：每完成一个里程碑就更新 STATUS.md 并提交，不要攒到最后写。
> 权威文档分工：法律＝`CLAUDE.md`；决策史＝`docs/decisions.md`；版本流水＝`CLAUDE.md` 表 + `docs/CHANGELOG.md`；协作流程＝`docs/collab-protocol.md`；人肉步骤＝`docs/launch-runbook.md`；规格＝`docs/specs/`；安卓仓＝`../time-logger-android`（CLAUDE.md / docs/DATA-CONTRACT.md / docs/release-checklist.md）。

## 阅读顺序

1. [`STATUS.md`](../STATUS.md) — 此刻 DONE/OPEN/BLOCKED
2. `CLAUDE.md` — 规范与红线（改动前必读）
3. `docs/collab-protocol.md` — 多模型协作流程
4. `docs/decisions.md` — 决策史（D1…）
5. `docs/launch-runbook.md` — 发布与上线的人肉步骤
6. 本文件其余部分 — 长期有效的交接须知（见下）

---

## 接手时最该知道的几件事

1. **标签配置有三条判据相反的规则，别把它们抹平**（v82/v83）：① 删除只对**零记录**标签开放，且保存时按最新 `load()` **复算**（sheet 开着时别的标签页记了一条要拦下）；② **已有行**的空名是错误，**草稿行**（`data-new="1"`）的空名是「没建过」，直接忽略；③ `config.mainline` 现在按行重建（行序即数组序），而 `setMainlineLongOk` 只认已在数组里的名字，所以 longOk 写回必须排在数组定稿**之后**——这条顺序依赖有单独的红灯用例锁着。
2. **英文界面的存量守卫**：`SUPPORTED_LOCALES` 加入 `'en'` 让 `resolveLocale` 的 navigator 分支第一次真正生效。`ensureLegacyLocalePinned()` 把「已有数据 + 无 locale 偏好」的设备一次性钉在中文；全新安装才跟随系统语言。**动这块前先读 `tests/locale_legacy_migration.spec.js` 的两条互相咬合的用例。**
3. **标签名是数据不是文案**（SPEC-013 §4.5）：保留标签、默认种子、`LEGACY_ALIASES` 都不随语言翻译——翻了旧备份读不回、桶归类查不中。
4. **现象只在系统动效/系统 UI 参与时出现 → 第一步做跨应用对照**（D23，2026-08-05）：白边追查花了四轮、三个错误假设，前三轮全在自己的 CSS 里找嫌疑人；而「换个 PWA 做同样动作」只要 20 秒，一次就分清了责任。本文件的验收纪律里早就写着「归因必须有对照组」——**规则在、却没被执行**，与「gitignore 规则在、却从不生效」同类。
5. **`toBeVisible()` 不保证「在视口里」**（v86 教训，D22）：它只检查元素有非空盒子且未被 `display:none`/`visibility:hidden`——**滚出视口照样通过**。v84 把滚动目标改成出错行、却把提示条留在正文末尾，真机上四个步骤全表现为「点了没反应」，而用例全绿。凡是「用户能不能看见」的判据，用 `expectInViewport`（`tests/v86_fixes.spec.js` 里的写法）比较边界盒与视口的相交关系。层级是：`toContainText` → `toBeVisible()` → **在视口里**。
6. **被动重渲染不能挂在 `pointerdown` 上**（v86）：重渲染会把正在被点的元素换掉，随后的 `click` 落在已脱离文档的节点上、到不了事件委托——**一次点击被自己吞掉**。要在交互时触发重渲染，挂 `click` 的**冒泡阶段**（动作已跑完）或 `scroll`。
7. **改「同一性判据」这类基础比较时，数据层与 UI 层要分开裁决**（v85 教训）：把 `tagKey()` 顺手用进 `normalizeConfig` 的去重，会让存量并存的两种拼写在**加载时**被静默丢掉一个——用户没同意、桶不同还会悄悄改历史归类，而且设置页因此看不到冲突、合并入口反而失效。**判据改严必须同时给出口**，出口在 UI，不在数据层。
8. **测试夹具冻结了 `Date.now()`**（`FixedDate`）：任何用「时钟差」做宽限/节流判据的守卫，在用例里恒为 0 而静默失效——v84 的撤销横幅第一版就踩了，改用定时器才活。写这类判据前先想一下它在冻结时钟下是什么行为。
9. **没有任何写入路径可以代替用户确认**（v87，D24）：`longConfirm` 只能来自用户点「确认」或 config 里的 `longOk`。写入路径若自称「用户已经断言过两端」，先去表单里数一数**用户真正能改的字段有几个**——C7A 就是这么错的：过夜表单里能改的只有起点，两个终点都是程序给的。而且这类自动确认的碰撞是结构性的：它唯一生效的场合，恰恰是段落长到最该问一句的场合。
10. **「挪动占位条」是个会改历史的隐式手势**（v87）：新增记录靠改尾占位条的 `ts` 落库，往前挪是续记（对），往后挪是把一段「确实没记」改写成前一条的标签（错）。v48 给编辑/切分/删除都建了 planner + 预览 + 签名复算，唯独**新增**这条最热的路径没有——它至今仍是就地改字段。再动这条路径时留意这个不对称。
11. **同一个问题不要在两处各答一遍**（v87）：「这一段的右邻是谁」在渲染侧走 `loggedEntriesFrom`、在确认侧走 `sortedEntriesFrom`，不一致了一年多没人发现——因为症状是「按钮没反应」而不是报错。跨日上限那条因此**只写在 `segmentBoundsForEntry` 一处**，让渲染/统计/`rawMins`/确认端点四者共用同一个函数。
12. **性能护栏用结构性判据，不用毫秒数**（v87）：「一次年视图 render 读了几次 `timelog.config`」是确定性的；耗时判据在并行 CI 里天生抖（`stress.spec.js` 的 boot ratio 常年 flaky，本批次前后各跑一次全量才敢说那个 flake 与改动无关）。抖到没人当真的护栏等于没有护栏。
13. **别人的真实数据是最好的模糊测试语料**（v87）：这四条全部是拿维护者那份 633 条备份把每一天的段重算一遍、跟界面上应该出现什么逐条对照出来的，不是读代码读出来的。下次拿到真实备份先做这件事。
14. **`.first()` 在标签设置里不安全**：主线分组出现后 `.cfg-name` 不唯一（v80 已改三处），v83 的草稿行让它更不唯一——一律按 `data-kind` / `data-original-name` / `data-new` 定位。
15. **配置页的 CAS 基线在「打开 sheet 时」捕获，局部动作不得现读刷新它**（v1.4.1/R5）：标签高级设置是长表单，「设为当前」「添加默认标签」等局部动作会原地重渲整张 sheet。CAS 基线（`configRawAtOpen`）只能在**真正新开 sheet**（`openFormSheet` 里 `prevMode !== 'config'`）时刷新；若在局部动作发生时 `loadConfigSnapshot()` 现读 raw 当基线，另一标签页在 sheet 打开期间的写入会被当成自己的起点而静默覆盖（⑦的红灯就针对这一点）。`saveConfigChecked` 成功后回传落库的 raw，调用方把基线推进到写入后的值，否则紧接的第二个局部动作会拿旧基线误判并发。局部重渲前用 `captureConfigEdits`/`restoreConfigEdits` 抓暂存回填，但重渲后已有记录的行不再挂删除按钮，待删除态遇此直接跳过。

## 还没做的（按「谁能推动」分）

> 时点快照在 `STATUS.md` 的 OPEN/BLOCKED；本节保留**裁定与技术债**等长期内容，两处重复时以裁定原文为准。

**只有维护者能推动**

- `- [ ] E 完成`（runbook Phase E，首轮推广）：**唯一非 gated 的未完成项，也是这个项目的真实瓶颈**。`docs/promo/` 有六份底稿（三中三英）待改写。要事实核查随时丢给 AI。
- `- [ ] A3`（GitHub 账号级域名验证）、`- [ ] C`（真机迁移确认）、`- [ ] D`（浸泡判断）：AI 无法验证，只能由维护者勾选。旁证上 C/D 的实质动作早已完成（SPEC-002 旧站只读冻结已于 v76 交付上线），**勾选动作本身还欠着**。
- `- [ ] F2` 及 F3/F4：App Store 前置项，**gated**（D17 第二层触发条件未满足前不启动）。

**已 park，不要主动捞**

- SPEC-008（landing 活体 mock）：服务「落地页的说服力」，而落地页访客仍未知。解 park 一个不等于解 park 全部。

**跨仓依赖（本仓已交付、等对侧）**

- **`eigentime.org/support` 死链窗口已闭合**（D30，显式修订 D28）：v1.1.0 应用内链接曾先行发布、承担了一段维护者裁定接受的**已知死链窗口**；2026-09-23 网站侧对无前缀 `/support` 设 301 → `/zh/support/`，且**保留 `?from=` query**（`curl -sIL https://eigentime.org/support?from=time-logger` 终态 `/zh/support/?from=time-logger` 200），归因参数完整跟随。D30 附带约束（双语站落成带 `/zh/` 前缀时须让无前缀 `/support` 保持可达）由此满足——**本仓运行时写死的无前缀 URL 无需改动、无需再发一版**。

**技术债（登记在案，都需要单独立规格，不要顺手改）**

- ~~**跨天记录的形态限制**（v77 记录）~~ **维护者 2026-08-03 裁定：当前形态就很好，不排期、不处理。** 事实照旧记在这里以免下次会话重新提出：数据层没有「跨天记录」，段＝[本点, 下一点)，午夜是统计边界；「过夜续记」要求昨天尾点是**未记录占位**，尾点若是真实记录（刷手机到睡着），「昨晚到今早都记成睡觉」需两步手工完成。**不要再把它当待办提上来。**
- **压测 A 类阈值仍在边缘**：判据已于 v80 后维护轮从绝对壁钟改为相对空数据基线（那次修的是判据**错误**，不是松紧），但 2026-08-03 三次全量里**仍有两次**擦线 flaky（500 条 1.625 vs 1.6；另一次是 5000 条同类）。都在 webkit、都重试即过、都与当轮改动无关。若再频繁，该查的是「基线取样次数够不够」，不是继续抬阈值。
- ~~**`使用与理念.md` 的「标签含义」段已过期**~~ **已改（2026-08-03，维护者授权）**：旧的 `研究·学工具·逃避` / `杂` 换成四桶说明 + 当前默认种子 + 标签管理入口；保留「偏航不等于错误」那层语义（CLAUDE.md 红线要求帮助页有这层意思，理念文档同口径）。

## 验收门槛（一条都不能减）

- 四件套全绿 + `git diff --check` 干净。
- **P35 红灯证明**：每条新回归先证明「没修会红」，证据贴 PR。
- `git status --short` 不夹带真实记录、截图、导出 JSON、`外部/`、测试产物。
- 改动范围严格等于规格 scope；顺手修无关问题＝拒收（例外：与本单同一处、且已在 PR 里写明的既有洞，如 v83 的保留名守卫）。

## 已知坑（踩过的，别再踩）

- **P35 证明不了「规格本身够不够」**：v74 验收时读实现 diff 又抓出两处规格没写的问题。红灯证明保证的是「规格要求的行为在不在」，验收环读 diff 仍然必要。
- **测试本身可能是假的**：v80 的「只追加」红灯第一次没点亮，因为断言只看「预览整体是否包含某名字」，`normalizeConfig` 去重把缺陷盖住了；改成方向性断言（同名必须在「将跳过」行、且**不得**在「将新增」行）才成立。
- **反馈类断言一律 `toBeVisible()`**：`toContainText` 对 `display:none` 和被遮挡元素照样通过——SPEC-012 那个回归就是这么漏网的。
- **同一枚硬币的反面（v91）：断言「不该出现」时不能用带自动重试的否定断言。** `toBeHidden()` 会重试到默认 5s 超时，而 info toast 自己 3s 后消失——于是它等到 toast 自然过期再判过，「无条件弹提示」这个红灯照样全绿。凡是判据里含「自动消失/自动收起」的元素，否定断言必须用一次性读取（`isVisible()`），并在注释里写明为什么不存在「还没来得及出现」的竞态。
- **`returnToMore` 会让 sheet「关不掉」**：从「更多」下钻的 sheet，`closeForm()` 是把内容换回「更多」而非 hidden，构成持续性遮挡（详见 SPEC-012 文末实测校正）。写用例时的直接后果：保存后**不要**再点一次「···」，「更多」已经在那儿了；要露出 FAB 得先点「关闭更多菜单」。
- **端口陷阱（v65）**：`reuseExistingServer: true` 会把 4173 上任何陈旧 server 当被测应用，整套假超时。同一个坑的第二面：全量套件正在跑时再起一个 Playwright 进程会因端口占用直接失败——要临时截图，等全量跑完。
- **`gh pr edit` 会撞 Projects classic 弃用报错**：改用 `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> --input -`；转 ready 用 GraphQL `markPullRequestReadyForReview`。另：`gh pr create --body "$(cat <<'EOF' … )"` 偶发 graphql 连接被重置，改用 `--body-file -` 直接喂 heredoc 更稳。
- `外部/` 已进 `.gitignore` 并已重命名为不带空格（2026-07-27）。原真名尾部带一个空格，而 gitignore 会吃掉行尾空格，旧规则匹配不到它——**规则在、却从不生效**，比没有规则更危险。现为 `外部/` + `外部*/` 两条。

## 常用命令（纯本地，不吃额度）

```bash
python3 scripts/project_audit.py && python3 scripts/confirm_logic_smoke.py && npm run typecheck
ss -ltnp | grep 4173 || echo "4173 空闲"    # v65 端口陷阱：先确认端口不是别的项目
npm run test:ui                              # 392 条双引擎，约 7 分钟
git diff --check && git status --short
```

发版仪式（六锚点用脚本，其余手动）：

```bash
python3 scripts/bump_version.py <N>          # 六处锚点联动；CHANGELOG 行与 FILES 仍手动
# PR 合并到 main 之后：
git tag v<N> && git push origin v<N>         # publish-site workflow 由 tag 触发
gh release create v<N> --title … --notes-file -
curl -s https://time.eigentime.org/app/manifest.webmanifest   # 线上核对版本号
```

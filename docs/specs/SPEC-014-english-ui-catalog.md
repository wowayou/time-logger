# SPEC-014 · 英文 UI catalog + 语言开关

status: ready（SPEC-013 已于 PR #34 合并，阻塞解除。英文 App 名＝**Eigentime**、默认标签种子＝**方案 B**，均由维护者 2026-07-31 拍板，无待拍板项）
owner: 执行方认领后填分支名 `spec/014-en-catalog`
执行模型: **Sonnet 5**（术语在本规格内已定死，执行是机械填表 + 一个 seg 控件）
验收人: Opus 5（**逐条核术语表**，措辞偏离即打回）

## 目标

在 SPEC-013 的 locale 层上加 `en`，加语言开关。**zh 仍是默认**，既有 272 条回归继续以 zh 跑、一行不改。

## 1. 术语表（**锁定，不得自由发挥**）

这张表是本单的验收依据。英文措辞的判据是 CLAUDE.md 的产品语义红线，尤其：**第三桶不带道德评判**。

| 中文 | English | 判据 / 不许用 |
|---|---|---|
| 时间尺（App 名） | **Eigentime** | 与域名 `eigentime.org` 同源。**已定案**（维护者 2026-07-31）；catalog 里是单个 key `app.name` |
| 5 秒记下真实做了什么 | Log what you actually did, in five seconds. | 主 tagline |
| 本地、离线、可信的一天时间线 | A local, offline, trustworthy timeline of your day. | 副 tagline |
| 主线（`job`） | **Focus** | 不用 "Work"（把生活挤出去了）、不用 "Productive"（价值判断） |
| 维持（`maintain`） | **Upkeep** | 睡觉/吃饭/家务。不用 "Maintenance"（机器味）、不用 "Chores"（贬义） |
| 偏航（`leak`） | **Drift** | 与「偏航」同源的航海/航空意象，**零道德色彩**。**严禁** "Leak"（内部键名不外露）、"Waste"、"Distraction"、"Wasted"、"Unproductive"——CLAUDE.md 明载「不含道德评判」 |
| 未记录（`unrecorded`） | **Unlogged** | 不用 "Missing"（像出错） |
| 记一条 | Log it | FAB 主文案，`＋ Log it` |
| 续 hh:mm 起 | From hh:mm | FAB 副文案（占位尾点） |
| 补记 hh:mm 起 | Backfill from hh:mm | FAB 副文案（真实尾点，v77 语义） |
| 计划一条 | Plan one | 计划模式 FAB |
| 补一下 | Fill in | 行内文字链 |
| 标记已发生 | Mark as done | 行内文字链 |
| 确认 | Confirm | 超长段确认 |
| 切一刀 | Split | 编辑 sheet 内 |
| 删除这条 | Delete this entry | |
| 撤销 | Undo | |
| 至今 / 固定结束 | Until now / Fixed end | 今日尾段 |
| 做了什么 | What did you do? | textarea label |
| 标签 | Tag | |
| 天 / 周 / 月 / 年 | Day / Week / Month / Year | 视图切换，需能塞进窄屏 seg |
| 回到今天 / 本周 / 本月 / 今年 | Today / This week / This month / This year | |
| 今天（badge） | Today | |
| 当日时间轴 | Timeline | |
| 现在 hh:mm | Now hh:mm | |
| 更多 | More | |
| 摘要 / 复制 | Summary / Copy | |
| 存储备份 / 分享备份 / 导入备份 | Save backup / Share backup / Import backup | 「备份」统一 backup，不混用 export/backup |
| 标签高级设置 | Tag settings | |
| 主题：跟随系统 / 浅色 / 深色 | Theme: System / Light / Dark | |
| 阶段格言 | Motto | 不用 "Slogan"/"Quote" |
| 启动诊断 | Startup diagnostics | |
| 修复更新通道 | Repair update channel | |
| 说明 | Help | |
| 记录历程第 N 天 | Day N of logging | 里程碑左半 |
| 已记录 N 天 | N days logged | 里程碑右半；N=1 用 "1 day logged" |
| 发现新版 | A new version is available | 更新横幅 |
| 更新应用 | Update | |
| 当前数据仍保存在本机 | Your data stays on this device | |
| 另一标签页已修改数据 | Another tab changed your data | |

**语气规则**：句号只在完整句子后加（按钮文案不加）；不用感叹号；不用 "Oops"/"Sorry" 一类拟人化；错误文案说清事实与出路，不道歉。

## 1.5 默认标签种子（**维护者拍板：方案 B**，2026-07-31）

SPEC-013 执行时发现：`DEFAULT_CONFIG` 的默认 chips（睡觉/吃饭/洗漱/通勤/家务/运动健康/娱乐/刷手机/发呆）与 `mainline: ['求职推进']` 是**数据种子**，不是文案——它们会写进 `timelog.config`、附到记录的 `tags[]`、随完整备份导出、并按名字参与导入合并。因此**不能**在展示层翻译（翻了就查不中桶归类）。

**拍板结果：按 locale 种子，但只在首次初始化。**

| 规则 | 判据 |
|---|---|
| **只在首次初始化时按当前 locale 选种子** | `normalizeConfig(null)` / `timelog.config` 键缺失这条路径 |
| **绝不迁移已有 config** | 已有用户切语言，标签**一个字都不变**——那是他们的数据，不是界面 |
| **切换语言不重新种子** | 同上；语言开关只影响界面文案 |
| **导入不改标签名** | 一份 zh 备份导进 en 设备后同时存在两套标签，这是**正确行为**（导入合并本就按名字保留双方），不做任何"智能"对齐 |

英文种子（与术语表同源，非道德评判）：

- mainline：`Job search`
- maintain：`Sleep` / `Meals` / `Wash up` / `Commute` / `Chores` / `Exercise`
- leak：`Entertainment` / `Phone` / `Zoning out`

`longOk` 布尔与中文种子逐项一致（`Sleep` 为 `true`，其余 `false`）——这是行为，不随语言变。

**实现约束**：种子选择必须发生在 `storage.js` 内部（config 的归属地），且**只读 locale、不写 locale**；`RESERVED_UNKNOWN_TAG` 与 `LEGACY_ALIASES` 保持中文原样不动（它们是存量数据的兼容层，与新装种子无关）。

**必须有的测试**：① 全新 en 安装种出英文 chips；② 已有 zh config 的设备切到 en 后 chips **逐字不变**；③ zh 备份导入 en 设备后两套标签共存且各自桶归类正确。第 ② 条是本节的核心风险，**红灯证明必须做**（临时让切语言也重新种子 → 用例必须红）。

## 2. 语言开关

放「···」更多 sheet 里、**紧邻「主题」**，同款 `.seg` 三选一：`跟随系统 / 中文 / English`（自身按当前语言显示）。写 `localStorage['timelog.locale']`（`''`＝跟随系统）。切换后立即整页重渲染，**不刷新页面**、不丢未保存输入（有 sheet 打开时禁用切换或先关 sheet——执行方选一种并在 PR 说明）。

`document.documentElement.lang` 与 `document.title` 随之更新。

## 3. 日期时间格式（唯一需要写代码而非填表的部分）

`src/time.js` 的展示型格式化按 locale 分流：

- **zh 路径一字不动**（现有手写格式），保证 zh 输出逐字节不变——这是可测的。
- en 走 `Intl.DateTimeFormat('en-US', …)`：`Fri, Jul 31`（日）/ `Jul 28 – Aug 3`（周）/ `July 2026`（月）/ `2026`（年）。**不传 `timeZone`**——Date 对象是本地壁钟构造的，传 tz 会引入 CLAUDE.md 禁止的时区转换。
- 时长：zh `3小时20分` / en `3h 20m`；`0分` / `0m`。
- 复数：`i18n.js` 加最小 `plural(n, { one, other })` helper（英文两形足够，不引 `Intl.PluralRules` 以免为一个用途加抽象）。

## 4. 已知边界（写进 PR 描述，不修）

- **manifest 不动**：`name`/`short_name`/`apple-mobile-web-app-title` 保持中文。PWA manifest 无法按运行时 locale 切换，改它会改变**现有安装用户主屏图标下的名字**，且属版本仪式六锚点。英文命名在 D17 第三层（原生载体）由 App Store 的 per-locale 名称字段正确解决。
- **备份 JSON 不含语言**：locale 是设备偏好，不进备份、导入不得改语言（SPEC-013 已定）。
- **帮助页**：本单需译，且必须保留 CLAUDE.md 要求的那层意思——「Drift isn't failure; stepping back is sometimes necessary; you can re-bucket any tag in Tag settings」。

## 5. 版本仪式

本单是 **v78** 合并批次的一部分。若本单最后合并，则由本单执行 `python3 scripts/bump_version.py 78` 并手写 CHANGELOG 行（含 013/014/015 三部分）；`FILES` 加 `src/locales/en.js`。

## 验收清单

- [ ] **zh 零回归**：`npm run test:ui` 272 条全绿且 `tests/` 既有断言一行未改
- [ ] 新增 `tests/ui_smoke_en.spec.js`（薄，≤12 条）：以 `localStorage['timelog.locale']='en'` 启动，覆盖 ① header/视图切换 ② FAB 两种文案（占位尾点 `From`、真实尾点 `Backfill from`，v77 语义）③ 新建→保存一条 ④ 四桶名 ⑤ 更多 sheet ⑥ 语言切回中文后立即生效
- [ ] **catalog 完备性护栏**（新增 audit）：`zh.js` 与 `en.js` 的 key 集合必须完全相同。P35 红灯证明：删掉 `en.js` 一条 key → audit fail；补回 → 绿
- [ ] **快照 locale 门实测**：zh 下渲染出快照 → 切 en → 刷新，断言**没有**恢复中文快照（SPEC-013 建的门在这里第一次真正被踩，必须有用例）
- [ ] **术语反向断言**（永久护栏）：audit 断言 `en.js` 全文不含 `Leak`/`Waste`/`Distraction`/`Unproductive`/`Wasted`（大小写不敏感，作为独立单词）。红灯证明：临时把 `Drift` 改成 `Leak` → fail
- [ ] `project_audit.py` / `confirm_logic_smoke.py` / `typecheck` / `git diff --check` 全绿；双引擎复跑
- [ ] 人工：375×667 en 下 header 第一行不横向溢出、视图 seg 四项不折行、FAB 双行文案不溢出（英文比中文长，**这是本单最可能翻车的地方**）

## 明确不做

第三种语言、日文、按地区自动切换以外的任何 locale 逻辑、manifest 多语言、landing 页（SPEC-015）、任何功能改动。

# SPEC-013 · i18n locale 层（纯重构，零可见变化，仍只有中文）

status: in-progress（分支 `spec/013-i18n-layer`）
owner: Opus 5（本仓库会话内执行）
执行模型: **Opus 5**（D17 路由表：触及全部运行时模块 + 同步启动脚本 + v53 快照门，一处漏改即静默回退中文）
验收人: Opus 5

## 目标与非目标

**目标**：把散落在运行时的 433 条中文字面量收进一个 catalog 模块，建立 locale 解析与取词机制。**本单结束时应用行为、文案、像素与现在完全一致，仍然只有中文**——英文在 SPEC-014 加。

**非目标**（写死，越界＝拒收）：不加英文、不加语言开关 UI、不改任何文案措辞、不动布局、不加功能。

## 为什么必须先做这一单（不能和英文一起上）

现有 `tests/ui_smoke.spec.js` 有 **606 行中文定位符/断言**。如果 catalog 与英文一起落地，回归全绿就同时依赖「取词机制对」和「英文译文对」两件事，红灯无法定位。本单的验收命题是可判定的单一命题：**取词机制上线后，272 条既有断言一字不改、全部照常绿**。

## 设计

### 1. 模块与边界

新增 `src/i18n.js`（唯一新增运行时资产）：

```js
export const DEFAULT_LOCALE = 'zh';
export const SUPPORTED_LOCALES = ['zh'];   // SPEC-014 追加 'en'
export function resolveLocale(stored, navLangs) { ... }  // 纯函数，可单测
export function setLocale(code) { ... }
export function getLocale() { ... }
export function t(key, vars) { ... }       // vars 走 {name} 占位，缺 key 抛错见 §5
```

模块边界：`i18n.js` 是**纯模块**——不访问 DOM、**不访问任何存储**、不 import 其它业务模块。

> **执行中的偏离（已落地，规格原文已按实际改写）**：规格初稿写「`i18n.js` 读写 `localStorage['timelog.locale']`」。实际做法是 **locale 偏好的持久化归 `storage.js`**（`LOCALE_KEY` / `loadLocalePref` / `saveLocalePref`），`app.js` 在 `init()` 里读出来喂给 `setLocale()`。理由是硬的：`storage.js` 的导入校验文案需要 `t()`，若 `i18n.js` 反过来依赖 `storage.js` 就成循环依赖；且 localStorage 归 `storage.js` 本就是 CLAUDE.md 的模块边界。语言仍**不进备份**（设备偏好，非用户数据；导入不得改语言）。

catalog 放 `src/locales/zh.js`，`export default { 'key': '中文' }`。**扁平点分键**（`form.save`、`bucket.job`、`fab.continueFrom`），不用嵌套对象——扁平键才能被 audit 用一条正则穷举比对。

### 2. 取词点改造

`src/ui.js`（154 行）、`sheet_controller.js`（60）、`io_actions.js`（77）、`storage.js`（54）、`entry_model.js`（43）、`app.js`（31）、`pickers.js`（24）、`time.js`（9）、`stats.js`（2）里的**非注释中文字面量**全部换成 `t('key')`。注释里的中文**原样保留**（那是维护文档，不是 UI）。

带插值的（如 `` `续 ${hhmm} 起` ``）用 `t('fab.continueFrom', { time: hhmm })`，catalog 写 `'续 {time} 起'`。**禁止**把译文拼接成句（`t('a') + name + t('b')`）——语序在英文里会翻。

`aria-label` / `data-tip` 与可见文本**同等**走 catalog（CLAUDE.md：图标按钮必须同时有 `data-tip` 和 `aria-label`，两者都是用户可感知文本）。

### 3. 静态壳（这一条最容易漏，且 headless 能测）

**已核实**：启动门闩只压 `#add-btn/.ruler/.tl-head/#timeline/.usage-day`，**header 站点名与「天/周/月/年」在 ES module 到达前就可见**。因此 locale 必须在 `index.html` 的**既有同步内联脚本**（v53 快照恢复那段）里解析完，不能等模块。

做法：

1. 静态壳里每个可见中文文本/`aria-label`/`data-tip` 加 `data-i18n="key"`（属性形态：`data-i18n-aria="key"`、`data-i18n-tip="key"`）。
2. 同步脚本里内联一份**只含静态壳这些 key** 的极小字典（~25 条），解析 locale 后就地填充并设 `document.documentElement.lang`。
3. 模块到达后 `app.js` 用完整 catalog 再走一次同样的填充（幂等）。

内联字典与 `src/locales/zh.js` 的重复由 §5 的 audit 护栏兜住漂移，**不得靠人记得同步**。

### 4. v53 boot 快照必须加 locale 门（回归风险最高的一处）

快照恢复条件目前含 `appVersion` 门。**必须再加 locale 门**：快照里记录当时的 locale，与当前解析出的 locale 不一致时**放弃快照、走正常启动**。否则 SPEC-014 之后会出现「切成英文 → 刷新 → 恢复出上一帧中文 DOM」的鬼影。本单虽只有 zh，门也要现在建好并测到（SPEC-014 才有机会踩它，那时已来不及）。

### 4.5 执行中发现的「数据 vs 文案」边界（规格初稿未预见，已按数据处理）

读代码时发现三类中文**不是文案，是数据**，翻译它们等于改数据：

1. **保留标签 `'未知'`** 是 `timelog.config` 的键（`storage.js` `LEGACY_ALIASES`），随完整备份导出、按名字参与导入合并。已抽成 `RESERVED_UNKNOWN_TAG` 常量，全仓引用；显示名走 `tag.unknown`（中文下逐字相同）。
2. **`DEFAULT_CONFIG` 的默认 chips**（睡觉/吃饭/通勤/娱乐…）与 `LEGACY_ALIASES` 的繁体别名同理，**不进 catalog**。⚠️ 由此引出一个 **SPEC-014 的产品决策**：全新的英文安装首次初始化时种什么标签？（登记在此，不在本单解决。）
3. **`BUCKETS` 必须保持对象形态**——`tests/ui_smoke.spec.js:2623` 直接 `import { BUCKETS }` 后读 `BUCKETS.leak`，改成函数会要求改既有断言（本单硬禁）。做法是保留 `export const BUCKETS = {...}`、值由 `refreshBucketLabels()` 就地刷新（const 绑定不可变、内容可变）。顺带把 `normalizeChip` 里借「显示名非空」当桶键存在性判断的写法改成 `BUCKET_ORDER.includes(...)`，等价但不再依赖文案。

另：`DEFAULT_MOTTO` 常量改为 `defaultMotto()` 取词函数，且 `normalizeMotto` 改为对**所有** locale 的默认句都归一化回「未设置」（`tAll('motto.default')`）——否则切一次语言，原本「跟随默认」的用户会被钉成「自定义」。

**全角标点也是文案**：`（）`、`，`、`；` 这类做包裹/分隔的全角符号必须进 catalog（`io.noteWrap`/`io.noteJoin`/`import.errJoin`），否则英文界面会残留中文排版。这两处是人工转换时漏掉、由下面的 CJK 护栏抓出来的。

## 5. 新增 audit 护栏（本单的永久产出）

`scripts/project_audit.py` 新增三条：

- `audit_no_hardcoded_cjk_in_runtime`：`src/*.js`（除 `src/locales/`）与 `index.html` 的**非注释行**不得出现 CJK 字面量。数据常量按 `DATA_CONSTANT_LINES` **逐行显式登记**豁免（不是整文件豁免——`storage.js` 里新增的其它中文字面量仍会被拦），与 `REQUIRED_DEMO_ASSETS` 用显式文件名而非通配是同一条纪律。注释剥离必须真做对（HTML 多行注释、块注释、行尾 `//`，且不能把 `https://` 当注释），否则会误报。
- `audit_shell_dict_matches_catalog`：`index.html` 内联字典的每个 key/值必须与 `src/locales/zh.js` 同 key 逐字相同（多、少、不一致都 fail）。
- `audit_i18n_keys_referenced`：catalog 里的每个 key 都能在运行时找到 `t('key')` 引用（防止死 key 堆积）；反向的「引用了不存在的 key」由 `t()` 在开发期 `console.error` + 返回 key 本身兜底（**不抛异常**——用户界面不能因为一条缺词白屏）。

同时修掉现有两处硬编码中文断言（第 288 行 `>改</button>` 反向断言、第 303 行 `aria-label="标记计划为已发生"`）：改为按 **key** 断言（断言 `data-action="confirm-planned"` 的元素存在且其 `aria-label` 取自 `entry.markDone` 这个 key），使其语言无关。

### 6. 版本仪式

本单**不单独 bump**。D17 定：013 + 014 + SPEC-015 的应用内隐私入口合并为一次仪式 **v78**，由最后合并的那一单执行 `python3 scripts/bump_version.py 78` 并写 CHANGELOG。但 **`sw.js` 的 `FILES` 必须在本单加入 `src/i18n.js` 与 `src/locales/zh.js`**（新增运行时资产，CLAUDE.md 硬性），`project_audit.py` 的运行时 import 检查列表同步。

## 验收清单

- [ ] `npm run test:ui` 272 条**全部绿，且 `tests/` 下与文案相关的断言一行未改**（`git diff --stat tests/` 只允许出现新增文件；改动既有断言＝拒收，那意味着文案变了）
- [ ] `python3 scripts/project_audit.py` / `confirm_logic_smoke.py` / `npm run typecheck` / `git diff --check` 全绿
- [ ] 三条新 audit 护栏各自的 **P35 红灯证明**贴进 PR：
  - `audit_no_hardcoded_cjk_in_runtime`：改动前跑（在 stash 掉本单改动的状态下）必须报出 CJK 命中；改动后转绿
  - `audit_shell_dict_matches_catalog`：临时改坏内联字典一条值 → fail；改回 → 绿
  - `audit_i18n_keys_referenced`：临时加一条无人引用的 key → fail；删掉 → 绿
- [ ] 新增 Playwright 用例：**快照 locale 门**——写入一份 locale 标记为 `en` 的假快照，以 zh 启动，断言快照被放弃（sentinel 节点不复用）且页面正常渲染中文。红灯证明：去掉 locale 门后此用例必须红。
- [ ] 双引擎（chromium + webkit）复跑
- [ ] 人工：桌面 + 375×667 各冷启动一次，**首帧 header 文案与改动前逐字相同**（静态壳填充没把 chrome 打空）

## 明确不做

英文译文、语言开关 UI、`en` catalog、landing 页、隐私政策页、任何措辞优化（哪怕发现现有中文有错别字——另开单）。

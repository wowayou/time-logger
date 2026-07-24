# SPEC-009 · 更新卡死自愈（C6 定案对策：检测 redundant-with-cache 死局并提供一键修复）

status: ready（优先级高于 SPEC-007——先修更新通道自身，再做设置美化；版本号按合并顺序取号，不预占）
owner: 执行方认领后填分支名
验收人: Fable

## 背景（C6 第二例，2026-07-25 真机定案）

iPhone SE（iOS 18.6.2）主屏 PWA 启动诊断实录：`v71 · SW态 a:activated（无 installing/无 waiting）· 缓存 timelog-v72(21文件,共2套)`，跨多次冷启动 + 系统重启不变。判读：新版 worker 完整安装、进入 waiting、用户未点击、被 iOS 丢弃成 redundant；注册记录仍记着「最新脚本＝新版」，此后 `reg.update()` 字节比对恒判「无变化」、永不重装。横幅/点击/完全退出/重启全部失效，唯一出路是重新注册。首例 2026-07-17（当时无 SW态 字段，只能猜）；本例定案「redundant 只留缓存」假说。

## 目标

页面侧检测这一死局，向用户提供一键修复（unregister → reload → 全新注册直取新版），把 C6 从「只能删图标重装」变成应用内 2 秒自救。**不自动执行**——修复由用户点击触发（与「waiting 只提示、点击才 skipWaiting」同一红线精神）。

## 检测条件（三条同时成立才算「卡死候选」，防误报）

1. `caches.keys()` 解析出的最大 `timelog-vN` 的 N **大于**当前 `APP_VERSION`；
2. `reg.installing` 与 `reg.waiting` **均为空**（正常更新过渡期两者必有其一，不得误伤）；
3. 上述状态**连续 ≥2 次启动**成立（localStorage 计数器，如 `timelog.updateStuck.count.v1`：启动时满足①②则 +1，任一不满足即清零；达 2 才亮修复入口）。

## 修复流程（用户点击后）

1. **在线前置检查（硬条件）**：`navigator.onLine === false` 时不亮修复按钮（只显示解释文案）——离线时 unregister 后 reload 将既无 SW 也无网络，应用直接不可用；点击后再 `fetch('sw.js', {cache:'no-store'})` HEAD/GET 探活一次，失败即中止并提示稍后再试。
2. 探活通过：`reg.unregister()` → `location.reload()`。无控制器的 reload 从网络取页面，全新注册安装新版并立即激活（无旧 worker 阻塞），activate 自然清掉旧缓存。`localStorage` 数据不受任何影响。
3. 成功路径的检测计数器随版本号变化自然归零。

## 呈现

复用 v64 更新横幅的双态结构（`update-prompt`/`update-stuck` 先例）加第三态「卡住修复」：文案「更新没有生效。点击修复（约 2 秒，本机数据不受影响）」+「修复」按钮；层级红线不变（可见可点、不被 FAB 遮挡）。仅在检测条件成立时出现，与正常更新横幅互斥。

## 版本仪式 / 测试

- bump 按当时序列 + CHANGELOG 行（写明 C6 定案背景与「用户点击才修复」边界）；FILES 不变。
- 测试（双引擎）：mock registration + caches 构造三态——①卡死态（大版本缓存 + 无 installing/waiting ×2 次启动）亮修复；②正常过渡态（有 waiting）不亮；③离线卡死态不亮按钮；④点击修复走 unregister→reload（sentinel 证明真 reload）；⑤计数器在出现 waiting 时清零。P35 红灯证明。全套自测绿。

## 明确不做

- 不自动 unregister（哪怕检测铁定）；不动 sw.js fetch 策略（P33 对赌约束仍在，见 freeze-candidates 复盘提示）；不做后台定时检测（只在启动时检查一次）。

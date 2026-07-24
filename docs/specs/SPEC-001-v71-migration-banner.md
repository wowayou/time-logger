# SPEC-001 · v71：旧 origin 迁移横幅（host-gated）

status: ready
owner: 执行方认领后填分支名
验收人: Fable

## 目标

在旧 origin（`wowayou.github.io/time-logger/`）向用户告知新地址并引导「导出 → 导入」迁移。**同一份代码同时部署两个 origin**（tag push 会自动发布到 time-logger-site 镜像），因此横幅必须按 origin 门控，新站上绝不出现。

## 范围（严格等于以下内容，不得扩大）

1. **origin 门控 helper**（放 `src/app.js`，它是唯一负责启动/状态组合的模块）：
   ```js
   const isLegacyOrigin = () =>
     location.hostname === 'wowayou.github.io' && location.pathname.startsWith('/time-logger/');
   ```
   注意 `startsWith('/time-logger/')` 带尾斜杠——镜像仓库的预览地址 `wowayou.github.io/time-logger-site/app/` 不得命中。
2. **迁移横幅** `#migration-notice`：
   - 仅当 `isLegacyOrigin()` 且未被关闭时渲染；**渲染在 `.app` 之外**（作为其前置兄弟节点），不进 v53 boot 快照范围。
   - 文案：`时间尺已迁至新地址 time.eigentime.org/app/。在旧地址「···」菜单存储备份，到新地址导入即可完成迁移；本旧地址今后将转为只读。`
   - 两个文字按钮（44px 命中区、无 `title=`、不用 x/×/✕）：
     - 「打开新地址」：`<a>` 到 `https://time.eigentime.org/app/`，`target="_blank" rel="noopener"`；
     - 「知道了」：关闭横幅并写 `localStorage['timelog.migrationNotice.dismissed.v1'] = '1'`，跨会话持久。
   - 普通文档流（非 fixed），位于 header 之上方；不得遮挡或被遮挡「更新应用」提示与 FAB（自测清单 6 的层级要求原样适用）。
3. **「···」更多 sheet 新 cell「迁移到新地址」**：仅 `isLegacyOrigin()` 时渲染；点击＝清除 dismissed 标志、关闭更多、重新显示横幅（给关掉横幅的用户一个永久入口）。cell 分组块级流红线（P21/P34）适用。
4. **版本仪式**：`python3 scripts/bump_version.py 71` 联动六锚点；CHANGELOG 手写 v71 行（一句话：旧 origin 迁移横幅，host-gated，新站不受影响）；`sw.js` FILES **不新增条目**（本改动零新资产）。

## 明确不做

- 不改新站行为（门控之外零字节差异即是验收点）；不做只读开关（SPEC-002）；不改备份格式；不动 header 三行结构。

## 测试要求（Playwright，双引擎）

- 用 `page.route('https://wowayou.github.io/time-logger/**')` + `fulfill`（从本地文件读）在真实 legacy origin 下驱动页面：断言横幅可见、两按钮可点、「知道了」后 reload 仍隐藏、更多 cell 存在且能重新唤起横幅。
- localhost 基线：横幅与更多 cell **均不存在**（保证既有 245 条用例零影响）。
- 镜像预览路径 `wowayou.github.io/time-logger-site/app/`（同法 route）：横幅不出现（验证 path 门控）。
- **P35 纪律**：先跑新用例证明未实现时会红，PR 里贴证明。

## 验收清单（PR 正文逐条勾选）

- [ ] audit / confirm smoke / typecheck / test:ui / `git diff --check` 全绿（输出摘要贴 PR）
- [ ] 六锚点版本号全部为 71，CHANGELOG 有 v71 行
- [ ] localhost 与镜像路径下应用行为与 v70 无差异
- [ ] 新增用例的 P35 红灯证明
- [ ] `git status --short` 干净，无夹带

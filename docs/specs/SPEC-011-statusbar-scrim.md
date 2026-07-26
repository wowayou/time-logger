# SPEC-011 · 状态栏遮条：standalone 滚动内容不得与系统状态栏文字互叠

status: in-progress（分支 `spec/074-batch`，v74 合并批次第 2 项；真机截图终审仍归维护者）
owner: 执行方认领后填分支名
验收人: Fable（真机截图终审：维护者）

## 背景（真机证据，2026-07-25 00:17 截图）

`index.html` 声明 `apple-mobile-web-app-status-bar-style: black-translucent` + `viewport-fit=cover`——standalone 下页面内容延伸到状态栏区域。header 不是 sticky，页面一滚动，应用文字就从半透明状态栏底下穿过，与系统时钟/运营商/电量字形互叠（截图实录：τ 图标和「記錄歷程第 28 天」压在 `0:17`/VPN 徽标下面），亮暗两主题都会发生。

## 方案（标准 PWA 遮条，非换 status-bar-style）

不改 `black-translucent`（改 `default` 会破坏暗色主题的沉浸边到边，且是 iOS 上更不可控的老机制）。加一条**固定遮条**：

```html
<!-- 静态壳，.app 之外、所有内容之前；纯装饰 -->
<div class="statusbar-scrim" aria-hidden="true"></div>
```
```css
.statusbar-scrim {
  position: fixed;
  top: 0; left: 0; right: 0;
  height: env(safe-area-inset-top, 0px);
  background: var(--bg);
  z-index: <介于页面内容与 form-sheet/更新横幅之间，按现有 z 标尺取值>;
  pointer-events: none;
}
```

要点：

1. **高度自适应**：浏览器上下文/无刘海桌面 `env()` 为 0 → 遮条零高度、零影响；SE standalone 为 20px；刘海机为 47/59px。零 JS。
2. **双主题自动跟随** `var(--bg)`（含 SPEC-010 未来改底色也自动继承）。
3. **层级**：必须盖住滚动中的页面内容（header/时间轴），必须在 `.form-sheet`（sheet 自带 safe-area 处理，v26）与更新横幅之下或经确认无互叠；`pointer-events: none` 保证不吃任何点击。
4. **不进 v53 boot 快照范围**（静态壳常驻元素，位于 `.app` 之外）。
5. 遮条无边框无阴影——内容滑入其下即被 `--bg` 干净截断，与 hero 贴地面观感一致；若执行中发现底缘生硬可加 8–12px 的 `--bg` 至透明渐变，二选一在 PR 里贴图说明。

## 版本仪式 / 测试

- bump 按当时序列 + CHANGELOG；FILES 不变（index.html/styles.css 本就在清单内）。
- Playwright 无法仿真 `env(safe-area-inset-top)`，自动化断言收敛为：元素存在、fixed、`pointer-events:none`、z 序（与 `#update-prompt`/`.form-sheet` 的计算 z-index 比较）、浏览器上下文中高度为 0 不遮挡任何可点元素；**真机验收由维护者完成**——standalone 打开、滚动时间轴、截图状态栏区域，文字不得互叠（亮暗各一张）。
- P35：断言「无遮条时滚动内容与状态栏区域重叠」做不到（headless 无 safe-area），红灯证明豁免，PR 里说明即可——这是本仓库首个凭真机截图关闭验证环的规格，如实标注。

## 明确不做

- 不改 status-bar-style；不做 header sticky（那是另一个交互决策）；不加 backdrop-filter（合成成本 + P33 敏感区）。

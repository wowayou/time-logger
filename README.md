# 时间尺

> Status: active  
> Updated: 2026-06-28  
> Intended user: 求职主线时间记录和每日复盘的个人使用者。  
> Operating boundary: 本地静态 PWA，只记录时间去向，不做云同步、账号管理、KPI 考核或投资/合规判断。  
> Risks and failure modes: 忘记记录导致“未记录”偏高、长时间间隔被整体计为未记录、周/月/年视图诱发过度复盘、浏览器本地数据被清理。  

求职主线时间记录仪 — 每天看清时间进了哪里。

## 本地运行

```bash
cd time-logger
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
```

## 装到手机主屏（PWA）

iOS Safari：打开页面 → 分享 → 添加到主屏幕。  
Android Chrome：打开页面 → 菜单 → 添加到主屏幕。

## GitHub Pages 发布（隐私边界）

只把 `time-logger/` 作为独立仓库发布，例如 `github.com/wowayou/time-logger`。不要把父目录 `/mnt/d/006-Overseas`、`toolkit/`、`archive/`、导出的 `timelog-*.json`、真实记录 JSON 或截图提交到 GitHub。

推荐发布方式：

1. 在 `time-logger/` 内初始化独立仓库。
2. 推送到 `github.com/wowayou/time-logger`。
3. GitHub Pages 选择从仓库根目录发布。
4. 其他设备通过 Pages URL 打开，再添加到主屏幕。

代码和界面文案可以公开；数据不能公开。每台设备的数据仍只保存在本机 `localStorage['timelog.v1']`，访问 Pages 不会上传、同步或合并记录。

## 多设备使用

- 同一个 Pages URL 只是同一个应用入口，不是云同步。
- 新设备首次打开时本地数据为空。
- 迁移数据靠原设备「下载」JSON，再到新设备「导入」。
- 不提交导出的备份 JSON，不提交真实记录截图。

## 文件地图

| 文件 | 作用 |
|---|---|
| `index.html` | 全部 UI + JS，单文件零依赖 |
| `sw.js` | Service Worker，离线缓存 |
| `manifest.webmanifest` | PWA 清单（名称、图标、版本） |
| `icon.svg` | 应用图标 |

## 数据模型

数据存在 `localStorage['timelog.v1']`，结构：

```json
{
  "version": 1,
  "entries": [
    { "id": "abc123", "ts": "2026-06-28T09:00", "what": "写简历", "tags": ["求职推进"] }
  ]
}
```

时长 = 当前条到下一条 ts 的间隔，渲染时实时算，不存储。  
超过 3h 间隔或标签为"未知"的段落计为**未记录**。

## 功能清单

- 记录 / 编辑 / 删除条目，标签分类
- 天 / 周 / 月 / 年视图：天视图可编辑，周/月/年只读汇总并可下钻
- 移动端日期滚轮选择器（补录用），支持触控、鼠标滚轮、方向键
- 桌面端日期与时分步进控件，支持 `YYYY-MM-DD HH:mm` 精确输入
- 时间尺：求职推进 / 其他 / 未记录 占比可视化
- 自动 / 亮色 / 暗色分段主题控件
- 数据导出（复制 JSON / 下载文件 / 系统分享可用时分享）
- 当前视图摘要复制（Markdown，可直接贴给 AI）
- 数据导入（按 id 合并去重，不静默覆盖）
- 离线可用（Service Worker）

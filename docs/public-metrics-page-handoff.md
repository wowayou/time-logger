# 公开指标页：决策、需求与 AI 交接

> 状态：**候选方案，未批准实现**  
> 日期：2026-07-15  
> 适用仓库：`wowayou/time-logger`  
> 目的：把“展示下载量或访问量”的讨论变成可验证、可实现、可停止的任务，避免把评分数、GitHub Stars、仓库浏览量或估算值冒充真实用户/下载量。

## 1. 结论先行

当前不应直接做“下载量页面”。时间尺仍是无账号、无后端、无遥测的本地优先 PWA，纯 Web 环境无法可靠得到全局安装量；iOS 用户通过 Safari 手动“添加到主屏幕”时，也没有一个跨浏览器、可汇总的可靠安装计数接口。

推荐的第一版是：

1. **先统计公开落地页访问次数，而不是 PWA 安装量或真实用户数。**
2. **核心应用 `index.html` 保持零遥测。**分析脚本只允许出现在独立落地页/公开指标页，不读取、更不上传时间记录、标签、配置、时区、设备标识或本机存储。
3. 对外只显示可核验口径，例如“页面浏览次数（Page Views）”，并同时显示来源、时间范围、更新时间和限制。
4. 所有不可获得的指标显示为“尚不可可靠统计”，不得用 App Store 评分数、GitHub Stars、仓库浏览量或手工估算代替。
5. 数据量足够前，公开指标页的主要价值是**透明说明测量方法**，不是制造社会证明。

## 2. 优化后的产品需求

### 用户故事

作为正在评估 Eigentime 的访问者，我希望看到一组口径诚实、来源明确、不会侵犯使用数据隐私的公开指标，从而判断项目是否仍在维护、是否有人访问，而不会被模糊的“用户量”数字误导。

### 第一版页面目标

建议页面标题：`Eigentime 公开数据` / `Public Metrics`

页面最多展示以下内容：

- **落地页总浏览次数**：明确标注为 `Page Views`，不是人数、活跃用户或安装量。
- **最近 30 天浏览次数**：数据源支持时再展示。
- **最近更新时间**：精确到日期或小时。
- **数据口径说明**：统计了哪些页面、从哪一天开始、是否排除了作者自己的访问、是否可能受机器人或广告拦截影响。
- **当前不可获得的指标**：PWA 安装量、真实活跃用户、留存率；必须显示“不可可靠统计”的原因。
- **未来 App Store 指标**：上架后可在 App Store Connect 内部查看首次下载、重新下载、产品页浏览等；是否公开由维护者另行决定。

### 明确非目标

第一版不做：

- 用户排名、“第 N 位用户”或虚假社会证明；
- 浏览器指纹、持久设备 ID、跨站跟踪；
- 在核心 PWA 中加入第三方行为分析；
- 把 GitHub Stars、Forks、仓库 Views/Clones、App Store 评分数量称为下载量或用户数；
- 为了公开一个数字而新增业务账号、实时同步、用户画像或事件埋点系统；
- 把个人真实时间记录、截图、导出 JSON 或设备信息放入仓库、分析平台或公开页面。

## 3. 为什么不能直接统计“下载量”

### PWA

`appinstalled` 事件只在部分浏览器可用，MDN 将其标记为 Limited availability；iOS 的手动添加到主屏幕也不能依赖该事件形成完整口径。因此它最多是局部客户端事件，若要汇总仍需把事件发送到远端，而这会改变当前零遥测边界。

参考：

- MDN `appinstalled`：<https://developer.mozilla.org/en-US/docs/Web/API/Window/appinstalled_event>
- web.dev 安装提示：<https://web.dev/learn/pwa/installation-prompt/>

### GitHub

GitHub Traffic API 提供的是**仓库**最近 14 天的 Views/Clones，需要具有仓库写访问权限的认证令牌；它不是 GitHub Pages 上时间尺应用的访问量，更不是安装量或真实用户数。令牌不得放进前端页面。

参考：<https://docs.github.com/en/rest/metrics/traffic?apiVersion=2022-11-28>

### App Store

原生应用上架后，App Store Connect Analytics 可以查看 First-Time Downloads、Redownloads、Product Page Views 等指标；这些是开发者后台数据，不等于当前 PWA 的用户量，也不应在尚未上架时提前模拟。

参考：<https://developer.apple.com/help/app-store-connect-analytics/overview/analytics-dashboard>

## 4. 数据源方案比较

| 方案 | 能得到什么 | 隐私/架构影响 | 维护成本 | 当前建议 |
|---|---|---|---|---|
| 不接分析，只显示“尚未统计” | 无访问数字；可展示版本、更新时间、GitHub 公共元数据 | 不改变现有边界 | 最低 | 可立即采用，最诚实 |
| GoatCounter，仅放在独立落地页 | 页面浏览次数；可用公开 counter JSON 展示 | 每次访问会向第三方发送最小分析请求；不得放入核心 PWA | 低 | **公开计数 MVP 首选候选** |
| Cloudflare Web Analytics，仅放在独立落地页 | Page Views、Visitors、性能等 | 第三方 RUM beacon；公开展示通常还需 API/定时快照 | 中 | 需要更完整分析时再选 |
| 自建 Serverless 计数器 | 自定义浏览/事件指标 | 引入后端、滥用防护、存续与安全责任 | 高 | 当前不值得 |
| GitHub Traffic 定时快照 | 仓库 Views/Clones | 不是应用访问；需安全保存令牌；仅 14 天滚动窗口 | 中 | 只能作为开发者内部参考 |
| App Store Connect | 原生版下载、产品页、销售等 | 仅上架后有效；数据主要在开发者后台 | 中 | 原生版以后再接 |

GoatCounter 文档说明它可以直接在站点展示某个页面或全站的浏览次数，并提供 JSON counter；其默认隐私模型不在浏览器保存 Cookie、localStorage 或跟踪 ID，但仍属于第三方分析请求，因此必须在隐私说明中如实披露。

参考：

- Visitor counter：<https://www.goatcounter.com/help/visitor-counter>
- Privacy：<https://www.goatcounter.com/help/privacy>

Cloudflare Web Analytics 也支持未代理到 Cloudflare 的站点通过 JS snippet 接入，并自述为 privacy-first；但若要把数据公开显示在页面上，通常还需要安全的 API 调用或定时生成静态快照，不能把 Cloudflare API Token 放入浏览器。

参考：

- About：<https://developers.cloudflare.com/web-analytics/about/>
- Get started：<https://developers.cloudflare.com/web-analytics/get-started/>
- GraphQL Analytics API：<https://developers.cloudflare.com/analytics/graphql-api/>

## 5. 推荐的最小架构

### 5.1 页面边界

优先把公开指标放在**营销/说明页面**，而不是核心记录界面：

- `eigentime.org/metrics`：公开指标与口径说明；
- 核心 PWA：继续零遥测；
- 若暂时只有本仓库，可先做独立 `metrics.html`，但不得在 `index.html` 注入分析脚本。

### 5.2 数据合同

页面层只消费一个稳定的数据合同，不直接理解供应商细节：

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-15T12:00:00Z",
  "metrics": [
    {
      "id": "landing_page_views_total",
      "label": "落地页浏览次数",
      "value": 0,
      "unit": "views",
      "window": "all_time",
      "source": "goatcounter",
      "status": "available"
    },
    {
      "id": "pwa_installs_total",
      "label": "PWA 安装量",
      "value": null,
      "unit": "installs",
      "window": "all_time",
      "source": "browser_platform",
      "status": "not_reliably_available"
    }
  ]
}
```

允许第一版直接读取 GoatCounter 的公开 counter JSON；若以后更换供应商，只替换适配层或定时生成 `public-metrics.json`，不要重写页面。

### 5.3 失败降级

- 外部服务超时、CORS、返回空值或格式变化时，页面显示“数据暂时不可用”，不得显示旧默认数字或 `0` 冒充真实结果。
- 页面必须显示最近成功更新时间；超过约定时限后显示“数据可能过期”。
- 指标服务失败不得影响核心 PWA 的加载、记录、编辑、统计、备份或离线能力。

## 6. 页面信息架构

建议从上到下：

1. **标题与一句话口径**：这些数字反映公开页面访问，不代表真实用户、安装量或留存。
2. **主指标卡**：总浏览次数、最近 30 天浏览次数、数据更新时间。
3. **不可获得指标卡**：PWA 安装量、活跃用户，解释为什么当前不展示。
4. **测量方法**：数据源、开始日期、去重方式、机器人/拦截器限制。
5. **隐私承诺**：核心时间记录从不上传；公开分析页不读取本机记录。
6. **项目入口**：打开应用、查看源码、查看隐私说明。

不要把竞品研究表和公开指标页混成一个页面。竞品表是内部决策材料；公开指标页是信任与透明页面，两者的用户、信息密度和更新频率不同。

## 7. 对现有竞品表截图的设计反馈

当前表格可用于内部研究，但需要以下优化后才适合长期维护：

1. 增加醒目说明：`App Store 评价数量 ≠ 下载量`，并给每条数据增加 `来源/截至日期`。
2. “竞争关系”徽章不要在窄列内折成 2–3 行；桌面端给固定最小宽度，移动端改为卡片字段。
3. 减少单元格长段落，将“用户任务”“输入模型”“可借鉴”“不要照搬”改成每格 1–3 个短要点。
4. 表头可 sticky，但必须处理顶部遮挡；截图中首行内容被表头/容器裁切，说明当前滚动定位或 sticky offset 有问题。
5. 增加筛选：直接竞品、工作场景替代、相邻竞品、交互参考；不要把所有产品放在同一优先级。
6. 移动端不要横向压缩五列，改成一产品一卡片，默认只显示结论，展开后看证据。
7. “不要照搬”保持为高价值字段，但改为“风险/边界”，避免只留下主观评价。

## 8. 验收标准

### 数据真实性

- 每个数字都显示来源、统计窗口和更新时间。
- 页面不得出现无法追溯的常量用户数、下载数或百分比。
- 评分、Stars、Views、Clones 等指标必须使用准确名称，不能改名为“用户量”。
- 不可统计时明确显示不可统计，不做推算。

### 隐私与安全

- `index.html` 和核心 PWA 模块不加载第三方分析脚本。
- 分析页不读取 `timelog.v1`、`timelog.config` 或其它时间尺本机存储。
- 前端仓库和页面中没有 API Token、账号密码或私密统计导出。
- 不提交真实时间记录、真实用户截图或带个人线索的日志。

### 体验与可访问性

- 320px 宽度下不横向溢出；指标卡自动单列。
- 加载、成功、空数据、过期、网络错误均有清楚状态。
- 数字不是仅靠颜色表达；屏幕阅读器能读出标签、值、单位、时间窗口。
- 支持浅色/深色和 `prefers-reduced-motion`。

### 工程与回归

若页面成为正式运行资产：

- 遵循 `CLAUDE.md` 与 `CONTRIBUTING.md` 的模块边界和版本仪式；
- 新运行资产加入 `sw.js` 预缓存前，必须明确它是否真的需要离线；
- 运行：`python3 scripts/project_audit.py`、`python3 scripts/confirm_logic_smoke.py`、`npm run test:ui`、`git diff --check`；
- 新增自动化至少覆盖成功、失败、过期和窄屏四种状态；
- 真实分析服务不得进入自动化测试，使用固定 mock 数据。

## 9. 下一位 AI 的执行顺序

1. 阅读 `README.md`、`CLAUDE.md`、`CONTRIBUTING.md`、`docs/external-ai-review-brief.md`、`docs/decisions.md`、`docs/roadmap.md` 和本文。
2. 明确页面是公开给访客还是仅供维护者内部查看；默认本文按“对外公开”处理。
3. 要求维护者只选择一个数据源：
   - 不统计，只做透明空状态；
   - GoatCounter 落地页计数；
   - Cloudflare Web Analytics；
   - 原生版上架后的 App Store Connect。
4. 在获得数据源账号/站点代码前，不编造示例账号，不把占位值提交为真实数据。
5. 先提交页面数据合同、空/错/过期状态和 mock 测试，再接真实数据源。
6. 不把分析脚本放进核心 PWA；若维护者坚持这么做，必须先把“数据不上传”的公开文案和隐私边界作为独立决策重新评审。
7. 完成后给出：变更文件、口径说明、隐私影响、截图、测试结果、回退方式和停止条件。
8. 在维护者明确批准前，只开 Draft PR，不合并、不发布。

## 10. 可复制给下一位 AI 的提示词

```text
你将接手 wowayou/time-logger 的“公开指标页”候选任务。先不要写代码。

必读：
1. README.md
2. CLAUDE.md（维护规范唯一真源）
3. CONTRIBUTING.md
4. docs/external-ai-review-brief.md
5. docs/decisions.md
6. docs/roadmap.md
7. docs/public-metrics-page-handoff.md

目标：设计并实现一个口径诚实的公开指标页，但不能把评分、GitHub Stars、仓库 Views/Clones 或估算值冒充下载量/用户量；核心时间记录 PWA 必须继续零遥测，不能读取或上传 timelog.v1、timelog.config 或任何真实记录。

默认推荐方案：分析只放在独立落地页，第一版展示 Page Views、统计窗口、来源、更新时间和“PWA 安装量不可可靠统计”的说明。数据源未由维护者选定前，只做数据合同、mock 状态和实现计划，不连接真实第三方服务。

请先输出：
- 你对目标、非目标和隐私边界的复述；
- 需要维护者确认的唯一关键问题；
- A 类边界内实现方案与 B 类破界方案；
- 文件级实施计划；
- 验收标准、测试、回退与停止条件。

得到明确批准后才创建 Draft PR。任何运行时文件变化都必须遵循版本仪式并跑完整门禁。不要上传真实记录或真实用户截图。
```

## 11. 停止条件

出现以下任一情况就停止实现并回到决策层：

- 维护者无法明确页面展示的是 Views、Visitors、Installs 还是 Downloads；
- 方案要求在前端写入私密 Token；
- 数据源无法解释去重、机器人、时间窗口或更新时间；
- 必须读取本机时间记录才能生成公开数字；
- 为一个公开数字引入的后端、账号、运维或合规成本超过页面本身价值；
- 指标低时团队倾向于改口径、估算或隐藏限制来制造社会证明。

本文只是候选输入，不代表已批准接入任何分析服务或修改运行时。
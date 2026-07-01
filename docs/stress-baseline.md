# 压测基线

首次运行 `npm run test:stress` 后填写此文件，作为后续性能对比锚点。

## A 类：数据规模（启动渲染）

| 档位 | 条数 | 首次实测 boot 耗时 | 通过阈值 |
|------|------|-------------------|---------|
| 小压 | 500  | 115ms             | < 300ms |
| 中压 | 2000 | 85ms              | < 800ms |
| 极压 | 5000 | 119ms             | < 2000ms |

> 运行环境：WSL2 + Chromium (Playwright)  
> 测量日期：2026-07-01                  

## B 类：交互压测（写入循环）

| 指标 | 首次实测值 | 通过阈值 |
|------|-----------|---------|
| 20 轮 P90 单次写入耗时 | 3.1ms | < 100ms |
| Console 错误数 | 0 | 0 |

## C 类：配额极限

| 检查项 | 结果 |
|--------|------|
| QuotaExceededError 未冒泡为页面错误 | ✓ |
| 已有数据完整 | ✓ |

## D 类：跨标签冲突

| 场景 | 结果 |
|------|------|
| 空闲标签页 1s 内自动刷新 | ✓ |
| 编辑中显示 banner | ✓ |
| 关闭表单后 banner 消失 | ✓ |

---

## 路线图：HTML 报告（待 CI 接入后启用）

接入 GitHub Actions 后，在 `playwright.config.js` 中添加：

```javascript
reporter: [['html', { outputFolder: 'playwright-report' }]]
```

每次压测自动生成 `playwright-report/index.html`，可查看各档位耗时趋势。

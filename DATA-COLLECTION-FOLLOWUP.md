# 数据采集方法增强总结

> 响应任务 Important Notes：*"Review data should not be collected by scraping only the visible content of the page. There are more appropriate ways to retrieve App Store review data; candidates are expected to explore them independently and explain their implementation."*

## 改动清单（7 项）

### 1. iTunes Lookup API 拿 app 元数据（非评论源）

**问题**：`fetchAppName` 从 RSS 第一条提取 app 名，RSS 空就失效；缺少全量评分上下文，无法判断样本是否代表整体。

**修复**：
- `types.ts` 新增 `AppMetadata` 类型 + `PipelineResults.appMetadata?` 字段
- `collector.ts` 新增 `fetchAppMetadata()` 调用 `https://itunes.apple.com/lookup?id={appId}&country=us`，返回全量平均评分、评分总数、当前版本、图标、分类
- `route.ts` 并行调 Lookup（不阻塞评论采集），存 `results.appMetadata`，appName 优先用 `trackName`

**效果**：app 名称稳定获取；全量评分用于标注样本偏差；UI 可展示 app 上下文。

### 2. amp-api 自实现替代 app-store-scraper 为首选 fallback

**问题**：原 fallback 依赖第三方 `app-store-scraper`，不可控；任务要求"独立探索"数据获取方式。

**修复**：
- `collector.ts` 新增：
  - `fetchAmpApiToken()`：从 `apps.apple.com/{cc}/app/id{id}` 页面 `<script name="web-experience-app/config/environment">` 的 JSON 中提取 `MEDIA_API.token`，带全局正则兜底
  - `fetchWithAmpApi()`：带 `Authorization: Bearer {token}` 调用 `amp-api.apps.apple.com/v1/catalog/{cc}/apps/{id}/reviews`，每页 200 条，限 3 页（~600 条）
- fallback 链重构为：**RSS → amp-api 自实现 → app-store-scraper（仅兜底）**

**效果**：摆脱第三方库依赖，自己控制重试/分页/字段映射；字段更全（含开发者回复）；单页量大（200 vs RSS 50）；README 能写清"我独立实现了 amp-api 调用"。

### 3. 真实评分偏差强化 Data Limitations

**问题**：Data Limitations finding 只有静态规则（样本量/版本覆盖/情感偏差），缺少"样本是否代表整体"的定量评估。

**修复**：
- `analyzer.ts` 的 `analyzeFindings` + `generateStatisticalFindings` 新增可选 `appMetadata` 参数
- 当 `|样本均分 - 全量均分| >= 0.7` 时，Data Limitations finding 加偏差描述：
  > "样本平均评分 2.1 与 App Store 全量评分 4.2 偏差 2.1 分（样本偏低），采集到的评论可能不代表整体用户感受（全量 18534 条评分）"
- 当样本覆盖率 < 1% 且全量 > 1000 时，加覆盖率警告

**效果**：命中任务 #05"evaluate whether the available evidence is sufficient, and identify ... data limitations"——用真实全量数据定量评估样本代表性。

### 4. UI 展示 app 元数据卡片

**问题**：评审者打开结果看不到 app 上下文（名称/版本/全量评分），无法快速判断样本代表性。

**修复**：
- 新建 `src/components/AppMetadataCard.tsx`：图标 + 名称 + 卖家 + 当前版本 + **全量评分 vs 样本评分对比**
- 偏差 >= 0.7 时样本评分标红/绿 + "样本偏低/偏高，不代表整体"提示
- `page.tsx` 在 Tabs 之前展示

**效果**：评审者一眼看到"全量 4.2 vs 样本 2.1 ⚠ 样本偏低"，在阅读发现前就校准预期。

### 5. README 大幅扩充"数据采集方式"段落

**问题**：原 README 只写 RSS Feed 一段，未解释 fallback 策略、各源限制、为何不用其他方法——未命中评审点"explain their implementation"。

**修复**：README "📡 数据采集方式" 段落重写为：
- 引用任务 Important Notes 原文
- 三层 fallback 链图示（RSS → amp-api → scraper）+ Lookup 并行
- 各源详解表（认证/上限/优势/局限）
- "为何不使用其他方法"表（Playwright / App Store Connect API / 商业 ASO 平台）
- 采集纪律（区域约束/速率控制/失败透明）
- "为什么选择这些技术"表补采集策略决策行

**效果**：直接命中评审点"data source and its limitations" + "explore them independently and explain their implementation"。

### 6. 示例结果补 appMetadata

**问题**：无 API key 评审者加载示例结果时，AppMetadataCard 不显示（无 appMetadata），看不到偏差演示。

**修复**：
- `generate-sample-results.mjs` 加 mock appMetadata（fullAvg 4.2 vs 样本 ~2.5，演示偏差提示）
- F-012 Data Limitations finding 动态计算偏差描述
- 重新生成 `sample-results.json`（validation 仍 passed，0 issues）

### 7. 测试补强

**问题**：新增的 appMetadata 偏差检测逻辑无回归保护。

**修复**：`analyzer.test.ts` 新增 2 个测试：
- `flags sample-vs-full-store rating bias when appMetadata is provided`：偏差 >= 0.7 时验证描述包含"全量评分"和具体数值
- `does not flag bias when sample average is close to full-store average`：偏差 < 0.7 时验证不触发偏差描述

**测试总数**：53 → 55

## 验证结果

```
tsc --noEmit:  0 errors
eslint src/:   0 errors (3 warnings 均预存在)
vitest run:    55 passed (5 files), 474ms
```

## 涉及文件

| 操作 | 文件 |
|------|------|
| 修改 | `src/lib/types.ts` / `src/lib/collector.ts` / `src/app/api/analyze/route.ts` / `src/lib/analyzer.ts` / `src/app/page.tsx` / `README.md` / `scripts/generate-sample-results.mjs` / `src/lib/__tests__/analyzer.test.ts` / `public/data/sample-results.json` |
| 新建 | `src/components/AppMetadataCard.tsx` |

## 数据源全景

```
┌─────────────────────────────────────────────────────────────┐
│  评论数据采集链（三层 fallback，按优先级）                    │
├─────────────────────────────────────────────────────────────┤
│  1. RSS Feed (主源)                                          │
│     itunes.apple.com/rss/customerreviews · 官方 JSON · 500上限│
│         │ 失败/为空                                          │
│         ▼                                                    │
│  2. amp-api 自实现 (fallback 1)                              │
│     amp-api.apps.apple.com · Bearer token · ~600 条         │
│         │ token 提取失败                                     │
│         ▼                                                    │
│  3. app-store-scraper (兜底)                                 │
│     社区库 · 应对 Apple 页面改版                             │
├─────────────────────────────────────────────────────────────┤
│  并行：iTunes Lookup API → app 元数据（非评论）              │
│  全量评分 / 评分总数 / 版本 / 图标 → 标注样本偏差            │
└─────────────────────────────────────────────────────────────┘
```

**不使用**：Playwright/无头浏览器（任务明确反对）、App Store Connect API（需自有 app 权限）、商业 ASO 平台（付费）。

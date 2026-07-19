# 修复总结 — App Review Insights

对应 `REVIEW-报告.md` 中列出的 12 个问题，本次共完成 **9 项修复**（3 P0 + 4 P1 + 2 P2），其余 3 项 P2（LLM ID 反向填充、样例数据扩充、单元测试）为可后续跟进的增强项。

---

## P0 — 核心修复（3 项）

### 1. 版本规划被生成但完全丢弃 ✅

**问题**：`generatePRD()` 返回了 `versionPlan`（V1.0/V1.1/V2.0 主题与理由）和 `executiveSummary`，但 `route.ts` 只存了 `requirements`，这两个字段被丢弃；类型里没定义；`page.tsx` 没传给 `PRDView`（尽管渲染逻辑已写好）。

**修复**：
- `src/lib/types.ts`：新增 `VersionPlanItem` 接口；`PipelineResults` 增加 `versionPlan` 和 `executiveSummary` 字段
- `src/app/api/analyze/route.ts`：持久化 `prdResult.versionPlan` 和 `prdResult.executiveSummary`
- `src/app/page.tsx`：将这两个字段传给 `PRDView` 组件

**效果**：PRD 页面现在会显示执行摘要卡片 + 版本规划网格（V1.0/V1.1/V2.0 主题与理由）+ 按版本分组的需求列表。

### 2. 死代码 + README 与实现不符 ✅

**问题**：`src/lib/pipeline.ts`（SSE 实现）无人 import；`sse.ts` 的 `createSSEResponse` 只被它调用；README 宣称 "SSE 流式推送" 但实际是 2s 轮询。

**修复**：
- 删除 `src/lib/pipeline.ts`
- 从 `src/lib/sse.ts` 删除 `createSSEResponse`（保留 `generateId`/`extractAppId`/`isAppStoreUrl`）
- `README.md`：把 "SSE 流式推送" 改为 "异步 Job + 2 秒轮询"；技术架构表、项目结构、技术决策三处同步更新

### 3. 分类结果无 UI 展示 ✅

**问题**：`results.classifications`（每条评论的主题/情感/严重度/摘录）被计算存储，但 Tabs 里没有展示入口。任务 #10 要求展示中间交付物。

**修复**：
- 新建 `src/components/ClassificationView.tsx`：
  - 顶部统计卡片（总计/负面/正面/严重+重要）
  - 三维过滤器（情感 / 严重度 / 主题，可叠加）
  - 评论卡片列表：展示评分、版本、情感徽章、严重度徽章、功能区域、主题标签、关键原文摘录
- `src/app/page.tsx`：新增 "🏷️ 分类结果" Tab，位于"评论数据"和"分析发现"之间

---

## P1 — 功能性修复（4 项）

### 4. 分析目标不影响数据范围 ✅

**问题**：`analysisGoal` 仅拼进 LLM prompt，输入"低分评论"不会过滤 rating，输入"3.2.0版本"不会按版本筛选。

**修复**：
- 新建 `src/lib/goal-filter.ts`：
  - `parseAnalysisGoal(goal)` 解析自由文本为结构化过滤器
    - 低分/差评/负面/吐槽/1星/2星 → `maxRating = 2`
    - 3星/中评 → `maxRating = 3`
    - "版本 3.2.0" / "v3.2" → `version` 过滤（需显式版本意图）
    - "关键词" / 「关键词」引号短语 → `keywords` 过滤
  - `applyGoalFilter(reviews, filter)` 应用过滤
- `route.ts`：在 `cleanReviews` 后、`classifyReviews` 前应用过滤；过滤后子集送入分类和深度分析；过滤为空时回退全部评论并警告

### 5. 证据充分性动态评估 ✅

**问题**：有 confidence/冲突证据，但缺"数据局限性"的动态评估（如"仅30条样本""某版本无评论"）。

**修复**：`src/lib/analyzer.ts` 的 `generateStatisticalFindings` 新增 "Data Limitations & Evidence Sufficiency" finding，动态评估四类局限性：
- 样本量 < 30 → 统计结论可能不稳定
- 部分版本评论数 < 3 → 版本对比不可靠
- 负面占比 > 70% → 样本可能偏向活跃抱怨用户
- > 50% 评论缺版本信息 → 无法做版本维度分析

局限性同时写入 `uncertaintyNotes`，在 UI 上以橙色警告框展示。

### 6. validator 修订机制 ✅

**问题**：validator 只标记 warning，不删除/修订无支撑结论。

**修复**：
- `src/lib/types.ts`：`ValidationResult` 新增 `revokedRequirementIds` / `revokedTestCaseIds` / `downgradedFindingIds`
- `src/lib/validator.ts`：实现修订规则
  - **剔除**：`sourceFindingIds` 和 `sourceReviewIds` 均为空的 requirement（纯幻觉结论）
  - **连带剔除**：因 requirement 被剔除而孤立的 testCases
  - **降级**：`confidence < 0.5` 的 finding 标记为降级
- `route.ts`：validation 后应用修订——从 `results.requirements`/`results.testCases` 中实际移除被剔除项，给降级 finding 的 `uncertaintyNotes` 追加警告

### 7. 统计发现的摘录改为原文 ✅

**问题**：`generateStatisticalFindings` 中 "Most Discussed Feature Areas" 的 excerpts 是 `"订阅" mentioned in 5 reviews` 这种合成描述，违反 prompt 里"supportingExcerpts 必须是原文引用"的规则。

**修复**：用 `reviewMap` 根据 `reviewIds` 找到对应评论，取 `content.slice(0, 150)` 作为真实原文摘录；仅在找不到评论时才回退到合成描述。

---

## P2 — 改进项（2 项）

### 8. 采集器区域回退修正 ✅

**问题**：RSS 失败时回退到 `[country, "us", "gb"]`，"gb" 违反"美区数据"约束。

**修复**：改为 `[country, "us"]`，且仅当请求区域非 us 时才追加 us，绝不回退到 gb。

### 9. 采集器死代码清理 ✅

**问题**：`fetchWithScraper` 中 `if (allReviews.length === 0 && page > 3) break;` 永不触发（`maxPages = 3`，page 不可能 > 3）。

**修复**：改为 `if (allReviews.length === 0) break;`——当前页处理完仍无数据就停止分页。

---

## 未处理的 P2 项（可后续跟进）

| 项 | 说明 | 建议 |
|---|------|------|
| LLM ID 引用链反向填充 | 当前 finding→review 的 ID 由 LLM 输出，多跳易出错 | 可在 analyzeFindings 后用确定性匹配（title/content 比对）反向校验和修正 ID |
| 样例数据扩充 | `sample-reviews.json` 仅 15 条 | 扩充到 50+ 条，并缓存一份完整管道输出供无 Key 评审者查看 |
| 单元测试 | 无测试 | 优先为 `goal-filter`、`cleaner`、`validator` 的纯函数加 vitest 测试 |

---

## 验证结果

| 检查 | 结果 |
|------|------|
| `tsc --noEmit` | ✅ 通过（0 errors） |
| `eslint src/` | ✅ 通过（0 errors，3 warnings 均为预存在） |
| `next build` | ⚠️ 失败，但仅因沙箱无法访问 Google Fonts（`layout.tsx` 用 `next/font/google` Geist，预存在配置，非本次代码问题） |

## 涉及文件

| 操作 | 文件 |
|------|------|
| 修改 | `src/lib/types.ts`、`src/app/api/analyze/route.ts`、`src/app/page.tsx`、`src/lib/analyzer.ts`、`src/lib/validator.ts`、`src/lib/collector.ts`、`src/lib/sse.ts`、`README.md` |
| 新建 | `src/lib/goal-filter.ts`、`src/components/ClassificationView.tsx` |
| 删除 | `src/lib/pipeline.ts` |

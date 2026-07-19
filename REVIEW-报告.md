# App Review Insights — 改进分析报告

> 对比任务要求（retro-labs/app-review-insights）与你的实现（zhy715/app-review-insights），逐项核对后的改进建议。
> 审查范围：`src/lib/*`、`src/app/api/*`、`src/components/*`、`page.tsx`、`README.md`、git 历史。

---

## 一、严重问题（直接影响评分，建议优先修复）

### 🔴 1. 版本规划与执行摘要被生成但完全丢弃（核心交付物缺失）

这是当前最严重的 bug。任务要求 #06 明确要求 "produce a PRD, and split the scope into multiple versions when necessary"，但版本规划虽然由 LLM 生成了，却在管道中被丢弃，用户永远看不到。

**证据链：**

- `prd-generator.ts` 的 `generatePRD()` 返回 `{ requirements, versionPlan, executiveSummary }`，`versionPlan` 包含 V1.0/V1.1/V2.0 的主题、理由、需求归属。
- `src/app/api/analyze/route.ts` 第 193 行只保留了 requirements：
  ```ts
  results.requirements = prdResult.requirements;  // versionPlan 和 executiveSummary 被丢弃
  ```
- `src/lib/types.ts` 的 `PipelineResults` 接口根本没有 `versionPlan` / `executiveSummary` 字段。
- `PRDView.tsx` 明明接收 `versionPlan` 和 `executiveSummary` props 并有完整渲染逻辑（第 44-71 行），但 `page.tsx` 第 151 行只传了 requirements：
  ```tsx
  <PRDView requirements={results?.requirements} />  // 没传 versionPlan / executiveSummary
  ```

**修复方法：**
1. `types.ts` 的 `PipelineResults` 增加 `versionPlan` 和 `executiveSummary` 字段。
2. `route.ts` 和 `pipeline.ts` 中 `results.versionPlan = prdResult.versionPlan; results.executiveSummary = prdResult.executiveSummary;`
3. `page.tsx` 把这两个字段传给 `<PRDView>`。

---

### 🔴 2. 死代码 + README 与实际实现不符（SSE vs 轮询）

- `src/lib/pipeline.ts`（SSE 实现，导出 `createAnalyzePipeline`）**完全未被任何文件 import**，是死代码。
- `src/lib/sse.ts` 的 `createSSEResponse` 仅被这个死代码调用。
- README 宣称 "SSE 流式推送分析进度，UI 实时更新"，但实际 `page.tsx` 用 `setInterval` 每 2 秒轮询 `/api/analyze?jobId=`（见 page.tsx 第 76 行）。
- git log 显示 commit `dfe315f` "改为异步轮询模式"，但 README 未同步更新。

**影响：** 评审者读 README 会预期 SSE，看代码发现是轮询，再发现一个完全没用的 `pipeline.ts`，会质疑代码整洁度与维护性。

**修复方法：** 删除 `src/lib/pipeline.ts`，把 `sse.ts` 中实际用到的 `generateId`/`extractAppId`/`isAppStoreUrl` 迁移到 `utils.ts`；更新 README 把 "SSE" 改为 "异步轮询"。

---

### 🔴 3. 分类结果（classifications）未在 UI 展示

任务要求 #10：展示中间交付物，明确包括 "classification results"。

- `results.classifications` 被计算并存储，包含每条评论的主题、情感、严重度、功能区域、关键摘录。
- 但 `page.tsx` 的 Tabs 只有：评论数据 / 分析发现 / PRD / 测试用例 / 追溯链路 —— **没有"分类结果"tab**。
- 分类数据算了但没地方看，用户无法验证分类是否合理。

**修复方法：** 新增一个 `ClassificationView` 组件和对应 tab，展示每条评论的主题/情感/严重度，以及批次的 `topicSummary`。

---

## 二、重要问题（功能性缺陷，影响评分维度）

### 🟠 4. 分析目标（analysisGoal）未真正用于"确定分析范围"

任务要求 #01："Determine the analysis scope based on the user's goal and the available data."

**现状：** `analysisGoal` 仅作为一个字符串拼进 analyzer 和 prd-generator 的 prompt，对实际数据范围零影响。
- 用户输入"聚焦低分评论" → 不会过滤 rating ≤ 2 的评论。
- 用户输入"分析 3.2.0 版本反馈" → 不会按 version 筛选。
- 用户输入"订阅转化" → 不会聚焦含订阅主题的评论。

**修复方法：** 在 Stage 1 和 Stage 2 之间增加一个轻量的"范围确定"步骤：
- 用规则或一次小 LLM 调用解析 goal → 提取过滤条件（最低分、版本号、关键词）。
- 对 cleanedReviews 做确定性过滤，并把"因目标过滤掉 N 条"作为统计发现上报。
- 这样面试官用"低分评论"测试时，能明显看到数据范围变化。

---

### 🟠 5. 证据充分性评估不完整

任务要求 #05："Evaluate whether the available evidence is sufficient, and identify conflicting feedback, uncertainty, and data limitations."

**现状（部分实现）：**
- Finding 有 `confidence` / `uncertaintyNotes` / `conflictingReviewIds` —— 冲突反馈和不确定性有覆盖。
- FindingsView 也展示了置信度和矛盾证据数量。

**缺口：** 缺少"数据局限性"的运行时评估。README 的"已知局限性"是静态文档，不是针对当次分析的动态评估。任务要求的是后者。

**修复方法：** 在 analyzer 或 validator 中增加数据充分性检查并作为发现/校验项上报：
- "仅采集到 N 条评论，样本量偏小，结论置信度受限"
- "版本 X.Y.Z 无评论数据，无法评估该版本反馈"
- "非英文评论占比 N%，可能存在语言理解偏差"
- "1-2 星评论仅 N 条，低分问题分析证据不足"

---

### 🟠 6. 修订机制缺失——只标记不修订

任务要求 #08："Unsupported conclusions must be removed, revised, or explicitly marked as assumptions."

**现状：** `validator.ts` 只把问题追加到 `issues` 数组（warning/error），不删除、不修订、不自动标记假设。`isAssumption` 是 LLM 生成 PRD 时自判的，validator 只是再报一条 warning。没有"移除无支撑结论"的步骤。

**修复方法：** 在 validation 后增加一个 revision pass：
- `sourceFindingIds` 为空且 `isAssumption=false` 的 requirement → 自动设 `isAssumption=true` 并追加备注。
- 引用不存在的 review ID 的 finding → 剔除该 ID 或降低 confidence。
- validation.passed=false 时在 UI 用醒目方式提示"以下结论已标记为假设/已剔除无效引用"。

---

### 🟠 7. 统计发现的摘录不是原文（违反自己的规则）

`analyzer.ts` 的 `generateStatisticalFindings` 里：
- "Most Discussed Feature Areas" 的 `supportingExcerpts` 是 `"${name}" mentioned in ${count} reviews` —— 合成描述，不是评论原文。
- "Multilingual User Base" 的 `supportingExcerpts` 是空数组 `[]`。

而你的系统 prompt 自己规定 "supportingExcerpts 必须是原文引用——不能改写"。评审者检查追溯链时，统计发现会显得证据不合规。

**修复方法：** 统计发现也填充真实评论摘录（从对应的 supportingReviewIds 里取前几条 content 片段），或把统计发现的"摘录"字段重命名为 `evidenceDescription` 以示区别。

---

## 三、次要问题（改进建议，提升完成度）

### 🟡 8. LLM ID 引用链脆弱

分类 → 分析 → PRD → 测试，每一跳都依赖 LLM 正确复制 review ID。问题：
- analyzer 只传入前 50 条详细分类（`slice(0, 50)`），超过 50 条评论时其余对分析器不可见，可能漏掉问题。
- PRD 生成让 LLM 从 finding 里复制 `sourceReviewIds`，测试生成又让 LLM 从 requirement 复制 `sourceReviews` —— 多跳后 ID 容易丢失或错配。

**修复方法：** 用确定性代码反向填充 ID：
- requirement.sourceReviewIds = 合并其 sourceFindingIds 对应 findings 的 supportingReviewIds（去重），而非依赖 LLM 输出。
- testCase.sourceReviews = 其 requirementId 对应 requirement 的 sourceReviewIds。
- LLM 只负责生成语义内容，ID 引用由代码保证准确。

---

### 🟡 9. 样例数据偏小 + 无缓存完整结果

- `public/data/sample-reviews.json` 仅 15 条评论。
- 任务要求："include any necessary sample output or cached data so that interviewers can review the results even when external network access is unavailable."
- **现状：** 若评审者无 DeepSeek API Key，"快速测试"只能跑采集/清洗，AI 阶段会因无 Key 报错，看不到任何分析成果（发现/PRD/测试用例）。

**修复方法：** 提供一份缓存的完整管道输出（`public/data/sample-result.json`，含 findings/requirements/testCases/versionPlan/validation），并在无 Key 或 AI 失败时允许加载该缓存展示。这样无网无 Key 的评审者也能审查分析质量。

---

### 🟡 10. 采集器回退到非美区，违反任务约束

任务明确："the review data used in this assessment must come from the U.S. App Store storefront."

`collector.ts` 第 142 行回退逻辑：`const countries = [country, "us", "gb"];` —— 当 us 失败会尝试 `gb`（英国区），拿到的是英国评论，违反约束。

**修复方法：** 回退只在美国区内尝试（如换 sort、换 page），或回退失败时直接提示用户导入数据，不要跨区。

---

### 🟡 11. 采集器死代码

`collector.ts` 第 238 行 `if (allReviews.length === 0 && page > 3) break;` 在 `for (page=1; page<=3)` 循环里 `page > 3` 永远不成立，是死代码。建议清理。

---

### 🟡 12. 无单元测试

项目没有任何测试文件。清洗逻辑（ID 去重、Jaccard 相似度、语言检测）、URL 解析（`extractAppId`）、校验器（追溯链完整性）都是纯函数，非常适合单测。虽然任务未强制要求，但加上能体现工程质量，也能在评审者"喂入重复/冲突评论"时证明健壮性。

---

## 四、做得好的地方（保持）

| 维度 | 评价 |
|------|------|
| 数据采集 | RSS Feed + app-store-scraper 双方案，符合"不要只抓页面可见内容"的要求，README 解释清楚 |
| AI vs 规则的划分 | 清洗/校验用规则，分类/分析/PRD/测试用 LLM，划分合理且有文档说明 |
| 防幻觉措施 | JSON mode + Zod 校验 + 低温度 + 显式溯源 + 置信度标注 + source 区分 model/statistical，措施完整 |
| 追溯链数据模型 | Review → Classification → Finding → Requirement → TestCase 类型设计清晰，ID 可追溯 |
| 数据导入 | JSON/CSV 双格式，兼容数组和 {reviews:[]} 两种结构 |
| 容错 | 指数退避重试 + jitter + Retry-After 头尊重 + 每阶段独立重试 |
| Git 历史 | 24 个 commit 完整记录了迭代过程，符合"preserve a complete commit history" |
| 安全 | `.env*` 在 gitignore，env 文件未被追踪 |

---

## 五、修复优先级建议

| 优先级 | 问题 | 工作量 |
|--------|------|--------|
| P0 | #1 版本规划/摘要被丢弃 | 小（改 3 个文件，约 20 行） |
| P0 | #2 删死代码 + 改 README | 小 |
| P0 | #3 分类结果 tab | 中（新增 1 组件 + 1 tab） |
| P1 | #4 分析目标影响范围 | 中 |
| P1 | #5 数据局限性评估 | 中 |
| P1 | #6 修订机制 | 中 |
| P1 | #7 统计发现摘录 | 小 |
| P2 | #8 ID 引用确定性填充 | 中 |
| P2 | #9 缓存完整结果 | 中 |
| P2 | #10 采集器跨区 | 小 |
| P2 | #11-12 死代码清理/测试 | 小-中 |

**建议先把 P0 的三个问题修掉**（预计 1-2 小时），它们直接关系到核心交付物是否可见、代码是否整洁，是评审者第一眼会注意到的地方。

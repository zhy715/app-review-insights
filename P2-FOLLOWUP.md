# P2 跟进总结

继 9 项 P0/P1/P2 修复后，本轮跟进剩余 3 项 P2 增强项，全部完成并通过验证。

## P2-1: LLM ID 引用链确定性反向填充

### 问题
- `prd-generator.ts` 让 LLM 返回 `sourceFindingTitles`，代码用 title 反查 finding ID → LLM 改写 title 就会失配，`sourceFindingIds` 为空
- `test-generator.ts` 让 LLM 返回 `requirementTitle`，同样脆弱 → 失配时 fallback 成 `"REQ-UNKNOWN"` 产生孤儿测试用例
- 后果：被 validator 误判为"无证据需求"并可能被 revocation 机制剔除

### 修复
**prd-generator.ts**：
- schema 新增 `sourceFindingIds`（ID 数组，首选），保留 `sourceFindingTitles`（兜底）
- system prompt 要求 LLM 用 `[F-xxx]` ID 引用来源发现
- 代码先按 ID 精确匹配，未命中再按 normalised title 模糊匹配（trim + lowercase + collapse whitespace）

**test-generator.ts**：
- schema 新增 `requirementId`（首选），保留 `requirementTitle`（兜底）
- 同样双轨匹配，消除 `REQ-UNKNOWN` 孤儿

### 效果
- ID 是短而明确的 token，LLM 从 prompt 的 `[F-xxx]`/`[REQ-xxx]` 标记中复制即可，比改写 title 可靠得多
- title 兜底保证了即使 LLM 不遵循指令也能工作（向前兼容）
- 消除了"LLM 改写 title → sourceFindingIds 为空 → 被误判无证据 → 被剔除"的脆弱链路

---

## P2-2: 样例数据扩充 + 完整结果缓存

### 问题
- `sample-reviews.json` 仅 15 条，覆盖面不足
- 无缓存完整 pipeline 结果，无 API key 的评审者看不到完整 UI

### 修复

**数据扩充**（15 → 35 条）：
- 6 个版本覆盖：3.1.8 / 3.1.9 / 3.2.0 / 3.2.1 / 3.2.2 / 3.3.0 + 2 条无版本
- 多语言：1 条中文（¥68 订阅贵）+ 1 条西班牙语（崩溃反馈）
- 1 条重复评论（与 sample-002 内容相同，触发去重逻辑）
- 主题扩展：登录失败、社交挑战、新手引导、搜索、通知、冥想、睡眠追踪、数据导出、家庭计划、女性训练、存储管理、跨设备同步等

**生成脚本** `scripts/generate-sample-results.mjs`：
- 内联 cleanReviews 逻辑（去重 + 语言检测 + 标准化）→ 生成准确 cleanedReviews
- 关键词规则生成 classifications（确定性，无需 LLM）
- 手写 findings/requirements/testCases（代表 LLM 聚合输出）
- 内联 validateTraceability 逻辑 → 生成准确 validation
- 可重复运行：当样例数据变化时重新执行 `node scripts/generate-sample-results.mjs`

**预计算结果** `public/data/sample-results.json`：
- 35 raw → 34 cleaned（1 重复被移除）
- 34 classifications → 12 findings → 8 requirements → 16 testCases
- validation passed（0 issues，追溯链完整）

**UI 入口**：
- AppInput 新增 "📖 查看示例结果" 按钮
- page.tsx 新增 `handleLoadSampleResults`：fetch sample-results.json → 直接 setResults，跳过 LLM pipeline
- 无 API key 评审者一键查看完整 UI（分类/发现/PRD/版本规划/测试用例/追溯链）

---

## P2-3: 单元测试

### 问题
- 无测试框架，无单元测试，纯函数逻辑无回归保护

### 修复

**框架**：vitest@4.1.10（比 jest 更轻量，TS 原生支持，与 Next.js 兼容）
- `vitest.config.ts`：node env + `@` alias
- package.json 加 `test`/`test:watch` 脚本

**测试覆盖**（5 文件，53 用例）：

| 文件 | 用例数 | 覆盖内容 |
|------|--------|----------|
| `sse.test.ts` | 8 | generateId 零填充、extractAppId 各种 URL 格式、isAppStoreUrl |
| `cleaner.test.ts` | 13 | 空内容移除、ID 去重、内容相似度去重（>0.9）、中/日语言检测、whitespace 标准化、processImportedReviews 默认值与 rating 钳制 |
| `validator.test.ts` | 9 | 完整链路通过、broken link（review/finding/requirement/testcase）、revocation（无证据需求剔除）、downgrade（低置信度降级）、weak evidence 警告、assumption 警告、unsupportedRequirements |
| `goal-filter.test.ts` | 15 | 低分/差评/3星/版本/关键词解析（中英文）、组合意图、不误读 stray 数字为版本、applyGoalFilter 的 rating/version/keyword 过滤（AND/OR 逻辑）|
| `analyzer.test.ts` | 8 | 评分分析、功能区域摘录为原文（非合成）、多语言、数据局限性（样本量/版本覆盖/情感偏差）、source/confidence 一致性 |

**关键测试**：
- `analyzer.test.ts` 验证"Most Discussed Feature Areas"的摘录是真实评论内容而非 `"name" mentioned in N reviews` 合成描述（这是之前 P1-4 修复的回归保护）
- `validator.test.ts` 验证 revocation 机制（无证据需求 + 孤儿测试用例同步剔除）
- `goal-filter.test.ts` 验证"stray 数字不误读为版本"（如 "I want 3 improvements" 不触发 version 过滤）

**导出调整**：
- analyzer.ts 的 `generateStatisticalFindings` 从内部函数改为 `export function`，以便独立测试统计逻辑（无需 mock LLM）

---

## 验证结果

```
=== TSC ===         0 errors
=== ESLint ===      0 errors (3 warnings 均为预存在)
=== Tests ===       53 passed (5 files), 493ms
```

---

## 涉及文件

**修改**：
- `src/lib/prd-generator.ts` — schema + prompt + 双轨 ID 匹配
- `src/lib/test-generator.ts` — schema + prompt + 双轨 ID 匹配
- `src/lib/analyzer.ts` — 导出 `generateStatisticalFindings`
- `src/components/AppInput.tsx` — 新增 `onLoadSampleResults` prop + 按钮
- `src/app/page.tsx` — 新增 `handleLoadSampleResults` 函数
- `package.json` — 加 vitest devDep + test 脚本

**新建**：
- `scripts/generate-sample-results.mjs` — 确定性生成脚本
- `public/data/sample-results.json` — 预计算完整结果
- `vitest.config.ts` — 测试配置
- `src/lib/__tests__/sse.test.ts`
- `src/lib/__tests__/cleaner.test.ts`
- `src/lib/__tests__/validator.test.ts`
- `src/lib/__tests__/goal-filter.test.ts`
- `src/lib/__tests__/analyzer.test.ts`

**扩充**：
- `public/data/sample-reviews.json` — 15 → 35 条

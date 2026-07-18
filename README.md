# 🍎 App Review Insights — 用户评论分析与版本规划工具

从 iOS App Store 用户评论自动采集、AI 分析、到 PRD 和测试用例生成的**完整产品分析工作流**。

## 📋 功能概述

输入一个美区 App Store 应用链接和分析目标，系统自动完成：

```
评论采集 → 数据清洗 → AI 分类 → 问题发现 → PRD 生成 → 测试用例生成 → 追溯校验
```

### 核心特性

- **♻️ 自动采集**：通过 Apple 官方 RSS Feed 采集评论（无需 API Key）
- **🧹 智能清洗**：ID 去重 + 内容相似度去重 + 语言检测 + 文本规范化
- **🤖 AI 驱动分析**：DeepSeek 大模型进行主题发现、问题聚合、PRD 和测试用例生成
- **📊 证据支撑**：每条发现包含源评论 ID、评论摘录、置信度、矛盾证据
- **🔗 全链路追溯**：评论 → 发现 → 需求 → 测试用例 的完整追溯链
- **📁 数据导入**：支持 JSON/CSV 格式的评论数据导入
- **⚡ 实时进度**：SSE 流式推送分析进度，UI 实时更新

## 🚀 快速开始

### 前提条件

- Node.js 18+
- DeepSeek API Key（[获取地址](https://platform.deepseek.com/)）

### 安装与运行

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，填入你的 DEEPSEEK_API_KEY

# 3. 启动开发服务器
npm run dev

# 4. 打开浏览器
# http://localhost:3000
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥（必填） | - |
| `DEEPSEEK_BASE_URL` | API 端点 | `https://api.deepseek.com/v1` |
| `DEEPSEEK_MODEL` | 模型名称 | `deepseek-chat` |

## 🏗️ 技术架构

| 层 | 技术选型 |
|---|---------|
| 框架 | Next.js 16 (App Router) + TypeScript |
| 样式 | Tailwind CSS v4 + shadcn/ui |
| AI | DeepSeek API (`deepseek-chat`) — 通过 OpenAI SDK 调用 |
| 数据采集 | Apple RSS Feed (`itunes.apple.com/rss/customerreviews`) |
| 实时通信 | Server-Sent Events (SSE) — 基于 Web Streams API |
| 数据校验 | Zod — 运行时 Schema 校验所有 LLM 输出 |

### 项目结构

```
src/
├── app/
│   ├── api/
│   │   ├── analyze/route.ts    # 全流程分析 (SSE)
│   │   ├── reviews/route.ts    # 单独采集评论
│   │   └── import/route.ts     # JSON/CSV 导入
│   ├── layout.tsx
│   ├── page.tsx                # 主页面
│   └── globals.css
├── components/
│   ├── ui/                     # shadcn/ui 基础组件
│   ├── AppInput.tsx            # 输入面板
│   ├── ProgressPanel.tsx       # 进度展示
│   ├── ReviewTable.tsx         # 评论列表
│   ├── FindingsView.tsx        # 分析发现
│   ├── PRDView.tsx             # PRD 展示
│   ├── TestCaseView.tsx        # 测试用例
│   ├── TraceabilityGraph.tsx   # 追溯链路
│   └── DataImport.tsx          # 数据导入
└── lib/
    ├── pipeline.ts             # 管道编排器
    ├── collector.ts            # RSS 评论采集
    ├── cleaner.ts              # 数据清洗
    ├── classifier.ts           # LLM 主题分类
    ├── analyzer.ts             # LLM 问题分析
    ├── prd-generator.ts        # LLM PRD 生成
    ├── test-generator.ts       # LLM 测试用例生成
    ├── validator.ts            # 追溯链校验
    ├── llm.ts                  # DeepSeek 客户端
    ├── sse.ts                  # SSE 工具
    └── types.ts                # 类型定义
```

## 📡 数据采集方式

使用 Apple 官方提供的 **RSS Feed** 接口采集评论：

```
https://itunes.apple.com/us/rss/customerreviews/page={n}/id={appId}/sortby=mostRecent/json
```

### 特点

| 方面 | 说明 |
|------|------|
| **认证** | 无需认证，完全公开 |
| **上限** | 每国 500 条（10 页 × 50 条） |
| **内容** | 仅包含有文本的评论（不含纯星级评分） |
| **速率** | 连续 ~30-40 次请求后返回 403，页面间隔 2 秒 |
| **局限性** | 不含开发者回复、仅限最近 ~500 条、不含纯星级评分 |

## 🤖 AI 集成策略

### 模型配置

- **Provider**：DeepSeek（API 兼容 OpenAI SDK）
- **模型**：`deepseek-chat` (DeepSeek-V3)
- **SDK**：使用 `openai` npm 包，`baseURL` 指向 `https://api.deepseek.com/v1`

### 四个 AI 驱动阶段

| 阶段 | 功能 | Temperature |
|------|------|-------------|
| 分类 (classifier) | 逐批发现评论主题、情感、严重程度 | 0.15 |
| 分析 (analyzer) | 聚合分类结果为证据支撑的发现 | 0.15 |
| PRD 生成 | 根据发现生成产品需求、版本规划 | 0.2 |
| 测试生成 | 根据需求生成 Gherkin 风格测试用例 | 0.1 |

### 防幻觉措施

1. **结构化输出**：所有 LLM 调用使用 `response_format: { type: "json_object" }`
2. **Zod 校验**：LLM 返回后 Zod Schema 校验，不合格自动重试（最多 2 次）
3. **低温度**：事实性任务 temperature 0.1-0.2
4. **显式溯源**：每条发现必须含 `supportingReviewIds` 和 `supportingExcerpts`（原文摘录）
5. **置信度标注**：每条发现含 `confidence`（0-1）和 `source`（model/statistical）
6. **独立校验**：Step 7 独立校验追溯链，标记无支撑结论为假设

### 容错处理

- 指数退避重试（最多 3 次），含 jitter 防雷同
- 每阶段错误独立上报到 UI
- 支持用户通过导入 JSON/CSV 绕过数据采集失败

## 📊 数据模型

### 追溯链路

```
RawReview ──→ CleanedReview ──→ ReviewClassification
                                      │
                                      ▼
                                  Finding (含 supportingReviewIds + excerpts)
                                      │
                                      ▼
                               Requirement (含 sourceFindingIds + sourceReviewIds)
                                      │
                                      ▼
                                TestCase (含 requirementId + sourceReviews)
```

### 数据导入格式

**JSON 格式**：
```json
{
  "reviews": [
    {
      "id": "optional-id",
      "rating": 3,
      "title": "评论标题",
      "content": "评论正文（必填）",
      "author": "用户名",
      "date": "2024-01-15",
      "version": "1.2.3"
    }
  ]
}
```
也支持直接传入数组格式。

**CSV 格式**：需包含 `content`/`review`/`text` 列（评论正文），可选 `rating`、`title`、`author`、`date`、`version` 列。

## ⚠️ 已知局限性

1. **评论上限**：Apple RSS Feed 最多返回 500 条评论（10 页），分析结果基于有限样本
2. **纯星级评分缺失**：不包含只有星级没有文本的评分，可能导致偏差
3. **历史数据不可获取**：RSS Feed 只返回最近评论，旧评论滚动后不可访问
4. **网络依赖**：数据采集需要访问 Apple 服务器（国内可能需要代理）
5. **AI 成本**：每次完整分析消耗约 15K-25K tokens，需 DeepSeek API 额度
6. **语言限制**：AI 分析以英文为主（Prompt 为英文，非英文评论通过 LLM 理解）

## 📝 开发说明

### 为什么选择这些技术

| 决策 | 理由 |
|------|------|
| **直接使用 OpenAI SDK** 而非 Vercel AI SDK | DeepSeek 非 Vercel AI SDK 官方 provider；管道式分析场景不需要 chat UI 框架的抽象 |
| **规则清洗 + AI 分析结合** | 去重、语言检测等用确定性规则（高效可靠）；主题发现、问题聚合用 LLM（需要语义理解） |
| **SSE 而非 WebSocket** | 单向推送进度即可满足需求，SSE 更简单、HTTP 原生支持 |
| **shadcn/ui** | 基于 Tailwind，组件可定制，开发速度快 |

### AI vs 确定性规则的阶段划分

| 阶段 | 方法 | 原因 |
|------|------|------|
| 数据采集 | 确定性规则 | HTTP 请求 + JSON 解析，无需 AI |
| 数据清洗 | 确定性规则 | ID 去重、Jaccard 相似度、字符集语言检测均可精确实现 |
| 主题分类 | **AI (DeepSeek)** | 需要语义理解，动态发现主题而非固定分类 |
| 问题聚合 | **AI (DeepSeek)** | 需要理解上下文、合并相似问题、评估严重程度 |
| 统计发现 | 确定性规则 | 评分分布、话题频次、语言分布可精确计算 |
| PRD 生成 | **AI (DeepSeek)** | 需要从发现问题转化为可执行的产品需求 |
| 测试生成 | **AI (DeepSeek)** | 需要从需求推导测试场景和验收条件 |
| 追溯校验 | 确定性规则 | 检查 ID 引用完整性和覆盖率的精确计算 |

## 📄 许可

本项目为笔试/面试提交作品。

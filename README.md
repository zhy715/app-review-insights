# 🍎 App Review Insights — 用户评论分析与版本规划工具

[![CI](https://github.com/zhy715/app-review-insights/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/zhy715/app-review-insights/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](tsconfig.json)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](#)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fzhy715%2Fapp-review-insights&env=DEEPSEEK_API_KEY&envDescription=DeepSeek%20API%20key%20for%20LLM%20analysis&project-name=app-review-insights&repository-name=app-review-insights)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/zhy715/app-review-insights&env=DEEPSEEK_API_KEY)

> 🌐 **Live Demo:** [https://earnest-kulfi-06e92f.netlify.app](https://earnest-kulfi-06e92f.netlify.app) — 无需 API Key，点击页面内「📖 查看示例结果」即可浏览完整 UI

从 iOS App Store 用户评论自动采集、AI 分析、到 PRD 和测试用例生成的**完整产品分析工作流**。

> 没有 DeepSeek API Key？部署后或本地运行时，点击页面内的「📖 查看示例结果」按钮即可无需 Key 浏览完整的预计算分析结果。

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
- **⚡ 实时进度**：异步任务 + 2 秒间隔轮询，UI 实时更新分析进度
- **📊 证据充分性雷达图**：多维评估（样本量 / 版本覆盖 / 情感均衡 / 评分代表性 / 证据一致性 / 语言多样性）分析结果的证据可靠性
- **🔍 交互式追溯探索器**：点击任意节点高亮其完整追溯链（评论 ↔ 发现 ↔ 需求 ↔ 测试用例）
- **📥 交付物导出**：PRD 导出 Markdown，测试用例导出 Cucumber 兼容的 Gherkin `.feature` 文件

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

### 方式二：一键部署到 Vercel（推荐评审者使用）

点击顶部「Deploy with Vercel」按钮，或直接访问：

[一键部署](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fzhy715%2Fapp-review-insights&env=DEEPSEEK_API_KEY&envDescription=DeepSeek%20API%20key%20for%20LLM%20analysis&project-name=app-review-insights&repository-name=app-review-insights)

Vercel 会自动 fork 仓库并部署（Next.js 是 Vercel 原生框架，零配置）。部署时填入 `DEEPSEEK_API_KEY` 即可启用完整 LLM 分析；无 Key 也可访问，点页面内「📖 查看示例结果」加载预计算数据浏览完整 UI。

### 方式三：一键部署到 Netlify

点击顶部「Deploy to Netlify」按钮，或直接访问：

[一键部署](https://app.netlify.com/start/deploy?repository=https://github.com/zhy715/app-review-insights&env=DEEPSEEK_API_KEY)

Netlify 原生支持 Next.js 16 + Turbopack（[官方公告](https://www.netlify.com/changelog/next-js-16-is-ready-to-deploy-on-netlify)），通过 OpenNext adapter 零配置自动检测。仓库已含 `netlify.toml`（指定 Node 20 + build 命令）。部署时填入 `DEEPSEEK_API_KEY` 启用完整 LLM 分析；无 Key 也可访问，点页面内「📖 查看示例结果」加载预计算数据。

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
| 数据采集 | RSS Feed + amp-api 自实现 + iTunes Lookup API（三层 fallback） |
| 任务通信 | 异步 Job + HTTP 轮询（2s 间隔）— 后台执行长耗时管道，前端轮询状态 |
| 数据校验 | Zod — 运行时 Schema 校验所有 LLM 输出 |

### 项目结构

```
src/
├── app/
│   ├── api/
│   │   ├── analyze/route.ts    # 全流程分析（异步 Job + 轮询）
│   │   ├── reviews/route.ts    # 单独采集评论
│   │   └── import/route.ts     # JSON/CSV 导入
│   ├── layout.tsx
│   ├── page.tsx                # 主页面
│   └── globals.css
├── components/
│   ├── ui/                     # shadcn/ui 基础组件
│   ├── AppInput.tsx            # 输入面板
│   ├── ProgressPanel.tsx       # 进度展示
│   ├── AppMetadataCard.tsx     # App 元数据卡片（全量评分 vs 样本偏差）
│   ├── ReviewTable.tsx         # 评论列表
│   ├── ClassificationView.tsx  # 分类结果（中间交付物）
│   ├── FindingsView.tsx        # 分析发现
│   ├── EvidenceRadarChart.tsx  # 证据充分性雷达图
│   ├── PRDView.tsx             # PRD 展示（含版本规划 + Markdown 导出）
│   ├── TestCaseView.tsx        # 测试用例（含 Gherkin .feature 导出）
│   ├── TraceabilityGraph.tsx   # 追溯链路 + 交互式追溯探索器
│   └── DataImport.tsx          # 数据导入
└── lib/
    ├── collector.ts            # RSS 评论采集
    ├── cleaner.ts              # 数据清洗
    ├── goal-filter.ts          # 分析目标过滤（task #01）
    ├── classifier.ts           # LLM 主题分类
    ├── analyzer.ts             # LLM 问题分析
    ├── prd-generator.ts        # LLM PRD 生成
    ├── test-generator.ts       # LLM 测试用例生成
    ├── validator.ts            # 追溯链校验 + 修订机制
    ├── exporters.ts            # PRD Markdown / Gherkin 导出
    ├── llm.ts                  # DeepSeek 客户端
    ├── sse.ts                  # 通用工具（ID 生成、URL 解析）
    └── types.ts                # 类型定义
```

## 📡 数据采集方式

> **任务重要提示**：*"Review data should not be collected by scraping only the visible content of the page. There are more appropriate ways to retrieve App Store review data; candidates are expected to explore them independently and explain their implementation."*

本项目**不使用无头浏览器抓取页面可见内容**。评论数据通过 Apple 官方/半官方 API 采集，采用**三层 fallback 链**保证稳定性；app 元数据通过 iTunes Lookup API 并行获取（非评论源，用于标注样本偏差）。

### 采集链路（三层 fallback）

```
RSS Feed (主源)  ──失败/为空──▶  amp-api 自实现 (fallback 1)  ──失败──▶  app-store-scraper (兜底)
        │
        │  并行
        ▼
iTunes Lookup API  ──▶  app 元数据（全量评分/版本/图标，非评论）
```

### 数据源详解

**1. Apple RSS Customer Reviews Feed（主源）**

Apple 官方提供的 JSON Feed，**非页面抓取**——直接返回结构化 JSON。

```
https://itunes.apple.com/us/rss/customerreviews/page={n}/id={appId}/sortby=mostRecent/json
```

| 方面 | 说明 |
|------|------|
| **认证** | 无需认证，完全公开 |
| **上限** | 每国 500 条（10 页 × 50 条） |
| **内容** | 仅包含有文本的评论（不含纯星级评分） |
| **速率** | 连续 ~30-40 次请求后返回 403，页面间隔 2 秒 |
| **局限** | 不含开发者回复、仅限最近 ~500 条、某些 app 的 RSS 会返回空（Apple 已知 bug） |

**2. amp-api 自实现（fallback 1）**

Apple App Store 网页版内部调用的 API（`amp-api.apps.apple.com`）。本项目**自行实现 token 提取 + API 调用**，不依赖第三方库：

1. 请求 `apps.apple.com/us/app/id{appId}` 页面 HTML
2. 从 `<script name="web-experience-app/config/environment">` 的 JSON 中提取 `MEDIA_API.token`（带正则兜底）
3. 带 `Authorization: Bearer {token}` 调用 `amp-api.apps.apple.com/v1/catalog/us/apps/{appId}/reviews`

| 方面 | 说明 |
|------|------|
| **认证** | Bearer token（从 app 页面提取，非永久 key） |
| **上限** | 每页最多 200 条，本项目限 3 页 = ~600 条 |
| **优势** | 比 RSS 字段更全（含开发者回复）、单页量大、更稳定 |
| **局限** | 非官方公开 API，token 机制可能随页面改版失效（故保留 scraper 兜底） |

**3. app-store-scraper（兜底 fallback 2）**

社区维护的 npm 包，内部同样调用 amp-api，但由社区跟进 Apple 页面改版。仅当我们的 amp-api token 提取失败时启用——作为"belt and suspenders"层。

**4. iTunes Lookup API（元数据，非评论源）**

```
https://itunes.apple.com/lookup?id={appId}&country=us
```

返回 app 元数据：全量平均评分、评分总数、当前版本、图标、分类。与评论采集**并行**执行，用于：
- 稳定获取 app 名称（不再依赖 RSS 第一条）
- 在 UI 展示 app 上下文卡片
- 在 Data Limitations 发现中标注**样本评分 vs 全量评分偏差**（如"样本均分 2.1 vs 全量 4.2，样本偏向差评"）

### 为何不使用其他方法

| 方法 | 不采用原因 |
|------|-----------|
| **无头浏览器（Playwright/Puppeteer）** | 任务明确反对"scraping visible page content"；且慢、重、易被 Apple 反爬封禁，对目标站点负载高 |
| **App Store Connect API** | Apple 官方正式 API，字段最全；但需 App Store Connect JWT Key，且**只能查询自己拥有/管理的 app**——任务示例 app 非本人所有，无法使用 |
| **商业 ASO 平台（AppFollow/data.ai/Sensor Tower）** | 数据最全、覆盖多国；但付费且需注册，任务场景下过重 |

### 采集纪律

- **区域约束**：只采集美区（`us`）评论，不回退到 `gb` 等其他区——任务要求美区数据，混区会污染分析
- **速率控制**：RSS 页间 2 秒、amp-api 页间 1.5-2.5 秒、带 jitter，避免对 Apple 造成异常负载
- **失败透明**：任一源失败时在日志记录并降级到下一层，最终无数据时回退到样例数据并在 UI 明确标注

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
| **异步 Job + 轮询 而非 SSE/WebSocket** | 完整分析耗时 1-3 分钟，长连接易被代理/防火墙超时切断；后台 Job + 2s 轮询更稳健，且无状态恢复成本 |
| **三层采集 fallback（RSS → amp-api → scraper）** | RSS 是官方 JSON Feed（非页面抓取）但 500 条上限；amp-api 自实现摆脱第三方依赖、字段更全、体现独立探索；scraper 兜底应对 Apple 页面改版导致 token 失效 |
| **iTunes Lookup API 补元数据** | 稳定获取全量评分/版本/图标，用于 UI 上下文 + 标注样本偏差，命中任务"explain data source and limitations" |
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

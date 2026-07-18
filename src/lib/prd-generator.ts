import { z } from "zod";
import { llmCallWithSchema } from "./llm";
import { generateId } from "./sse";
import type { Finding, Requirement } from "./types";

// ============================================================
// Stage 5: LLM-Driven PRD Generation
// Converts findings into product requirements with priorities
// ============================================================

const PRDOutputSchema = z.object({
  requirements: z.array(
    z.object({
      title: z.string().max(200),
      description: z.string().max(2000).optional().default(""),
      priority: z.enum(["P0", "P1", "P2", "P3"]).optional().default("P2"),
      sourceFindingTitles: z.array(z.string()).optional().default([]),
      sourceReviewIds: z.array(z.union([z.string(), z.number()]).transform(String)).optional().default([]),
      acceptance: z.array(z.string().max(500)).optional().default(["验收通过"]),
      version: z.string().optional(),
      isAssumption: z.boolean().optional().default(false),
    })
  ).default([]),
  versionPlan: z.array(
    z.object({
      version: z.string().optional().default("V1.0"),
      theme: z.string().optional().default(""),
      requirementTitles: z.array(z.string()).optional().default([]),
      rationale: z.string().optional().default(""),
    })
  ).optional().default([]),
  executiveSummary: z.string().optional().default(""),
});

type PRDOutput = z.infer<typeof PRDOutputSchema>;

const SYSTEM_PROMPT = `你是一名资深产品经理，正在基于用户反馈分析撰写 PRD（产品需求文档）。你的需求必须基于真实的用户反馈，而非凭空猜测。

## 任务说明：
1. 仔细阅读用户评论分析得出的发现。
2. 撰写**具体、可执行的需求**以解决已识别的问题。每条需求必须包含：
   - **title**: 清晰、具体的中文需求名称
   - **description**: 需要构建/变更什么以及为什么。包含用户反馈的上下文。使用"用户反馈……"来确保证据基础。用中文撰写。
   - **priority**: P0（必须修复——严重Bug、核心流程中断）、P1（应该修复——重大摩擦、高影响）、P2（可以修复——小烦恼、边缘场景）、P3（未来——增强、优化）
   - **sourceFindingTitles**: 此需求对应的发现标题（使用确切的发现标题）
   - **sourceReviewIds**: 支撑此需求的原始评论 ID（来自发现的 supportingReviewIds）
   - **acceptance**: 2-5 条可衡量的验收标准。使用具体的、可测试的语言（例如："用户可在 3 秒内完成视频加载"，而非"性能更好"）。用中文。
   - **version**: 所属版本（V1.0、V1.1、V2.0）
   - **isAssumption**: 仅当此需求基于推测而非明确的用户证据时才为 true。大多数应为 false。

3. 创建**版本规划（versionPlan）**，将需求分组到逻辑合理的版本中：
   - V1.0: 关键修复和高影响改进（P0 + 部分 P1）
   - V1.1: 剩余 P1 + 高价值 P2
   - V2.0: 较大的功能新增和 P3 项目
   - 每个版本需要主题（theme）和理由（rationale），用中文。

## 优先级指南：
- P0: App 崩溃、支付失败、数据丢失、登录失败、核心功能不可用
- P1: 重大 UX 摩擦、高频需求、大量投诉、订阅转化障碍
- P2: 小烦恼、边缘场景Bug、低频需求
- P3: 锦上添花、外观优化、未来增强

## 重要规则：
- 需求必须基于提供的发现。不要臆造用户未报告的问题。
- 如果发现证据薄弱（低置信度、评论数少），应标注并考虑降低优先级。
- 验收标准必须可衡量、可测试。
- 请具体——"改善性能"太模糊。"将健身视频加载时间降至 3 秒以内"才具体。
- 所有文本内容（title、description、acceptance、executiveSummary、versionPlan 中的 theme 和 rationale）请用中文输出。

请以指定的 JSON 格式返回 PRD（requirements 数组、versionPlan 数组、executiveSummary 字符串）。`;

function buildUserPrompt(
  findings: Finding[],
  analysisGoal: string,
  appName: string
): string {
  const findingsText = findings
    .map(
      (f) =>
        `[${f.id}] ${f.title}
  Category: ${f.category} | Severity: ${f.severity} | Confidence: ${(f.confidence * 100).toFixed(0)}% | Source: ${f.source}
  Description: ${f.description}
  Supporting Reviews (${f.sampleCount}): ${f.supportingReviewIds.join(", ")}
  Excerpts: ${f.supportingExcerpts.map((e) => `"${e.slice(0, 200)}"`).join(" | ")}
  Conflicts: ${f.conflictingReviewIds.length > 0 ? f.conflictingReviewIds.join(", ") : "None"}
  ${f.uncertaintyNotes ? `Uncertainty: ${f.uncertaintyNotes}` : ""}`
    )
    .join("\n\n---\n\n");

  return `## Context
- App: ${appName}
- Analysis Goal: ${analysisGoal || "Comprehensive product improvement"}
- Total Findings: ${findings.length}

## Findings from User Review Analysis
${findingsText}

Based on these findings, create a PRD with:
1. A list of concrete, actionable product requirements (each linked to its source findings and reviews)
2. A version plan grouping requirements into logical releases
3. An executive summary

Focus on requirements that align with the analysis goal. Be specific and measurable in acceptance criteria.`;
}

export interface PRDResult {
  requirements: Requirement[];
  versionPlan: PRDOutput["versionPlan"];
  executiveSummary: string;
}

/**
 * Generate PRD from findings
 */
export async function generatePRD(
  findings: Finding[],
  analysisGoal: string,
  appName: string
): Promise<PRDResult> {
  const output = await llmCallWithSchema<PRDOutput>(
    {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(findings, analysisGoal, appName),
      temperature: 0.2,
      maxTokens: 8192,
    },
    PRDOutputSchema
  );

  // Map finding titles to finding IDs
  const findingMap = new Map(findings.map((f) => [f.title, f]));

  const requirements: Requirement[] = output.requirements.map((r, i) => {
    // Resolve finding titles to IDs
    const sourceFindingIds = r.sourceFindingTitles
      .map((title) => findingMap.get(title)?.id)
      .filter((id): id is string => id !== undefined);

    return {
      id: generateId("REQ", i),
      title: r.title,
      description: r.description,
      priority: r.priority,
      sourceFindingIds,
      sourceReviewIds: r.sourceReviewIds,
      acceptance: r.acceptance,
      version: r.version,
      isAssumption: r.isAssumption,
    };
  });

  return {
    requirements,
    versionPlan: output.versionPlan,
    executiveSummary: output.executiveSummary,
  };
}

import { z } from "zod";
import { llmCallWithSchema } from "./llm";
import { generateId } from "./sse";
import type {
  CleanedReview,
  ReviewClassification,
  Finding,
} from "./types";

// ============================================================
// Stage 4: LLM-Driven Issue Aggregation → Findings
// Consolidates classified reviews into evidence-backed findings
// ============================================================

const FindingsOutputSchema = z.object({
  findings: z.array(
    z.object({
      title: z.string().max(200),
      description: z.string().max(1000).optional().default(""),
      category: z.enum([
        "bug",
        "feature_request",
        "ux_issue",
        "performance",
        "pricing",
        "content",
        "other",
      ]).optional().default("other"),
      severity: z.string().optional().default("minor"),
      supportingReviewIds: z.array(z.union([z.string(), z.number()]).transform(String)).min(1).optional().default([]),
      supportingExcerpts: z.array(z.string()).min(1).optional().default([""]),
      conflictingReviewIds: z.array(z.union([z.string(), z.number()]).transform(String)).optional().default([]),
      confidence: z.number().min(0).max(1).optional().default(0.5),
      uncertaintyNotes: z.string().optional(),
      source: z.enum(["model", "statistical"]).optional().default("model"),
    })
  ).default([]),
  analysisSummary: z.string().default(""),
});

type FindingsOutput = z.infer<typeof FindingsOutputSchema>;

const SYSTEM_PROMPT = `你是一名资深产品经理，正在分析聚合后的用户反馈，以识别具体、可执行的产品发现。你的分析必须有证据支撑——每项发现必须由具体评论支持。

## 任务说明：
1. 仔细阅读提供的分类评论数据和主题总结。
2. 识别**5-15 个不同的发现**——这些是从多条评论中浮现的具体问题、需求或模式。
3. 对于每项发现，提供：
   - **title**: 简洁、具体的中文标题
   - **description**: 用中文写 2-4 句话，解释问题是什么、影响哪些用户、为什么重要
   - **category**: bug | feature_request | ux_issue | performance | pricing | content | other
   - **severity**: critical（核心功能不可用）| major（严重影响使用）| minor（小烦恼或边缘场景）
   - **supportingReviewIds**: 支持此发现的所有评论 ID
   - **supportingExcerpts**: 2-5 条最能说明此发现的原文摘录（保持原始语言）
   - **conflictingReviewIds**: 呈现相反证据的评论 ID（例如有人抱怨而有人喜欢同一功能）
   - **confidence**: 0.0-1.0 —— 你对这项发现为真的信心（0.9+ = 非常明确的模式，0.5-0.7 = 试探性结论，需要更多数据）
   - **uncertaintyNotes**: （可选）注明低置信度的原因、数据限制或混杂信号，用中文
   - **source**: 总是 "model"（统计发现另外处理）

## 重要规则：
- 每项发现必须至少有 2 条支持评论（总数据集很小时 1 条也可接受，但应标记低置信度）。
- supportingExcerpts 必须是原文引用——不能改写。
- 如果用户对同一功能表达相反意见，请在 conflictingReviewIds 中注明并降低置信度。
- 将相关的投诉合并为一项发现，而非每条评论各建一项。
- 特别注意 1-2 星的评论——它们包含最关键的反馈。
- 分析时应考虑用户的分析目标。
- 所有 title、description、uncertaintyNotes 和 analysisSummary 请用中文输出。

请以指定的 JSON 格式返回分析发现。`;

function buildUserPrompt(
  classifications: ReviewClassification[],
  reviews: CleanedReview[],
  analysisGoal: string,
  appName: string
): string {
  // Build a review lookup map for quick access
  const reviewMap = new Map(reviews.map((r) => [r.id, r]));

  // Aggregate statistics
  const topicCounts = new Map<string, number>();
  const sentimentCounts = { positive: 0, negative: 0, neutral: 0, mixed: 0 };
  const severityCounts = {
    critical: 0,
    major: 0,
    minor: 0,
    suggestion: 0,
  };
  const featureAreas = new Map<string, number>();

  for (const c of classifications) {
    for (const topic of c.topics) {
      topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
    }
    sentimentCounts[c.sentiment]++;
    if (c.severity) severityCounts[c.severity]++;
    if (c.featureArea) {
      featureAreas.set(c.featureArea, (featureAreas.get(c.featureArea) || 0) + 1);
    }
  }

  // Top topics
  const topTopics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([topic, count]) => `  - ${topic}: ${count} reviews`)
    .join("\n");

  // Detailed classification data
  const detailedClassifications = classifications
    .filter((c) => c.topics.length > 0 && c.topics[0] !== "unclear")
    .map((c) => {
      const review = reviewMap.get(c.reviewId);
      const rating = review?.rating || "N/A";
      return `[${c.reviewId}] Rating: ${rating}/5 | Sentiment: ${c.sentiment} | Severity: ${c.severity || "N/A"} | Area: ${c.featureArea || "N/A"}
  Topics: ${c.topics.join(", ")}
  Excerpts: ${c.keyExcerpts.map((e) => `"${e}"`).join(" | ")}`;
    })
    .join("\n\n---\n\n");

  return `## Analysis Context
- App: ${appName}
- Analysis Goal: ${analysisGoal || "General product analysis"}
- Total Reviews Analyzed: ${classifications.length}

## Statistical Overview
- Sentiment Distribution: ${JSON.stringify(sentimentCounts)}
- Severity Distribution: ${JSON.stringify(severityCounts)}

## Top Topics (by frequency)
${topTopics}

## Detailed Classifications
${detailedClassifications}

Based on this data, identify the key findings. Each finding must include supporting review IDs and verbatim excerpts. Prioritize findings that align with the analysis goal.`;
}

export interface AnalysisResult {
  findings: Finding[];
  analysisSummary: string;
}

/** Normalize LLM severity values to expected enum */
function normalizeSeverity(
  raw: string | undefined
): "critical" | "major" | "minor" {
  if (!raw) return "minor";
  const s = raw.toLowerCase().trim();
  const map: Record<string, "critical" | "major" | "minor"> = {
    critical: "critical", blocker: "critical", severe: "critical",
    major: "major", high: "major", significant: "major", important: "major",
    minor: "minor", medium: "minor", moderate: "minor", low: "minor",
    suggestion: "minor",
  };
  return map[s] || "minor";
}

/** Normalize LLM category values to expected enum */
function normalizeCategory(
  raw: string | undefined
): Finding["category"] {
  if (!raw) return "other";
  const s = raw.toLowerCase().trim().replace(/[^a-z_]/g, "_");
  const valid = ["bug", "feature_request", "ux_issue", "performance", "pricing", "content", "other"];
  return valid.includes(s) ? (s as Finding["category"]) : "other";
}

/**
 * Analyze classified reviews and produce evidence-backed findings
 */
export async function analyzeFindings(
  classifications: ReviewClassification[],
  reviews: CleanedReview[],
  analysisGoal: string,
  appName: string
): Promise<AnalysisResult> {
  // Also generate deterministic/statistical findings
  const statisticalFindings = generateStatisticalFindings(
    classifications,
    reviews
  );

  // LLM-driven analysis for nuanced findings
  const output = await llmCallWithSchema<FindingsOutput>(
    {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(classifications, reviews, analysisGoal, appName),
      temperature: 0.15,
      maxTokens: 16384,
    },
    FindingsOutputSchema
  );

  // Merge, normalize, and assign IDs
  const allFindings = [...statisticalFindings, ...output.findings].map(
    (f, i) => ({
      ...f,
      id: generateId("F", i),
      severity: normalizeSeverity(f.severity),
      category: normalizeCategory(f.category),
      sampleCount:
        "sampleCount" in f ? f.sampleCount : f.supportingReviewIds.length,
    })
  ) as Finding[];

  return {
    findings: allFindings,
    analysisSummary: output.analysisSummary,
  };
}

/**
 * Generate deterministic/statistical findings from the data
 * These are clearly marked as source: "statistical"
 */
function generateStatisticalFindings(
  classifications: ReviewClassification[],
  reviews: CleanedReview[]
): Omit<Finding, "id">[] {
  const findings: Omit<Finding, "id">[] = [];

  // Finding: Overall rating distribution
  const ratings = reviews.map((r) => r.rating);
  const avgRating = ratings.reduce((s, r) => s + r, 0) / ratings.length;
  const lowRatings = reviews.filter((r) => r.rating <= 2);
  const highRatings = reviews.filter((r) => r.rating >= 4);

  if (lowRatings.length > 0) {
    findings.push({
      title: `Overall Rating Analysis`,
      description: `Average rating: ${avgRating.toFixed(1)}/5. ${lowRatings.length}/${reviews.length} reviews (${((lowRatings.length / reviews.length) * 100).toFixed(0)}%) are 1-2 stars. ${highRatings.length} reviews are 4-5 stars.`,
      category: "other",
      severity: lowRatings.length > reviews.length * 0.3 ? "major" : "minor",
      supportingReviewIds: lowRatings.map((r) => r.id),
      supportingExcerpts: lowRatings.slice(0, 3).map((r) => r.content.slice(0, 200)),
      conflictingReviewIds: highRatings.map((r) => r.id),
      confidence: 1.0,
      source: "statistical",
      sampleCount: lowRatings.length,
    });
  }

  // Finding: Top feature areas by volume
  const areaCounts = new Map<string, { count: number; reviewIds: string[] }>();
  for (const c of classifications) {
    if (!c.featureArea) continue;
    const existing = areaCounts.get(c.featureArea);
    if (existing) {
      existing.count++;
      existing.reviewIds.push(c.reviewId);
    } else {
      areaCounts.set(c.featureArea, { count: 1, reviewIds: [c.reviewId] });
    }
  }

  const topAreas = [...areaCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  if (topAreas.length > 0) {
    findings.push({
      title: "Most Discussed Feature Areas",
      description: `The most frequently mentioned feature areas are: ${topAreas.map(([name, data]) => `${name} (${data.count} reviews)`).join(", ")}.`,
      category: "other",
      severity: "minor",
      supportingReviewIds: topAreas.flatMap(([, d]) => d.reviewIds),
      supportingExcerpts: topAreas.map(([name, data]) => `"${name}" mentioned in ${data.count} reviews`),
      conflictingReviewIds: [],
      confidence: 1.0,
      source: "statistical",
      sampleCount: topAreas.reduce((sum, [, d]) => sum + d.count, 0),
    });
  }

  // Finding: Language distribution
  const langCounts = new Map<string, number>();
  for (const r of reviews) {
    langCounts.set(r.language, (langCounts.get(r.language) || 0) + 1);
  }
  const nonEnglishCount = [...langCounts.entries()]
    .filter(([lang]) => lang !== "en")
    .reduce((s, [, c]) => s + c, 0);

  if (nonEnglishCount > 0) {
    findings.push({
      title: "Multilingual User Base",
      description: `${nonEnglishCount}/${reviews.length} reviews (${((nonEnglishCount / reviews.length) * 100).toFixed(0)}%) are in non-English languages, including: ${[...langCounts.entries()].filter(([l]) => l !== "en").map(([l, c]) => `${l} (${c})`).join(", ")}.`,
      category: "other",
      severity: "minor",
      supportingReviewIds: reviews.filter((r) => r.language !== "en").map((r) => r.id),
      supportingExcerpts: [],
      conflictingReviewIds: [],
      confidence: 1.0,
      source: "statistical",
      sampleCount: nonEnglishCount,
    });
  }

  return findings;
}

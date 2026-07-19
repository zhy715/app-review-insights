import { z } from "zod";
import { llmCallWithSchema } from "./llm";
import { generateId } from "./sse";
import type {
  CleanedReview,
  ReviewClassification,
  Finding,
  AppMetadata,
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

  // Detailed classification data — limit to keep prompt within bounds
  const detailedClassifications = classifications
    .filter((c) => c.topics.length > 0 && c.topics[0] !== "unclear")
    .slice(0, 50) // Max 50 reviews in prompt
    .map((c) => {
      const review = reviewMap.get(c.reviewId);
      const rating = review?.rating || "N/A";
      const shortExcerpts = c.keyExcerpts.map((e) => e.slice(0, 150));
      return `[${c.reviewId}] Rating: ${rating}/5 | Sentiment: ${c.sentiment} | Severity: ${c.severity || "N/A"} | Area: ${c.featureArea || "N/A"}
  Topics: ${c.topics.join(", ")}
  Excerpts: ${shortExcerpts.map((e) => `"${e}"`).join(" | ")}`;
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
  appName: string,
  appMetadata?: AppMetadata
): Promise<AnalysisResult> {
  // Also generate deterministic/statistical findings
  const statisticalFindings = generateStatisticalFindings(
    classifications,
    reviews,
    appMetadata
  );

  // LLM-driven analysis for nuanced findings
  const output = await llmCallWithSchema<FindingsOutput>(
    {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(classifications, reviews, analysisGoal, appName),
      temperature: 0.15,
      maxTokens: 4096,
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
 *
 * Exported for unit testing — the LLM-driven `analyzeFindings` wraps this
 * plus a model call, so testing the statistical part in isolation gives
 * deterministic coverage of the evidence-sufficiency and verbatim-excerpt
 * rules without mocking the LLM.
 */
export function generateStatisticalFindings(
  classifications: ReviewClassification[],
  reviews: CleanedReview[],
  appMetadata?: AppMetadata
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
    // Build a review lookup so excerpts can be VERBATIM quotes, not synthesised
    // descriptions like '"name" mentioned in N reviews' (which violated the
    // "supportingExcerpts must be original text" rule in the system prompt).
    const reviewMap = new Map(reviews.map((r) => [r.id, r]));

    findings.push({
      title: "Most Discussed Feature Areas",
      description: `The most frequently mentioned feature areas are: ${topAreas.map(([name, data]) => `${name} (${data.count} reviews)`).join(", ")}.`,
      category: "other",
      severity: "minor",
      supportingReviewIds: topAreas.flatMap(([, d]) => d.reviewIds),
      supportingExcerpts: topAreas.map(([name, data]) => {
        // Pick the first review that mentions this area and quote it verbatim
        const sample = data.reviewIds
          .map((id) => reviewMap.get(id))
          .find((r): r is CleanedReview => Boolean(r));
        return sample
          ? sample.content.slice(0, 150)
          : `${name} (${data.count} reviews)`; // last-resort fallback
      }),
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

  // Finding: Data Limitations & Evidence Sufficiency (task #05)
  // Dynamically assess the limits of this dataset so downstream readers know
  // how much weight to put on the other findings.
  const limitations: string[] = [];

  if (reviews.length < 30) {
    limitations.push(
      `样本量较小（仅 ${reviews.length} 条评论），统计性结论可能不稳定，建议扩大样本后复核`
    );
  }

  // Version coverage — flag when some versions have very thin data
  const versionCounts = new Map<string, number>();
  for (const r of reviews) {
    const v = r.version || "(未标注版本)";
    versionCounts.set(v, (versionCounts.get(v) || 0) + 1);
  }
  const noVersionCount = versionCounts.get("(未标注版本)") || 0;
  if (reviews.length > 0 && noVersionCount / reviews.length > 0.5) {
    limitations.push(
      `${((noVersionCount / reviews.length) * 100).toFixed(0)}% 的评论缺少版本信息，无法做版本维度分析`
    );
  }
  const knownVersionCounts = [...versionCounts.entries()].filter(
    ([v]) => v !== "(未标注版本)"
  );
  if (knownVersionCounts.length > 1) {
    const minCount = Math.min(...knownVersionCounts.map(([, c]) => c));
    if (minCount < 3) {
      limitations.push(
        `部分版本评论数过少（最少仅 ${minCount} 条），版本间对比结论需谨慎对待`
      );
    }
  }

  // Sentiment skew — a heavily skewed dataset may not represent typical users
  const negCount = reviews.filter((r) => r.rating <= 2).length;
  if (reviews.length > 0 && negCount / reviews.length > 0.7) {
    limitations.push(
      `负面评论占比过高（${((negCount / reviews.length) * 100).toFixed(0)}%），样本可能偏向活跃抱怨用户，不代表整体用户感受`
    );
  }

  // Sample-vs-full-store rating bias (task #05).
  // When iTunes Lookup gives us the full-store average rating, a large gap vs
  // the sample average means the collected reviews do not represent the overall
  // user base — RSS/amp-api tend to surface recent reviews, which skew negative
  // right after a bad release. This is exactly the kind of "data limitation"
  // the task wants flagged dynamically rather than assumed.
  if (appMetadata && reviews.length > 0) {
    const sampleAvg = avgRating;
    const fullAvg = appMetadata.averageUserRating;
    const gap = Math.abs(sampleAvg - fullAvg);
    if (gap >= 0.7) {
      const direction = sampleAvg < fullAvg ? "偏低" : "偏高";
      limitations.push(
        `样本平均评分 ${sampleAvg.toFixed(1)} 与 App Store 全量评分 ${fullAvg.toFixed(1)} 偏差 ${gap.toFixed(1)} 分（样本${direction}），采集到的评论可能不代表整体用户感受（全量 ${appMetadata.userRatingCount} 条评分）`
      );
    }
    // Flag when the sample is a tiny fraction of the full-store ratings.
    const coverage = reviews.length / Math.max(appMetadata.userRatingCount, 1);
    if (coverage < 0.01 && appMetadata.userRatingCount > 1000) {
      limitations.push(
        `样本仅覆盖全量 ${appMetadata.userRatingCount} 条评分的 ${(coverage * 100).toFixed(2)}%，定量结论需结合全量评分综合判断`
      );
    }
  }

  if (limitations.length > 0) {
    findings.push({
      title: "Data Limitations & Evidence Sufficiency",
      description: `本次分析的数据局限性：${limitations.join("；")}。请在解读其他发现时将这些限制纳入考量。`,
      category: "other",
      severity: "minor",
      supportingReviewIds: [],
      supportingExcerpts: [],
      conflictingReviewIds: [],
      confidence: 1.0,
      source: "statistical",
      sampleCount: reviews.length,
      uncertaintyNotes: limitations.join("；"),
    });
  }

  return findings;
}

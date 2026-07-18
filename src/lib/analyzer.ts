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
      supportingExcerpts: z.array(z.string()).min(1).max(5).optional().default([""]),
      conflictingReviewIds: z.array(z.union([z.string(), z.number()]).transform(String)).optional().default([]),
      confidence: z.number().min(0).max(1).optional().default(0.5),
      uncertaintyNotes: z.string().optional(),
      source: z.enum(["model", "statistical"]).optional().default("model"),
    })
  ).default([]),
  analysisSummary: z.string().default(""),
});

type FindingsOutput = z.infer<typeof FindingsOutputSchema>;

const SYSTEM_PROMPT = `You are a senior product manager analyzing aggregated user feedback to identify concrete, actionable findings. Your analysis must be evidence-grounded — every finding must be backed by specific reviews.

## Instructions:
1. Review the classified review data and topic summaries provided.
2. Identify **5-15 distinct findings** — these are concrete problems, requests, or patterns that emerge from multiple reviews.
3. For each finding, provide:
   - **title**: Concise, specific description of the finding
   - **description**: 2-4 sentences explaining the issue, who it affects, and why it matters
   - **category**: bug | feature_request | ux_issue | performance | pricing | content | other
   - **severity**: critical (blocks core app usage) | major (significant friction) | minor (annoyance or edge case)
   - **supportingReviewIds**: IDs of ALL reviews that support this finding
   - **supportingExcerpts**: 2-5 verbatim quotes from reviews that best illustrate this finding
   - **conflictingReviewIds**: IDs of reviews that present contrary evidence (e.g., users who like a feature others complain about)
   - **confidence**: 0.0-1.0 — how confident are you that this is a real finding (0.9+ = very clear pattern, 0.5-0.7 = tentative, needs more data)
   - **uncertaintyNotes**: (optional) Note any reasons for low confidence, data limitations, or mixed signals
   - **source**: always "model" for these findings (statistical findings are handled separately)

## Important Rules:
- Every finding MUST have at least 2 supporting reviews (unless the total dataset is very small, then 1 is acceptable but mark confidence low).
- supportingExcerpts MUST be verbatim quotes from the source reviews — do NOT paraphrase.
- If users express contradictory opinions about the same feature, note this in conflictingReviewIds and reduce confidence.
- Group related complaints into a single finding rather than creating one per review.
- Pay special attention to reviews rated 1-2 stars — they contain the most critical feedback.
- Consider the analysis goal when prioritizing findings.
- For reviews in non-English languages, the excerpts stay in the original language but the finding title/description should be in English.

Return your findings as a valid JSON object with the specified schema.`;

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
      maxTokens: 8192,
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

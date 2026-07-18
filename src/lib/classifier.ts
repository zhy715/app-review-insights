import { z } from "zod";
import { llmCallWithSchema } from "./llm";
import type { CleanedReview, ReviewClassification } from "./types";

// ============================================================
// Stage 3: LLM-Driven Review Classification
// Discovers topics, sentiment, severity per review batch
// ============================================================

const ClassificationOutputSchema = z.object({
  classifications: z.array(
    z.object({
      reviewId: z.union([z.string(), z.number()]).transform(String),
      topics: z.array(z.string()).max(10).optional().default([]),
      sentiment: z.enum(["positive", "negative", "neutral", "mixed"]).optional().default("neutral"),
      severity: z.string().optional().default("minor"),
      featureArea: z.string().max(100).optional().default(""),
      keyExcerpts: z.array(z.string()).max(3).optional().default([]),
    })
  ).default([]),
  topicSummary: z.string().default(""),
});

type ClassificationOutput = z.infer<typeof ClassificationOutputSchema>;

const SYSTEM_PROMPT = `你是一名移动应用用户反馈分析专家。你的任务是对每条用户评论进行分类，识别讨论的主题、整体情感以及所提问题的严重程度。

## 任务说明：
1. 为每条评论识别 1-5 个**主题**——这些应该是具体、明确的功能或方面（例如："订阅价格"、"健身视频卡顿"、"内购Bug"、"界面导航"、"教练音频质量"）。尽可能使用用户的原话。
2. 标注**情感**："positive"（用户满意）、"negative"（用户不满）、"neutral"（客观陈述）或 "mixed"（褒贬皆有）。
3. 为负面/褒贬混合的评论标注**严重程度**："critical"（App无法使用）、"major"（严重影响核心使用）、"minor"（小烦恼）、"suggestion"（功能建议）。
4. 识别主要**功能区域**（如："健身"、"订阅"、"引导页"、"设置"、"社区"等）。
5. 提取 1-3 条**关键摘录**——最能体现用户核心观点的原文引用。必须是评论原文，不能改写。
6. 用中文提供一段简短的**主题总结**（topicSummary），概括本批次评论的主要主题。

## 重要规则：
- 分类仅基于评论中明确提到的内容，不要推测用户未提及的问题。
- 主题应从内容中动态发现——不要将评论强行塞入预设的分类体系。
- 所有 topicSummary 和 featureArea 请用中文输出。
- 如果评论太短、语义模糊或无意义，将其标注为 topics: ["不明确"]，sentiment: "neutral"。

请以指定的 JSON 格式返回分析结果。`;

function buildUserPrompt(reviews: CleanedReview[], batchIndex: number, totalBatches: number): string {
  const reviewText = reviews
    .map(
      (r) =>
        `[ID: ${r.id}] [Rating: ${r.rating}/5] [Version: ${r.version || "N/A"}] [Lang: ${r.language}]\nTitle: ${r.title}\nContent: ${r.normalizedContent}\n---`
    )
    .join("\n\n");

  return `Analyze the following batch of user reviews (batch ${batchIndex + 1} of ${totalBatches}).

${reviewText}

Return a JSON object with:
- "classifications": an array where each element contains the reviewId, discovered topics, sentiment, severity (if applicable), featureArea, and exact key excerpts
- "topicSummary": a 1-2 sentence overview of the dominant themes in this batch

Ensure all "keyExcerpts" entries are verbatim quotes from the reviews, not your own words.`;
}

export interface ClassificationResult {
  classifications: ReviewClassification[];
  topicSummary: string;
}

/**
 * Normalize LLM-returned severity strings to our expected enum values.
 * DeepSeek may return values like "high", "medium", "low" instead of expected values.
 */
function normalizeSeverity(
  raw: string | undefined
): "critical" | "major" | "minor" | "suggestion" | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase().trim();
  const map: Record<string, "critical" | "major" | "minor" | "suggestion"> = {
    critical: "critical",
    blocker: "critical",
    severe: "critical",
    major: "major",
    high: "major",
    significant: "major",
    important: "major",
    minor: "minor",
    medium: "minor",
    moderate: "minor",
    low: "minor",
    suggestion: "suggestion",
    enhancement: "suggestion",
    nice_to_have: "suggestion",
    feature: "suggestion",
  };
  return map[s] || "minor";
}

/**
 * Classify a batch of reviews using LLM
 */
export async function classifyReviews(
  reviews: CleanedReview[],
  batchSize: number = 25,
  onProgress?: (batchIndex: number, totalBatches: number) => void
): Promise<ClassificationResult[]> {
  const results: ClassificationResult[] = [];
  const totalBatches = Math.ceil(reviews.length / batchSize);

  for (let i = 0; i < totalBatches; i++) {
    const batch = reviews.slice(i * batchSize, (i + 1) * batchSize);

    onProgress?.(i, totalBatches);

    const output = await llmCallWithSchema<ClassificationOutput>(
      {
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(batch, i, totalBatches),
        temperature: 0.15,
        maxTokens: 4096,
      },
      ClassificationOutputSchema
    );

    // Enrich classifications — normalize severity values from LLM
    const classifications: ReviewClassification[] = output.classifications.map(
      (c) => ({
        reviewId: c.reviewId,
        topics: c.topics.filter((t) => t !== "unclear"),
        sentiment: c.sentiment,
        severity: normalizeSeverity(c.severity),
        featureArea: c.featureArea,
        keyExcerpts: c.keyExcerpts,
      })
    );

    results.push({
      classifications,
      topicSummary: output.topicSummary,
    });
  }

  return results;
}

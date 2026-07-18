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
      topics: z.array(z.string()).max(10).default([]),
      sentiment: z.enum(["positive", "negative", "neutral", "mixed"]).default("neutral"),
      severity: z.string().optional().default("minor"),
      featureArea: z.string().max(100).optional().default(""),
      keyExcerpts: z.array(z.string()).max(3).default([]),
    })
  ).default([]),
  topicSummary: z.string().default(""),
});

type ClassificationOutput = z.infer<typeof ClassificationOutputSchema>;

const SYSTEM_PROMPT = `You are a product analyst specializing in mobile app user feedback analysis. Your task is to classify each user review according to the topics it discusses, the overall sentiment, and the severity of any issue raised.

## Instructions:
1. For each review, identify 1-5 **topics** — these should be specific, concrete features or aspects (e.g., "subscription pricing", "workout video buffering", "in-app purchase bug", "UI navigation", "trainer audio quality"). Use the user's own language where possible.
2. Assign a **sentiment**: "positive" (user is happy/satisfied), "negative" (user is frustrated/disappointed), "neutral" (factual/balanced), or "mixed" (both praise and criticism).
3. Assign a **severity** only for negative/mixed reviews: "critical" (app is broken/unusable), "major" (significant problem affecting core use), "minor" (annoyance), "suggestion" (feature request or improvement idea).
4. Identify the primary **featureArea** (e.g., "workout", "subscription", "onboarding", "settings", "social").
5. Extract 1-3 **keyExcerpts** — verbatim quotes from the review that best illustrate the user's main point. These MUST be exact text from the review, not paraphrases.
6. Provide a brief **topicSummary** of the dominant themes across this entire batch.

## Important Rules:
- Base classifications ONLY on what is explicitly stated in the reviews. Do not infer problems the user did not mention.
- Topics should be dynamically discovered from the content — do not force reviews into a predefined taxonomy.
- For non-English reviews, identify topics in English but keep excerpts in the original language.
- If a review is too short, vague, or nonsensical, classify it with topics: ["unclear"] and sentiment: "neutral".`;

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

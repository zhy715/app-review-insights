import type { CleanedReview } from "./types";

// ============================================================
// Analysis Goal Filter (task #01)
// Parses a free-text analysis goal into a concrete review filter
// so the goal actually narrows the SCOPE of the data analysed,
// not just the prompt sent to the LLM.
// ============================================================

export interface GoalFilter {
  maxRating?: number; // keep only reviews with rating <= maxRating
  version?: string; // keep only reviews matching this app version
  keywords?: string[]; // keep only reviews whose content contains these
  description: string; // human-readable summary of the filter
  applied: boolean; // whether any narrowing rule was set
}

/**
 * Parse an analysis goal string into a concrete review filter.
 *
 * Recognised intents (Chinese + English):
 *  - 低分/差评/负面/吐槽/1星/2星  → maxRating = 2
 *  - 3星/中评                     → maxRating = 3
 *  - 版本 3.2.0 / v3.2 / version 3.2.0 → version filter
 *  - "关键词" / 「关键词」 quoted phrases → keyword filter
 */
export function parseAnalysisGoal(goal: string): GoalFilter {
  const raw = (goal || "").trim();
  if (!raw) {
    return { description: "无过滤，分析全部评论", applied: false };
  }

  const g = raw.toLowerCase();
  const filter: GoalFilter = { description: "", applied: false };

  // Rating intent
  if (
    /(低分|差评|负面|不满|吐槽|抱怨|差评如潮|低评分)/.test(g) ||
    /(^|\D)(1|2)\s*星/.test(g) ||
    /(1|2)-star|one star|two star|negative review/.test(g)
  ) {
    filter.maxRating = 2;
  } else if (/(3\s*星|3-star|three star|中评)/.test(g)) {
    filter.maxRating = 3;
  }

  // Version intent — only trigger when the user explicitly talks about a
  // version, otherwise a stray "3.0" in the goal text would be misread.
  if (/(版本|version|v\d)/i.test(raw)) {
    const versionMatch = raw.match(/(\d+\.\d+(?:\.\d+)?)/);
    if (versionMatch) {
      filter.version = versionMatch[1];
    }
  }

  // Keyword intent — pull quoted phrases out of the goal text
  const quoted = raw.match(/["“「『]([^"”」』]{2,})["”」』]/g);
  if (quoted) {
    filter.keywords = quoted
      .map((q) => q.replace(/["“”「」『』]/g, ""))
      .filter((kw) => kw.length > 0);
  }

  const parts: string[] = [];
  if (filter.maxRating !== undefined) parts.push(`rating ≤ ${filter.maxRating}`);
  if (filter.version) parts.push(`version = ${filter.version}`);
  if (filter.keywords && filter.keywords.length > 0) {
    parts.push(`keywords = ${filter.keywords.join(", ")}`);
  }
  filter.applied = parts.length > 0;
  filter.description = filter.applied
    ? parts.join("；")
    : "无过滤，分析全部评论";

  return filter;
}

/**
 * Apply a goal filter to a list of cleaned reviews.
 * Returns the filtered subset (or the original list if no filter applies).
 */
export function applyGoalFilter(
  reviews: CleanedReview[],
  filter: GoalFilter
): CleanedReview[] {
  let result = reviews;
  if (filter.maxRating !== undefined) {
    result = result.filter((r) => r.rating <= filter.maxRating!);
  }
  if (filter.version) {
    result = result.filter((r) => r.version === filter.version);
  }
  if (filter.keywords && filter.keywords.length > 0) {
    const kws = filter.keywords.map((k) => k.toLowerCase());
    result = result.filter((r) =>
      kws.some((kw) => r.content.toLowerCase().includes(kw))
    );
  }
  return result;
}

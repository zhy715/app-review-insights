import type { RawReview, CleanedReview } from "./types";

// ============================================================
// Review Cleaner: Deduplication + Normalization
// ============================================================

/**
 * Simple language detection based on character sets
 * Returns ISO 639-1 language code
 */
function detectLanguage(text: string): string {
  // Check for CJK characters
  const cjkCount = (text.match(/[一-鿿㐀-䶿豈-﫿]/g) || []).length;
  const japaneseCount = (text.match(/[぀-ゟ゠-ヿ]/g) || []).length;
  const koreanCount = (text.match(/[가-힯ᄀ-ᇿ]/g) || []).length;
  const totalChars = text.replace(/\s/g, "").length;

  if (totalChars === 0) return "en";

  const cjkRatio = (cjkCount + japaneseCount + koreanCount) / totalChars;

  if (cjkRatio > 0.3) {
    if (japaneseCount > cjkCount && japaneseCount > koreanCount) return "ja";
    if (koreanCount > cjkCount && koreanCount > japaneseCount) return "ko";
    return "zh";
  }

  // Check for Cyrillic
  const cyrillicCount = (text.match(/[Ѐ-ӿ]/g) || []).length;
  if (cyrillicCount / totalChars > 0.3) return "ru";

  // Default to English
  return "en";
}

/**
 * Normalize review content: trim, collapse whitespace, remove excessive punctuation
 */
function normalizeContent(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/([.!?])\1{2,}/g, "$1") // Collapse excessive punctuation
    .replace(/\n{3,}/g, "\n\n"); // Collapse excessive newlines
}

/**
 * Calculate text similarity using Jaccard similarity on word sets
 * Returns 0-1 where 1 is identical
 */
function textSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 2));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}

export interface CleaningStats {
  totalRaw: number;
  duplicatesById: number;
  duplicatesByContent: number;
  emptyContent: number;
  finalCount: number;
}

/**
 * Clean and deduplicate raw reviews
 */
export function cleanReviews(rawReviews: RawReview[]): {
  reviews: CleanedReview[];
  stats: CleaningStats;
} {
  const stats: CleaningStats = {
    totalRaw: rawReviews.length,
    duplicatesById: 0,
    duplicatesByContent: 0,
    emptyContent: 0,
    finalCount: 0,
  };

  // Step 1: Remove reviews with empty content
  const nonEmpty = rawReviews.filter((r) => {
    const hasContent = r.content.trim().length > 0;
    if (!hasContent) stats.emptyContent++;
    return hasContent;
  });

  // Step 2: Deduplicate by ID
  const seenIds = new Set<string>();
  const idDeduped: RawReview[] = [];

  for (const review of nonEmpty) {
    if (seenIds.has(review.id)) {
      stats.duplicatesById++;
      continue;
    }
    seenIds.add(review.id);
    idDeduped.push(review);
  }

  // Step 3: Deduplicate by content similarity (> 0.9 threshold)
  const contentDeduped: RawReview[] = [];
  const SIMILARITY_THRESHOLD = 0.9;

  for (const review of idDeduped) {
    const isDuplicate = contentDeduped.some(
      (existing) =>
        textSimilarity(review.content, existing.content) > SIMILARITY_THRESHOLD
    );
    if (isDuplicate) {
      stats.duplicatesByContent++;
      continue;
    }
    contentDeduped.push(review);
  }

  // Step 4: Normalize and detect language
  const cleaned: CleanedReview[] = contentDeduped.map((review) => {
    const normalizedContent = normalizeContent(review.content);
    // Combine title + content for language detection
    const langText = `${review.title} ${review.content}`;
    const language = detectLanguage(langText);

    return {
      ...review,
      language,
      isDuplicate: false, // Already removed duplicates
      normalizedContent,
    };
  });

  stats.finalCount = cleaned.length;
  return { reviews: cleaned, stats };
}

/**
 * Deduplicate and assign IDs to imported reviews (JSON/CSV)
 */
export function processImportedReviews(
  data: Partial<RawReview>[]
): RawReview[] {
  return data
    .filter(
      (r): r is RawReview =>
        typeof r.content === "string" && r.content.trim().length > 0
    )
    .map((r, index) => ({
      id: r.id || `imported-${index}`,
      rating: typeof r.rating === "number" ? Math.max(1, Math.min(5, Math.round(r.rating))) : 3,
      title: r.title || "",
      content: r.content!,
      author: r.author || "Imported",
      date: r.date || new Date().toISOString(),
      version: r.version,
    }));
}

import { describe, it, expect } from "vitest";
import { generateStatisticalFindings } from "../analyzer";
import type { CleanedReview, ReviewClassification, AppMetadata } from "../types";

function makeCleaned(over: Partial<CleanedReview> = {}): CleanedReview {
  return {
    id: "r1",
    rating: 3,
    title: "t",
    content: "This is review content about the app.",
    author: "a",
    date: "2024-01-01",
    version: "1.0.0",
    language: "en",
    isDuplicate: false,
    normalizedContent: "This is review content about the app.",
    ...over,
  };
}

function makeClassification(over: Partial<ReviewClassification> = {}): ReviewClassification {
  return {
    reviewId: "r1",
    topics: ["topic"],
    sentiment: "neutral",
    severity: "minor",
    featureArea: "general",
    keyExcerpts: ["excerpt"],
    ...over,
  };
}

describe("generateStatisticalFindings", () => {
  it("produces a rating-analysis finding when low ratings exist", () => {
    const reviews = [
      makeCleaned({ id: "r1", rating: 1, content: "terrible" }),
      makeCleaned({ id: "r2", rating: 2, content: "bad" }),
      makeCleaned({ id: "r3", rating: 5, content: "great" }),
    ];
    const findings = generateStatisticalFindings([], reviews);
    const ratingFinding = findings.find((f) => f.title === "Overall Rating Analysis");
    expect(ratingFinding).toBeDefined();
    expect(ratingFinding!.source).toBe("statistical");
    expect(ratingFinding!.supportingReviewIds).toContain("r1");
    expect(ratingFinding!.supportingReviewIds).toContain("r2");
    expect(ratingFinding!.conflictingReviewIds).toContain("r3");
  });

  it("produces a feature-area finding with VERBATIM excerpts (not synthesised)", () => {
    const reviews = [
      makeCleaned({ id: "r1", content: "The subscription billing is broken" }),
      makeCleaned({ id: "r2", content: "Subscription management needs work" }),
    ];
    const classifications = [
      makeClassification({ reviewId: "r1", featureArea: "订阅" }),
      makeClassification({ reviewId: "r2", featureArea: "订阅" }),
    ];
    const findings = generateStatisticalFindings(classifications, reviews);
    const areaFinding = findings.find((f) => f.title === "Most Discussed Feature Areas");
    expect(areaFinding).toBeDefined();
    // Excerpts must be real review content, not '"订阅" mentioned in N reviews'
    for (const excerpt of areaFinding!.supportingExcerpts) {
      // Should NOT contain the synthesised pattern
      expect(excerpt).not.toMatch(/mentioned in \d+ reviews/);
      // Should be a substring of an actual review's content
      const matchesSomeReview = reviews.some((r) => r.content.includes(excerpt));
      expect(matchesSomeReview).toBe(true);
    }
  });

  it("produces a multilingual finding when non-English reviews exist", () => {
    const reviews = [
      makeCleaned({ id: "r1", language: "zh", content: "这个应用不错" }),
      makeCleaned({ id: "r2", language: "en", content: "good app" }),
    ];
    const findings = generateStatisticalFindings([], reviews);
    const multilingual = findings.find((f) => f.title === "Multilingual User Base");
    expect(multilingual).toBeDefined();
    expect(multilingual!.supportingReviewIds).toContain("r1");
  });

  it("produces a data-limitations finding for small samples (< 30)", () => {
    const reviews = Array.from({ length: 15 }, (_, i) =>
      makeCleaned({ id: `r${i}`, rating: 3, content: `review ${i}`, version: "1.0.0" })
    );
    const findings = generateStatisticalFindings([], reviews);
    const limitations = findings.find((f) => f.title === "Data Limitations & Evidence Sufficiency");
    expect(limitations).toBeDefined();
    expect(limitations!.description).toContain("样本量较小");
    expect(limitations!.uncertaintyNotes).toBeTruthy();
  });

  it("flags version coverage gaps when some versions have < 3 reviews", () => {
    const reviews = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeCleaned({ id: `r${i}`, rating: 3, version: "1.0.0", content: `v1 ${i}` })
      ),
      makeCleaned({ id: "r-v2", rating: 3, version: "2.0.0", content: "v2 only one" }),
    ];
    const findings = generateStatisticalFindings([], reviews);
    const limitations = findings.find((f) => f.title === "Data Limitations & Evidence Sufficiency");
    expect(limitations).toBeDefined();
    expect(limitations!.description).toContain("版本");
  });

  it("flags sentiment skew when > 70% are negative", () => {
    const reviews = [
      ...Array.from({ length: 8 }, (_, i) =>
        makeCleaned({ id: `r${i}`, rating: 1, version: "1.0.0", content: `bad ${i}` })
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        makeCleaned({ id: `g${i}`, rating: 5, version: "1.0.0", content: `good ${i}` })
      ),
    ];
    const findings = generateStatisticalFindings([], reviews);
    const limitations = findings.find((f) => f.title === "Data Limitations & Evidence Sufficiency");
    expect(limitations).toBeDefined();
    expect(limitations!.description).toContain("负面评论占比过高");
  });

  it("all statistical findings have source=statistical and confidence=1.0", () => {
    const reviews = [
      makeCleaned({ id: "r1", rating: 1, content: "bad" }),
      makeCleaned({ id: "r2", rating: 2, content: "also bad" }),
    ];
    const findings = generateStatisticalFindings([], reviews);
    for (const f of findings) {
      expect(f.source).toBe("statistical");
      expect(f.confidence).toBe(1.0);
    }
  });

  it("all findings have unique ids assigned by caller (ids not set here)", () => {
    // generateStatisticalFindings returns Omit<Finding, "id">[], so no id field
    const reviews = [makeCleaned({ id: "r1", rating: 1, content: "bad" })];
    const findings = generateStatisticalFindings([], reviews);
    for (const f of findings) {
      expect((f as Record<string, unknown>).id).toBeUndefined();
    }
  });

  it("flags sample-vs-full-store rating bias when appMetadata is provided", () => {
    // Sample averages ~1.5 (skewed negative, like RSS-surveilled recent reviews);
    // full-store average is 4.2 — gap 2.7 >= 0.7, should trigger the bias warning.
    const reviews = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeCleaned({ id: `r${i}`, rating: i % 2 === 0 ? 1 : 2, version: "1.0.0", content: `bad ${i}` })
      ),
    ];
    const metadata: AppMetadata = {
      trackId: 123,
      trackName: "Test App",
      sellerName: "Test",
      version: "1.0.0",
      averageUserRating: 4.2,
      averageUserRatingForCurrentVersion: 4.0,
      userRatingCount: 50000,
      userRatingCountForCurrentVersion: 5000,
    };
    const findings = generateStatisticalFindings([], reviews, metadata);
    const limitations = findings.find(
      (f) => f.title === "Data Limitations & Evidence Sufficiency"
    );
    expect(limitations).toBeDefined();
    // The bias description must mention both the sample and full-store averages.
    expect(limitations!.description).toContain("全量评分");
    expect(limitations!.description).toContain("4.2");
    expect(limitations!.uncertaintyNotes).toContain("偏差");
  });

  it("does not flag bias when sample average is close to full-store average", () => {
    // Sample averages ~3.0, full-store 3.2 — gap 0.2 < 0.7, no bias warning.
    const reviews = Array.from({ length: 10 }, (_, i) =>
      makeCleaned({ id: `r${i}`, rating: 3, version: "1.0.0", content: `ok ${i}` })
    );
    const metadata: AppMetadata = {
      trackId: 123,
      trackName: "Test App",
      sellerName: "Test",
      version: "1.0.0",
      averageUserRating: 3.2,
      averageUserRatingForCurrentVersion: 3.2,
      userRatingCount: 100,
      userRatingCountForCurrentVersion: 100,
    };
    const findings = generateStatisticalFindings([], reviews, metadata);
    const limitations = findings.find(
      (f) => f.title === "Data Limitations & Evidence Sufficiency"
    );
    // Small-sample warning still fires (10 < 30), but bias warning should NOT.
    if (limitations) {
      expect(limitations.description).not.toContain("偏差");
    }
  });
});

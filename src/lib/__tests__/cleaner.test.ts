import { describe, it, expect } from "vitest";
import { cleanReviews, processImportedReviews } from "../cleaner";
import type { RawReview } from "../types";

function makeReview(over: Partial<RawReview> = {}): RawReview {
  return {
    id: "r1",
    rating: 3,
    title: "Test",
    content: "This is a test review about the app.",
    author: "user",
    date: "2024-01-01T00:00:00Z",
    version: "1.0.0",
    ...over,
  };
}

describe("cleanReviews", () => {
  it("removes reviews with empty content", () => {
    const reviews = [
      makeReview({ id: "r1", content: "  " }),
      makeReview({ id: "r2", content: "valid content here" }),
    ];
    const { reviews: cleaned, stats } = cleanReviews(reviews);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].id).toBe("r2");
    expect(stats.emptyContent).toBe(1);
  });

  it("deduplicates by id", () => {
    const reviews = [
      makeReview({ id: "dup", content: "first" }),
      makeReview({ id: "dup", content: "second" }),
    ];
    const { reviews: cleaned, stats } = cleanReviews(reviews);
    expect(cleaned).toHaveLength(1);
    expect(stats.duplicatesById).toBe(1);
  });

  it("deduplicates by content similarity > 0.9", () => {
    const content =
      "The workout plans are great but the subscription is way too expensive compared to other fitness apps available on the market today right now";
    const reviews = [
      makeReview({ id: "r1", content }),
      makeReview({ id: "r2", content }), // identical content → similarity 1.0
    ];
    const { reviews: cleaned, stats } = cleanReviews(reviews);
    expect(cleaned).toHaveLength(1);
    expect(stats.duplicatesByContent).toBe(1);
  });

  it("keeps reviews with similar but distinct content", () => {
    const reviews = [
      makeReview({ id: "r1", content: "I love the yoga sessions in this app, very relaxing" }),
      makeReview({ id: "r2", content: "The HIIT workouts are intense and really effective" }),
    ];
    const { reviews: cleaned } = cleanReviews(reviews);
    expect(cleaned).toHaveLength(2);
  });

  it("detects Chinese language", () => {
    const reviews = [
      makeReview({
        id: "r1",
        title: "整体不错",
        content: "用了三个月，训练计划很专业，视频质量也不错。",
      }),
    ];
    const { reviews: cleaned } = cleanReviews(reviews);
    expect(cleaned[0].language).toBe("zh");
  });

  it("detects Japanese language", () => {
    const reviews = [
      makeReview({
        id: "r1",
        title: "使いやすい",
        content: "このアプリはとても使いやすくて便利です。おすすめします。",
      }),
    ];
    const { reviews: cleaned } = cleanReviews(reviews);
    expect(cleaned[0].language).toBe("ja");
  });

  it("defaults to English for Latin-script text", () => {
    const reviews = [
      makeReview({ id: "r1", content: "La aplicación es buena pero cara." }),
    ];
    const { reviews: cleaned } = cleanReviews(reviews);
    // Spanish uses Latin script — current heuristic defaults to "en"
    expect(cleaned[0].language).toBe("en");
  });

  it("normalizes whitespace in content", () => {
    const reviews = [
      makeReview({ id: "r1", content: "  This   has   irregular   spaces.\n\n\n\nEnd.  " }),
    ];
    const { reviews: cleaned } = cleanReviews(reviews);
    expect(cleaned[0].normalizedContent).toBe("This has irregular spaces. End.");
  });

  it("marks all returned reviews as isDuplicate=false (dups removed, not flagged)", () => {
    const reviews = [
      makeReview({ id: "r1", content: "unique content one" }),
      makeReview({ id: "r2", content: "unique content two" }),
    ];
    const { reviews: cleaned } = cleanReviews(reviews);
    for (const r of cleaned) {
      expect(r.isDuplicate).toBe(false);
    }
  });
});

describe("processImportedReviews", () => {
  it("fills missing fields with defaults", () => {
    const imported = processImportedReviews([
      { content: "minimal review" },
    ]);
    expect(imported).toHaveLength(1);
    expect(imported[0].id).toBe("imported-0");
    expect(imported[0].rating).toBe(3);
    expect(imported[0].author).toBe("Imported");
    expect(imported[0].content).toBe("minimal review");
  });

  it("clamps rating to 1-5 range", () => {
    const imported = processImportedReviews([
      { content: "a", rating: 10 },
      { content: "b", rating: 0 },
      { content: "c", rating: 3.7 },
    ]);
    expect(imported[0].rating).toBe(5);
    expect(imported[1].rating).toBe(1);
    expect(imported[2].rating).toBe(4);
  });

  it("filters out reviews with empty content", () => {
    const imported = processImportedReviews([
      { content: "" },
      { content: "   " },
      { content: "valid" },
    ]);
    expect(imported).toHaveLength(1);
    expect(imported[0].content).toBe("valid");
  });

  it("preserves provided id, version, date", () => {
    const imported = processImportedReviews([
      { id: "custom-1", content: "x", version: "2.0.0", date: "2024-06-01" },
    ]);
    expect(imported[0].id).toBe("custom-1");
    expect(imported[0].version).toBe("2.0.0");
    expect(imported[0].date).toBe("2024-06-01");
  });
});

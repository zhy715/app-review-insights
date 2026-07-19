import { describe, it, expect } from "vitest";
import { parseAnalysisGoal, applyGoalFilter } from "../goal-filter";
import type { CleanedReview } from "../types";

function makeReview(over: Partial<CleanedReview> = {}): CleanedReview {
  return {
    id: "r1",
    rating: 3,
    title: "t",
    content: "content",
    author: "a",
    date: "2024-01-01",
    language: "en",
    isDuplicate: false,
    normalizedContent: "content",
    ...over,
  };
}

describe("parseAnalysisGoal", () => {
  it("returns no-op filter for empty input", () => {
    const f = parseAnalysisGoal("");
    expect(f.applied).toBe(false);
    expect(f.maxRating).toBeUndefined();
    expect(f.version).toBeUndefined();
  });

  it("detects low-rating intent (Chinese)", () => {
    expect(parseAnalysisGoal("分析低分评论").maxRating).toBe(2);
    expect(parseAnalysisGoal("关注差评和吐槽").maxRating).toBe(2);
    expect(parseAnalysisGoal("1星评论").maxRating).toBe(2);
    expect(parseAnalysisGoal("2星评论").maxRating).toBe(2);
  });

  it("detects low-rating intent (English)", () => {
    expect(parseAnalysisGoal("focus on negative reviews").maxRating).toBe(2);
    expect(parseAnalysisGoal("1-star reviews").maxRating).toBe(2);
    expect(parseAnalysisGoal("2-star reviews").maxRating).toBe(2);
  });

  it("detects 3-star intent", () => {
    expect(parseAnalysisGoal("3星评论分析").maxRating).toBe(3);
    expect(parseAnalysisGoal("3-star reviews").maxRating).toBe(3);
  });

  it("detects version intent", () => {
    expect(parseAnalysisGoal("分析版本 3.2.0 的反馈").version).toBe("3.2.0");
    expect(parseAnalysisGoal("version 3.2.0").version).toBe("3.2.0");
    expect(parseAnalysisGoal("v3.2.1").version).toBe("3.2.1");
  });

  it("does not misread stray numbers as version without version keyword", () => {
    // "I want 3 improvements" should NOT trigger version filter
    const f = parseAnalysisGoal("I want 3 improvements");
    expect(f.version).toBeUndefined();
  });

  it("extracts quoted keywords", () => {
    const f = parseAnalysisGoal('关注"订阅"和"崩溃"问题');
    expect(f.keywords).toEqual(expect.arrayContaining(["订阅", "崩溃"]));
    expect(f.applied).toBe(true);
  });

  it("extracts English quoted keywords", () => {
    const f = parseAnalysisGoal('focus on "subscription" issues');
    expect(f.keywords).toContain("subscription");
  });

  it("combines multiple intents", () => {
    const f = parseAnalysisGoal('低分评论中"订阅"问题，版本 3.2.0');
    expect(f.maxRating).toBe(2);
    expect(f.version).toBe("3.2.0");
    expect(f.keywords).toContain("订阅");
    expect(f.applied).toBe(true);
  });
});

describe("applyGoalFilter", () => {
  const reviews = [
    makeReview({ id: "r1", rating: 1, content: "crash bug", version: "3.2.0" }),
    makeReview({ id: "r2", rating: 5, content: "love it", version: "3.2.1" }),
    makeReview({ id: "r3", rating: 2, content: "subscription too expensive", version: "3.2.0" }),
    makeReview({ id: "r4", rating: 4, content: "great workouts", version: "3.2.1" }),
  ];

  it("filters by maxRating", () => {
    const filtered = applyGoalFilter(reviews, { maxRating: 2, applied: true, description: "" });
    expect(filtered).toHaveLength(2);
    expect(filtered.every((r) => r.rating <= 2)).toBe(true);
  });

  it("filters by version", () => {
    const filtered = applyGoalFilter(reviews, { version: "3.2.0", applied: true, description: "" });
    expect(filtered).toHaveLength(2);
    expect(filtered.every((r) => r.version === "3.2.0")).toBe(true);
  });

  it("filters by keywords (case-insensitive)", () => {
    const filtered = applyGoalFilter(reviews, {
      keywords: ["crash"],
      applied: true,
      description: "",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("r1");
  });

  it("filters by multiple keywords (OR logic)", () => {
    const filtered = applyGoalFilter(reviews, {
      keywords: ["crash", "subscription"],
      applied: true,
      description: "",
    });
    expect(filtered).toHaveLength(2);
  });

  it("returns original list when no filter applied", () => {
    const filtered = applyGoalFilter(reviews, { applied: false, description: "" });
    expect(filtered).toHaveLength(4);
  });

  it("combines rating + version filters (AND logic)", () => {
    const filtered = applyGoalFilter(reviews, {
      maxRating: 2,
      version: "3.2.0",
      applied: true,
      description: "",
    });
    expect(filtered).toHaveLength(2); // r1 and r3
    expect(filtered.every((r) => r.rating <= 2 && r.version === "3.2.0")).toBe(true);
  });
});

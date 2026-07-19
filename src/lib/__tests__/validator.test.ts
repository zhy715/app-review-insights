import { describe, it, expect } from "vitest";
import { validateTraceability } from "../validator";
import type {
  RawReview,
  CleanedReview,
  ReviewClassification,
  Finding,
  Requirement,
  TestCase,
} from "../types";

function makeRaw(over: Partial<RawReview> = {}): RawReview {
  return { id: "r1", rating: 3, title: "t", content: "c", author: "a", date: "2024-01-01", ...over };
}

function makeCleaned(over: Partial<CleanedReview> = {}): CleanedReview {
  return { ...makeRaw(over), language: "en", isDuplicate: false, normalizedContent: "c", ...over };
}

function makeFinding(over: Partial<Finding> = {}): Finding {
  return {
    id: "F-001",
    title: "Test finding",
    description: "desc",
    category: "bug",
    severity: "major",
    supportingReviewIds: ["r1"],
    supportingExcerpts: ["excerpt"],
    sampleCount: 1,
    conflictingReviewIds: [],
    confidence: 0.9,
    source: "model",
    ...over,
  };
}

function makeRequirement(over: Partial<Requirement> = {}): Requirement {
  return {
    id: "REQ-001",
    title: "Test req",
    description: "desc",
    priority: "P1",
    sourceFindingIds: ["F-001"],
    sourceReviewIds: ["r1"],
    acceptance: ["acc"],
    version: "V1.0",
    isAssumption: false,
    ...over,
  };
}

function makeTestCase(over: Partial<TestCase> = {}): TestCase {
  return {
    id: "TC-001",
    requirementId: "REQ-001",
    title: "Test case",
    steps: ["step"],
    expectedResult: "result",
    sourceReviews: ["r1"],
    priority: "P1",
    ...over,
  };
}

describe("validateTraceability", () => {
  it("passes for a fully consistent trace chain", () => {
    const raw = [makeRaw()];
    const cleaned = [makeCleaned()];
    const classifications: ReviewClassification[] = [
      { reviewId: "r1", topics: ["t"], sentiment: "negative", severity: "major", keyExcerpts: ["x"] },
    ];
    const findings = [makeFinding()];
    const requirements = [makeRequirement()];
    const testCases = [makeTestCase()];

    const result = validateTraceability(raw, cleaned, classifications, findings, requirements, testCases);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.coveredReviews).toBe(1);
    expect(result.totalReviews).toBe(1);
  });

  it("flags error when finding references non-existent review", () => {
    const raw = [makeRaw()];
    const cleaned = [makeCleaned()];
    const findings = [makeFinding({ supportingReviewIds: ["nonexistent"] })];
    const requirements = [makeRequirement({ sourceFindingIds: ["F-001"], sourceReviewIds: [] })];
    const testCases: TestCase[] = [];

    const result = validateTraceability(raw, cleaned, [], findings, requirements, testCases);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.type === "broken_link" && i.severity === "error")).toBe(true);
  });

  it("flags error when requirement references non-existent finding", () => {
    const requirements = [makeRequirement({ sourceFindingIds: ["F-999"] })];
    const result = validateTraceability([makeRaw()], [makeCleaned()], [], [], requirements, []);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.message.includes("F-999"))).toBe(true);
  });

  it("flags error when test case references non-existent requirement", () => {
    const testCases = [makeTestCase({ requirementId: "REQ-999" })];
    const result = validateTraceability([makeRaw()], [makeCleaned()], [], [], [], testCases);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.message.includes("REQ-999"))).toBe(true);
  });

  it("revokes requirements with zero evidence (no findings AND no reviews)", () => {
    // Requirement with neither sourceFindingIds nor sourceReviewIds
    const requirements = [
      makeRequirement({ id: "REQ-BAD", sourceFindingIds: [], sourceReviewIds: [] }),
    ];
    const testCases = [
      makeTestCase({ requirementId: "REQ-BAD" }),
    ];
    const result = validateTraceability([makeRaw()], [makeCleaned()], [], [], requirements, testCases);
    expect(result.revokedRequirementIds).toContain("REQ-BAD");
    expect(result.revokedTestCaseIds).toContain("TC-001");
  });

  it("downgrades findings with confidence < 0.5", () => {
    const findings = [
      makeFinding({ id: "F-LOW", confidence: 0.3 }),
      makeFinding({ id: "F-HIGH", confidence: 0.8 }),
    ];
    const result = validateTraceability([makeRaw()], [makeCleaned()], [], findings, [], []);
    expect(result.downgradedFindingIds).toContain("F-LOW");
    expect(result.downgradedFindingIds).not.toContain("F-HIGH");
  });

  it("warns about low-confidence findings (< 0.6)", () => {
    const findings = [makeFinding({ confidence: 0.55 })];
    const result = validateTraceability([makeRaw()], [makeCleaned()], [], findings, [], []);
    expect(result.issues.some((i) => i.type === "weak_evidence" && i.message.includes("55%"))).toBe(true);
  });

  it("warns about requirements marked as assumptions", () => {
    const requirements = [makeRequirement({ isAssumption: true })];
    const result = validateTraceability([makeRaw()], [makeCleaned()], [], [], requirements, []);
    expect(result.issues.some((i) => i.type === "unsupported_conclusion" && i.message.includes("assumption"))).toBe(true);
  });

  it("includes requirement in unsupportedRequirements when it has no source findings", () => {
    const requirements = [makeRequirement({ sourceFindingIds: [] })];
    const result = validateTraceability([makeRaw()], [makeCleaned()], [], [], requirements, []);
    expect(result.unsupportedRequirements).toContain("REQ-001");
    expect(result.missingLinks.some((l) => l.from === "REQ-001" && l.to === "findings")).toBe(true);
  });
});

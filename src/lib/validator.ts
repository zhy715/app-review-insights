import type {
  RawReview,
  CleanedReview,
  ReviewClassification,
  Finding,
  Requirement,
  TestCase,
  ValidationResult,
  ValidationIssue,
} from "./types";

// ============================================================
// Stage 7: Traceability Validation
// Checks the trace chain: Reviews → Findings → Requirements → Test Cases
// This is a DETERMINISTIC step — no LLM involved
// ============================================================

/**
 * Validate the full traceability chain
 */
export function validateTraceability(
  rawReviews: RawReview[],
  cleanedReviews: CleanedReview[],
  classifications: ReviewClassification[],
  findings: Finding[],
  requirements: Requirement[],
  testCases: TestCase[]
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Build lookup sets
  const rawReviewIds = new Set(rawReviews.map((r) => r.id));
  const cleanedReviewIds = new Set(cleanedReviews.map((r) => r.id));
  const findingIds = new Set(findings.map((f) => f.id));
  const requirementIds = new Set(requirements.map((r) => r.id));

  // === Check 1: Every finding's supporting reviews must exist in cleaned data ===
  for (const finding of findings) {
    for (const reviewId of finding.supportingReviewIds) {
      if (!cleanedReviewIds.has(reviewId)) {
        issues.push({
          type: "broken_link",
          severity: "error",
          message: `Finding "${finding.title}" references non-existent review: ${reviewId}`,
          details: `The review ID may refer to a duplicate that was removed during cleaning.`,
        });
      }
    }
  }

  // === Check 2: Every requirement's source findings must exist ===
  for (const req of requirements) {
    if (req.sourceFindingIds.length === 0) {
      issues.push({
        type: "weak_evidence",
        severity: "warning",
        message: `Requirement "${req.title}" has no linked source findings`,
        details: "This requirement may be an assumption without evidence.",
      });
    }

    for (const findingId of req.sourceFindingIds) {
      if (!findingIds.has(findingId)) {
        issues.push({
          type: "broken_link",
          severity: "error",
          message: `Requirement "${req.title}" references non-existent finding: ${findingId}`,
          details: "The finding ID is invalid.",
        });
      }
    }

    // Check if source reviews are valid
    for (const reviewId of req.sourceReviewIds) {
      if (!rawReviewIds.has(reviewId)) {
        issues.push({
          type: "broken_link",
          severity: "warning",
          message: `Requirement "${req.title}" references non-existent review: ${reviewId}`,
          details: "The review may have been removed during cleaning.",
        });
      }
    }
  }

  // === Check 3: Every test case must link to a valid requirement ===
  for (const tc of testCases) {
    if (!requirementIds.has(tc.requirementId)) {
      issues.push({
        type: "broken_link",
        severity: "error",
        message: `Test case "${tc.title}" references non-existent requirement: ${tc.requirementId}`,
        details: "The requirement ID is invalid.",
      });
    }
  }

  // === Check 4: Requirements marked as assumptions ===
  const assumptionRequirements = requirements.filter((r) => r.isAssumption);
  for (const req of assumptionRequirements) {
    issues.push({
      type: "unsupported_conclusion",
      severity: "warning",
      message: `Requirement "${req.title}" is marked as an assumption — lacks confirming evidence`,
      details:
        "This requirement was generated based on inference rather than explicit user feedback. Treat with caution.",
    });
  }

  // === Check 5: Findings with low confidence ===
  const lowConfidenceFindings = findings.filter((f) => f.confidence < 0.6);
  for (const f of lowConfidenceFindings) {
    issues.push({
      type: "weak_evidence",
      severity: "warning",
      message: `Finding "${f.title}" has low confidence (${(f.confidence * 100).toFixed(0)}%)`,
      details: f.uncertaintyNotes || "Insufficient supporting reviews or conflicting evidence.",
    });
  }

  // === Check 6: Coverage analysis ===
  const coveredReviewIds = new Set<string>();
  for (const req of requirements) {
    for (const reviewId of req.sourceReviewIds) {
      coveredReviewIds.add(reviewId);
    }
  }

  // === Revision mechanism (task #08) ===
  // Don't just *flag* unsupported conclusions — actively revoke/downgrade them
  // so they cannot leak into the final deliverable as if they were solid.
  //
  // Revocation rule: a requirement with NO evidence at all (neither source
  // findings nor source reviews) is a hallucinated conclusion and is revoked.
  const revokedRequirementIds = requirements
    .filter(
      (r) =>
        r.sourceFindingIds.length === 0 && r.sourceReviewIds.length === 0
    )
    .map((r) => r.id);

  const revokedSet = new Set(revokedRequirementIds);

  // Test cases whose requirement was revoked are orphaned → revoke them too,
  // otherwise the trace chain would point at a non-existent requirement.
  const revokedTestCaseIds = testCases
    .filter((tc) => revokedSet.has(tc.requirementId))
    .map((tc) => tc.id);

  // Downgrade rule: findings with weak evidence (confidence < 0.5) get marked
  // as downgraded. They stay in the dataset (still informative) but carry an
  // explicit warning so PMs treat them as hypotheses, not facts.
  const downgradedFindingIds = findings
    .filter((f) => f.confidence < 0.5)
    .map((f) => f.id);

  // Record the revisions as validation issues for transparency
  for (const reqId of revokedRequirementIds) {
    const req = requirements.find((r) => r.id === reqId);
    issues.push({
      type: "unsupported_conclusion",
      severity: "error",
      message: `Requirement "${req?.title || reqId}" revoked — no supporting findings or reviews`,
      details:
        "已自动剔除：该需求既无来源发现也无来源评论，属于无证据结论（任务 #08 修订机制）。",
    });
  }
  for (const tcId of revokedTestCaseIds) {
    issues.push({
      type: "broken_link",
      severity: "warning",
      message: `Test case "${tcId}" revoked — its source requirement was revoked`,
      details: "因来源需求被剔除，该测试用例同步剔除以保持追溯链完整。",
    });
  }

  const errors = issues.filter((i) => i.severity === "error");
  const unsupportedRequirements = requirements
    .filter(
      (r) =>
        r.isAssumption ||
        r.sourceFindingIds.length === 0 ||
        lowConfidenceFindings.some((f) => r.sourceFindingIds.includes(f.id)) ||
        revokedSet.has(r.id)
    )
    .map((r) => r.id);

  const missingLinks: { from: string; to: string }[] = [];
  for (const req of requirements) {
    if (req.sourceFindingIds.length === 0) {
      missingLinks.push({ from: req.id, to: "findings" });
    }
    if (req.sourceReviewIds.length === 0) {
      missingLinks.push({ from: req.id, to: "reviews" });
    }
  }
  for (const tc of testCases) {
    if (tc.sourceReviews.length === 0) {
      missingLinks.push({ from: tc.id, to: "reviews" });
    }
  }

  return {
    passed: errors.length === 0,
    issues,
    unsupportedRequirements,
    missingLinks,
    totalReviews: rawReviews.length,
    coveredReviews: coveredReviewIds.size,
    revokedRequirementIds,
    revokedTestCaseIds,
    downgradedFindingIds,
  };
}

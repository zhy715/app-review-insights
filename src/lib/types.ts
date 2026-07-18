// ============================================================
// App Review Insights — Core Type Definitions
// Full traceability: Review → Classification → Finding → Requirement → TestCase
// ============================================================

// === Pipeline Stages ===
export type PipelineStage =
  | "idle"
  | "collecting"
  | "cleaning"
  | "classifying"
  | "analyzing"
  | "generating_prd"
  | "generating_tests"
  | "validating"
  | "complete"
  | "error";

// === Raw Review (from App Store RSS) ===
export interface RawReview {
  id: string;
  rating: number; // 1-5
  title: string;
  content: string;
  author: string;
  date: string; // ISO date string
  version?: string;
}

// === Cleaned Review ===
export interface CleanedReview extends RawReview {
  language: string; // detected language (e.g. "en", "zh", "ja")
  isDuplicate: boolean;
  normalizedContent: string;
}

// === Per-Review AI Classification ===
export interface ReviewClassification {
  reviewId: string;
  topics: string[];
  sentiment: "positive" | "negative" | "neutral" | "mixed";
  severity?: "critical" | "major" | "minor" | "suggestion";
  featureArea?: string;
  keyExcerpts: string[]; // key quotes from this review
}

// === Aggregated Finding (evidence-backed) ===
export interface Finding {
  id: string; // e.g. "F-001"
  title: string;
  description: string;
  category: string; // "bug" | "feature_request" | "ux_issue" | "performance" | "pricing" | "other"
  severity: "critical" | "major" | "minor";
  supportingReviewIds: string[];
  supportingExcerpts: string[];
  sampleCount: number;
  conflictingReviewIds: string[];
  confidence: number; // 0-1
  uncertaintyNotes?: string;
  source: "model" | "statistical";
}

// === PRD Requirement ===
export interface Requirement {
  id: string; // e.g. "REQ-001"
  title: string;
  description: string;
  priority: "P0" | "P1" | "P2" | "P3";
  sourceFindingIds: string[];
  sourceReviewIds: string[];
  acceptance: string[];
  version?: string;
  isAssumption: boolean;
}

// === Test Case ===
export interface TestCase {
  id: string; // e.g. "TC-001"
  requirementId: string;
  title: string;
  steps: string[];
  expectedResult: string;
  sourceReviews: string[];
  priority: "P0" | "P1" | "P2" | "P3";
}

// === Pipeline Results (accumulated through stages) ===
export interface PipelineResults {
  appName: string;
  appId: string;
  analysisGoal: string;
  rawReviews: RawReview[];
  cleanedReviews: CleanedReview[];
  classifications: ReviewClassification[];
  findings: Finding[];
  requirements: Requirement[];
  testCases: TestCase[];
  validation: ValidationResult;
}

// === Validation Result ===
export interface ValidationResult {
  passed: boolean;
  issues: ValidationIssue[];
  unsupportedRequirements: string[]; // requirement IDs that lack evidence
  missingLinks: { from: string; to: string }[]; // broken traceability links
  totalReviews: number;
  coveredReviews: number; // reviews that are traced through to test cases
}

export interface ValidationIssue {
  type: "unsupported_conclusion" | "weak_evidence" | "broken_link" | "missing_review";
  severity: "error" | "warning";
  message: string;
  details: string;
}

// === Pipeline State (streamed via SSE) ===
export interface PipelineState {
  stage: PipelineStage;
  progress: number; // 0-100
  message: string;
  data?: Partial<PipelineResults>;
  errors: PipelineError[];
  warnings: string[];
}

export interface PipelineError {
  stage: PipelineStage;
  message: string;
  detail?: string;
  timestamp: string;
}

// === Analysis Input ===
export interface AnalysisInput {
  appUrl?: string;
  analysisGoal: string;
  importData?: RawReview[]; // from JSON/CSV import
}

// === LLM Configuration ===
export interface LLMConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

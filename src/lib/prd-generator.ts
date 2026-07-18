import { z } from "zod";
import { llmCallWithSchema } from "./llm";
import { generateId } from "./sse";
import type { Finding, Requirement } from "./types";

// ============================================================
// Stage 5: LLM-Driven PRD Generation
// Converts findings into product requirements with priorities
// ============================================================

const PRDOutputSchema = z.object({
  requirements: z.array(
    z.object({
      title: z.string().max(200),
      description: z.string().max(2000),
      priority: z.enum(["P0", "P1", "P2", "P3"]),
      sourceFindingTitles: z.array(z.string()),
      sourceReviewIds: z.array(z.string()),
      acceptance: z.array(z.string().max(500)).min(1),
      version: z.string().optional(),
      isAssumption: z.boolean(),
    })
  ),
  versionPlan: z.array(
    z.object({
      version: z.string(),
      theme: z.string(),
      requirementTitles: z.array(z.string()),
      rationale: z.string(),
    })
  ),
  executiveSummary: z.string(),
});

type PRDOutput = z.infer<typeof PRDOutputSchema>;

const SYSTEM_PROMPT = `You are a senior product manager writing a PRD (Product Requirements Document) based on user feedback analysis. Your requirements must be grounded in real user feedback, not speculation.

## Instructions:
1. Review the findings from user review analysis.
2. Write **concrete, actionable requirements** that address the identified problems. Each requirement must:
   - **title**: Clear, specific requirement name
   - **description**: What needs to be built/changed and why. Include context from user feedback. Use "Users report that..." to ground in evidence.
   - **priority**: P0 (must fix — critical bugs, broken flows), P1 (should fix — major friction, high-impact), P2 (nice to fix — annoyance, edge case), P3 (future — enhancement, optimization)
   - **sourceFindingTitles**: Which findings this requirement addresses (use the exact finding titles)
   - **sourceReviewIds**: The original review IDs backing this requirement (from the findings' supportingReviewIds)
   - **acceptance**: 2-5 measurable acceptance criteria. Use specific, testable language (e.g., "User can complete X in fewer than 3 taps", not "X is easier to use")
   - **version**: Which release version this belongs to (V1.0, V1.1, V2.0)
   - **isAssumption**: true ONLY if this requirement is based on inference rather than explicit user evidence. Most should be false.

3. Create a **versionPlan** that groups requirements into logical releases:
   - V1.0: Critical fixes and high-impact improvements (P0 + some P1)
   - V1.1: Remaining P1 items + high-value P2 items
   - V2.0: Larger feature additions and P3 items
   - Each version needs a theme and rationale.

## Priority Guidelines:
- P0: App crashes, payment failures, data loss, login failures, core functionality broken
- P1: Major UX friction, frequently requested features, high-volume complaints, subscription conversion blockers
- P2: Minor annoyances, edge case bugs, infrequently requested features
- P3: Nice-to-haves, cosmetic improvements, future enhancements

## Important Rules:
- Requirements MUST be grounded in the provided findings. Do not invent problems users didn't report.
- Source reviews should come from the findings' supportingReviewIds.
- If a finding has weak evidence (low confidence, few reviews), note this and consider lower priority.
- Acceptance criteria must be measurable and testable.
- Be specific — "Improve performance" is too vague. "Reduce workout video load time to under 3 seconds" is specific.`;

function buildUserPrompt(
  findings: Finding[],
  analysisGoal: string,
  appName: string
): string {
  const findingsText = findings
    .map(
      (f) =>
        `[${f.id}] ${f.title}
  Category: ${f.category} | Severity: ${f.severity} | Confidence: ${(f.confidence * 100).toFixed(0)}% | Source: ${f.source}
  Description: ${f.description}
  Supporting Reviews (${f.sampleCount}): ${f.supportingReviewIds.join(", ")}
  Excerpts: ${f.supportingExcerpts.map((e) => `"${e.slice(0, 200)}"`).join(" | ")}
  Conflicts: ${f.conflictingReviewIds.length > 0 ? f.conflictingReviewIds.join(", ") : "None"}
  ${f.uncertaintyNotes ? `Uncertainty: ${f.uncertaintyNotes}` : ""}`
    )
    .join("\n\n---\n\n");

  return `## Context
- App: ${appName}
- Analysis Goal: ${analysisGoal || "Comprehensive product improvement"}
- Total Findings: ${findings.length}

## Findings from User Review Analysis
${findingsText}

Based on these findings, create a PRD with:
1. A list of concrete, actionable product requirements (each linked to its source findings and reviews)
2. A version plan grouping requirements into logical releases
3. An executive summary

Focus on requirements that align with the analysis goal. Be specific and measurable in acceptance criteria.`;
}

export interface PRDResult {
  requirements: Requirement[];
  versionPlan: PRDOutput["versionPlan"];
  executiveSummary: string;
}

/**
 * Generate PRD from findings
 */
export async function generatePRD(
  findings: Finding[],
  analysisGoal: string,
  appName: string
): Promise<PRDResult> {
  const output = await llmCallWithSchema<PRDOutput>(
    {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(findings, analysisGoal, appName),
      temperature: 0.2,
      maxTokens: 8192,
    },
    PRDOutputSchema
  );

  // Map finding titles to finding IDs
  const findingMap = new Map(findings.map((f) => [f.title, f]));

  const requirements: Requirement[] = output.requirements.map((r, i) => {
    // Resolve finding titles to IDs
    const sourceFindingIds = r.sourceFindingTitles
      .map((title) => findingMap.get(title)?.id)
      .filter((id): id is string => id !== undefined);

    return {
      id: generateId("REQ", i),
      title: r.title,
      description: r.description,
      priority: r.priority,
      sourceFindingIds,
      sourceReviewIds: r.sourceReviewIds,
      acceptance: r.acceptance,
      version: r.version,
      isAssumption: r.isAssumption,
    };
  });

  return {
    requirements,
    versionPlan: output.versionPlan,
    executiveSummary: output.executiveSummary,
  };
}

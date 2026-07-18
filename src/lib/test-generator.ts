import { z } from "zod";
import { llmCallWithSchema } from "./llm";
import { generateId } from "./sse";
import type { Requirement, TestCase } from "./types";

// ============================================================
// Stage 6: LLM-Driven Test Case Generation
// Generates test cases from PRD requirements
// ============================================================

const TestCasesOutputSchema = z.object({
  testCases: z.array(
    z.object({
      requirementTitle: z.string(),
      title: z.string().max(200),
      steps: z.array(z.string().max(500)).min(1).optional().default(["验证功能"]),
      expectedResult: z.string().max(1000).optional().default("符合预期"),
      sourceReviews: z.array(z.union([z.string(), z.number()]).transform(String)).optional().default([]),
      priority: z.enum(["P0", "P1", "P2", "P3"]).optional().default("P2"),
    })
  ).optional().default([]),
});

type TestCasesOutput = z.infer<typeof TestCasesOutputSchema>;

const SYSTEM_PROMPT = `You are a QA engineer designing test cases for a mobile app PRD. Your test cases must verify that each requirement correctly addresses the user problems identified in the source reviews.

## Instructions:
For each requirement, design test cases that verify the acceptance criteria AND confirm the underlying user problems are solved. Use **Gherkin-style** Given/When/Then format for steps.

## Test Case Types:
1. **Happy Path**: The feature works correctly under normal conditions
2. **Edge Case**: Boundary values, empty states, concurrent operations
3. **Error Path**: What happens when dependencies fail or inputs are invalid

## For each test case, provide:
- **requirementTitle**: The exact requirement this tests
- **title**: Descriptive test case name
- **steps**: Array of Given/When/Then steps. Be CONCRETE — use specific values, not placeholders.
  - "Given the user is on the subscription page with a 'Monthly Premium' plan priced at $9.99"
  - NOT "Given the user is on the correct page"
- **expectedResult**: What the user should see/experience when the test passes
- **sourceReviews**: IDs of the original user reviews whose problems this test verifies are solved
- **priority**: Same as the requirement's priority

## Important Rules:
- Each step must test exactly ONE behavior.
- Use real-world values (prices, durations, UI labels, error messages).
- Cover authentication and authorization edge cases for features that require login.
- Include at least one test case per acceptance criterion.
- Source reviews should link back to the original user complaints — this proves we're testing the right things.
- Generate at least 2 test cases per requirement: 1 happy path + 1 edge case minimum.`;

function buildUserPrompt(requirements: Requirement[]): string {
  const reqText = requirements
    .map(
      (r) =>
        `[${r.id}] ${r.title} (Priority: ${r.priority}, Version: ${r.version || "N/A"}, Assumption: ${r.isAssumption})
  Description: ${r.description}
  Acceptance Criteria:
  ${r.acceptance.map((a, i) => `    ${i + 1}. ${a}`).join("\n")}
  Source Reviews: ${r.sourceReviewIds.join(", ")}
  Source Findings: ${r.sourceFindingIds.join(", ")}`
    )
    .join("\n\n---\n\n");

  return `Based on the following PRD requirements, generate comprehensive test cases:

${reqText}

Generate test cases for each requirement. Include happy path, edge case, and error path scenarios where applicable. Link each test case to the original user reviews it helps verify.`;
}

export interface TestGenResult {
  testCases: TestCase[];
}

/**
 * Generate test cases from PRD requirements
 */
export async function generateTestCases(
  requirements: Requirement[]
): Promise<TestGenResult> {
  // Build a map for requirement title → ID resolution
  const reqMap = new Map(requirements.map((r) => [r.title, r]));

  const output = await llmCallWithSchema<TestCasesOutput>(
    {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(requirements),
      temperature: 0.1, // Lowest temperature for deterministic test cases
      maxTokens: 8192,
    },
    TestCasesOutputSchema
  );

  const testCases: TestCase[] = output.testCases.map((tc, i) => {
    const req = reqMap.get(tc.requirementTitle);
    return {
      id: generateId("TC", i),
      requirementId: req?.id || "REQ-UNKNOWN",
      title: tc.title,
      steps: tc.steps,
      expectedResult: tc.expectedResult,
      sourceReviews: tc.sourceReviews,
      priority: tc.priority,
    };
  });

  return { testCases };
}

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
      // Prefer requirementId (deterministic reverse lookup by ID).
      // requirementTitle kept as a fallback for models that ignore the
      // ID instruction — resolved against the requirement list in code.
      requirementId: z.union([z.string(), z.number()]).transform(String).optional().default(""),
      requirementTitle: z.string().optional().default(""),
      title: z.string().max(200),
      steps: z.array(z.string().max(500)).min(1).optional().default(["验证功能"]),
      expectedResult: z.string().max(1000).optional().default("符合预期"),
      sourceReviews: z.array(z.union([z.string(), z.number()]).transform(String)).optional().default([]),
      priority: z.enum(["P0", "P1", "P2", "P3"]).optional().default("P2"),
    })
  ).optional().default([]),
});

type TestCasesOutput = z.infer<typeof TestCasesOutputSchema>;

const SYSTEM_PROMPT = `你是一名 QA 工程师，正在为移动应用 PRD 设计测试用例。你的测试用例必须验证每条需求是否正确地解决了源评论中识别的用户问题。

## 任务说明：
为每条需求设计测试用例，验证验收标准并确认底层用户问题已解决。使用 **Gherkin 风格**的 Given/When/Then 格式编写步骤。

## 测试用例类型：
1. **正常路径**: 功能在正常条件下正常工作
2. **边界情况**: 边界值、空状态、并发操作
3. **异常路径**: 依赖失败或输入无效时会发生什么

## 每条测试用例需提供：
- **requirementId**: 所测试的需求 ID（使用确切的需求 ID，如 "REQ-001"、"REQ-002"，见上方输入中的 [REQ-xxx] 标记）。这是首选方式，比用标题更可靠。
- **requirementTitle**: 仅当无法确定 ID 时作为兜底，填入对应的需求标题（将做模糊匹配）。
- **title**: 描述性的中文测试用例标题
- **steps**: Given/When/Then 步骤数组。必须具体——使用具体数值，而非占位符。
  - 正确："Given 用户在订阅页面，显示'月度高级版'计划价格为 ¥68.00"
  - 错误："Given 用户在正确的页面"
- **expectedResult**: 测试通过时用户应看到/体验到的结果，用中文
- **sourceReviews**: 此测试验证的原始评论 ID
- **priority**: 与对应需求相同的优先级

## 重要规则：
- 每个步骤必须只测试一个行为。
- 使用真实数值（价格、时长、UI 标签、错误消息）。
- 对需要登录的功能，覆盖认证和授权的边界情况。
- 每条验收标准至少包含一条测试用例。
- 每条需求至少生成 2 条测试用例：最少 1 条正常路径 + 1 条边界/异常情况。
- 所有文本内容（title、steps、expectedResult）请用中文输出。

请以指定的 JSON 格式返回测试用例。`;

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
  // Build lookup maps for deterministic reverse-filling of requirement IDs.
  // Primary: exact ID match. Fallback: normalised title match for models that
  // ignore the ID rule. Eliminates the "REQ-UNKNOWN" orphan problem that
  // arose when the LLM slightly reworded the requirement title.
  const reqById = new Map(requirements.map((r) => [r.id, r]));
  const reqByTitle = new Map(
    requirements.map((r) => [normaliseTitle(r.title), r])
  );

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
    // 1. Resolve by ID (preferred path — deterministic)
    let req = tc.requirementId ? reqById.get(tc.requirementId) : undefined;
    // 2. Resolve by title (fallback for non-compliant LLM output)
    if (!req && tc.requirementTitle) {
      req = reqByTitle.get(normaliseTitle(tc.requirementTitle));
    }
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

/**
 * Normalise a title for fuzzy matching: trim, collapse whitespace, lowercase.
 * Used only as a fallback when the LLM ignores the "use requirement ID" rule.
 */
function normaliseTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

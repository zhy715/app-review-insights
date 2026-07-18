"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import type { TestCase } from "@/lib/types";

interface TestCaseViewProps {
  testCases?: TestCase[];
}

const PRIORITY_COLORS: Record<string, string> = {
  P0: "bg-red-100 text-red-800 border-red-300",
  P1: "bg-orange-100 text-orange-800 border-orange-300",
  P2: "bg-blue-100 text-blue-800 border-blue-300",
  P3: "bg-gray-100 text-gray-600 border-gray-300",
};

export function TestCaseView({ testCases }: TestCaseViewProps) {
  if (!testCases || testCases.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-gray-400">
          暂无测试用例。运行分析以生成测试用例。
        </CardContent>
      </Card>
    );
  }

  // Group by requirement
  const byRequirement = new Map<string, TestCase[]>();
  for (const tc of testCases) {
    const list = byRequirement.get(tc.requirementId) || [];
    list.push(tc);
    byRequirement.set(tc.requirementId, list);
  }

  const p0Count = testCases.filter((t) => t.priority === "P0").length;
  const p1Count = testCases.filter((t) => t.priority === "P1").length;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex gap-3 flex-wrap">
        <div className="rounded-lg border px-3 py-2 text-center min-w-[80px] bg-gray-50">
          <div className="text-lg font-bold">{testCases.length}</div>
          <div className="text-xs">测试用例</div>
        </div>
        <div className="rounded-lg border px-3 py-2 text-center min-w-[80px] bg-red-50 text-red-700 border-red-200">
          <div className="text-lg font-bold">{p0Count}</div>
          <div className="text-xs">P0 关键</div>
        </div>
        <div className="rounded-lg border px-3 py-2 text-center min-w-[80px] bg-orange-50 text-orange-700 border-orange-200">
          <div className="text-lg font-bold">{p1Count}</div>
          <div className="text-xs">P1 重要</div>
        </div>
        <div className="rounded-lg border px-3 py-2 text-center min-w-[80px] bg-gray-50">
          <div className="text-lg font-bold">{byRequirement.size}</div>
          <div className="text-xs">覆盖需求</div>
        </div>
      </div>

      {/* Test cases by requirement */}
      {[...byRequirement.entries()].map(([reqId, cases]) => (
        <div key={reqId}>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            📋 {reqId} <span className="text-gray-400">({cases.length} 条用例)</span>
          </h3>
          <Accordion className="space-y-2">
            {cases.map((tc) => (
              <AccordionItem
                key={tc.id}
                value={tc.id}
                className="border rounded-lg px-4"
              >
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center gap-2 flex-wrap text-left">
                    <span className="text-xs font-mono text-gray-400">
                      {tc.id}
                    </span>
                    <Badge
                      className={`text-xs ${PRIORITY_COLORS[tc.priority] || ""}`}
                      variant="outline"
                    >
                      {tc.priority}
                    </Badge>
                    <span className="text-sm font-medium flex-1">
                      {tc.title}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pb-3">
                  {/* Steps — Gherkin style */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">
                      测试步骤:
                    </p>
                    <ol className="list-decimal list-inside space-y-1">
                      {tc.steps.map((step, i) => {
                        const isGiven = step.startsWith("Given");
                        const isWhen = step.startsWith("When");
                        const isThen = step.startsWith("Then");
                        let color = "";
                        if (isGiven) color = "text-blue-600";
                        else if (isWhen) color = "text-orange-600";
                        else if (isThen) color = "text-green-600";

                        return (
                          <li key={i} className={`text-xs ${color}`}>
                            {step}
                          </li>
                        );
                      })}
                    </ol>
                  </div>

                  {/* Expected result */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">
                      预期结果:
                    </p>
                    <p className="text-xs text-green-700 bg-green-50 rounded p-2">
                      {tc.expectedResult}
                    </p>
                  </div>

                  {/* Source reviews */}
                  <p className="text-xs text-gray-400">
                    来源评论: {tc.sourceReviews.join(", ") || "无"}
                  </p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      ))}
    </div>
  );
}

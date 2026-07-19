"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import type { Requirement } from "@/lib/types";
import { buildPRDMarkdown, downloadText } from "@/lib/exporters";

interface PRDViewProps {
  appName?: string;
  requirements?: Requirement[];
  versionPlan?: { version: string; theme: string; requirementTitles: string[]; rationale: string }[];
  executiveSummary?: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  P0: "bg-red-100 text-red-800 border-red-300",
  P1: "bg-orange-100 text-orange-800 border-orange-300",
  P2: "bg-blue-100 text-blue-800 border-blue-300",
  P3: "bg-gray-100 text-gray-600 border-gray-300",
};

export function PRDView({ appName, requirements, versionPlan, executiveSummary }: PRDViewProps) {
  if (!requirements || requirements.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-gray-400">
          暂无 PRD。运行分析以生成产品需求文档。
        </CardContent>
      </Card>
    );
  }

  // Group by version
  const byVersion = new Map<string, Requirement[]>();
  for (const req of requirements) {
    const v = req.version || "未规划";
    const list = byVersion.get(v) || [];
    list.push(req);
    byVersion.set(v, list);
  }

  return (
    <div className="space-y-6">
      {/* Export toolbar */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            downloadText(
              "PRD.md",
              buildPRDMarkdown({ appName, executiveSummary, versionPlan, requirements }),
              "text/markdown"
            )
          }
        >
          📥 导出 Markdown
        </Button>
      </div>

      {/* Executive Summary */}
      {executiveSummary && (
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold text-blue-800 mb-1">📋 摘要</h3>
            <p className="text-sm text-blue-700">{executiveSummary}</p>
          </CardContent>
        </Card>
      )}

      {/* Version Plan */}
      {versionPlan && versionPlan.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {versionPlan.map((v) => (
            <Card key={v.version} className="border-l-4 border-l-blue-500">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="default">{v.version}</Badge>
                  <span className="font-medium text-sm">{v.theme}</span>
                </div>
                <p className="text-xs text-gray-500">{v.rationale}</p>
                <p className="text-xs text-gray-400">
                  {v.requirementTitles.length} 条需求
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Requirements by Version */}
      {[...byVersion.entries()].map(([version, reqs]) => (
        <div key={version}>
          <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <Badge variant="outline">{version}</Badge>
            <span className="text-gray-400">{reqs.length} 条需求</span>
          </h3>
          <Accordion className="space-y-2">
            {reqs.map((req) => (
              <AccordionItem
                key={req.id}
                value={req.id}
                className="border rounded-lg px-4"
              >
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center gap-2 flex-wrap text-left">
                    <span className="text-xs font-mono text-gray-400">
                      {req.id}
                    </span>
                    <Badge
                      className={`text-xs ${PRIORITY_COLORS[req.priority] || ""}`}
                      variant="outline"
                    >
                      {req.priority}
                    </Badge>
                    <span className="text-sm font-medium flex-1">
                      {req.title}
                    </span>
                    {req.isAssumption && (
                      <Badge variant="secondary" className="text-xs text-orange-600">
                        ⚠ 假设
                      </Badge>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pb-3">
                  {/* Description */}
                  <p className="text-sm text-gray-700">{req.description}</p>

                  {/* Acceptance Criteria */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">
                      验收标准:
                    </p>
                    <ul className="list-disc list-inside space-y-0.5">
                      {req.acceptance.map((a, i) => (
                        <li key={i} className="text-xs text-gray-600">
                          {a}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Source traceability */}
                  <div className="flex gap-3 flex-wrap text-xs text-gray-400">
                    <span>
                      来源发现: {req.sourceFindingIds.join(", ") || "无"}
                    </span>
                    <span>
                      来源评论: {req.sourceReviewIds.length} 条
                    </span>
                  </div>

                  {req.isAssumption && (
                    <p className="text-xs text-orange-600 bg-orange-50 rounded p-2">
                      ⚠ 此需求标注为假设 — 缺乏充分的用户证据支撑。建议在开发前进行用户验证。
                    </p>
                  )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      ))}
    </div>
  );
}

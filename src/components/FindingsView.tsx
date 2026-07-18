"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import type { Finding } from "@/lib/types";

interface FindingsViewProps {
  findings?: Finding[];
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-300",
  major: "bg-orange-100 text-orange-800 border-orange-300",
  minor: "bg-yellow-100 text-yellow-800 border-yellow-300",
};

const CATEGORY_LABELS: Record<string, string> = {
  bug: "🐛 Bug",
  feature_request: "💡 功能请求",
  ux_issue: "👆 体验问题",
  performance: "⚡ 性能",
  pricing: "💰 定价",
  content: "📝 内容",
  other: "📌 其他",
};

export function FindingsView({ findings }: FindingsViewProps) {
  if (!findings || findings.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-gray-400">
          暂无发现。运行分析以生成基于证据的产品发现。
        </CardContent>
      </Card>
    );
  }

  // Sort: critical → major → minor
  const sorted = [...findings].sort((a, b) => {
    const order = { critical: 0, major: 1, minor: 2 };
    return (order[a.severity] || 3) - (order[b.severity] || 3);
  });

  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const majorCount = findings.filter((f) => f.severity === "major").length;
  const minorCount = findings.filter((f) => f.severity === "minor").length;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex gap-3 flex-wrap">
        <SummaryBadge label="总计" value={findings.length} />
        <SummaryBadge label="🔴 严重" value={criticalCount} color="red" />
        <SummaryBadge label="🟠 重要" value={majorCount} color="orange" />
        <SummaryBadge label="🟡 轻微" value={minorCount} color="yellow" />
      </div>

      {/* Findings list */}
      <Accordion className="space-y-2">
        {sorted.map((finding) => (
          <AccordionItem key={finding.id} value={finding.id} className="border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline py-3">
              <div className="flex items-center gap-2 flex-wrap text-left">
                <span className="text-xs font-mono text-gray-400">
                  {finding.id}
                </span>
                <Badge
                  className={`text-xs ${SEVERITY_COLORS[finding.severity] || ""}`}
                  variant="outline"
                >
                  {finding.severity}
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {CATEGORY_LABELS[finding.category] || finding.category}
                </Badge>
                <span className="text-sm font-medium flex-1">
                  {finding.title}
                </span>
                <Badge
                  variant={finding.source === "model" ? "default" : "outline"}
                  className="text-xs"
                >
                  {finding.source === "model" ? "🤖 AI" : "📊 统计"}
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pb-3">
              {/* Description */}
              <p className="text-sm text-gray-700">{finding.description}</p>

              {/* Meta */}
              <div className="flex gap-3 flex-wrap text-xs text-gray-500">
                <span>支持评论: <strong>{finding.sampleCount}</strong></span>
                <span>置信度: <strong>{(finding.confidence * 100).toFixed(0)}%</strong></span>
                {finding.conflictingReviewIds.length > 0 && (
                  <span className="text-orange-600">
                    矛盾证据: {finding.conflictingReviewIds.length} 条
                  </span>
                )}
              </div>

              {/* Supporting excerpts */}
              {finding.supportingExcerpts.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">
                    支撑证据（评论摘录）:
                  </p>
                  <ul className="space-y-1">
                    {finding.supportingExcerpts.map((excerpt, i) => (
                      <li
                        key={i}
                        className="text-xs text-gray-600 bg-gray-50 rounded px-2 py-1 italic"
                      >
                        &ldquo;{excerpt}&rdquo;
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Uncertainty */}
              {finding.uncertaintyNotes && (
                <p className="text-xs text-orange-600 bg-orange-50 rounded p-2">
                  ⚠ {finding.uncertaintyNotes}
                </p>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}

function SummaryBadge({
  label,
  value,
  color = "gray",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  const colors: Record<string, string> = {
    red: "bg-red-50 text-red-700 border-red-200",
    orange: "bg-orange-50 text-orange-700 border-orange-200",
    yellow: "bg-yellow-50 text-yellow-700 border-yellow-200",
    gray: "bg-gray-50 text-gray-700 border-gray-200",
  };
  return (
    <div className={`rounded-lg border px-3 py-2 text-center min-w-[80px] ${colors[color]}`}>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

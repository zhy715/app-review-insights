"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ValidationResult, ValidationIssue } from "@/lib/types";

interface TraceabilityGraphProps {
  validation?: ValidationResult;
  reviewCount?: number;
  findingCount?: number;
  requirementCount?: number;
  testCaseCount?: number;
}

export function TraceabilityGraph({
  validation,
  reviewCount = 0,
  findingCount = 0,
  requirementCount = 0,
  testCaseCount = 0,
}: TraceabilityGraphProps) {
  return (
    <div className="space-y-6">
      {/* Pipeline Flow Diagram */}
      <Card>
        <CardContent className="p-6">
          <h3 className="text-sm font-semibold mb-4">📐 追溯链路</h3>
          <div className="flex flex-wrap items-center gap-2 md:gap-4 justify-center">
            <ChainNode
              label="评论"
              count={reviewCount}
              color="bg-blue-500"
            />
            <ChainArrow />
            <ChainNode
              label="发现"
              count={findingCount}
              color="bg-purple-500"
            />
            <ChainArrow />
            <ChainNode
              label="需求"
              count={requirementCount}
              color="bg-orange-500"
            />
            <ChainArrow />
            <ChainNode
              label="测试用例"
              count={testCaseCount}
              color="bg-green-500"
            />
          </div>
          <div className="flex flex-wrap items-center gap-4 justify-center mt-4 text-xs text-gray-400">
            <span>用户反馈</span>
            <span>→</span>
            <span>问题分析</span>
            <span>→</span>
            <span>产品规划</span>
            <span>→</span>
            <span>质量验证</span>
          </div>
        </CardContent>
      </Card>

      {/* Validation Results */}
      {validation && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">
                🔍 追溯校验
              </h3>
              <Badge
                variant={validation.passed ? "default" : "destructive"}
              >
                {validation.passed ? "✓ 通过" : "✗ 存在问题"}
              </Badge>
            </div>

            {/* Coverage stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <CoverageStat
                label="总评论数"
                value={validation.totalReviews}
              />
              <CoverageStat
                label="已覆盖"
                value={validation.coveredReviews}
              />
              <CoverageStat
                label="覆盖率"
                value={`${validation.totalReviews > 0 ? ((validation.coveredReviews / validation.totalReviews) * 100).toFixed(0) : 0}%`}
              />
              <CoverageStat
                label="未支撑需求"
                value={validation.unsupportedRequirements.length}
                highlight={validation.unsupportedRequirements.length > 0}
              />
            </div>

            {/* Issues */}
            {validation.issues.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500">
                  发现 {validation.issues.length} 个问题:
                </p>
                {validation.issues.map((issue, i) => (
                  <IssueCard key={i} issue={issue} />
                ))}
              </div>
            )}

            {/* Missing links */}
            {validation.missingLinks.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">
                  缺失的追溯链接:
                </p>
                <ul className="list-disc list-inside text-xs text-gray-600">
                  {validation.missingLinks.slice(0, 10).map((link, i) => (
                    <li key={i}>
                      {link.from} → {link.to} (缺失)
                    </li>
                  ))}
                  {validation.missingLinks.length > 10 && (
                    <li className="text-gray-400">
                      ...还有 {validation.missingLinks.length - 10} 条
                    </li>
                  )}
                </ul>
              </div>
            )}

            {validation.passed && validation.issues.length === 0 && (
              <p className="text-sm text-green-600 bg-green-50 rounded-lg p-3">
                ✓ 所有追溯链路完整 — 每个需求都有对应的发现和评论支撑，每个测试用例都已链接到需求和原始评论。
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ChainNode({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <div
        className={`w-16 h-16 md:w-20 md:h-20 rounded-2xl ${color} text-white flex flex-col items-center justify-center shadow-lg`}
      >
        <span className="text-xl md:text-2xl font-bold">{count}</span>
      </div>
      <span className="text-xs mt-1 font-medium">{label}</span>
    </div>
  );
}

function ChainArrow() {
  return (
    <span className="text-2xl text-gray-300 font-bold mx-0 md:mx-1">→</span>
  );
}

function CoverageStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-center ${
        highlight
          ? "bg-red-50 border-red-200 text-red-700"
          : "bg-gray-50 border-gray-200"
      }`}
    >
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

function IssueCard({ issue }: { issue: ValidationIssue }) {
  const isError = issue.severity === "error";
  return (
    <div
      className={`rounded-lg p-3 text-sm ${
        isError
          ? "bg-red-50 border border-red-200"
          : "bg-yellow-50 border border-yellow-200"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Badge variant={isError ? "destructive" : "secondary"} className="text-xs">
          {isError ? "错误" : "警告"}
        </Badge>
        <span className="text-xs text-gray-500">{issue.type}</span>
      </div>
      <p className={`text-sm ${isError ? "text-red-700" : "text-yellow-700"}`}>
        {issue.message}
      </p>
      <p className="text-xs text-gray-500 mt-1">{issue.details}</p>
    </div>
  );
}

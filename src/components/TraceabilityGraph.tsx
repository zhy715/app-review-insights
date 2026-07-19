"use client";

import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  ValidationResult,
  ValidationIssue,
  Finding,
  Requirement,
  TestCase,
  CleanedReview,
} from "@/lib/types";

interface TraceabilityGraphProps {
  validation?: ValidationResult;
  reviewCount?: number;
  findingCount?: number;
  requirementCount?: number;
  testCaseCount?: number;
  // Full data for the interactive explorer
  reviews?: CleanedReview[];
  findings?: Finding[];
  requirements?: Requirement[];
  testCases?: TestCase[];
}

type NodeType = "review" | "finding" | "requirement" | "testCase";
type Selection = { type: NodeType; id: string } | null;

interface RelatedSet {
  reviews: Set<string>;
  findings: Set<string>;
  requirements: Set<string>;
  testCases: Set<string>;
}

function computeRelated(
  sel: Selection,
  data: {
    reviews: CleanedReview[];
    findings: Finding[];
    requirements: Requirement[];
    testCases: TestCase[];
  }
): RelatedSet | null {
  if (!sel) return null;
  const r = new Set<string>();
  const f = new Set<string>();
  const req = new Set<string>();
  const tc = new Set<string>();

  if (sel.type === "review") {
    r.add(sel.id);
    for (const fd of data.findings) {
      if (
        fd.supportingReviewIds.includes(sel.id) ||
        fd.conflictingReviewIds.includes(sel.id)
      ) {
        f.add(fd.id);
      }
    }
    for (const rq of data.requirements) {
      if (rq.sourceReviewIds.includes(sel.id)) req.add(rq.id);
    }
    for (const t of data.testCases) {
      if (t.sourceReviews.includes(sel.id)) tc.add(t.id);
    }
  } else if (sel.type === "finding") {
    f.add(sel.id);
    const fd = data.findings.find((x) => x.id === sel.id);
    if (fd) {
      fd.supportingReviewIds.forEach((id) => r.add(id));
      fd.conflictingReviewIds.forEach((id) => r.add(id));
    }
    for (const rq of data.requirements) {
      if (rq.sourceFindingIds.includes(sel.id)) req.add(rq.id);
    }
    for (const t of data.testCases) {
      if (req.has(t.requirementId)) tc.add(t.id);
    }
  } else if (sel.type === "requirement") {
    req.add(sel.id);
    const rq = data.requirements.find((x) => x.id === sel.id);
    if (rq) {
      rq.sourceFindingIds.forEach((id) => f.add(id));
      rq.sourceReviewIds.forEach((id) => r.add(id));
    }
    for (const t of data.testCases) {
      if (t.requirementId === sel.id) tc.add(t.id);
    }
  } else if (sel.type === "testCase") {
    tc.add(sel.id);
    const t = data.testCases.find((x) => x.id === sel.id);
    if (t) {
      req.add(t.requirementId);
      t.sourceReviews.forEach((id) => r.add(id));
      const rq = data.requirements.find((x) => x.id === t.requirementId);
      if (rq) {
        rq.sourceFindingIds.forEach((id) => f.add(id));
      }
    }
  }

  return { reviews: r, findings: f, requirements: req, testCases: tc };
}

const NODE_STYLES: Record<
  NodeType,
  { selected: string; related: string; label: string; dot: string }
> = {
  review: {
    selected: "bg-blue-100 border-blue-400 border-2",
    related: "bg-blue-50 border-blue-300",
    label: "评论",
    dot: "bg-blue-500",
  },
  finding: {
    selected: "bg-purple-100 border-purple-400 border-2",
    related: "bg-purple-50 border-purple-300",
    label: "发现",
    dot: "bg-purple-500",
  },
  requirement: {
    selected: "bg-orange-100 border-orange-400 border-2",
    related: "bg-orange-50 border-orange-300",
    label: "需求",
    dot: "bg-orange-500",
  },
  testCase: {
    selected: "bg-green-100 border-green-400 border-2",
    related: "bg-green-50 border-green-300",
    label: "测试用例",
    dot: "bg-green-500",
  },
};

function nodeClass(
  type: NodeType,
  id: string,
  sel: Selection,
  related: RelatedSet | null
): string {
  const base = "border rounded-md p-2 text-left text-xs cursor-pointer transition-all hover:border-gray-400 w-full";
  if (sel?.type === type && sel.id === id) {
    return `${base} ${NODE_STYLES[type].selected}`;
  }
  if (related) {
    const set =
      type === "review"
        ? related.reviews
        : type === "finding"
          ? related.findings
          : type === "requirement"
            ? related.requirements
            : related.testCases;
    if (set.has(id)) {
      return `${base} ${NODE_STYLES[type].related}`;
    }
    // Non-related: hidden when something is selected (filter mode)
    return `${base} hidden`;
  }
  return `${base} bg-gray-50 border-gray-200`;
}

function shortId(id: string, n = 10): string {
  return id.length > n ? `${id.slice(0, n)}…` : id;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function TraceabilityGraph({
  validation,
  reviewCount = 0,
  findingCount = 0,
  requirementCount = 0,
  testCaseCount = 0,
  reviews = [],
  findings = [],
  requirements = [],
  testCases = [],
}: TraceabilityGraphProps) {
  return (
    <div className="space-y-6">
      {/* Pipeline Flow Diagram */}
      <Card>
        <CardContent className="p-6">
          <h3 className="text-sm font-semibold mb-4">📐 追溯链路</h3>
          <div className="flex flex-wrap items-center gap-2 md:gap-4 justify-center">
            <ChainNode label="评论" count={reviewCount} color="bg-blue-500" />
            <ChainArrow />
            <ChainNode label="发现" count={findingCount} color="bg-purple-500" />
            <ChainArrow />
            <ChainNode label="需求" count={requirementCount} color="bg-orange-500" />
            <ChainArrow />
            <ChainNode label="测试用例" count={testCaseCount} color="bg-green-500" />
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

      {/* Interactive explorer */}
      <InteractiveTraceability
        reviews={reviews}
        findings={findings}
        requirements={requirements}
        testCases={testCases}
      />

      {/* Validation Results */}
      {validation && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">🔍 追溯校验</h3>
              <Badge variant={validation.passed ? "default" : "destructive"}>
                {validation.passed ? "✓ 通过" : "✗ 存在问题"}
              </Badge>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <CoverageStat label="总评论数" value={validation.totalReviews} />
              <CoverageStat label="已覆盖" value={validation.coveredReviews} />
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

function InteractiveTraceability({
  reviews,
  findings,
  requirements,
  testCases,
}: {
  reviews: CleanedReview[];
  findings: Finding[];
  requirements: Requirement[];
  testCases: TestCase[];
}) {
  const [selected, setSelected] = useState<Selection>(null);

  const related = useMemo(
    () => computeRelated(selected, { reviews, findings, requirements, testCases }),
    [selected, reviews, findings, requirements, testCases]
  );

  const hasData =
    reviews.length > 0 || findings.length > 0 || requirements.length > 0 || testCases.length > 0;
  if (!hasData) return null;

  // When nothing selected, cap each column to 12 for legibility
  const cap = 12;
  const visibleReviews = selected && related
    ? reviews.filter((r) => related.reviews.has(r.id))
    : reviews.slice(0, cap);
  const visibleFindings = selected && related
    ? findings.filter((f) => related.findings.has(f.id))
    : findings.slice(0, cap);
  const visibleRequirements = selected && related
    ? requirements.filter((r) => related.requirements.has(r.id))
    : requirements.slice(0, cap);
  const visibleTestCases = selected && related
    ? testCases.filter((t) => related.testCases.has(t.id))
    : testCases.slice(0, cap);

  const select = (type: NodeType, id: string) => {
    setSelected((prev) =>
      prev?.type === type && prev.id === id ? null : { type, id }
    );
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold">🔍 交互式追溯探索器</h3>
          {selected && (
            <button
              onClick={() => setSelected(null)}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              清除选择
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 mb-4">
          {selected
            ? "已选中节点，下方仅显示其完整追溯链。点击同一节点取消。"
            : "点击任意节点，高亮显示其完整追溯链（评论 ↔ 发现 ↔ 需求 ↔ 测试用例）。"}
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Reviews column */}
          <Column
            label="评论"
            dotClass="bg-blue-500"
            count={reviews.length}
            visibleCount={visibleReviews.length}
            capped={!selected && reviews.length > cap}
          >
            {visibleReviews.map((r) => (
              <button
                key={r.id}
                onClick={() => select("review", r.id)}
                className={nodeClass("review", r.id, selected, related)}
              >
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <span className="font-mono text-[10px] text-gray-500">
                    {shortId(r.id, 8)}
                  </span>
                  <span className="text-[10px]">
                    {"★".repeat(r.rating)}
                    <span className="text-gray-300">
                      {"★".repeat(5 - r.rating)}
                    </span>
                  </span>
                </div>
                <p className="text-[11px] text-gray-700 leading-tight">
                  {truncate(r.title || r.content, 32)}
                </p>
              </button>
            ))}
          </Column>

          {/* Findings column */}
          <Column
            label="发现"
            dotClass="bg-purple-500"
            count={findings.length}
            visibleCount={visibleFindings.length}
            capped={!selected && findings.length > cap}
          >
            {visibleFindings.map((f) => (
              <button
                key={f.id}
                onClick={() => select("finding", f.id)}
                className={nodeClass("finding", f.id, selected, related)}
              >
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="font-mono text-[10px] text-gray-500">
                    {f.id}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    · {f.severity}
                  </span>
                </div>
                <p className="text-[11px] text-gray-700 leading-tight">
                  {truncate(f.title, 30)}
                </p>
              </button>
            ))}
          </Column>

          {/* Requirements column */}
          <Column
            label="需求"
            dotClass="bg-orange-500"
            count={requirements.length}
            visibleCount={visibleRequirements.length}
            capped={!selected && requirements.length > cap}
          >
            {visibleRequirements.map((r) => (
              <button
                key={r.id}
                onClick={() => select("requirement", r.id)}
                className={nodeClass("requirement", r.id, selected, related)}
              >
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="font-mono text-[10px] text-gray-500">
                    {r.id}
                  </span>
                  <span className="text-[10px] px-1 rounded bg-orange-100 text-orange-700">
                    {r.priority}
                  </span>
                </div>
                <p className="text-[11px] text-gray-700 leading-tight">
                  {truncate(r.title, 28)}
                </p>
              </button>
            ))}
          </Column>

          {/* Test cases column */}
          <Column
            label="测试用例"
            dotClass="bg-green-500"
            count={testCases.length}
            visibleCount={visibleTestCases.length}
            capped={!selected && testCases.length > cap}
          >
            {visibleTestCases.map((t) => (
              <button
                key={t.id}
                onClick={() => select("testCase", t.id)}
                className={nodeClass("testCase", t.id, selected, related)}
              >
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="font-mono text-[10px] text-gray-500">
                    {t.id}
                  </span>
                  <span className="text-[10px] px-1 rounded bg-green-100 text-green-700">
                    {t.priority}
                  </span>
                </div>
                <p className="text-[11px] text-gray-700 leading-tight">
                  {truncate(t.title, 28)}
                </p>
              </button>
            ))}
          </Column>
        </div>

        {selected && related && (
          <SelectionSummary
            selected={selected}
            related={related}
          />
        )}
      </CardContent>
    </Card>
  );
}

function Column({
  label,
  dotClass,
  count,
  visibleCount,
  capped,
  children,
}: {
  label: string;
  dotClass: string;
  count: number;
  visibleCount: number;
  capped: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <span className="text-[10px] text-gray-400">
          ({visibleCount}
          {capped ? `/${count}` : ""})
        </span>
      </div>
      <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
        {visibleCount === 0 ? (
          <p className="text-[11px] text-gray-400 italic p-2">无关联节点</p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function SelectionSummary({
  selected,
  related,
}: {
  selected: Selection;
  related: RelatedSet;
}) {
  if (!selected) return null;
  const label =
    selected.type === "review"
      ? "评论"
      : selected.type === "finding"
        ? "发现"
        : selected.type === "requirement"
          ? "需求"
          : "测试用例";

  return (
    <div className="mt-4 p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs">
      <p className="text-gray-600">
        已选中 <strong className="text-gray-800">{label}</strong>{" "}
        <span className="font-mono">{selected.id}</span>，追溯链覆盖：
      </p>
      <div className="flex gap-3 flex-wrap mt-1.5 text-[11px]">
        <span className="text-blue-700">
          {related.reviews.size} 条评论
        </span>
        <span className="text-purple-700">
          {related.findings.size} 条发现
        </span>
        <span className="text-orange-700">
          {related.requirements.size} 条需求
        </span>
        <span className="text-green-700">
          {related.testCases.size} 条测试用例
        </span>
      </div>
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

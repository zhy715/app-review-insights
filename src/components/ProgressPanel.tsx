"use client";

import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { PipelineState } from "@/lib/types";

interface ProgressPanelProps {
  state: PipelineState | null;
}

const STAGE_LABELS: Record<string, string> = {
  idle: "等待中",
  collecting: "采集评论",
  cleaning: "清洗数据",
  classifying: "AI 分类",
  analyzing: "AI 分析",
  generating_prd: "生成 PRD",
  generating_tests: "生成测试用例",
  validating: "追溯校验",
  complete: "完成",
  error: "错误",
};

const STAGE_ORDER = [
  "idle",
  "collecting",
  "cleaning",
  "classifying",
  "analyzing",
  "generating_prd",
  "generating_tests",
  "validating",
  "complete",
];

export function ProgressPanel({ state }: ProgressPanelProps) {
  if (!state || state.stage === "idle") {
    return (
      <div className="text-center text-gray-400 py-8 text-sm">
        输入 App Store 链接或导入数据，然后点击「开始分析」
      </div>
    );
  }

  const currentIndex = STAGE_ORDER.indexOf(state.stage);

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium">
            {state.message || STAGE_LABELS[state.stage] || state.stage}
          </span>
          <span className="text-sm text-gray-500">{state.progress}%</span>
        </div>
        <Progress value={state.progress} className="h-2" />
      </div>

      {/* Stage indicators */}
      <div className="flex flex-wrap gap-1.5">
        {STAGE_ORDER.filter((s) => s !== "idle").map((stage, idx) => {
          const isComplete =
            state.stage === "complete" ||
            currentIndex > idx;
          const isCurrent = state.stage === stage;
          const isError = state.stage === "error" && currentIndex === idx;

          let variant: "default" | "secondary" | "outline" | "destructive" =
            "outline";
          if (isComplete) variant = "default";
          else if (isCurrent) variant = "secondary";
          else if (isError) variant = "destructive";

          return (
            <Badge key={stage} variant={variant} className="text-xs">
              {isComplete ? "✓" : isCurrent ? "●" : "○"}{" "}
              {STAGE_LABELS[stage]}
            </Badge>
          );
        })}
      </div>

      {/* Errors */}
      {state.errors.length > 0 && (
        <div className="space-y-2">
          {state.errors.map((err, i) => (
            <Alert key={i} variant="destructive">
              <AlertDescription className="text-sm">
                <strong>{err.stage}:</strong> {err.message}
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* Warnings */}
      {state.warnings.length > 0 && (
        <div className="space-y-1">
          {state.warnings.slice(0, 5).map((w, i) => (
            <Alert key={i} variant="default" className="border-yellow-300 bg-yellow-50">
              <AlertDescription className="text-sm text-yellow-800">
                ⚠ {w}
              </AlertDescription>
            </Alert>
          ))}
          {state.warnings.length > 5 && (
            <p className="text-xs text-gray-400 pl-2">
              ...还有 {state.warnings.length - 5} 条警告
            </p>
          )}
        </div>
      )}
    </div>
  );
}

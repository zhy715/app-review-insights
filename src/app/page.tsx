"use client";

import { useState, useRef, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppInput } from "@/components/AppInput";
import { ProgressPanel } from "@/components/ProgressPanel";
import { ReviewTable } from "@/components/ReviewTable";
import { FindingsView } from "@/components/FindingsView";
import { PRDView } from "@/components/PRDView";
import { TestCaseView } from "@/components/TestCaseView";
import { TraceabilityGraph } from "@/components/TraceabilityGraph";
import type { PipelineState, PipelineResults, RawReview } from "@/lib/types";

const INITIAL_STATE: PipelineState = {
  stage: "idle",
  progress: 0,
  message: "",
  errors: [],
  warnings: [],
};

export default function Home() {
  const [state, setState] = useState<PipelineState>(INITIAL_STATE);
  const [results, setResults] = useState<Partial<PipelineResults> | null>(null);
  const [activeTab, setActiveTab] = useState("findings");
  const abortRef = useRef<AbortController | null>(null);

  const handleStart = useCallback(
    async (appUrl: string, analysisGoal: string, importData?: RawReview[]) => {
      // Reset
      setState({
        stage: "idle",
        progress: 0,
        message: "Starting analysis...",
        errors: [],
        warnings: [],
      });
      setResults(null);
      setActiveTab("findings");

      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appUrl: appUrl || undefined,
            analysisGoal,
            importData,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(
            errData.error || `Request failed with status ${response.status}`
          );
        }

        // Read SSE stream
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";

          for (const event of events) {
            const dataLine = event
              .split("\n")
              .find((l) => l.startsWith("data: "));
            if (!dataLine) continue;

            try {
              const parsed = JSON.parse(dataLine.slice(6)) as PipelineState;
              setState(parsed);

              // Accumulate results
              if (parsed.data) {
                setResults((prev) => ({
                  ...prev,
                  ...parsed.data,
                }));
              }

              // Auto-switch to traceability tab on completion
              if (parsed.stage === "complete") {
                setActiveTab("trace");
              }
            } catch {
              // Skip malformed event
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState((prev) => ({
          ...prev,
          stage: "error",
          message:
            err instanceof Error ? err.message : "Unknown error occurred",
          errors: [
            ...prev.errors,
            {
              stage: "error",
              message:
                err instanceof Error ? err.message : "Unknown error",
              timestamp: new Date().toISOString(),
            },
          ],
        }));
      }
    },
    []
  );

  const isRunning =
    state.stage !== "idle" &&
    state.stage !== "complete" &&
    state.stage !== "error";

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <header className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">
            🍎 App Review Insights
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            从用户评论到产品需求的完整分析工具
          </p>
        </header>

        {/* Input Panel */}
        <AppInput onStart={handleStart} isRunning={isRunning} />

        {/* Progress Panel */}
        <ProgressPanel state={state} />

        {/* Results Tabs */}
        {(results || state.stage === "complete") && (
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="w-full"
          >
            <TabsList className="w-full justify-start overflow-x-auto">
              <TabsTrigger value="reviews" className="text-sm">
                📊 评论数据
              </TabsTrigger>
              <TabsTrigger value="findings" className="text-sm">
                🔍 分析发现
              </TabsTrigger>
              <TabsTrigger value="prd" className="text-sm">
                📋 PRD
              </TabsTrigger>
              <TabsTrigger value="tests" className="text-sm">
                🧪 测试用例
              </TabsTrigger>
              <TabsTrigger value="trace" className="text-sm">
                🔗 追溯链路
              </TabsTrigger>
            </TabsList>

            <TabsContent value="reviews" className="mt-4">
              <ReviewTable
                rawReviews={results?.rawReviews}
                cleanedReviews={results?.cleanedReviews}
              />
            </TabsContent>

            <TabsContent value="findings" className="mt-4">
              <FindingsView findings={results?.findings} />
            </TabsContent>

            <TabsContent value="prd" className="mt-4">
              <PRDView
                requirements={results?.requirements}
              />
            </TabsContent>

            <TabsContent value="tests" className="mt-4">
              <TestCaseView testCases={results?.testCases} />
            </TabsContent>

            <TabsContent value="trace" className="mt-4">
              <TraceabilityGraph
                validation={results?.validation}
                reviewCount={results?.rawReviews?.length || 0}
                findingCount={results?.findings?.length || 0}
                requirementCount={results?.requirements?.length || 0}
                testCaseCount={results?.testCases?.length || 0}
              />
            </TabsContent>
          </Tabs>
        )}

        {/* Empty state */}
        {!results && state.stage === "idle" && (
          <div className="text-center py-12 text-gray-400 space-y-2">
            <div className="text-5xl">🍎</div>
            <p className="text-lg">输入 App Store 链接开始分析</p>
            <p className="text-sm">
              支持美区 App Store · 自动采集评论 · AI 分析 · 生成 PRD 和测试用例
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

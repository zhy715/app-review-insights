"use client";

import { useState, useRef, useCallback, Component, ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppInput } from "@/components/AppInput";
import { ProgressPanel } from "@/components/ProgressPanel";
import { ReviewTable } from "@/components/ReviewTable";
import { FindingsView } from "@/components/FindingsView";
import { PRDView } from "@/components/PRDView";
import { TestCaseView } from "@/components/TestCaseView";
import { TraceabilityGraph } from "@/components/TraceabilityGraph";
import type { PipelineState, PipelineResults, RawReview } from "@/lib/types";

// ============================================================
// Error Boundary
// ============================================================
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-8 max-w-2xl mx-auto mt-8">
          <div className="bg-red-50 border border-red-300 rounded-xl p-6 space-y-3">
            <h2 className="text-lg font-bold text-red-700">⚠️ 页面错误</h2>
            <pre className="text-sm text-red-600 whitespace-pre-wrap bg-red-100 rounded p-3">
              {this.state.error.message}
            </pre>
            <details>
              <summary className="text-sm text-red-500 cursor-pointer">完整堆栈</summary>
              <pre className="text-xs text-red-500 mt-2 whitespace-pre-wrap max-h-60 overflow-auto">
                {this.state.error.stack}
              </pre>
            </details>
            <button
              onClick={() => this.setState({ error: null })}
              className="text-sm bg-red-600 text-white px-4 py-1.5 rounded-lg"
            >
              重试
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================================
// Main Page
// ============================================================
export default function Home() {
  const [state, setState] = useState<PipelineState>({
    stage: "idle",
    progress: 0,
    message: "",
    errors: [],
    warnings: [],
  });
  const [results, setResults] = useState<Partial<PipelineResults> | null>(null);
  const [activeTab, setActiveTab] = useState("findings");
  const abortRef = useRef<AbortController | null>(null);

  const handleStart = useCallback(
    async (appUrl: string, analysisGoal: string, importData?: RawReview[]) => {
      // Abort previous run
      if (abortRef.current) {
        abortRef.current.abort();
      }

      const abortController = new AbortController();
      abortRef.current = abortController;

      // Reset UI
      setState({
        stage: "collecting",
        progress: 0,
        message: "正在提交分析请求...",
        errors: [],
        warnings: [],
      });
      setResults(null);
      setActiveTab("findings");

      try {
        setState((prev) => ({
          ...prev,
          stage: "collecting",
          progress: 10,
          message: "正在采集和分析数据，请耐心等待...",
        }));

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
          let errMsg = `请求失败 (HTTP ${response.status})`;
          try {
            const errData = await response.json();
            errMsg = errData.error || errMsg;
          } catch { /* ignore */ }
          throw new Error(errMsg);
        }

        const data = await response.json();

        if (data.success && data.results) {
          setResults(data.results);
          setState({
            stage: "complete",
            progress: 100,
            message: `🎉 分析完成! ${data.results.findings?.length || 0} 个发现, ${data.results.requirements?.length || 0} 条需求, ${data.results.testCases?.length || 0} 条测试用例`,
            errors: [],
            warnings: data.results.validation?.issues
              ?.filter((i: { severity: string }) => i.severity === "warning")
              ?.map((i: { message: string }) => i.message) || [],
          });
          setActiveTab("findings");
        } else {
          throw new Error("服务器返回了意外的数据格式");
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "未知错误";
        setState((prev) => ({
          ...prev,
          stage: "error",
          message: msg,
          errors: [...prev.errors, { stage: "error", message: msg, timestamp: new Date().toISOString() }],
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
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
          <header className="text-center">
            <h1 className="text-2xl font-bold text-gray-900">
              🍎 App Review Insights
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              从用户评论到产品需求的完整分析工具
            </p>
          </header>

          <AppInput onStart={handleStart} isRunning={isRunning} />

          <ProgressPanel state={state} />

          {results && (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full justify-start overflow-x-auto">
                <TabsTrigger value="reviews" className="text-sm">📊 评论数据</TabsTrigger>
                <TabsTrigger value="findings" className="text-sm">🔍 分析发现</TabsTrigger>
                <TabsTrigger value="prd" className="text-sm">📋 PRD</TabsTrigger>
                <TabsTrigger value="tests" className="text-sm">🧪 测试用例</TabsTrigger>
                <TabsTrigger value="trace" className="text-sm">🔗 追溯链路</TabsTrigger>
              </TabsList>
              <TabsContent value="reviews" className="mt-4">
                <ReviewTable rawReviews={results?.rawReviews} cleanedReviews={results?.cleanedReviews} />
              </TabsContent>
              <TabsContent value="findings" className="mt-4">
                <FindingsView findings={results?.findings} />
              </TabsContent>
              <TabsContent value="prd" className="mt-4">
                <PRDView requirements={results?.requirements} />
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

          {!results && state.stage === "idle" && (
            <div className="text-center py-12 text-gray-400 space-y-2">
              <div className="text-5xl">🍎</div>
              <p className="text-lg">输入 App Store 链接开始分析</p>
              <p className="text-sm">支持美区 App Store · 自动采集评论 · AI 分析 · 生成 PRD 和测试用例</p>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}

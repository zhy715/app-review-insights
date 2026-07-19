"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataImport } from "./DataImport";
import type { RawReview } from "@/lib/types";

interface AppInputProps {
  onStart: (appUrl: string, analysisGoal: string, importData?: RawReview[]) => void;
  isRunning: boolean;
  onLoadSampleResults?: () => void;
}

export function AppInput({ onStart, isRunning, onLoadSampleResults }: AppInputProps) {
  const [appUrl, setAppUrl] = useState(
    "https://apps.apple.com/us/app/workout-for-women-home-gym/id839285684"
  );
  const [analysisGoal, setAnalysisGoal] = useState("");
  const [importData, setImportData] = useState<RawReview[] | null>(null);

  const handleStart = () => {
    onStart(appUrl, analysisGoal, importData || undefined);
  };

  const canStart =
    !isRunning && (appUrl.trim() !== "" || importData !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          🍎 App Review Insights
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* App Store URL */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">
            App Store URL <span className="text-gray-400">(美区)</span>
          </label>
          <Input
            placeholder="https://apps.apple.com/us/app/.../idXXXXXX"
            value={appUrl}
            onChange={(e) => {
              setAppUrl(e.target.value);
              setImportData(null); // Clear import when URL is edited
            }}
            disabled={isRunning}
          />
        </div>

        {/* Analysis Goal */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">
            分析目标 <span className="text-gray-400">(可选)</span>
          </label>
          <Textarea
            placeholder="例如：关注订阅转化问题、分析低分评论原因、聚焦某个版本的功能反馈..."
            value={analysisGoal}
            onChange={(e) => setAnalysisGoal(e.target.value)}
            disabled={isRunning}
            rows={2}
            className="resize-none"
          />
        </div>

        {/* Data Import */}
        <DataImport
          onDataLoaded={(data) => {
            setImportData(data);
            setAppUrl(""); // Clear URL when data imported
          }}
          disabled={isRunning}
        />

        {importData && (
          <div className="text-sm text-green-600 bg-green-50 rounded-lg p-2 px-3">
            ✓ 已导入 {importData.length} 条评论数据
          </div>
        )}

        {/* Start Button */}
        <div className="flex gap-2">
          <Button
            onClick={handleStart}
            disabled={!canStart}
            className="flex-1"
            size="lg"
          >
            {isRunning ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin">⏳</span> 分析中...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                🚀 开始分析
              </span>
            )}
          </Button>
          {!isRunning && (
            <Button
              onClick={async () => {
                try {
                  const res = await fetch("/data/sample-reviews.json");
                  const data = await res.json();
                  const reviews = data.reviews || data;
                  onStart("", analysisGoal, Array.isArray(reviews) ? reviews : []);
                } catch {
                  // fallback silent
                }
              }}
              variant="outline"
              size="lg"
              title="使用内置样例数据快速测试 AI 分析管道"
            >
              🧪 快速测试
            </Button>
          )}
          {!isRunning && onLoadSampleResults && (
            <Button
              onClick={onLoadSampleResults}
              variant="outline"
              size="lg"
              title="无需 API Key，直接查看预计算的完整分析结果（分类/发现/PRD/测试用例/追溯链）"
            >
              📖 查看示例结果
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

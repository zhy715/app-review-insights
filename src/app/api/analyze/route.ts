import { NextRequest, NextResponse } from "next/server";
import { extractAppId, isAppStoreUrl } from "@/lib/sse";
import { fetchAllReviews } from "@/lib/collector";
import { cleanReviews, processImportedReviews } from "@/lib/cleaner";
import { classifyReviews } from "@/lib/classifier";
import { analyzeFindings } from "@/lib/analyzer";
import { generatePRD } from "@/lib/prd-generator";
import { generateTestCases } from "@/lib/test-generator";
import { validateTraceability } from "@/lib/validator";
import type { PipelineResults, AnalysisInput } from "@/lib/types";

// ============================================================
// POST /api/analyze — Full analysis pipeline (returns JSON)
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // 10 minutes timeout

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input: AnalysisInput = {
      appUrl: body.appUrl || undefined,
      analysisGoal: body.analysisGoal || "",
      importData: body.importData || undefined,
    };

    if (!input.appUrl && !input.importData) {
      return NextResponse.json(
        { error: "请提供 App Store 链接或导入评论数据" },
        { status: 400 }
      );
    }

    const results: Partial<PipelineResults> = {
      analysisGoal: input.analysisGoal,
    };

    // Stage 1: Collect
    let rawReviews;
    let appName = "Unknown App";
    let appId = "";

    if (input.importData && input.importData.length > 0) {
      rawReviews = processImportedReviews(input.importData);
      appName = "Imported Data";
      appId = "imported";
    } else if (input.appUrl && isAppStoreUrl(input.appUrl)) {
      appId = extractAppId(input.appUrl) || "";
      const result = await fetchAllReviews(input.appUrl, "us");
      rawReviews = result.reviews;
      appName = result.appName;
      appId = result.appId;
    } else {
      return NextResponse.json(
        { error: "无效的 App Store 链接" },
        { status: 400 }
      );
    }

    if (rawReviews.length === 0) {
      // Ultimate fallback: use built-in sample data
      try {
        const fs = await import("fs/promises");
        const path = await import("path");
        const samplePath = path.join(process.cwd(), "public/data/sample-reviews.json");
        const sampleRaw = await fs.readFile(samplePath, "utf-8");
        const sampleData = JSON.parse(sampleRaw);
        rawReviews = processImportedReviews(sampleData.reviews || sampleData);
        appName = "样例数据（Apple 接口暂时不可用）";
        appId = "sample-fallback";
      } catch {
        return NextResponse.json(
          { error: "未找到评论数据，且样例数据加载失败。请稍后重试或导入 JSON/CSV 数据。" },
          { status: 404 }
        );
      }
    }

    results.rawReviews = rawReviews;
    results.appName = appName;
    results.appId = appId;

    // Stage 2: Clean
    const { reviews: cleanedReviews } = cleanReviews(rawReviews);
    results.cleanedReviews = cleanedReviews;

    if (cleanedReviews.length === 0) {
      return NextResponse.json(
        { error: "所有评论都是空的或重复的" },
        { status: 400 }
      );
    }

    // Stage 3: Classify
    const batchSize = 25;
    const classificationResults = await classifyReviews(
      cleanedReviews,
      batchSize
    );
    const allClassifications = classificationResults.flatMap((r) => r.classifications);
    results.classifications = allClassifications;

    // Stage 4: Analyze
    const analysisResult = await analyzeFindings(
      allClassifications,
      cleanedReviews,
      input.analysisGoal || "",
      appName
    );
    results.findings = analysisResult.findings;

    // Stage 5: PRD
    const prdResult = await generatePRD(
      analysisResult.findings,
      input.analysisGoal || "",
      appName
    );
    results.requirements = prdResult.requirements;

    // Stage 6: Test Cases
    const testResult = await generateTestCases(prdResult.requirements);
    results.testCases = testResult.testCases;

    // Stage 7: Validate
    const validation = validateTraceability(
      rawReviews,
      cleanedReviews,
      allClassifications,
      analysisResult.findings,
      prdResult.requirements,
      testResult.testCases
    );
    results.validation = validation;

    return NextResponse.json({
      success: true,
      results,
    });
  } catch (err) {
    console.error("Pipeline error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "分析过程中出现错误",
        detail: err instanceof Error ? err.stack : undefined,
      },
      { status: 500 }
    );
  }
}

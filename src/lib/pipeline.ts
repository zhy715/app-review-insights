import type { PipelineResults, AnalysisInput } from "./types";
import { extractAppId, isAppStoreUrl, createSSEResponse } from "./sse";
import { fetchAllReviews } from "./collector";
import { cleanReviews, processImportedReviews } from "./cleaner";
import { classifyReviews } from "./classifier";
import { analyzeFindings } from "./analyzer";
import { generatePRD } from "./prd-generator";
import { generateTestCases } from "./test-generator";
import { validateTraceability } from "./validator";

// ============================================================
// Pipeline Orchestrator
// Runs the full analysis pipeline with SSE progress updates
// Intermediate stages only send progress (no data payload)
// Full results are sent only at the "complete" stage
// ============================================================

export function createAnalyzePipeline(
  input: AnalysisInput,
  signal: AbortSignal
): Response {
  return createSSEResponse(signal, async (send) => {
    const results: Partial<PipelineResults> = {
      analysisGoal: input.analysisGoal,
    };

    // ============================================================
    // Stage 1: Collect reviews
    // ============================================================
    send({
      stage: "collecting",
      progress: 5,
      message: "正在采集评论数据...",
    });

    let rawReviews;
    let appName = "Unknown App";
    let appId = "";

    if (input.importData && input.importData.length > 0) {
      rawReviews = processImportedReviews(input.importData);
      appName = "Imported Data";
      appId = "imported";
      send({
        stage: "collecting",
        progress: 15,
        message: `已导入 ${rawReviews.length} 条评论`,
      });
    } else if (input.appUrl && isAppStoreUrl(input.appUrl)) {
      appId = extractAppId(input.appUrl) || "";
      try {
        const result = await fetchAllReviews(
          input.appUrl,
          "us",
          (page, total) => {
            send({
              stage: "collecting",
              progress: 5 + Math.floor((page / 10) * 10),
              message: `正在采集评论... 第 ${page}/10 页，已获取 ${total} 条`,
            });
          }
        );
        rawReviews = result.reviews;
        appName = result.appName;
        appId = result.appId;
      } catch (err) {
        send({
          stage: "error",
          progress: 5,
          message: `评论采集失败: ${err instanceof Error ? err.message : "未知错误"}`,
        });
        return;
      }
    } else {
      send({
        stage: "error",
        progress: 0,
        message: "请提供有效的 App Store 链接或导入评论数据",
      });
      return;
    }

    if (rawReviews.length === 0) {
      send({
        stage: "error",
        progress: 10,
        message: "未找到任何评论。该应用可能没有评论，或 RSS Feed 未返回数据。",
      });
      return;
    }

    results.rawReviews = rawReviews;
    results.appName = appName;
    results.appId = appId;

    send({
      stage: "collecting",
      progress: 15,
      message: `✓ 已采集 ${rawReviews.length} 条评论 (${appName})`,
    });

    // ============================================================
    // Stage 2: Clean and deduplicate
    // ============================================================
    send({
      stage: "cleaning",
      progress: 20,
      message: "正在清洗和去重评论数据...",
    });

    const { reviews: cleanedReviews, stats: cleaningStats } =
      cleanReviews(rawReviews);

    results.cleanedReviews = cleanedReviews;

    send({
      stage: "cleaning",
      progress: 25,
      message: `✓ 清洗完成: ${cleaningStats.finalCount} 条有效评论 (ID去重 ${cleaningStats.duplicatesById}，内容去重 ${cleaningStats.duplicatesByContent}，空内容 ${cleaningStats.emptyContent})`,
    });

    if (cleanedReviews.length === 0) {
      send({
        stage: "error",
        progress: 25,
        message: "所有评论均为空或重复，没有可分析的内容。",
      });
      return;
    }

    // ============================================================
    // Stage 3: LLM Classification
    // ============================================================
    send({
      stage: "classifying",
      progress: 30,
      message: "正在使用 AI 对评论进行主题分类...",
    });

    const batchSize = 25;
    const classificationResults = await classifyReviews(
      cleanedReviews,
      batchSize,
      (batchIndex, totalBatches) => {
        const baseProgress = 30;
        const rangeProgress = 15;
        const pct =
          baseProgress +
          Math.floor(((batchIndex + 1) / totalBatches) * rangeProgress);
        send({
          stage: "classifying",
          progress: pct,
          message: `AI 分类中... 第 ${batchIndex + 1}/${totalBatches} 批`,
        });
      }
    );

    const allClassifications = classificationResults.flatMap(
      (r) => r.classifications
    );
    results.classifications = allClassifications;

    send({
      stage: "classifying",
      progress: 45,
      message: `✓ 分类完成: ${allClassifications.length} 条评论已标注主题和情感`,
    });

    // ============================================================
    // Stage 4: LLM Analysis → Findings
    // ============================================================
    send({
      stage: "analyzing",
      progress: 50,
      message: "正在使用 AI 分析问题模式并生成发现...",
    });

    const analysisResult = await analyzeFindings(
      allClassifications,
      cleanedReviews,
      input.analysisGoal || "",
      appName
    );

    results.findings = analysisResult.findings;

    send({
      stage: "analyzing",
      progress: 65,
      message: `✓ 分析完成: 发现 ${analysisResult.findings.length} 个产品问题`,
    });

    // ============================================================
    // Stage 5: LLM PRD Generation
    // ============================================================
    send({
      stage: "generating_prd",
      progress: 70,
      message: "正在使用 AI 生成产品需求文档 (PRD)...",
    });

    const prdResult = await generatePRD(
      analysisResult.findings,
      input.analysisGoal || "",
      appName
    );

    results.requirements = prdResult.requirements;

    send({
      stage: "generating_prd",
      progress: 80,
      message: `✓ PRD 生成完成: ${prdResult.requirements.length} 条需求，覆盖版本: ${prdResult.versionPlan.map((v) => v.version).join(", ")}`,
    });

    // ============================================================
    // Stage 6: LLM Test Case Generation
    // ============================================================
    send({
      stage: "generating_tests",
      progress: 85,
      message: "正在使用 AI 生成测试用例...",
    });

    const testResult = await generateTestCases(prdResult.requirements);

    results.testCases = testResult.testCases;

    send({
      stage: "generating_tests",
      progress: 92,
      message: `✓ 测试用例生成完成: ${testResult.testCases.length} 条用例`,
    });

    // ============================================================
    // Stage 7: Validation
    // ============================================================
    send({
      stage: "validating",
      progress: 95,
      message: "正在验证追溯链完整性...",
    });

    const validation = validateTraceability(
      rawReviews,
      cleanedReviews,
      allClassifications,
      analysisResult.findings,
      prdResult.requirements,
      testResult.testCases
    );

    results.validation = validation;

    const warningCount = validation.issues.filter(
      (i) => i.severity === "warning"
    ).length;
    const errorCount = validation.issues.filter(
      (i) => i.severity === "error"
    ).length;

    send({
      stage: "validating",
      progress: 98,
      message: `✓ 校验完成: ${validation.passed ? "通过" : "存在问题"} (${errorCount} 错误, ${warningCount} 警告, ${validation.coveredReviews}/${validation.totalReviews} 评论已覆盖)`,
      warnings: validation.issues
        .filter((i) => i.severity === "warning")
        .map((i) => i.message),
      errors: validation.issues
        .filter((i) => i.severity === "error")
        .map((i) => ({
          stage: "validating" as const,
          message: i.message,
          detail: i.details,
          timestamp: new Date().toISOString(),
        })),
    });

    // ============================================================
    // Stage 8: Complete — send ALL results at once
    // ============================================================
    send({
      stage: "complete",
      progress: 100,
      message: `🎉 分析完成! ${results.findings?.length || 0} 个发现, ${results.requirements?.length || 0} 条需求, ${results.testCases?.length || 0} 条测试用例`,
      data: results,
    });
  });
}

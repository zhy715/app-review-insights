import { NextRequest, NextResponse } from "next/server";
import { extractAppId, isAppStoreUrl } from "@/lib/sse";
import { fetchAllReviews } from "@/lib/collector";
import { cleanReviews, processImportedReviews } from "@/lib/cleaner";
import { classifyReviews } from "@/lib/classifier";
import { analyzeFindings } from "@/lib/analyzer";
import { generatePRD } from "@/lib/prd-generator";
import { generateTestCases } from "@/lib/test-generator";
import { validateTraceability } from "@/lib/validator";
import { parseAnalysisGoal, applyGoalFilter } from "@/lib/goal-filter";
import type { PipelineResults, AnalysisInput, AppMetadata } from "@/lib/types";

// ============================================================
// In-memory job store for async analysis
// ============================================================
interface Job {
  id: string;
  status: "running" | "complete" | "error";
  progress: number;
  message: string;
  results?: Partial<PipelineResults>;
  error?: string;
}

const jobs = new Map<string, Job>();

// Clean up old jobs periodically (every 30 min)
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const created = parseInt(id.split("-")[1], 10);
    if (now - created > 30 * 60 * 1000) jobs.delete(id);
  }
}, 30 * 60 * 1000);

// ============================================================
// POST /api/analyze — Start async analysis, returns jobId
// GET  /api/analyze?jobId=xxx — Poll job status
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input: AnalysisInput = {
      appUrl: body.appUrl || undefined,
      analysisGoal: body.analysisGoal || "",
      importData: body.importData || undefined,
    };

    if (!input.appUrl && !input.importData) {
      return NextResponse.json({ error: "请提供 App Store 链接或导入评论数据" }, { status: 400 });
    }

    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job: Job = { id: jobId, status: "running", progress: 0, message: "分析已启动..." };
    jobs.set(jobId, job);

    // Run pipeline in background
    runPipeline(jobId, input).catch((err) => {
      const j = jobs.get(jobId);
      if (j) {
        j.status = "error";
        j.error = err instanceof Error ? err.message : "未知错误";
        j.message = j.error;
      }
    });

    return NextResponse.json({ jobId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "请求无效" },
      { status: 400 }
    );
  }
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "缺少 jobId 参数" }, { status: 400 });
  }

  const job = jobs.get(jobId);
  if (!job) {
    return NextResponse.json({ error: "任务不存在或已过期" }, { status: 404 });
  }

  return NextResponse.json(job);
}

// ============================================================
// Background pipeline runner
// ============================================================
async function runPipeline(jobId: string, input: AnalysisInput) {
  const job = jobs.get(jobId)!;
  const results: Partial<PipelineResults> = { analysisGoal: input.analysisGoal };

  const updateJob = (progress: number, message: string) => {
    job.progress = progress;
    job.message = message;
  };

  try {
    // Stage 1: Collect
    updateJob(5, "正在采集评论数据...");
    let rawReviews;
    let appName = "Unknown App";
    let appId = "";
    let appMetadata: AppMetadata | undefined;

    if (input.importData && input.importData.length > 0) {
      rawReviews = processImportedReviews(input.importData);
      appName = "Imported Data";
      appId = "imported";
      updateJob(15, `已导入 ${rawReviews.length} 条评论`);
    } else if (input.appUrl && isAppStoreUrl(input.appUrl)) {
      appId = extractAppId(input.appUrl) || "";
      const result = await fetchAllReviews(input.appUrl, "us");
      rawReviews = result.reviews;
      appName = result.appName;
      appId = result.appId;
      appMetadata = result.appMetadata;
    } else {
      job.status = "error";
      job.error = "无效的 App Store 链接";
      return;
    }

    if (rawReviews.length === 0) {
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
        job.status = "error";
        job.error = "未找到评论数据，样例数据加载也失败";
        return;
      }
    }

    results.rawReviews = rawReviews;
    results.appName = appName;
    results.appId = appId;
    results.appMetadata = appMetadata;
    updateJob(15, `✓ 已采集 ${rawReviews.length} 条评论${appMetadata ? `（${appMetadata.trackName} · 全量评分 ${appMetadata.averageUserRating.toFixed(1)}/5 · ${appMetadata.userRatingCount} 评分）` : ""}`);

    // Stage 2: Clean
    updateJob(20, "正在清洗数据...");
    const { reviews: cleanedReviews } = cleanReviews(rawReviews);
    results.cleanedReviews = cleanedReviews;
    updateJob(25, `✓ 清洗完成: ${cleanedReviews.length} 条有效评论`);

    // Stage 2.5: Apply analysis-goal filter (task #01)
    // The analysis goal must narrow the SCOPE of the data analysed, not just
    // be appended to the LLM prompt. Parse it into concrete filters and run
    // all downstream stages on the filtered subset.
    const goalFilter = parseAnalysisGoal(input.analysisGoal);
    let reviewsForAnalysis = cleanedReviews;
    if (goalFilter.applied) {
      reviewsForAnalysis = applyGoalFilter(cleanedReviews, goalFilter);
      if (reviewsForAnalysis.length === 0) {
        updateJob(27, `⚠ 分析目标过滤后无评论（${goalFilter.description}），回退到全部评论`);
        reviewsForAnalysis = cleanedReviews;
      } else if (reviewsForAnalysis.length < cleanedReviews.length) {
        updateJob(27, `✓ 按分析目标过滤: ${cleanedReviews.length} → ${reviewsForAnalysis.length} 条（${goalFilter.description}）`);
      }
    }

    // Helper: retry an LLM stage with backoff
    const retryStage = async <T>(fn: () => Promise<T>, label: string, maxTries = 3): Promise<T> => {
      for (let i = 0; i < maxTries; i++) {
        try {
          return await fn();
        } catch (err) {
          const msg = err instanceof Error ? err.message : "";
          if (i < maxTries - 1 && (msg.includes("terminated") || msg.includes("timeout") || msg.includes("rate"))) {
            const wait = (i + 1) * 5000;
            updateJob(job.progress, `${label} — 暂时中断，${wait / 1000}s 后重试 (${i + 1}/${maxTries})...`);
            await new Promise((r) => setTimeout(r, wait));
            continue;
          }
          throw err;
        }
      }
      throw new Error(`${label} 重试耗尽`);
    };

    // Stage 3: Classify
    updateJob(30, "正在 AI 分类...");
    const classificationResults = await retryStage(() => classifyReviews(reviewsForAnalysis, 10), "AI 分类");
    const allClassifications = classificationResults.flatMap((r) => r.classifications);
    results.classifications = allClassifications;
    updateJob(45, `✓ 分类完成: ${allClassifications.length} 条`);

    // Stage 4: Analyze
    updateJob(50, "正在 AI 深度分析...");
    const analysisResult = await retryStage(() => analyzeFindings(allClassifications, reviewsForAnalysis, input.analysisGoal || "", appName, appMetadata), "AI 深度分析");
    results.findings = analysisResult.findings;
    updateJob(65, `✓ 发现 ${analysisResult.findings.length} 个问题`);

    // Stage 5: PRD
    updateJob(70, "正在生成 PRD...");
    const prdResult = await retryStage(() => generatePRD(analysisResult.findings, input.analysisGoal || "", appName), "PRD 生成");
    results.requirements = prdResult.requirements;
    // P0-1: persist versionPlan + executiveSummary so the UI can render them.
    // Previously these were generated (tokens spent) and then thrown away.
    results.versionPlan = prdResult.versionPlan;
    results.executiveSummary = prdResult.executiveSummary;
    updateJob(80, `✓ 生成 ${prdResult.requirements.length} 条需求（版本规划: ${prdResult.versionPlan.map((v) => v.version).join(", ")}）`);

    // Stage 6: Tests
    updateJob(85, "正在生成测试用例...");
    const testResult = await retryStage(() => generateTestCases(prdResult.requirements), "测试用例生成");
    results.testCases = testResult.testCases;
    updateJob(92, `✓ 生成 ${testResult.testCases.length} 条用例`);

    // Stage 7: Validate
    updateJob(95, "正在校验...");
    const validation = validateTraceability(rawReviews, cleanedReviews, allClassifications, analysisResult.findings, prdResult.requirements, testResult.testCases);

    // P1-3: Apply revisions — actually remove/downgrade unsupported conclusions
    // rather than only flagging them. This is the "revision mechanism" the
    // task asks for (task #08).
    if (validation.revokedRequirementIds.length > 0) {
      const revokedReqSet = new Set(validation.revokedRequirementIds);
      results.requirements = (results.requirements || []).filter(
        (r) => !revokedReqSet.has(r.id)
      );
    }
    if (validation.revokedTestCaseIds.length > 0) {
      const revokedTcSet = new Set(validation.revokedTestCaseIds);
      results.testCases = (results.testCases || []).filter(
        (tc) => !revokedTcSet.has(tc.id)
      );
    }
    if (validation.downgradedFindingIds.length > 0) {
      const downgradedSet = new Set(validation.downgradedFindingIds);
      results.findings = (results.findings || []).map((f) =>
        downgradedSet.has(f.id)
          ? {
              ...f,
              uncertaintyNotes:
                `⚠ 证据不足（置信度 ${(f.confidence * 100).toFixed(0)}%），已降级为假设性结论。` +
                (f.uncertaintyNotes ? ` ${f.uncertaintyNotes}` : ""),
            }
          : f
      );
    }

    results.validation = validation;

    const revisionMsg =
      validation.revokedRequirementIds.length > 0 || validation.downgradedFindingIds.length > 0
        ? `（已剔除 ${validation.revokedRequirementIds.length} 条无证据需求，降级 ${validation.downgradedFindingIds.length} 条低置信度发现）`
        : "";
    updateJob(98, `✓ 校验完成 ${revisionMsg}`);

    // Complete
    job.status = "complete";
    job.progress = 100;
    job.message = `🎉 分析完成! ${results.findings?.length || 0} 个发现, ${results.requirements?.length || 0} 条需求, ${results.testCases?.length || 0} 条测试用例`;
    job.results = results;
  } catch (err) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : "分析过程中出现错误";
    job.message = job.error;
  }
}

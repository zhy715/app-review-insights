import { NextRequest } from "next/server";
import { createAnalyzePipeline } from "@/lib/pipeline";
import type { AnalysisInput } from "@/lib/types";

// ============================================================
// POST /api/analyze — Start full analysis pipeline (SSE stream)
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const input: AnalysisInput = {
      appUrl: body.appUrl || undefined,
      analysisGoal: body.analysisGoal || "",
      importData: body.importData || undefined,
    };

    if (!input.appUrl && !input.importData) {
      return new Response(
        JSON.stringify({
          error: "Please provide an App Store URL or import review data.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    return createAnalyzePipeline(input, req.signal);
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Invalid request",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
}

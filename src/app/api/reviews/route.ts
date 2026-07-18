import { NextRequest, NextResponse } from "next/server";
import { fetchAllReviews } from "@/lib/collector";
import { cleanReviews } from "@/lib/cleaner";

// ============================================================
// POST /api/reviews — Fetch and clean reviews (without AI analysis)
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { appUrl } = body;

    if (!appUrl) {
      return NextResponse.json(
        { error: "Please provide an App Store URL." },
        { status: 400 }
      );
    }

    // Fetch reviews
    const { reviews: rawReviews, appName, appId } = await fetchAllReviews(
      appUrl,
      "us"
    );

    // Clean reviews
    const { reviews: cleanedReviews, stats } = cleanReviews(rawReviews);

    return NextResponse.json({
      appName,
      appId,
      rawReviews,
      cleanedReviews,
      stats,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to fetch reviews",
      },
      { status: 500 }
    );
  }
}

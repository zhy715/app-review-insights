import { NextRequest, NextResponse } from "next/server";
import { processImportedReviews } from "@/lib/cleaner";
import Papa from "papaparse";

// ============================================================
// POST /api/import — Import reviews from JSON or CSV
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    let rawData: unknown[] = [];

    if (contentType.includes("application/json")) {
      const body = await req.json();

      // Accept both array and { reviews: [...] } format
      if (Array.isArray(body)) {
        rawData = body;
      } else if (body.reviews && Array.isArray(body.reviews)) {
        rawData = body.reviews;
      } else {
        return NextResponse.json(
          {
            error:
              "JSON must be an array of reviews or an object with a 'reviews' array.",
          },
          { status: 400 }
        );
      }
    } else if (
      contentType.includes("text/csv") ||
      contentType.includes("text/plain") ||
      contentType.includes("multipart/form-data")
    ) {
      // Handle CSV
      let csvText: string;

      if (contentType.includes("multipart/form-data")) {
        const formData = await req.formData();
        const file = formData.get("file");
        if (!file || !(file instanceof File)) {
          return NextResponse.json(
            { error: "No file uploaded." },
            { status: 400 }
          );
        }
        csvText = await file.text();
      } else {
        csvText = await req.text();
      }

      const parsed = Papa.parse<Record<string, unknown>>(csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.toLowerCase().trim(),
      });

      if (parsed.errors.length > 0) {
        return NextResponse.json(
          {
            error: "CSV parsing error",
            details: parsed.errors.slice(0, 5),
          },
          { status: 400 }
        );
      }

      rawData = parsed.data;
    } else {
      return NextResponse.json(
        {
          error:
            "Unsupported content type. Use application/json or text/csv.",
        },
        { status: 400 }
      );
    }

    // Process imported data
    const reviews = processImportedReviews(
      rawData as Record<string, unknown>[]
    );

    if (reviews.length === 0) {
      return NextResponse.json(
        { error: "No valid reviews found in the imported data." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      reviews,
      count: reviews.length,
      message: `Successfully imported ${reviews.length} reviews.`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to import reviews",
      },
      { status: 500 }
    );
  }
}

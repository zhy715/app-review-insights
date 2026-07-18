"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { RawReview } from "@/lib/types";

interface DataImportProps {
  onDataLoaded: (reviews: RawReview[]) => void;
  disabled: boolean;
}

export function DataImport({ onDataLoaded, disabled }: DataImportProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setError("");

    try {
      const text = await file.text();
      let reviews: RawReview[];

      if (file.name.endsWith(".json")) {
        const parsed = JSON.parse(text);
        const arr = Array.isArray(parsed)
          ? parsed
          : parsed.reviews || [];
        reviews = arr
          .filter((r: Record<string, unknown>) => r.content)
          .map((r: Record<string, unknown>, i: number) => ({
            id: String(r.id || `imported-${i}`),
            rating: Number(r.rating) || 3,
            title: String(r.title || ""),
            content: String(r.content || ""),
            author: String(r.author || "Imported"),
            date: String(r.date || new Date().toISOString()),
            version: r.version ? String(r.version) : undefined,
          }));
      } else if (file.name.endsWith(".csv")) {
        // Simple CSV parsing (for complex cases, the import API handles it)
        const lines = text.split("\n").filter((l) => l.trim());
        if (lines.length < 2) {
          throw new Error(
            "CSV file must have a header row and at least one data row."
          );
        }
        const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
        const contentIdx = headers.findIndex(
          (h) => h === "content" || h === "review" || h === "text"
        );
        const ratingIdx = headers.findIndex(
          (h) => h === "rating" || h === "score" || h === "stars"
        );
        const titleIdx = headers.findIndex((h) => h === "title");
        const authorIdx = headers.findIndex(
          (h) => h === "author" || h === "username" || h === "user"
        );
        const dateIdx = headers.findIndex((h) => h === "date");
        const versionIdx = headers.findIndex((h) => h === "version");

        if (contentIdx === -1) {
          throw new Error(
            "CSV must have a 'content', 'review', or 'text' column."
          );
        }

        reviews = lines.slice(1).map((line, i) => {
          // Handle quoted fields
          const fields = parseCSVLine(line);
          return {
            id: `imported-csv-${i}`,
            rating: ratingIdx >= 0 ? parseInt(fields[ratingIdx]) || 3 : 3,
            title: titleIdx >= 0 ? fields[titleIdx] || "" : "",
            content: fields[contentIdx] || "",
            author: authorIdx >= 0 ? fields[authorIdx] || "Imported" : "Imported",
            date:
              dateIdx >= 0 ? fields[dateIdx] || new Date().toISOString() : new Date().toISOString(),
            version: versionIdx >= 0 ? fields[versionIdx] || undefined : undefined,
          };
        });
      } else {
        throw new Error("Unsupported file format. Use .json or .csv files.");
      }

      const validReviews = reviews.filter((r) => r.content.trim().length > 0);
      if (validReviews.length === 0) {
        throw new Error("No valid reviews found (all had empty content).");
      }

      onDataLoaded(validReviews);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to parse file"
      );
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div>
      <label className="text-sm font-medium mb-1.5 block">
        或导入数据 <span className="text-gray-400">(JSON / CSV)</span>
      </label>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || importing}
        >
          {importing ? "导入中..." : "📁 选择文件"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.csv"
          onChange={handleFile}
          className="hidden"
        />
        <span className="text-xs text-gray-400">
          JSON: {"{ reviews: [...] }"} 或直接数组; CSV: 需包含 content/review/text 列
        </span>
      </div>
      {error && (
        <p className="text-sm text-red-500 mt-1">⚠ {error}</p>
      )}
    </div>
  );
}

/**
 * Parse a CSV line, handling quoted fields with commas
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

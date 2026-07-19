"use client";

import { useMemo } from "react";
import type { AppMetadata, RawReview } from "@/lib/types";

interface AppMetadataCardProps {
  metadata?: AppMetadata;
  rawReviews?: RawReview[];
}

/**
 * Shows App Store context above the analysis tabs: icon, name, seller,
 * current version, full-store average rating vs the sampled reviews' average.
 *
 * The sample-vs-full-store comparison is the key signal — a large gap means
 * the collected reviews do not represent the overall user base (RSS/amp-api
 * surface recent reviews, which skew negative after a bad release). The Data
 * Limitations finding flags this quantitatively; this card surfaces it at a
 * glance so the reviewer calibrates expectations before reading findings.
 */
export function AppMetadataCard({ metadata, rawReviews }: AppMetadataCardProps) {
  const sampleAvg = useMemo(() => {
    if (!rawReviews || rawReviews.length === 0) return null;
    const sum = rawReviews.reduce((s, r) => s + r.rating, 0);
    return sum / rawReviews.length;
  }, [rawReviews]);

  if (!metadata) return null;

  const fullAvg = metadata.averageUserRating;
  const gap = sampleAvg !== null ? sampleAvg - fullAvg : 0;
  const gapAbs = Math.abs(gap);
  const isBiased = gapAbs >= 0.7;
  const biasLabel = isBiased
    ? gap < 0
      ? "样本偏低，不代表整体"
      : "样本偏高，不代表整体"
    : null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4 shadow-sm">
      {metadata.artworkUrl100 && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={metadata.artworkUrl512 || metadata.artworkUrl100}
          alt={metadata.trackName}
          className="w-16 h-16 rounded-2xl flex-shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h2 className="text-lg font-semibold text-gray-900 truncate">
            {metadata.trackName}
          </h2>
          {metadata.primaryGenreName && (
            <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
              {metadata.primaryGenreName}
            </span>
          )}
        </div>
        <div className="text-sm text-gray-500 mt-0.5">
          {metadata.sellerName} · 当前版本 {metadata.version}
        </div>
      </div>
      <div className="flex items-center gap-6 text-right flex-shrink-0">
        <div>
          <div className="text-2xl font-bold text-gray-900">
            {fullAvg.toFixed(1)}
          </div>
          <div className="text-xs text-gray-500">
            全量评分 · {metadata.userRatingCount.toLocaleString()} 条
          </div>
        </div>
        {sampleAvg !== null && (
          <div>
            <div
              className={`text-2xl font-bold ${
                isBiased
                  ? gap < 0
                    ? "text-red-600"
                    : "text-green-600"
                  : "text-gray-900"
              }`}
            >
              {sampleAvg.toFixed(1)}
            </div>
            <div className="text-xs text-gray-500">
              样本评分 · {rawReviews?.length} 条
              {biasLabel && (
                <span className="block text-amber-600 mt-0.5">⚠ {biasLabel}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

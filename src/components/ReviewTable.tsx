"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { RawReview, CleanedReview } from "@/lib/types";

interface ReviewTableProps {
  rawReviews?: RawReview[];
  cleanedReviews?: CleanedReview[];
  stats?: { totalRaw: number; duplicatesById: number; duplicatesByContent: number; emptyContent: number; finalCount: number };
}

export function ReviewTable({ rawReviews, cleanedReviews, stats }: ReviewTableProps) {
  const displayReviews = cleanedReviews || rawReviews;

  if (!displayReviews || displayReviews.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-gray-400">
          暂无评论数据。开始分析以获取数据。
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <StatBadge label="原始数据" value={stats.totalRaw} />
          <StatBadge label="ID去重" value={stats.duplicatesById} variant="warning" />
          <StatBadge label="内容去重" value={stats.duplicatesByContent} variant="warning" />
          <StatBadge label="空内容" value={stats.emptyContent} variant="destructive" />
          <StatBadge label="有效数据" value={stats.finalCount} variant="default" />
        </div>
      )}

      {/* Review list */}
      <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
        {displayReviews.map((review) => {
          const isCleaned = "language" in review && "normalizedContent" in review;
          const cleaned = review as CleanedReview;
          const content = isCleaned ? cleaned.normalizedContent : (review as RawReview).content;

          return (
            <Card key={review.id} className="text-sm">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Rating */}
                  <span className="font-mono font-bold">
                    {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}
                  </span>
                  {/* Version */}
                  {review.version && (
                    <Badge variant="outline" className="text-xs">
                      v{review.version}
                    </Badge>
                  )}
                  {/* Language */}
                  {isCleaned && (
                    <Badge variant="secondary" className="text-xs">
                      {cleaned.language}
                    </Badge>
                  )}
                  {/* Date */}
                  <span className="text-gray-400 text-xs ml-auto">
                    {review.date ? new Date(review.date).toLocaleDateString() : ""}
                  </span>
                </div>
                {/* Title */}
                {review.title && (
                  <p className="font-medium text-gray-800">{review.title}</p>
                )}
                {/* Content */}
                <p className="text-gray-600 leading-relaxed whitespace-pre-wrap line-clamp-4">
                  {content}
                </p>
                {/* Author */}
                <p className="text-xs text-gray-400">— {review.author}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function StatBadge({
  label,
  value,
  variant = "default",
}: {
  label: string;
  value: number;
  variant?: "default" | "warning" | "destructive";
}) {
  const colors = {
    default: "bg-blue-50 text-blue-700 border-blue-200",
    warning: "bg-yellow-50 text-yellow-700 border-yellow-200",
    destructive: "bg-red-50 text-red-700 border-red-200",
  };
  return (
    <div className={`rounded-lg border px-3 py-2 text-center ${colors[variant]}`}>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

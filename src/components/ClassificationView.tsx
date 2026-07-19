"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  ReviewClassification,
  CleanedReview,
} from "@/lib/types";

interface ClassificationViewProps {
  classifications?: ReviewClassification[];
  cleanedReviews?: CleanedReview[];
}

type SentimentKey = "positive" | "negative" | "neutral" | "mixed";
type SeverityKey = "critical" | "major" | "minor" | "suggestion";

const SENTIMENT_COLORS: Record<SentimentKey, string> = {
  positive: "bg-green-100 text-green-800 border-green-300",
  negative: "bg-red-100 text-red-800 border-red-300",
  neutral: "bg-gray-100 text-gray-700 border-gray-300",
  mixed: "bg-yellow-100 text-yellow-800 border-yellow-300",
};

const SENTIMENT_LABELS: Record<SentimentKey, string> = {
  positive: "😊 正面",
  negative: "😞 负面",
  neutral: "😐 中性",
  mixed: "🟡 混合",
};

const SEVERITY_COLORS: Record<SeverityKey, string> = {
  critical: "bg-red-100 text-red-800 border-red-300",
  major: "bg-orange-100 text-orange-800 border-orange-300",
  minor: "bg-yellow-100 text-yellow-800 border-yellow-300",
  suggestion: "bg-blue-100 text-blue-800 border-blue-300",
};

const SEVERITY_LABELS: Record<SeverityKey, string> = {
  critical: "严重",
  major: "重要",
  minor: "轻微",
  suggestion: "建议",
};

export function ClassificationView({
  classifications,
  cleanedReviews,
}: ClassificationViewProps) {
  const [sentimentFilter, setSentimentFilter] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);
  const [topicFilter, setTopicFilter] = useState<string | null>(null);

  const reviewMap = useMemo(() => {
    return new Map((cleanedReviews || []).map((r) => [r.id, r]));
  }, [cleanedReviews]);

  const stats = useMemo(() => {
    const sentiment: Record<SentimentKey, number> = {
      positive: 0,
      negative: 0,
      neutral: 0,
      mixed: 0,
    };
    const severity: Record<SeverityKey, number> = {
      critical: 0,
      major: 0,
      minor: 0,
      suggestion: 0,
    };
    const topicCounts = new Map<string, number>();
    const areaCounts = new Map<string, number>();

    for (const c of classifications || []) {
      sentiment[c.sentiment]++;
      if (c.severity) severity[c.severity]++;
      for (const t of c.topics) {
        topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
      }
      if (c.featureArea) {
        areaCounts.set(
          c.featureArea,
          (areaCounts.get(c.featureArea) || 0) + 1
        );
      }
    }

    return {
      sentiment,
      severity,
      topTopics: [...topicCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8),
      topAreas: [...areaCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    };
  }, [classifications]);

  const filtered = useMemo(() => {
    if (!classifications) return [];
    return classifications.filter((c) => {
      if (sentimentFilter && c.sentiment !== sentimentFilter) return false;
      if (severityFilter && c.severity !== severityFilter) return false;
      if (topicFilter && !c.topics.includes(topicFilter)) return false;
      return true;
    });
  }, [classifications, sentimentFilter, severityFilter, topicFilter]);

  if (!classifications || classifications.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-gray-400">
          暂无分类结果。运行分析以查看每条评论的主题、情感与严重度标注。
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatCard label="总计" value={classifications.length} color="gray" />
        <StatCard
          label="负面"
          value={stats.sentiment.negative}
          color="red"
        />
        <StatCard
          label="正面"
          value={stats.sentiment.positive}
          color="green"
        />
        <StatCard
          label="严重/重要"
          value={stats.severity.critical + stats.severity.major}
          color="orange"
        />
      </div>

      {/* Sentiment filter */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-gray-500 mr-1">情感:</span>
        <FilterChip
          active={sentimentFilter === null}
          onClick={() => setSentimentFilter(null)}
        >
          全部
        </FilterChip>
        {(Object.keys(SENTIMENT_LABELS) as SentimentKey[]).map((s) => (
            <FilterChip
              key={s}
              active={sentimentFilter === s}
              onClick={() =>
                setSentimentFilter(sentimentFilter === s ? null : s)
              }
            >
              {SENTIMENT_LABELS[s]} ({stats.sentiment[s]})
            </FilterChip>
          ))}
      </div>

      {/* Severity filter */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-gray-500 mr-1">严重度:</span>
        <FilterChip
          active={severityFilter === null}
          onClick={() => setSeverityFilter(null)}
        >
          全部
        </FilterChip>
        {(Object.keys(SEVERITY_LABELS) as SeverityKey[]).map((s) => (
            <FilterChip
              key={s}
              active={severityFilter === s}
              onClick={() =>
                setSeverityFilter(severityFilter === s ? null : s)
              }
            >
              {SEVERITY_LABELS[s]} ({stats.severity[s]})
            </FilterChip>
          ))}
      </div>

      {/* Top topics */}
      {stats.topTopics.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-gray-500 mr-1">主题:</span>
          <FilterChip
            active={topicFilter === null}
            onClick={() => setTopicFilter(null)}
          >
            全部
          </FilterChip>
          {stats.topTopics.map(([topic, count]) => (
            <FilterChip
              key={topic}
              active={topicFilter === topic}
              onClick={() => setTopicFilter(topicFilter === topic ? null : topic)}
            >
              {topic} ({count})
            </FilterChip>
          ))}
        </div>
      )}

      {/* Filtered count */}
      {filtered.length !== classifications.length && (
        <p className="text-xs text-gray-500">
          已过滤: 显示 {filtered.length} / {classifications.length} 条
        </p>
      )}

      {/* Classification list */}
      <div className="space-y-3 max-h-[700px] overflow-y-auto pr-1">
        {filtered.map((c) => {
          const review = reviewMap.get(c.reviewId);
          return (
            <Card key={c.reviewId} className="text-sm">
              <CardContent className="p-4 space-y-2">
                {/* Header: review id + rating */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-gray-400">
                    {c.reviewId}
                  </span>
                  {review && (
                    <span className="font-mono text-xs font-bold">
                      {"★".repeat(review.rating)}
                      {"☆".repeat(5 - review.rating)}
                    </span>
                  )}
                  {review?.version && (
                    <Badge variant="outline" className="text-xs">
                      v{review.version}
                    </Badge>
                  )}

                  {/* Sentiment + severity badges */}
                  <Badge
                    className={`text-xs ${SENTIMENT_COLORS[c.sentiment] || ""}`}
                    variant="outline"
                  >
                    {SENTIMENT_LABELS[c.sentiment] || c.sentiment}
                  </Badge>
                  {c.severity && (
                    <Badge
                      className={`text-xs ${SEVERITY_COLORS[c.severity] || ""}`}
                      variant="outline"
                    >
                      {SEVERITY_LABELS[c.severity] || c.severity}
                    </Badge>
                  )}
                  {c.featureArea && (
                    <Badge variant="secondary" className="text-xs">
                      {c.featureArea}
                    </Badge>
                  )}
                </div>

                {/* Review content (truncated) */}
                {review && (
                  <p className="text-gray-600 leading-relaxed line-clamp-3">
                    {review.normalizedContent || review.content}
                  </p>
                )}

                {/* Topics */}
                {c.topics.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {c.topics.map((t) => (
                      <span
                        key={t}
                        className="text-xs bg-blue-50 text-blue-700 rounded px-1.5 py-0.5"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}

                {/* Key excerpts (verbatim quotes the model pulled out) */}
                {c.keyExcerpts.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">
                      关键摘录:
                    </p>
                    <ul className="space-y-0.5">
                      {c.keyExcerpts.map((e, i) => (
                        <li
                          key={i}
                          className="text-xs text-gray-600 bg-gray-50 rounded px-2 py-1 italic"
                        >
                          &ldquo;{e}&rdquo;
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const colors: Record<string, string> = {
    gray: "bg-gray-50 text-gray-700 border-gray-200",
    red: "bg-red-50 text-red-700 border-red-200",
    green: "bg-green-50 text-green-700 border-green-200",
    orange: "bg-orange-50 text-orange-700 border-orange-200",
  };
  return (
    <div className={`rounded-lg border px-3 py-2 text-center ${colors[color]}`}>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${
        active
          ? "bg-blue-600 text-white border-blue-600"
          : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}

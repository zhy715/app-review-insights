"use client";

import { Card, CardContent } from "@/components/ui/card";
import type {
  Finding,
  CleanedReview,
  AppMetadata,
  ValidationResult,
} from "@/lib/types";

interface EvidenceRadarChartProps {
  findings?: Finding[];
  cleanedReviews?: CleanedReview[];
  appMetadata?: AppMetadata;
  validation?: ValidationResult;
}

interface Dimension {
  key: string;
  label: string;
  score: number;
  detail: string;
}

function computeDimensions(
  findings: Finding[],
  reviews: CleanedReview[],
  appMetadata: AppMetadata | undefined,
  validation: ValidationResult | undefined
): Dimension[] {
  const n = reviews.length;

  // 1. Sample size — more reviews = more reliable findings
  const sampleSize =
    n >= 100 ? 100 : n >= 50 ? 90 : n >= 30 ? 70 : n >= 10 ? 40 : 15;

  // 2. Version coverage — multi-version spread enables version-aware analysis
  const versions = new Set(reviews.map((r) => r.version).filter(Boolean));
  const versionCount = versions.size;
  const versionCoverage =
    versionCount >= 4
      ? 100
      : versionCount === 3
        ? 75
        : versionCount === 2
          ? 50
          : versionCount === 1
            ? 25
            : 30;

  // 3. Sentiment balance — review samples naturally skew negative (venting
  //    behavior). 0.6 negative is a healthy baseline for an app with issues;
  //    extreme skew in either direction hurts reliability.
  const negativeCount = reviews.filter((r) => r.rating <= 2).length;
  const negativeRatio = n > 0 ? negativeCount / n : 0;
  const sentimentBalance = Math.max(
    0,
    Math.min(100, 100 - Math.abs(negativeRatio - 0.6) * 150)
  );

  // 4. Rating representativeness — sample mean vs full-store mean (from
  //    iTunes Lookup). Big gap => sample is not representative.
  let ratingRepresentation = 50;
  let ratingDetail = "无全量数据";
  if (appMetadata && n > 0) {
    const sampleAvg = reviews.reduce((s, r) => s + r.rating, 0) / n;
    const fullAvg = appMetadata.averageUserRating;
    const diff = Math.abs(sampleAvg - fullAvg);
    ratingRepresentation =
      diff < 0.3 ? 100 : diff < 0.7 ? 70 : diff < 1.0 ? 40 : 20;
    ratingDetail = `样本 ${sampleAvg.toFixed(1)} vs 全量 ${fullAvg.toFixed(1)}`;
  }

  // 5. Evidence consistency — some conflict is healthy (surfaces diverging
  //    voices), but high conflict ratio or validation errors signal noise.
  const conflictFindings = findings.filter(
    (f) => f.conflictingReviewIds.length > 0
  ).length;
  const conflictRatio = findings.length > 0 ? conflictFindings / findings.length : 0;
  const errorCount =
    validation?.issues?.filter((i) => i.severity === "error").length || 0;
  let evidenceConsistency = 100;
  if (conflictRatio > 0.3) evidenceConsistency -= (conflictRatio - 0.3) * 100;
  evidenceConsistency -= errorCount * 10;
  evidenceConsistency = Math.max(0, Math.min(100, evidenceConsistency));

  // 6. Language diversity — single-language sample may miss NPS issues from
  //    non-English users; multi-language is a stronger signal.
  const langs = new Set(reviews.map((r) => r.language).filter(Boolean));
  const langCount = langs.size;
  const languageDiversity = langCount >= 3 ? 100 : langCount === 2 ? 90 : 70;

  return [
    { key: "sample", label: "样本量", score: sampleSize, detail: `${n} 条评论` },
    { key: "version", label: "版本覆盖", score: versionCoverage, detail: `${versionCount} 个版本` },
    { key: "sentiment", label: "情感均衡", score: Math.round(sentimentBalance), detail: `负面 ${Math.round(negativeRatio * 100)}%` },
    { key: "rating", label: "评分代表性", score: ratingRepresentation, detail: ratingDetail },
    { key: "consistency", label: "证据一致性", score: Math.round(evidenceConsistency), detail: `${errorCount} 个校验错误` },
    { key: "language", label: "语言多样性", score: languageDiversity, detail: `${langCount} 种语言` },
  ];
}

function scoreColor(score: number): string {
  if (score >= 75) return "#16a34a"; // green-600
  if (score >= 50) return "#ca8a04"; // yellow-600
  return "#dc2626"; // red-600
}

export function EvidenceRadarChart({
  findings = [],
  cleanedReviews = [],
  appMetadata,
  validation,
}: EvidenceRadarChartProps) {
  if (cleanedReviews.length === 0 && findings.length === 0) {
    return null;
  }

  const dims = computeDimensions(findings, cleanedReviews, appMetadata, validation);
  const overall = Math.round(dims.reduce((s, d) => s + d.score, 0) / dims.length);

  // Radar geometry
  const cx = 150;
  const cy = 140;
  const R = 95;
  const gridLevels = [0.25, 0.5, 0.75, 1.0];

  const axes = dims.map((d, i) => {
    const angle = ((-90 + i * 60) * Math.PI) / 180;
    return {
      ...d,
      angle,
      x: cx + R * Math.cos(angle),
      y: cy + R * Math.sin(angle),
      scoreX: cx + (d.score / 100) * R * Math.cos(angle),
      scoreY: cy + (d.score / 100) * R * Math.sin(angle),
      labelX: cx + (R + 22) * Math.cos(angle),
      labelY: cy + (R + 22) * Math.sin(angle),
    };
  });

  const dataPolygon = axes.map((a) => `${a.scoreX},${a.scoreY}`).join(" ");

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold">📊 证据充分性评估</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              多维评估本次分析结果的证据可靠性
            </p>
          </div>
          <div className="text-right">
            <div
              className="text-2xl font-bold"
              style={{ color: scoreColor(overall) }}
            >
              {overall}
            </div>
            <div className="text-xs text-gray-500">综合分</div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 items-center">
          {/* Radar SVG */}
          <div className="flex justify-center">
            <svg
              viewBox="0 0 300 290"
              className="w-full max-w-[300px]"
              role="img"
              aria-label="证据充分性雷达图"
            >
              {/* Grid hexagons */}
              {gridLevels.map((level) => {
                const pts = axes
                  .map((a) => {
                    const x = cx + level * R * Math.cos(a.angle);
                    const y = cy + level * R * Math.sin(a.angle);
                    return `${x},${y}`;
                  })
                  .join(" ");
                return (
                  <polygon
                    key={level}
                    points={pts}
                    fill="none"
                    stroke="#e5e7eb"
                    strokeWidth="0.5"
                  />
                );
              })}
              {/* Axes lines */}
              {axes.map((a) => (
                <line
                  key={a.key}
                  x1={cx}
                  y1={cy}
                  x2={a.x}
                  y2={a.y}
                  stroke="#e5e7eb"
                  strokeWidth="0.5"
                />
              ))}
              {/* Data polygon */}
              <polygon
                points={dataPolygon}
                fill="rgba(59,130,246,0.18)"
                stroke="#3b82f6"
                strokeWidth="1.5"
              />
              {/* Data points */}
              {axes.map((a) => (
                <circle
                  key={a.key}
                  cx={a.scoreX}
                  cy={a.scoreY}
                  r="3"
                  fill="#3b82f6"
                />
              ))}
              {/* Axis labels */}
              {axes.map((a) => (
                <g key={a.key}>
                  <text
                    x={a.labelX}
                    y={a.labelY}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="11"
                    fill="#374151"
                    fontWeight="500"
                  >
                    {a.label}
                  </text>
                  <text
                    x={a.labelX}
                    y={a.labelY + 13}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="10"
                    fill={scoreColor(a.score)}
                    fontWeight="500"
                  >
                    {a.score}
                  </text>
                </g>
              ))}
            </svg>
          </div>

          {/* Dimension cards */}
          <div className="grid grid-cols-2 gap-2">
            {dims.map((d) => (
              <div
                key={d.key}
                className="rounded-lg border border-gray-200 bg-gray-50 p-2.5"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-700">
                    {d.label}
                  </span>
                  <span
                    className="text-sm font-bold"
                    style={{ color: scoreColor(d.score) }}
                  >
                    {d.score}
                  </span>
                </div>
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-1">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${d.score}%`,
                      background: scoreColor(d.score),
                    }}
                  />
                </div>
                <p className="text-[11px] text-gray-500">{d.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
          注：分数为相对评估，非绝对标准。样本量越多、版本覆盖越广、情感与评分越具代表性、校验错误越少，证据可靠性越高。少量矛盾证据是健康的（体现不同声音），大量校验错误则扣分。
        </p>
      </CardContent>
    </Card>
  );
}

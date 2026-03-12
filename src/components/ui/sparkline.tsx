"use client";

import type { MomentumTrend } from "@/lib/momentum";

interface SparklineProps {
  readonly data: readonly number[];
  readonly trend: MomentumTrend;
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
}

const trendColors: Record<MomentumTrend, string> = {
  accelerating: "#22c55e",
  steady: "#6b7280",
  slowing: "#f59e0b",
  fading: "#ef4444",
  inactive: "#d1d5db",
};

const trendLabels: Record<MomentumTrend, string> = {
  accelerating: "Accelerating",
  steady: "Steady",
  slowing: "Slowing",
  fading: "Fading",
  inactive: "Inactive",
};

export function Sparkline({
  data,
  trend,
  width = 64,
  height = 20,
  className = "",
}: SparklineProps) {
  const color = trendColors[trend];
  const max = Math.max(...data, 1);
  const padding = 2;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const points = data.map((val, i) => {
    const x = padding + (i / (data.length - 1)) * innerW;
    const y = padding + innerH - (val / max) * innerH;
    return `${x},${y}`;
  });

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${p}`).join(" ");

  // Area fill path
  const areaD = `${pathD} L${padding + innerW},${padding + innerH} L${padding},${padding + innerH} Z`;

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`} title={trendLabels[trend]}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <path d={areaD} fill={color} opacity={0.12} />
        <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span
        className="text-[10px] font-semibold leading-none"
        style={{ color }}
      >
        {trend === "inactive" ? "—" : trendLabels[trend][0]}
      </span>
    </div>
  );
}

export function SparklineBadge({
  trend,
}: {
  readonly trend: MomentumTrend;
}) {
  const color = trendColors[trend];
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ backgroundColor: `${color}15`, color }}
    >
      {trendLabels[trend]}
    </span>
  );
}

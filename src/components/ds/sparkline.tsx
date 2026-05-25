import * as React from "react";

/**
 * Tiny SVG sparkline for use inside StatTile. No axes, no labels —
 * pure shape memory. Two flavors:
 *   line — smooth path
 *   bars — small bars (good for "this week" weekly cadence)
 */
export interface SparklineProps {
  /** 1+ numeric values to plot. Lengths under 2 just draw a flat line. */
  data: number[];
  variant?: "line" | "bars";
  width?: number;
  height?: number;
  /** Color of the line/bars. Defaults to text-secondary. */
  color?: string;
}

export function Sparkline({
  data,
  variant = "line",
  width = 64,
  height = 28,
  color = "var(--text-secondary)",
}: SparklineProps) {
  if (data.length === 0) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : width;

  if (variant === "bars") {
    const barWidth = Math.max(2, width / (data.length * 1.6));
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
        {data.map((v, i) => {
          const h = Math.max(2, ((v - min) / span) * height);
          const x = i * (width / data.length) + (width / data.length - barWidth) / 2;
          const y = height - h;
          return <rect key={i} x={x} y={y} width={barWidth} height={h} rx={1.5} fill={color} />;
        })}
      </svg>
    );
  }

  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / span) * height;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={points} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

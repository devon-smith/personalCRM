import * as React from "react";
import { Surface, type SurfaceTone } from "./surface";
import { SectionLabel } from "./section-label";
import { cn } from "@/lib/utils";

/**
 * The "Patients:" / "Visits summary:" Intelly tile: small label up top,
 * one big tabular number, optional inline viz (sparkline, donut, etc.)
 * tucked to the right. One job per tile.
 */
export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  description?: React.ReactNode;
  /** Tiny inline visualization. Sparkline, donut, glyph — anything ~64x40. */
  viz?: React.ReactNode;
  tone?: SurfaceTone;
  href?: string;
  className?: string;
}

export function StatTile({
  label,
  value,
  description,
  viz,
  tone = "sand",
  href,
  className,
}: StatTileProps) {
  const inner = (
    <Surface
      tone={tone}
      interactive={!!href}
      className={cn("h-full p-5 sm:p-6", className)}
    >
      <div className="flex items-start justify-between gap-3">
        <SectionLabel>{label}</SectionLabel>
        {viz ? <div className="shrink-0 opacity-90">{viz}</div> : null}
      </div>
      <div className="ds-stat-lg mt-4">{value}</div>
      {description ? (
        <div className="ds-body-sm mt-1.5" style={{ color: "var(--text-secondary)" }}>
          {description}
        </div>
      ) : null}
    </Surface>
  );

  if (href) {
    // Use plain anchor so RSC + client mix stays clean; the Link wrapper
    // gets applied by the caller when needed.
    return (
      <a href={href} className="block h-full">
        {inner}
      </a>
    );
  }
  return inner;
}

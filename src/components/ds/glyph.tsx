import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Standardized icon wrapper. Single stroke weight (1.6), three sizes,
 * inherits color from `currentColor` by default so it always blends
 * with the surrounding text rather than competing with it.
 */
export type GlyphSize = 16 | 20 | 24;

export interface GlyphProps {
  icon: LucideIcon;
  size?: GlyphSize;
  className?: string;
  tone?: "primary" | "secondary" | "tertiary" | "inverse" | "current";
}

const COLOR: Record<NonNullable<GlyphProps["tone"]>, string> = {
  primary:   "var(--text-primary)",
  secondary: "var(--text-secondary)",
  tertiary:  "var(--text-tertiary)",
  inverse:   "var(--text-inverse)",
  current:   "currentColor",
};

export function Glyph({ icon: Icon, size = 20, className, tone = "current" }: GlyphProps) {
  return (
    <Icon
      width={size}
      height={size}
      strokeWidth={1.6}
      className={cn("shrink-0", className)}
      style={{ color: COLOR[tone] }}
    />
  );
}

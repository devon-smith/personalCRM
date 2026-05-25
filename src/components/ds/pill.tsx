"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Pills do the work of buttons, chips, filters, and badges. The
 * Intelly aesthetic deliberately avoids rectangles for actionable
 * surfaces. Three variants:
 *   filled  — solid accent background, used for the primary CTA
 *   outline — transparent with a thin border, used for secondary actions
 *   ghost   — no border, no background, hover gives subtle accent-soft
 *
 * Two tones:
 *   accent  — dark warm-brown background, light text
 *   neutral — accent-soft background, primary text
 */
export type PillVariant = "filled" | "outline" | "ghost";
export type PillTone = "accent" | "neutral";
export type PillSize = "sm" | "md" | "lg";

interface PillBaseProps {
  variant?: PillVariant;
  tone?: PillTone;
  size?: PillSize;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  /** Render as `as` element. Pill-shaped link → as="a", Next.js Link → asChild via parent. */
  as?: React.ElementType;
}

export type PillProps = PillBaseProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof PillBaseProps>;

const SIZE_STYLES: Record<PillSize, string> = {
  sm: "px-3 py-1 text-[12px] gap-1.5",
  md: "px-4 py-1.5 text-[13px] gap-2",
  lg: "px-5 py-2 text-[14px] gap-2",
};

export const Pill = React.forwardRef<HTMLButtonElement, PillProps>(function Pill(
  {
    variant = "filled",
    tone = "accent",
    size = "md",
    leadingIcon,
    trailingIcon,
    as: Tag = "button",
    className,
    children,
    ...rest
  },
  ref,
) {
  const accentFilled =
    "bg-[var(--accent-color)] text-[var(--text-inverse)] hover:bg-[var(--accent-hover)]";
  const neutralFilled =
    "bg-[var(--accent-soft)] text-[var(--text-primary)] hover:bg-[var(--surface-mist-raised)]";
  const accentOutline =
    "bg-transparent text-[var(--text-primary)] border border-[var(--accent-color)] hover:bg-[var(--accent-soft)]";
  const neutralOutline =
    "bg-transparent text-[var(--text-secondary)] border border-[var(--border)] hover:bg-[var(--accent-soft)] hover:text-[var(--text-primary)]";
  const ghost =
    "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--accent-soft)] hover:text-[var(--text-primary)]";

  const variantClass = (() => {
    if (variant === "filled") return tone === "accent" ? accentFilled : neutralFilled;
    if (variant === "outline") return tone === "accent" ? accentOutline : neutralOutline;
    return ghost;
  })();

  return (
    <Tag
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-full font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
        SIZE_STYLES[size],
        variantClass,
        className,
      )}
      style={{ transitionDuration: "var(--duration-fast)" }}
      {...rest}
    >
      {leadingIcon ? <span className="shrink-0 inline-flex items-center">{leadingIcon}</span> : null}
      {children}
      {trailingIcon ? <span className="shrink-0 inline-flex items-center">{trailingIcon}</span> : null}
    </Tag>
  );
});

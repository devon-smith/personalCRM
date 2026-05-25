"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The universal content container. Picks one of four tone surfaces by
 * the rule "tone follows content category":
 *   sand  → people / inbox
 *   mist  → activity / communication
 *   olive → relationships / circles
 *   stone → time / calendar
 *   plain → dialogs, popovers, anything intentionally toneless
 *
 * No borders. Soft shadow. 24px radius. Hover lift only when `interactive`.
 *
 * Note: backgrounds are set via inline style (hex values, not CSS
 * variables) so the tones survive Tailwind v4 cascade weirdness and
 * any dev-server CSS-cache staleness. The CSS variables in globals.css
 * remain the canonical source for everything else.
 */
export type SurfaceTone = "sand" | "mist" | "olive" | "stone" | "plain";

const TONE_BG: Record<SurfaceTone, string> = {
  sand:  "#F1ECDE",
  mist:  "#E8E4DC",
  olive: "#DCDCC9",
  stone: "#DDE3E3",
  plain: "#FFFFFF",
};

const TONE_HOVER_BG: Record<SurfaceTone, string> = {
  sand:  "#F5F0E4",
  mist:  "#EEEAE2",
  olive: "#E2E2D2",
  stone: "#E4E9E9",
  plain: "#FFFFFF",
};

export interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: SurfaceTone;
  interactive?: boolean;
  padded?: boolean;
  /** Render as `as` element. Useful for `<a>` / `<button>` semantics. */
  as?: React.ElementType;
}

export const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  function Surface(
    { tone = "plain", interactive = false, padded = true, as: Tag = "div", className, children, style, onMouseEnter, onMouseLeave, ...rest },
    ref,
  ) {
    const baseBg = TONE_BG[tone];
    const hoverBg = TONE_HOVER_BG[tone];
    return (
      <Tag
        ref={ref}
        className={cn(
          "rounded-3xl transition-[transform,box-shadow]",
          interactive && "cursor-pointer",
          padded && "p-6",
          className,
        )}
        style={{
          backgroundColor: baseBg,
          boxShadow: "0 2px 8px rgba(27,26,23,0.04)",
          transitionDuration: "180ms",
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
          ...style,
        }}
        onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
          if (interactive) {
            const el = e.currentTarget;
            el.style.backgroundColor = hoverBg;
            el.style.transform = "translateY(-2px)";
            el.style.boxShadow = "0 6px 20px rgba(27,26,23,0.07)";
          }
          onMouseEnter?.(e);
        }}
        onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
          if (interactive) {
            const el = e.currentTarget;
            el.style.backgroundColor = baseBg;
            el.style.transform = "";
            el.style.boxShadow = "0 2px 8px rgba(27,26,23,0.04)";
          }
          onMouseLeave?.(e);
        }}
        {...rest}
      >
        {children}
      </Tag>
    );
  },
);


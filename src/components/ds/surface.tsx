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
 */
export type SurfaceTone = "sand" | "mist" | "olive" | "stone" | "plain";

export interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: SurfaceTone;
  interactive?: boolean;
  padded?: boolean;
  /** Render as `as` element. Useful for `<a>` / `<button>` semantics. */
  as?: React.ElementType;
}

export const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  function Surface(
    { tone = "plain", interactive = false, padded = true, as: Tag = "div", className, children, ...rest },
    ref,
  ) {
    return (
      <Tag
        ref={ref}
        className={cn(
          "ds-surface",
          tone === "sand"  && "ds-surface-sand",
          tone === "mist"  && "ds-surface-mist",
          tone === "olive" && "ds-surface-olive",
          tone === "stone" && "ds-surface-stone",
          tone === "plain" && "ds-surface-plain",
          interactive && "ds-surface-interactive cursor-pointer",
          padded && "p-6",
          className,
        )}
        {...rest}
      >
        {children}
      </Tag>
    );
  },
);

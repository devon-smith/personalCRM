import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Small uppercase tracked-out label used inside cards. Pulls visual
 * weight off the content; the brief should feel like it's whispering
 * the section names, not announcing them.
 */
export function SectionLabel({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "text-[11px] font-semibold uppercase tracking-[0.08em]",
        className,
      )}
      style={{ color: "var(--text-tertiary)" }}
      {...rest}
    >
      {children}
    </div>
  );
}

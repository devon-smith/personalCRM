"use client";

/**
 * Word-level diff overlay for draft versions (M0.x.6).
 *
 * Uses the `diff` npm package's diffWords to compute insertions /
 * deletions between two versions, then renders inline with subtle
 * accent-soft for inserts and a strike-through ghost for deletes.
 * Pure-render component — caller decides when to show it.
 */

import { diffWords } from "diff";

interface DiffOverlayProps {
  /** The earlier version's text. */
  previous: string;
  /** The current version's text — what's being highlighted. */
  current: string;
}

export function DiffOverlay({ previous, current }: DiffOverlayProps) {
  const parts = diffWords(previous, current);
  return (
    <div
      className="whitespace-pre-wrap"
      style={{
        fontFamily:
          "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        lineHeight: 1.6,
        color: "var(--text-secondary)",
      }}
    >
      {parts.map((part, i) => {
        if (part.added) {
          return (
            <span
              key={i}
              style={{
                backgroundColor: "rgba(106, 138, 110, 0.18)",
                color: "var(--text-primary)",
                borderRadius: 2,
                padding: "1px 2px",
              }}
            >
              {part.value}
            </span>
          );
        }
        if (part.removed) {
          return (
            <span
              key={i}
              style={{
                color: "var(--text-tertiary)",
                textDecoration: "line-through",
                textDecorationColor: "rgba(196, 96, 84, 0.6)",
                opacity: 0.6,
                marginRight: 1,
              }}
            >
              {part.value}
            </span>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </div>
  );
}

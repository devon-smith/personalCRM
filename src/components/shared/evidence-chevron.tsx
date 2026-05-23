"use client";

import { useState } from "react";
import { Info, ChevronDown, ChevronRight } from "lucide-react";

interface EvidenceChevronProps {
  /** Human-readable reason the item was surfaced. Shown as the headline. */
  reason: string | null;
  /** Where the trigger came from: gmail / imessage / whatsapp / linkedin. */
  sourceSystem?: string | null;
  /** Source record references in the form "kind:id" (e.g. "interaction:abc"). */
  sourceRecordIds?: string[];
  /** Optional confidence in [0,1] for AI-classified items. */
  confidence?: number | null;
  /** Compact variant: render as a small inline pill instead of a row. */
  compact?: boolean;
}

/**
 * "Why is this here?" affordance. Collapsed by default — one click reveals
 * the source records and confidence so the user can audit any AI surface.
 */
export function EvidenceChevron({
  reason,
  sourceSystem,
  sourceRecordIds = [],
  confidence,
  compact = false,
}: EvidenceChevronProps) {
  const [open, setOpen] = useState(false);

  if (!reason && sourceRecordIds.length === 0) return null;

  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className={compact ? "inline-flex" : "block"}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center gap-1 text-[10px] font-medium rounded-full px-1.5 py-0.5 transition-colors"
        style={{
          backgroundColor: "var(--surface-sunken)",
          color: "var(--text-tertiary)",
        }}
        aria-expanded={open}
        aria-label="Why is this here?"
      >
        <Info className="h-2.5 w-2.5" />
        <span>Why?</span>
        <Chevron className="h-2.5 w-2.5" />
      </button>

      {open && (
        <div
          className={
            (compact ? "absolute z-10 mt-1 " : "mt-1.5 ") +
            "rounded-[10px] p-2.5 text-[11px] leading-snug"
          }
          style={{
            backgroundColor: "var(--surface-sunken)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
            maxWidth: 320,
          }}
        >
          {reason && (
            <div className="font-medium" style={{ color: "var(--text-primary)" }}>
              {reason}
            </div>
          )}
          {confidence != null && (
            <div className="mt-1" style={{ color: "var(--text-tertiary)" }}>
              Confidence: {Math.round(confidence * 100)}%
            </div>
          )}
          {sourceSystem && (
            <div className="mt-1" style={{ color: "var(--text-tertiary)" }}>
              Source: {sourceSystem}
            </div>
          )}
          {sourceRecordIds.length > 0 && (
            <div className="mt-1" style={{ color: "var(--text-tertiary)" }}>
              Records:{" "}
              <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                {sourceRecordIds.slice(0, 5).join(", ")}
                {sourceRecordIds.length > 5
                  ? ` +${sourceRecordIds.length - 5} more`
                  : ""}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

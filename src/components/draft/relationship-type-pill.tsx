"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Sparkles } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  RELATIONSHIP_TYPES,
  type RelationshipType,
} from "@/lib/voice/relationship-classifier";

const LABELS: Record<RelationshipType, string> = {
  former_student: "Former student",
  peer_faculty: "Peer faculty",
  industry_exec: "Industry exec",
  media: "Media",
  family: "Family",
  board: "Board / advisor",
  casual: "Casual / friend",
  unknown: "Unclassified",
};

/**
 * "Drafting as: [Former Student ▾]" pill in the draft modal (M6.4).
 *
 * Fetches the inferred relationship type for the selected contact and
 * exposes an override via dropdown. The override is a one-shot per
 * draft — not persisted to the contact — so Jennifer can experiment
 * without committing to a re-classification.
 *
 * Hidden when the contact has no email (no recipient to classify).
 */
export function RelationshipTypePill({
  contactId,
  value,
  onChange,
}: {
  contactId: string;
  /** Current override, or null if defaulting to the inferred value. */
  value: RelationshipType | null;
  onChange: (next: RelationshipType | null) => void;
}) {
  const { data, isLoading } = useQuery<{
    relationshipType: RelationshipType | null;
  }>({
    queryKey: ["contact", contactId, "relationship-type"],
    queryFn: async () => {
      const res = await fetch(
        `/api/contacts/${contactId}/relationship-type`,
      );
      if (!res.ok) throw new Error("Failed to load relationship type");
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  const inferred = data?.relationshipType ?? null;
  const effective = value ?? inferred;
  const isOverridden = value !== null && value !== inferred;

  // Hide entirely when contact has no email — the API returned null
  // because there's nothing to classify against.
  if (!isLoading && inferred === null && value === null) return null;

  return (
    <div className="flex items-center gap-2">
      <span
        className="ds-caption"
        style={{ color: "var(--text-tertiary)" }}
      >
        Drafting as
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ds-caption font-medium transition-colors"
          style={{
            backgroundColor: isOverridden
              ? "var(--surface-sunken)"
              : "rgba(124, 95, 76, 0.08)",
            color: "var(--text-secondary)",
            border: isOverridden
              ? "1px solid var(--border-subtle)"
              : "1px solid transparent",
          }}
        >
          {!isOverridden && (
            <Sparkles
              className="h-3 w-3"
              style={{ color: "var(--accent-color)" }}
              aria-label="Inferred"
            />
          )}
          {isLoading ? "…" : effective ? LABELS[effective] : "Unknown"}
          <ChevronDown
            className="h-3 w-3"
            style={{ color: "var(--text-tertiary)" }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {RELATIONSHIP_TYPES.map((t) => (
            <DropdownMenuItem
              key={t}
              onClick={() => onChange(t === inferred ? null : t)}
              className="cursor-pointer"
            >
              {LABELS[t]}
              {t === inferred && (
                <span
                  className="ml-auto text-[10px]"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  inferred
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {isOverridden && (
        <button
          onClick={() => onChange(null)}
          className="text-[10px] uppercase tracking-wide"
          style={{ color: "var(--text-tertiary)" }}
        >
          reset
        </button>
      )}
    </div>
  );
}

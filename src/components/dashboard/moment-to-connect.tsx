"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EvidenceChevron } from "@/components/shared/evidence-chevron";
import { useDraftComposer } from "@/lib/draft-composer-context";

interface MomentSuggestion {
  contactId: string;
  contactName: string;
  company: string | null;
  role: string | null;
  tier: string;
  avatarUrl: string | null;
  daysSinceLastInteraction: number | null;
  interactionCount: number;
  reason: string;
  sourceSystem: string;
  sourceRecordIds: string[];
  occasion: "light_day" | "gap_in_schedule";
  forDate: string;
}

interface MomentResponse {
  suggestion: MomentSuggestion | null;
}

/**
 * A single, gentle "reach out to this person today" card. Hidden when
 * the calendar is packed or no qualifying contact exists — by design
 * the card disappears rather than rendering an empty / nagging state.
 */
export function MomentToConnect() {
  const { openComposer } = useDraftComposer();

  const { data } = useQuery<MomentResponse>({
    queryKey: ["moment-to-connect"],
    queryFn: async () => {
      const res = await fetch("/api/suggestions/moment");
      if (!res.ok) throw new Error("Failed to load suggestion");
      return res.json();
    },
    staleTime: 10 * 60 * 1000, // 10 min — pick is daily but cheap to refresh
  });

  const m = data?.suggestion;
  if (!m) return null;

  const subline = [m.role, m.company].filter(Boolean).join(" at ");
  const occasion =
    m.occasion === "light_day" ? "Light day today" : "Open window today";

  return (
    <div
      className="crm-card mt-6 rounded-[14px] p-5"
      style={{
        border: "1px solid var(--border)",
        backgroundColor: "var(--surface)",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Sparkles
          className="h-3.5 w-3.5"
          style={{ color: "var(--accent-color)" }}
        />
        <span
          className="text-[11px] font-medium uppercase tracking-wide"
          style={{ color: "var(--text-tertiary)" }}
        >
          A moment to connect · {occasion}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <Avatar className="h-10 w-10">
          {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt={m.contactName} />}
          <AvatarFallback>
            {m.contactName
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p
            className="ds-body-sm font-medium truncate"
            style={{ color: "var(--text-primary)" }}
          >
            {m.contactName}
          </p>
          {subline && (
            <p
              className="text-[12px] truncate"
              style={{ color: "var(--text-tertiary)" }}
            >
              {subline}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p
            className="text-[11px]"
            style={{ color: "var(--text-tertiary)" }}
          >
            {m.daysSinceLastInteraction != null
              ? `${m.daysSinceLastInteraction}d quiet`
              : "no recent contact"}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() =>
            openComposer({
              contactId: m.contactId,
              presetTone: "warm",
              presetContext: "catching_up",
            })
          }
          className="rounded-[8px] px-3 py-1.5 text-[12px] font-medium"
          style={{
            backgroundColor: "var(--accent-color)",
            color: "var(--text-inverse)",
          }}
        >
          Draft a message
        </button>
        <Link
          href={`/people/${m.contactId}`}
          className="text-[12px] font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          Open contact →
        </Link>
        <div className="ml-auto">
          <EvidenceChevron
            reason={m.reason}
            sourceSystem={m.sourceSystem}
            sourceRecordIds={m.sourceRecordIds}
            compact
          />
        </div>
      </div>
    </div>
  );
}

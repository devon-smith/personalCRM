"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EvidenceChevron } from "@/components/shared/evidence-chevron";
import { useDraftComposer } from "@/lib/draft-composer-context";
import { Surface, Pill, SectionLabel } from "@/components/ds";

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
 * The dashboard's editorial centerpiece — one carefully chosen
 * contact, on days where the calendar shape genuinely supports it.
 * Hidden when no qualifying contact exists: by design we'd rather
 * show nothing than nag.
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
    staleTime: 10 * 60 * 1000,
  });

  const m = data?.suggestion;
  if (!m) return null;

  const subline = [m.role, m.company].filter(Boolean).join(" · ");
  const occasion =
    m.occasion === "light_day" ? "Light day today" : "Open window today";
  const quietLabel =
    m.daysSinceLastInteraction != null
      ? `${m.daysSinceLastInteraction} days quiet`
      : "no recent contact";

  return (
    <Surface tone="olive" className="relative overflow-hidden p-7 sm:p-9">
      <div className="flex items-start justify-between gap-3 mb-5">
        <SectionLabel>A moment to connect</SectionLabel>
        <span
          className="text-[11px] font-medium tracking-wide"
          style={{ color: "var(--text-secondary)" }}
        >
          {occasion}
        </span>
      </div>

      <div className="flex items-start gap-4">
        <Avatar className="h-14 w-14 shrink-0">
          {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt={m.contactName} />}
          <AvatarFallback
            className="text-[15px] font-semibold"
            style={{ backgroundColor: "var(--surface-olive-raised)", color: "var(--text-primary)" }}
          >
            {m.contactName
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h2 className="ds-display-lg" style={{ fontSize: "1.875rem" }}>
            {m.contactName}
          </h2>
          {subline && (
            <p className="ds-body-md mt-1" style={{ color: "var(--text-secondary)" }}>
              {subline}
            </p>
          )}
          <p className="ds-body-sm mt-2" style={{ color: "var(--text-tertiary)" }}>
            {quietLabel} · {m.reason}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Pill
          variant="filled"
          tone="accent"
          size="md"
          onClick={() =>
            openComposer({
              contactId: m.contactId,
              presetTone: "warm",
              presetContext: "catching_up",
            })
          }
        >
          Draft a message
        </Pill>
        <Link
          href={`/people?contact=${m.contactId}`}
          className="text-[13px] font-medium transition-colors"
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
    </Surface>
  );
}

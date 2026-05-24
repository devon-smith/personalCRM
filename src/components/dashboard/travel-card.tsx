"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plane } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EvidenceChevron } from "@/components/shared/evidence-chevron";

interface TravelSuggestion {
  type: "travel";
  city: string;
  eventTitle: string;
  eventTime: string;
  contacts: Array<{
    contactId: string;
    contactName: string;
    daysSinceLastInteraction: number | null;
  }>;
  reason: string;
}

interface SuggestionsResponse {
  travelSuggestions?: TravelSuggestion[];
}

/**
 * "While you're in [city]" card. Pulls the existing /api/suggestions
 * travelSuggestions bucket and renders the first one. Hides entirely
 * when no travel is detected — no nagging.
 *
 * Travel detection lives in /api/suggestions/route.ts (keyword + city
 * extraction from upcoming calendar events). This component is a UI
 * surface only.
 */
export function TravelCard() {
  const { data, dataUpdatedAt } = useQuery<SuggestionsResponse>({
    queryKey: ["suggestions"],
    queryFn: async () => {
      const res = await fetch("/api/suggestions");
      if (!res.ok) throw new Error("Failed to load suggestions");
      return res.json();
    },
    staleTime: 30 * 60 * 1000, // 30 min — travel windows don't shift minute-to-minute
  });

  const trip = data?.travelSuggestions?.[0];
  if (!trip) return null;

  // Lock "now" to the moment we fetched so the days-until display
  // stays pure across render. nowMs is 0 before first fetch.
  const nowMs = dataUpdatedAt || 0;
  const eventTs = new Date(trip.eventTime).getTime();
  const daysUntil = eventTs > nowMs
    ? Math.ceil((eventTs - nowMs) / 86_400_000)
    : null;

  // Top 3 contacts, ranked by oldest-interaction-first (reach out to the
  // ones you've been meaning to see for longer).
  const topContacts = [...trip.contacts]
    .sort((a, b) => {
      const aDays = a.daysSinceLastInteraction ?? Infinity;
      const bDays = b.daysSinceLastInteraction ?? Infinity;
      return bDays - aDays;
    })
    .slice(0, 3);

  return (
    <div
      className="crm-card mt-6 rounded-[14px] p-5"
      style={{
        border: "1px solid var(--border)",
        backgroundColor: "var(--surface)",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Plane className="h-3.5 w-3.5" style={{ color: "var(--accent-color)" }} />
        <span
          className="text-[11px] font-medium uppercase tracking-wide"
          style={{ color: "var(--text-tertiary)" }}
        >
          While you&rsquo;re in {trip.city}
          {daysUntil != null && daysUntil > 0 && (
            <span> · in {daysUntil}d</span>
          )}
        </span>
        <div className="ml-auto">
          <EvidenceChevron
            reason={trip.reason}
            sourceSystem="calendar"
            sourceRecordIds={[`event:${trip.eventTitle}`]}
            compact
          />
        </div>
      </div>

      <p className="ds-body-sm mb-3" style={{ color: "var(--text-secondary)" }}>
        {trip.contacts.length} contact{trip.contacts.length === 1 ? "" : "s"} in {trip.city}
        {trip.contacts.length > 3 && " — top 3 shown"}
      </p>

      <ul className="space-y-2">
        {topContacts.map((c) => (
          <li key={c.contactId}>
            <Link
              href={`/people?contact=${c.contactId}`}
              className="flex items-center gap-3 rounded-[8px] p-1.5 transition-colors"
              style={{ backgroundColor: "transparent" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "";
              }}
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback>
                  {c.contactName
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
                  {c.contactName}
                </p>
                <p
                  className="text-[11px]"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {c.daysSinceLastInteraction != null
                    ? `${c.daysSinceLastInteraction}d since last interaction`
                    : "No prior interactions"}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

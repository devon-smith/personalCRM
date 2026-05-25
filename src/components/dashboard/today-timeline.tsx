"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Calendar, FileEdit, Mail } from "lucide-react";
import type { UpcomingEvent } from "@/lib/calendar";

/**
 * Today's timeline — vertical strip on the dashboard right rail
 * showing what's actually on the day in chronological order:
 * calendar meetings + pending drafts. Hides itself completely on
 * a no-meetings / no-drafts day rather than rendering an empty
 * "Nothing today" prompt.
 */

interface DraftLite {
  id: string;
  contact: { name: string } | null;
  subjectLine: string | null;
  updatedAt: string;
}

interface TimelineEntry {
  id: string;
  kind: "meeting" | "draft";
  time: Date | null; // null = no specific time (e.g. drafts)
  title: string;
  subtitle: string | null;
  href: string;
}

export function TodayTimeline() {
  const { data: calendarData } = useQuery<{ events: UpcomingEvent[] }>({
    queryKey: ["upcoming-meetings"],
    queryFn: async () => {
      const res = await fetch("/api/calendar");
      if (!res.ok) return { events: [] };
      return res.json();
    },
    retry: false,
  });

  const { data: draftsData } = useQuery<{ drafts: DraftLite[] }>({
    queryKey: ["drafts", "DRAFT"],
    queryFn: async () => {
      const res = await fetch("/api/drafts?status=DRAFT");
      if (!res.ok) return { drafts: [] };
      return res.json();
    },
  });

  const entries = React.useMemo<TimelineEntry[]>(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const items: TimelineEntry[] = [];

    for (const e of calendarData?.events ?? []) {
      const start = new Date(e.startTime);
      if (start.toISOString().slice(0, 10) !== todayIso) continue;
      items.push({
        id: `m-${e.id}`,
        kind: "meeting",
        time: start,
        title: e.title,
        subtitle:
          e.attendees.length > 0
            ? `with ${e.attendees.map((a) => a.name ?? a.email).slice(0, 2).join(", ")}${e.attendees.length > 2 ? ` +${e.attendees.length - 2}` : ""}`
            : null,
        href: `/meetings/${encodeURIComponent(e.id)}/prep`,
      });
    }

    for (const d of draftsData?.drafts ?? []) {
      const name = d.contact?.name ?? "Unknown contact";
      items.push({
        id: `d-${d.id}`,
        kind: "draft",
        time: null,
        title: d.subjectLine ?? `Draft to ${name}`,
        subtitle: `to ${name}`,
        href: `/dashboard#drafts`,
      });
    }

    items.sort((a, b) => {
      // Meetings first by start time; drafts last in update order.
      if (a.time && b.time) return a.time.getTime() - b.time.getTime();
      if (a.time) return -1;
      if (b.time) return 1;
      return 0;
    });

    return items;
  }, [calendarData, draftsData]);

  if (entries.length === 0) return null;

  return (
    <div>
      <div
        className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-3"
        style={{ color: "#8C8A82" }}
      >
        Today
      </div>
      <ul className="space-y-2">
        {entries.map((entry) => (
          <li key={entry.id}>
            <Link
              href={entry.href}
              className="block rounded-2xl p-3 transition-colors"
              style={{ backgroundColor: "#FFFFFF" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#FBF8F2";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "#FFFFFF";
              }}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className="h-7 w-7 shrink-0 rounded-full inline-flex items-center justify-center"
                  style={{
                    backgroundColor: entry.kind === "meeting" ? "#DDE3E3" : "#E8E4DC",
                    color: "#5A574F",
                  }}
                >
                  {entry.kind === "meeting" ? (
                    <Calendar className="h-3 w-3" strokeWidth={1.7} />
                  ) : (
                    <FileEdit className="h-3 w-3" strokeWidth={1.7} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p
                      className="text-[12.5px] font-medium truncate"
                      style={{ color: "#1B1A17" }}
                    >
                      {entry.title}
                    </p>
                    {entry.time ? (
                      <span
                        className="text-[10.5px] tabular-nums shrink-0"
                        style={{ color: "#8C8A82" }}
                      >
                        {entry.time.toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                          hour12: true,
                        })}
                      </span>
                    ) : null}
                  </div>
                  {entry.subtitle ? (
                    <p
                      className="text-[11px] truncate mt-0.5"
                      style={{ color: "#8C8A82" }}
                    >
                      {entry.subtitle}
                    </p>
                  ) : null}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AddEventPill() {
  // Calendar create is a future capability; for now this links to the
  // user's primary Google Calendar where they'd actually add the event.
  return (
    <Link
      href="https://calendar.google.com/calendar/u/0/r/eventedit"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center justify-center gap-1.5 w-full rounded-full px-4 py-2 text-[12px] font-medium transition-colors"
      style={{ backgroundColor: "#2E2A24", color: "#FAF8F5" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "#1B1A17";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "#2E2A24";
      }}
    >
      <Mail className="h-3 w-3" strokeWidth={1.7} />
      Add event
    </Link>
  );
}

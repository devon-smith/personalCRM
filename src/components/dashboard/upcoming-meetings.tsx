"use client";

import { useQuery } from "@tanstack/react-query";
import { Calendar, ExternalLink, Users } from "lucide-react";
import Link from "next/link";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { UpcomingEvent } from "@/lib/calendar";

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  if (isToday) return `Today ${time}`;
  if (isTomorrow) return `Tomorrow ${time}`;

  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${day} ${time}`;
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return "";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

export function UpcomingMeetings() {
  const { data, isLoading } = useQuery<{ events: UpcomingEvent[]; error?: string }>({
    queryKey: ["upcoming-meetings"],
    queryFn: async () => {
      const res = await fetch("/api/calendar");
      if (!res.ok) {
        return { events: [], error: `Calendar unavailable (${res.status})` };
      }
      return res.json();
    },
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <p className="crm-section-label">Upcoming meetings</p>
        <div className="h-16 animate-pulse rounded-[10px]" style={{ backgroundColor: "var(--surface-sunken)" }} />
      </div>
    );
  }

  const events = data?.events ?? [];
  const apiError = data?.error;

  if (events.length === 0) {
    return (
      <div className="space-y-3">
        <p className="crm-section-label">Upcoming meetings</p>
        <div className="flex flex-col items-center py-6 text-center">
          <div
            className="mb-3 flex h-10 w-10 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--surface-sunken)" }}
          >
            <Calendar className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
          </div>
          {apiError ? (
            <>
              <p className="ds-body-sm font-medium" style={{ color: "var(--status-warning)" }}>Calendar not connected</p>
              <p className="mt-1 ds-caption max-w-[220px]">
                {apiError.includes("scope")
                  ? "Re-sign in with Google to grant Calendar access."
                  : apiError.includes("not connected")
                    ? "Sign in with Google to see your upcoming meetings."
                    : apiError}
              </p>
            </>
          ) : (
            <p className="ds-body-sm" style={{ color: "var(--text-tertiary)" }}>No meetings this week</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="crm-section-label">Upcoming meetings</p>
      <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
        {events.slice(0, 8).map((event) => {
          const knownAttendees = event.attendees.filter((a) => a.contactId);
          const unknownCount = event.attendees.length - knownAttendees.length;

          return (
            <div
              key={event.id}
              className="flex items-start gap-3 py-3 -mx-2 px-2 rounded-[10px] transition-colors"
              style={{ transitionDuration: "var(--duration-fast)" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; }}
            >
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: "var(--surface-sunken)" }}
              >
                <Calendar className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="ds-body-md font-medium truncate" style={{ color: "var(--text-primary)" }}>
                    {event.title}
                  </p>
                  {event.htmlLink && (
                    <a
                      href={event.htmlLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 transition-colors"
                      style={{ color: "var(--text-tertiary)", transitionDuration: "var(--duration-fast)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-0.5">
                  <p className="ds-caption">
                    {formatEventTime(event.startTime)}
                    {event.endTime && (
                      <span style={{ color: "var(--border-strong)" }}> · {formatDuration(event.startTime, event.endTime)}</span>
                    )}
                  </p>
                </div>

                {/* Attendees */}
                {event.attendees.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <div className="flex -space-x-1.5">
                      {knownAttendees.slice(0, 4).map((a) => {
                        const color = getAvatarColor(a.name ?? a.email);
                        return (
                          <Link
                            key={a.email}
                            href={`/people?contact=${a.contactId}`}
                            title={a.name ?? a.email}
                          >
                            <Avatar className="h-5 w-5 ring-2" style={{ "--tw-ring-color": "var(--surface)" } as React.CSSProperties}>
                              <AvatarFallback
                                className="text-[8px] font-semibold"
                                style={{ backgroundColor: color.bg, color: color.text }}
                              >
                                {getInitials(a.name ?? a.email)}
                              </AvatarFallback>
                            </Avatar>
                          </Link>
                        );
                      })}
                    </div>
                    {knownAttendees.length > 0 && (
                      <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                        {knownAttendees.map((a) => a.name ?? a.email.split("@")[0]).slice(0, 2).join(", ")}
                        {knownAttendees.length > 2 && ` +${knownAttendees.length - 2}`}
                      </span>
                    )}
                    {unknownCount > 0 && knownAttendees.length > 0 && (
                      <span className="text-[11px]" style={{ color: "var(--border-strong)" }}>+{unknownCount}</span>
                    )}
                    {unknownCount > 0 && knownAttendees.length === 0 && (
                      <div className="flex items-center gap-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                        <Users className="h-3 w-3" />
                        {unknownCount} attendee{unknownCount !== 1 ? "s" : ""}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

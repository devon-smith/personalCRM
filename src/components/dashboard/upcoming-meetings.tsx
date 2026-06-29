"use client";

import { useQuery } from "@tanstack/react-query";
import { Calendar, ExternalLink, Users } from "lucide-react";
import Link from "next/link";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { UpcomingEvent } from "@/lib/calendar";
import type { CalendarSyncStatus } from "@/lib/calendar/status";
import { CollapsibleSection } from "@/components/ds";

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
  const { data, isLoading } = useQuery<{
    events: UpcomingEvent[];
    syncStatus?: CalendarSyncStatus;
    error?: string;
  }>({
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
  const emptyCopy = getEmptyCopy(data);

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
          {emptyCopy.warning ? (
            <>
              <p className="ds-body-sm font-medium" style={{ color: "var(--status-warning)" }}>
                {emptyCopy.title}
              </p>
              <p className="mt-1 ds-caption max-w-[240px]">{emptyCopy.body}</p>
            </>
          ) : (
            <>
              <p className="ds-body-sm" style={{ color: "var(--text-tertiary)" }}>
                {emptyCopy.title}
              </p>
              <p className="mt-1 ds-caption max-w-[240px]">{emptyCopy.body}</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="crm-section-label">Upcoming meetings</p>
      <CollapsibleSection
        storageKey="dashboard-meetings-expanded"
        previewCount={4}
        items={events}
        showMoreLabel={(hidden) => `Show ${hidden} more meetings`}
        className="divide-y"
        renderItem={(event) => <MeetingRow key={event.id} event={event} />}
      />
    </div>
  );
}

function getEmptyCopy(data: {
  error?: string;
  syncStatus?: CalendarSyncStatus;
} | undefined): {
  title: string;
  body: string;
  warning: boolean;
} {
  if (data?.error) {
    return {
      title: "Calendar needs attention",
      body: calendarErrorCopy(data.error),
      warning: true,
    };
  }

  const status = data?.syncStatus;
  if (status?.connection === "not_connected") {
    return {
      title: "Calendar not connected",
      body: "Connect Google Calendar from Sources to show meetings here.",
      warning: true,
    };
  }
  if (status?.connection === "missing_scope") {
    return {
      title: "Calendar access missing",
      body: "Reconnect Google from Sources and grant Calendar access.",
      warning: true,
    };
  }
  if (status?.lastSyncRunStatus === "error") {
    return {
      title: "Calendar sync failed",
      body: status.lastSyncRunError ?? "Open Sources and run Calendar sync again.",
      warning: true,
    };
  }
  if (status && status.syncedMeetingCount === 0 && !status.lastMeetingSyncedAt) {
    return {
      title: "Calendar connected",
      body: "No upcoming meetings loaded. Sync calendar to backfill meeting history for prep context.",
      warning: false,
    };
  }

  return {
    title: "No meetings this week",
    body: "Google Calendar returned no upcoming meetings for the next week.",
    warning: false,
  };
}

function calendarErrorCopy(error: string): string {
  if (error.includes("scope")) {
    return "Reconnect Google and grant Calendar access.";
  }
  if (error.includes("not connected")) {
    return "Sign in with Google to show upcoming meetings.";
  }
  return error;
}

function MeetingRow({ event }: { event: UpcomingEvent }) {
  const knownAttendees = event.attendees.filter((a) => a.contactId);
  const unknownCount = event.attendees.length - knownAttendees.length;

  return (
    <div
      className="flex items-start gap-3 py-3 -mx-2 px-2 rounded-[10px] transition-colors"
      style={{ transitionDuration: "var(--duration-fast)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "";
      }}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: "var(--surface-sunken)" }}
      >
        <Calendar className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p
            className="ds-body-md font-medium truncate"
            style={{ color: "var(--text-primary)" }}
          >
            {event.title}
          </p>
          <Link
            href={`/meetings/${event.id}/prep`}
            className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium transition-colors"
            style={{
              backgroundColor: "var(--surface-sunken)",
              color: "var(--text-secondary)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--accent-color)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            Prep
          </Link>
          {event.htmlLink && (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 transition-colors"
              style={{
                color: "var(--text-tertiary)",
                transitionDuration: "var(--duration-fast)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-tertiary)";
              }}
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        <div className="flex items-center gap-2 mt-0.5">
          <p className="ds-caption">
            {formatEventTime(event.startTime)}
            {event.endTime && (
              <span style={{ color: "var(--border-strong)" }}>
                {" "}
                · {formatDuration(event.startTime, event.endTime)}
              </span>
            )}
          </p>
        </div>

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
                    <Avatar
                      className="h-5 w-5 ring-2"
                      style={
                        { "--tw-ring-color": "var(--surface)" } as React.CSSProperties
                      }
                    >
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
              <span
                className="text-[11px]"
                style={{ color: "var(--text-tertiary)" }}
              >
                {knownAttendees
                  .map((a) => a.name ?? a.email.split("@")[0])
                  .slice(0, 2)
                  .join(", ")}
                {knownAttendees.length > 2 && ` +${knownAttendees.length - 2}`}
              </span>
            )}
            {unknownCount > 0 && knownAttendees.length > 0 && (
              <span
                className="text-[11px]"
                style={{ color: "var(--border-strong)" }}
              >
                +{unknownCount}
              </span>
            )}
            {unknownCount > 0 && knownAttendees.length === 0 && (
              <div
                className="flex items-center gap-1 text-[11px]"
                style={{ color: "var(--text-tertiary)" }}
              >
                <Users className="h-3 w-3" />
                {unknownCount} attendee{unknownCount !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

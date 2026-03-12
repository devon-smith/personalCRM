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
        // Return empty events rather than throwing — avoids 500 retry loops
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
        <div className="h-16 animate-pulse rounded-xl bg-gray-50" />
      </div>
    );
  }

  const events = data?.events ?? [];

  if (events.length === 0) {
    return (
      <div className="space-y-3">
        <p className="crm-section-label">Upcoming meetings</p>
        <div className="flex flex-col items-center py-6 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-50">
            <Calendar className="h-4 w-4 text-gray-400" />
          </div>
          <p className="text-[13px] text-gray-400">No meetings this week</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="crm-section-label">Upcoming meetings</p>
      <div className="divide-y" style={{ borderColor: "var(--crm-border-light)" }}>
        {events.slice(0, 8).map((event) => {
          const knownAttendees = event.attendees.filter((a) => a.contactId);
          const unknownCount = event.attendees.length - knownAttendees.length;

          return (
            <div
              key={event.id}
              className="flex items-start gap-3 py-3 -mx-2 px-2 rounded-lg transition-colors hover:bg-gray-50"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-50">
                <Calendar className="h-4 w-4 text-gray-400" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[14px] font-medium text-gray-900 truncate">
                    {event.title}
                  </p>
                  {event.htmlLink && (
                    <a
                      href={event.htmlLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-gray-300 hover:text-gray-500 transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-[12px] text-gray-400">
                    {formatEventTime(event.startTime)}
                    {event.endTime && (
                      <span className="text-gray-300"> · {formatDuration(event.startTime, event.endTime)}</span>
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
                            <Avatar className="h-5 w-5 ring-2 ring-white">
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
                      <span className="text-[11px] text-gray-400">
                        {knownAttendees.map((a) => a.name ?? a.email.split("@")[0]).slice(0, 2).join(", ")}
                        {knownAttendees.length > 2 && ` +${knownAttendees.length - 2}`}
                      </span>
                    )}
                    {unknownCount > 0 && knownAttendees.length > 0 && (
                      <span className="text-[11px] text-gray-300">+{unknownCount}</span>
                    )}
                    {unknownCount > 0 && knownAttendees.length === 0 && (
                      <div className="flex items-center gap-1 text-[11px] text-gray-400">
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

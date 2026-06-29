"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  Clock3,
  ExternalLink,
  Loader2,
  MapPin,
  MessageSquareText,
  RefreshCw,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import type { UpcomingEvent } from "@/lib/calendar";
import type { CalendarSyncStatus } from "@/lib/calendar/status";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { cn } from "@/lib/utils";

interface CalendarResponse {
  events: UpcomingEvent[];
  syncStatus?: CalendarSyncStatus;
  error?: string;
}

function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

function isTomorrow(iso: string): boolean {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return new Date(iso).toDateString() === tomorrow.toDateString();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDayHeading(iso: string): string {
  if (isToday(iso)) return "Today";
  if (isTomorrow(iso)) return "Tomorrow";
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return "";
  const mins = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const remainder = mins % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatRelativeDay(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function formatSyncAge(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function calendarEmptyCopy(data: CalendarResponse | undefined): {
  icon: typeof CalendarDays;
  title: string;
  body: string;
} {
  const status = data?.syncStatus;
  const error = data?.error;

  if (error) {
    return {
      icon: AlertCircle,
      title: "Calendar needs attention",
      body: calendarErrorCopy(error),
    };
  }

  if (!status) {
    return {
      icon: CalendarDays,
      title: "No upcoming events",
      body: "Google Calendar returned no upcoming events for the next week.",
    };
  }

  if (status.connection === "not_connected") {
    return {
      icon: AlertCircle,
      title: "Calendar is not connected",
      body: "Connect Google Calendar from Sources so upcoming meetings and prep context can appear here.",
    };
  }

  if (status.connection === "missing_scope") {
    return {
      icon: AlertCircle,
      title: "Calendar access is missing",
      body: "Reconnect Google from Sources and grant Calendar access so meetings can load.",
    };
  }

  if (status.lastSyncRunStatus === "error") {
    return {
      icon: AlertCircle,
      title: "Calendar sync needs attention",
      body:
        status.lastSyncRunError ??
        "The last Calendar sync failed. Try Sync calendar, then check Sources if it still fails.",
    };
  }

  if (!status.lastMeetingSyncedAt && status.syncedMeetingCount === 0) {
    return {
      icon: CalendarDays,
      title: "Calendar is connected, but meeting history has not synced",
      body:
        "Upcoming events are fetched live from Google. Run Sync calendar to backfill past meetings for richer prep context.",
    };
  }

  const lastSynced = formatSyncAge(status.lastMeetingSyncedAt);
  return {
    icon: CalendarDays,
    title: "No upcoming events",
    body: lastSynced
      ? `Google Calendar returned no upcoming events for the next week. Meeting history last synced ${lastSynced}.`
      : "Google Calendar returned no upcoming events for the next week.",
  };
}

function calendarErrorCopy(error: string): string {
  if (error.includes("scope")) {
    return "Reconnect Google from Sources and grant Calendar access so meetings can load.";
  }
  if (error.includes("not connected")) {
    return "Connect Google Calendar from Sources to see upcoming meetings and prep context.";
  }
  return error;
}

function groupEventsByDay(events: UpcomingEvent[]): Array<{ dayKey: string; label: string; events: UpcomingEvent[] }> {
  const groups = new Map<string, UpcomingEvent[]>();
  for (const event of events) {
    const dayKey = new Date(event.startTime).toDateString();
    groups.set(dayKey, [...(groups.get(dayKey) ?? []), event]);
  }
  return Array.from(groups.entries()).map(([dayKey, dayEvents]) => ({
    dayKey,
    label: formatDayHeading(dayEvents[0].startTime),
    events: dayEvents,
  }));
}

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, dataUpdatedAt } = useQuery<CalendarResponse>({
    queryKey: ["upcoming-meetings"],
    queryFn: async () => {
      const res = await fetch("/api/calendar");
      if (!res.ok) return { events: [], error: `Calendar unavailable (${res.status})` };
      return res.json();
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const syncCalendar = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/calendar", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) throw new Error(body.error ?? "Calendar sync failed");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upcoming-meetings"] });
      toast.success("Calendar synced");
    },
    onError: (err) => toast.error(err.message),
  });

  const upcomingEvents = useMemo(
    () => data?.events ?? [],
    [data?.events],
  );
  const groupedEvents = useMemo(() => groupEventsByDay(upcomingEvents), [upcomingEvents]);
  const selected =
    upcomingEvents.find((event) => event.id === selectedId) ??
    upcomingEvents.find((event) => !event.allDay) ??
    upcomingEvents[0] ??
    null;
  const knownAttendees = upcomingEvents.reduce((sum, event) => sum + event.prep.knownAttendees, 0);
  const openThreads = upcomingEvents.reduce((sum, event) => sum + event.prep.openThreads, 0);
  const facts = upcomingEvents.reduce((sum, event) => sum + event.prep.facts, 0);
  const timedMeetings = upcomingEvents.filter((event) => !event.allDay).length;

  return (
    <div className="mx-auto max-w-[1180px] space-y-5">
      <section className="rounded-[14px] border border-[#EAE2D6] bg-white px-5 py-5 shadow-[0_1px_2px_rgba(40,30,20,0.03)] sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#B5613F]">
              Google Calendar
            </div>
            <h1 className="font-serif text-[34px] font-medium leading-tight text-[#1B1A17]">
              Calendar
            </h1>
            <p className="mt-2 max-w-[720px] text-[13px] leading-5 text-[#6A645A]">
              Upcoming events from Google Calendar with relationship context, open threads, and prep links.
            </p>
            {dataUpdatedAt > 0 && (
              <p className="mt-2 text-[12px] text-[#8A8276]">
                Last loaded {formatTime(new Date(dataUpdatedAt).toISOString())}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => syncCalendar.mutate()}
            disabled={syncCalendar.isPending}
            className="inline-flex h-9 w-fit items-center gap-2 rounded-[8px] border border-[#E2D9CB] bg-[#FAF8F5] px-3 text-[12px] font-semibold text-[#6F685D] disabled:opacity-60"
          >
            {syncCalendar.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Sync calendar
          </button>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Events loaded" value={upcomingEvents.length.toString()} />
        <Metric label="Timed meetings" value={timedMeetings.toString()} />
        <Metric label="Known people" value={knownAttendees.toString()} />
        <Metric label="Prep signals" value={(openThreads + facts).toString()} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_390px]">
        <main className="space-y-3">
          {isLoading ? (
            <div className="flex items-center gap-2 rounded-[12px] border border-[#E9E1D5] bg-[#F6F2EC] px-4 py-8 text-[13px] text-[#8A8276]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading Google Calendar events...
            </div>
          ) : upcomingEvents.length === 0 ? (
            <EmptyState {...calendarEmptyCopy(data)} />
          ) : (
            groupedEvents.map((group) => (
              <section key={group.dayKey} className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <h2 className="font-serif text-[22px] font-medium text-[#1B1A17]">{group.label}</h2>
                  <span className="text-[11.5px] font-semibold text-[#A89F90]">
                    {group.events.length} event{group.events.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="space-y-3">
                  {group.events.map((event) => (
                    <MeetingRow
                      key={event.id}
                      event={event}
                      selected={event.id === selected?.id}
                      onSelect={() => setSelectedId(event.id)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </main>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <MeetingDeepDive event={selected} loading={isLoading} />
        </aside>
      </div>
    </div>
  );
}

function MeetingRow({
  event,
  selected,
  onSelect,
}: {
  event: UpcomingEvent;
  selected: boolean;
  onSelect: () => void;
}) {
  const known = event.attendees.filter((attendee) => attendee.contactId);
  const unknownCount = event.attendees.length - known.length;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-[12px] border bg-white px-4 py-4 text-left shadow-[0_1px_2px_rgba(40,30,20,0.03)] transition",
        selected ? "border-[#B5613F]" : "border-[#E9E1D5] hover:border-[#D8CBB9]",
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[11.5px] font-semibold text-[#8A8276]">
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5" />
              {event.allDay
                ? "All day"
                : `${formatTime(event.startTime)}${event.endTime ? ` - ${formatTime(event.endTime)}` : ""}`}
            </span>
            {!event.allDay && event.endTime && <span>{formatDuration(event.startTime, event.endTime)}</span>}
            {event.location && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{event.location}</span>
              </span>
            )}
          </div>
          <h2 className="mt-2 font-serif text-[22px] font-medium leading-tight text-[#1B1A17]">
            {event.title}
          </h2>
          <p className="mt-2 text-[12.5px] leading-5 text-[#6A645A]">{event.prep.summary}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {known.slice(0, 5).map((attendee) => (
              <AttendeeChip key={attendee.email} attendee={attendee} />
            ))}
            {unknownCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-[999px] border border-[#E2D9CB] bg-[#FAF8F5] px-2.5 py-1 text-[11.5px] text-[#8A8276]">
                <Users className="h-3.5 w-3.5" />
                {unknownCount} unknown
              </span>
            )}
          </div>
        </div>
        <Link
          href={`/meetings/${encodeURIComponent(event.id)}/prep`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] bg-[#1B1A17] px-3 text-[12px] font-semibold text-[#FAF8F5]"
        >
          Full prep
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </button>
  );
}

function MeetingDeepDive({ event, loading }: { event: UpcomingEvent | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="rounded-[14px] border border-[#E9E1D5] bg-[#F3EEE6] p-5">
        <Loader2 className="h-4 w-4 animate-spin text-[#8A8276]" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="rounded-[14px] border border-[#E9E1D5] bg-[#F3EEE6] p-5 text-[13px] text-[#8A8276]">
        Select a meeting to see prep context.
      </div>
    );
  }

  const known = event.attendees.filter((attendee) => attendee.contactId);
  const topFacts = known.flatMap((attendee) =>
    attendee.facts.slice(0, 2).map((fact) => ({ ...fact, attendee })),
  );
  const recent = known.flatMap((attendee) =>
    attendee.recentInteractions.slice(0, 2).map((interaction) => ({ ...interaction, attendee })),
  );
  const themes = Array.from(new Set(known.flatMap((attendee) => attendee.memory?.recurringThemes ?? []))).slice(0, 6);

  return (
    <section className="rounded-[14px] border border-[#E2D9CB] bg-[#F3EEE6] p-4 shadow-[0_2px_8px_rgba(27,26,23,0.04)]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#B5613F]">
        Meeting brief
      </div>
      <h2 className="mt-1 font-serif text-[25px] font-medium leading-tight text-[#1B1A17]">
        {event.title}
      </h2>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-[#8A8276]">
        <span>{event.allDay ? "All day" : formatTime(event.startTime)}</span>
        {!event.allDay && event.endTime && <span>{formatDuration(event.startTime, event.endTime)}</span>}
        {event.prep.lastMetAt && <span>last met {formatRelativeDay(event.prep.lastMetAt)}</span>}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniMetric label="Known" value={event.prep.knownAttendees.toString()} />
        <MiniMetric label="Threads" value={event.prep.openThreads.toString()} />
        <MiniMetric label="Facts" value={event.prep.facts.toString()} />
      </div>

      {event.description && (
        <Panel icon={MessageSquareText} label="Agenda">
          <p className="line-clamp-5 text-[12.5px] leading-5 text-[#5A574F]">{event.description}</p>
        </Panel>
      )}

      {known.length > 0 && (
        <Panel icon={Users} label="People in the room">
          <div className="space-y-3">
            {known.slice(0, 4).map((attendee) => (
              <Link
                key={attendee.email}
                href={`/people?contact=${attendee.contactId}`}
                className="flex items-start gap-3 rounded-[10px] px-2 py-2 transition hover:bg-[#FAF8F5]"
              >
                <AvatarDot name={attendee.name ?? attendee.email} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-[#1B1A17]">
                    {attendee.name ?? attendee.email}
                  </div>
                  <div className="truncate text-[11.5px] text-[#8A8276]">
                    {[attendee.role, attendee.company].filter(Boolean).join(" · ") || attendee.email}
                  </div>
                  <div className="mt-1 text-[11.5px] text-[#6A645A]">
                    {attendee.recentInteractions[0]?.subject ??
                      attendee.recentInteractions[0]?.summary ??
                      attendee.memory?.recurringThemes[0] ??
                      "No recent context yet"}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </Panel>
      )}

      {topFacts.length > 0 && (
        <Panel icon={Sparkles} label="Useful facts">
          <ul className="space-y-2">
            {topFacts.slice(0, 5).map((fact) => (
              <li key={fact.id} className="text-[12.5px] leading-5 text-[#5A574F]">
                <span className="font-semibold text-[#1B1A17]">{fact.attendee.name ?? fact.attendee.email}: </span>
                {fact.value}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {themes.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {themes.map((theme) => (
            <span key={theme} className="rounded-full border border-[#E2D9CB] bg-[#FAF8F5] px-2.5 py-1 text-[11.5px] text-[#6A645A]">
              {theme}
            </span>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <Panel icon={Clock3} label="Recent touchpoints">
          <ul className="space-y-2">
            {recent.slice(0, 5).map((interaction) => (
              <li key={interaction.id} className="text-[12.5px] leading-5">
                <span className="font-semibold text-[#1B1A17]">{interaction.attendee.name ?? interaction.attendee.email}</span>
                <span className="text-[#8A8276]"> · {formatRelativeDay(interaction.occurredAt)} · </span>
                <span className="text-[#5A574F]">{interaction.subject ?? interaction.summary ?? interaction.type.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/meetings/${encodeURIComponent(event.id)}/prep`}
          className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#1B1A17] px-3 text-[12px] font-semibold text-[#FAF8F5]"
        >
          Open full dossier
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
        {event.htmlLink && (
          <a
            href={event.htmlLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#D8CBB9] bg-[#FAF8F5] px-3 text-[12px] font-semibold text-[#6F685D]"
          >
            Calendar
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </section>
  );
}

function AttendeeChip({ attendee }: { attendee: UpcomingEvent["attendees"][number] }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[999px] border border-[#E2D9CB] bg-[#FAF8F5] px-2 py-1 text-[11.5px] font-medium text-[#4A453D]">
      <AvatarDot name={attendee.name ?? attendee.email} small />
      <span className="max-w-[160px] truncate">{attendee.name ?? attendee.email}</span>
    </span>
  );
}

function AvatarDot({ name, small = false }: { name: string; small?: boolean }) {
  const color = getAvatarColor(name);
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        small ? "h-5 w-5 text-[8px]" : "h-8 w-8 text-[10px]",
      )}
      style={{ backgroundColor: color.bg, color: color.text }}
    >
      {getInitials(name)}
    </span>
  );
}

function Panel({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof CalendarDays;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 rounded-[11px] border border-[#E2D9CB] bg-white px-3 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[#A89F90]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-[#E2D9CB] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(40,30,20,0.03)]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#A89F90]">{label}</div>
      <div className="mt-1 font-serif text-[25px] text-[#1B1A17]">{value}</div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[9px] border border-[#E2D9CB] bg-[#FAF8F5] px-3 py-2">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-[#A89F90]">{label}</div>
      <div className="mt-0.5 text-[17px] font-semibold text-[#1B1A17]">{value}</div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof CalendarDays;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[12px] border border-[#E9E1D5] bg-[#F6F2EC] px-6 py-12 text-center">
      <Icon className="mx-auto h-6 w-6 text-[#A89F90]" />
      <h2 className="mt-3 font-serif text-[24px] font-medium text-[#1B1A17]">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-5 text-[#8A8276]">{body}</p>
    </div>
  );
}

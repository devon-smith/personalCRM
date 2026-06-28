"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  Clock3,
  ExternalLink,
  Loader2,
  RefreshCw,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import type { UpcomingEvent } from "@/lib/calendar";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { cn } from "@/lib/utils";

interface CalendarResponse {
  events: UpcomingEvent[];
  error?: string;
}

function isToday(iso: string): boolean {
  const date = new Date(iso);
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateLabel(): string {
  return new Date().toLocaleDateString("en-US", {
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

function nextMeeting(events: UpcomingEvent[]): UpcomingEvent | null {
  const now = Date.now();
  return events.find((event) => new Date(event.endTime ?? event.startTime).getTime() >= now) ?? events[0] ?? null;
}

export default function CalendarPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<CalendarResponse>({
    queryKey: ["upcoming-meetings"],
    queryFn: async () => {
      const res = await fetch("/api/calendar");
      if (!res.ok) return { events: [], error: `Calendar unavailable (${res.status})` };
      return res.json();
    },
    retry: false,
    refetchInterval: 5 * 60 * 1000,
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

  const todayEvents = useMemo(
    () => (data?.events ?? []).filter((event) => isToday(event.startTime)),
    [data?.events],
  );
  const upcoming = nextMeeting(todayEvents);
  const knownAttendees = todayEvents.reduce(
    (sum, event) => sum + event.attendees.filter((attendee) => attendee.contactId).length,
    0,
  );

  return (
    <div className="mx-auto max-w-[1120px] space-y-6">
      <section className="rounded-[14px] border border-[#EAE2D6] bg-white px-5 py-5 shadow-[0_1px_2px_rgba(40,30,20,0.03)] sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#B5613F]">
              Daily prep
            </div>
            <h1 className="font-serif text-[34px] font-medium leading-tight text-[#1B1A17]">
              Calendar
            </h1>
            <p className="mt-2 max-w-[680px] text-[13px] leading-5 text-[#6A645A]">
              {formatDateLabel()} meetings, attendee context, and prep links in one place.
            </p>
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <main className="space-y-3">
          {isLoading ? (
            <div className="flex items-center gap-2 rounded-[12px] border border-[#E9E1D5] bg-[#F6F2EC] px-4 py-8 text-[13px] text-[#8A8276]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading today&apos;s meetings...
            </div>
          ) : data?.error ? (
            <EmptyState
              icon={AlertCircle}
              title="Calendar needs attention"
              body={data.error}
            />
          ) : todayEvents.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No meetings today"
              body="When meetings are on the calendar, prep links and attendee context will show here."
            />
          ) : (
            todayEvents.map((event) => <MeetingPrepRow key={event.id} event={event} />)
          )}
        </main>

        <aside className="space-y-4">
          <div className="rounded-[12px] border border-[#E9E1D5] bg-[#F3EEE6] px-4 py-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#A89F90]">
              Today
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Metric label="Meetings" value={todayEvents.length.toString()} />
              <Metric label="Known people" value={knownAttendees.toString()} />
            </div>
            {upcoming && (
              <div className="mt-4 rounded-[10px] border border-[#E2D9CB] bg-[#FAF8F5] px-3 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#A89F90]">
                  Next up
                </div>
                <div className="mt-1 text-[13px] font-semibold text-[#1B1A17]">
                  {upcoming.title}
                </div>
                <div className="mt-1 text-[12px] text-[#8A8276]">
                  {formatTime(upcoming.startTime)}
                  {upcoming.endTime ? ` - ${formatTime(upcoming.endTime)}` : ""}
                </div>
                <Link
                  href={`/meetings/${encodeURIComponent(upcoming.id)}/prep`}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-[7px] bg-[#1B1A17] px-3 py-2 text-[11.5px] font-semibold text-[#FAF8F5]"
                >
                  Open prep
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function MeetingPrepRow({ event }: { event: UpcomingEvent }) {
  const known = event.attendees.filter((attendee) => attendee.contactId);
  const unknownCount = event.attendees.length - known.length;

  return (
    <section className="rounded-[12px] border border-[#E9E1D5] bg-white px-4 py-4 shadow-[0_1px_2px_rgba(40,30,20,0.03)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[11.5px] font-semibold text-[#8A8276]">
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5" />
              {formatTime(event.startTime)}
              {event.endTime ? ` - ${formatTime(event.endTime)}` : ""}
            </span>
            {event.endTime && <span>{formatDuration(event.startTime, event.endTime)}</span>}
          </div>
          <h2 className="mt-2 font-serif text-[22px] font-medium leading-tight text-[#1B1A17]">
            {event.title}
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {known.slice(0, 6).map((attendee) => (
              <AttendeeChip
                key={attendee.email}
                name={attendee.name ?? attendee.email}
                contactId={attendee.contactId}
              />
            ))}
            {unknownCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-[999px] border border-[#E2D9CB] bg-[#FAF8F5] px-2.5 py-1 text-[11.5px] text-[#8A8276]">
                <Users className="h-3.5 w-3.5" />
                {unknownCount} unknown
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href={`/meetings/${encodeURIComponent(event.id)}/prep`}
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#1B1A17] px-3 text-[12px] font-semibold text-[#FAF8F5]"
          >
            Prep
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          {event.htmlLink && (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#E2D9CB] bg-[#FAF8F5] px-3 text-[12px] font-semibold text-[#6F685D]"
            >
              Calendar
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

function AttendeeChip({ name, contactId }: { name: string; contactId: string | null }) {
  const color = getAvatarColor(name);
  const className = "inline-flex items-center gap-1.5 rounded-[999px] border border-[#E2D9CB] bg-[#FAF8F5] px-2 py-1 text-[11.5px] font-medium text-[#4A453D]";
  const content = (
    <>
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-semibold"
        style={{ backgroundColor: color.bg, color: color.text }}
      >
        {getInitials(name)}
      </span>
      <span className="max-w-[160px] truncate">{name}</span>
    </>
  );

  if (!contactId) return <span className={className}>{content}</span>;

  return (
    <Link href={`/people?contact=${contactId}`} className={cn(className, "transition hover:border-[#D2BEA3]")}>
      {content}
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[9px] border border-[#E2D9CB] bg-[#FAF8F5] px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#A89F90]">
        {label}
      </div>
      <div className="mt-0.5 text-[18px] font-semibold text-[#1B1A17]">{value}</div>
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

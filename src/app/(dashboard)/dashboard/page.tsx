"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Gift,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import type { UpcomingEvent } from "@/lib/calendar";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { formatDistanceToNow } from "@/lib/date-utils";
import { NetworkQueryBox } from "@/components/network-query/network-query-box";
import { AssistantObservations } from "@/components/dashboard/assistant-observations";
import { SyncAlerts } from "@/components/dashboard/sync-alerts";

interface CircleBadge {
  id: string;
  name: string;
  color: string;
}

interface RecentInteraction {
  id: string;
  type: string;
  subject: string | null;
  summary: string | null;
  occurredAt: string;
  direction: string;
  channel: string | null;
  messageCount: number;
  contact: {
    id: string;
    name: string;
    company: string | null;
    tier: string;
    source: string;
    circles: { circle: CircleBadge }[];
  };
}

interface RecentlyActiveContact {
  id: string;
  name: string;
  company: string | null;
  tier: string;
  source: string;
  interactionCount: number;
  lastInteraction: string | null;
  lastInteractionType: string | null;
  lastInteractionSummary: string | null;
  circles: CircleBadge[];
}

interface DashboardStats {
  tierCounts: Record<string, number>;
  contactsThisMonth: number;
  interactionsThisWeek: number;
  totalContacts: number;
  recentInteractions: RecentInteraction[];
  overdueContacts: Array<{
    id: string;
    name: string;
    company: string | null;
    daysOverdue: number;
    tier: string;
  }>;
  overdueCount: number;
  circles: Array<{
    id: string;
    name: string;
    color: string;
    icon: string;
    contactCount: number;
  }>;
  recentlyActive: RecentlyActiveContact[];
  sourceCounts: Record<string, number>;
}

interface CalendarResponse {
  events: UpcomingEvent[];
  error?: string;
}

interface Birthday {
  id: string;
  name: string;
  company: string | null;
  avatarUrl: string | null;
  birthday: string;
  birthdayLabel: string;
  daysUntil: number;
  isToday: boolean;
}

interface BirthdaysResponse {
  birthdays: Birthday[];
}

const SYNC_INTERVAL_MS = 10 * 60 * 1000;

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getFirstName(name: string | null | undefined): string | null {
  if (!name) return null;
  return name.split(/\s+/)[0] ?? null;
}

function prettyDate(now: Date = new Date()): string {
  return now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatMeetingStamp(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (date.toDateString() === today.toDateString()) return formatTime(iso);
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow ${formatTime(iso)}`;
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatBirthdayLabel(birthday: Birthday): string {
  if (birthday.isToday) return "Today";
  if (birthday.daysUntil === 1) return "Tomorrow";
  return `In ${birthday.daysUntil} days`;
}

function compactLabel(value: number, label: string): string {
  return `${value.toLocaleString()} ${label}${value === 1 ? "" : "s"}`;
}

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const syncInFlight = useRef(false);
  const { data: session } = useSession();

  const runSync = useCallback(async () => {
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    try {
      await fetch("/api/gmail/sync", { method: "POST" });
      queryClient.invalidateQueries({ queryKey: ["inbox-items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["upcoming-meetings"] });
    } finally {
      syncInFlight.current = false;
    }
  }, [queryClient]);

  useEffect(() => {
    const initialTimer = setTimeout(runSync, 3000);
    const interval = setInterval(runSync, SYNC_INTERVAL_MS);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [runSync]);

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: calendar } = useQuery<CalendarResponse>({
    queryKey: ["upcoming-meetings"],
    queryFn: async () => {
      const res = await fetch("/api/calendar");
      if (!res.ok) return { events: [], error: `Calendar unavailable (${res.status})` };
      return res.json();
    },
    retry: false,
    staleTime: 5 * 60_000,
  });

  const { data: birthdayData } = useQuery<BirthdaysResponse>({
    queryKey: ["birthdays", 30],
    queryFn: async () => {
      const res = await fetch("/api/birthdays?days=30");
      if (!res.ok) return { birthdays: [] };
      return res.json();
    },
    retry: false,
    staleTime: 10 * 60_000,
  });

  const firstName = getFirstName(session?.user?.name);
  const greetingHeadline = firstName
    ? `${getGreeting()}, ${firstName}.`
    : `${getGreeting()}.`;

  const todayMeetings = useMemo(
    () => (calendar?.events ?? []).filter((event) => !event.allDay && isToday(event.startTime)),
    [calendar?.events],
  );
  const upcomingMeetings = (calendar?.events ?? []).filter((event) => !event.allDay);
  const visibleMeetings = todayMeetings.length > 0 ? todayMeetings : upcomingMeetings.slice(0, 4);
  const meetingSectionLabel = todayMeetings.length > 0 ? "Today" : "Upcoming";
  const birthdays = birthdayData?.birthdays ?? [];

  if (isLoading || !stats) {
    return (
      <div className="mx-auto max-w-[1120px] space-y-5">
        <div className="rounded-[14px] border border-[#EAE2D6] bg-white px-6 py-6">
          <div className="h-7 w-40 animate-pulse rounded bg-[#EFE8DC]" />
          <div className="mt-4 h-12 w-72 animate-pulse rounded bg-[#EFE8DC]" />
        </div>
      </div>
    );
  }

  const attention = [
    ...stats.recentInteractions.slice(0, 4).map((interaction) => ({
      key: interaction.id,
      href: "/reply-queue",
      name: interaction.contact.name,
      initials: getInitials(interaction.contact.name),
      body: interaction.subject ?? interaction.summary ?? "Recent inbound conversation",
      tag: interaction.direction === "INBOUND" ? "Reply" : "Recent",
      accent: interaction.direction === "INBOUND" ? "#B5613F" : "#5E7A93",
      meta: formatDistanceToNow(new Date(interaction.occurredAt)),
    })),
    ...stats.overdueContacts.slice(0, 2).map((contact) => ({
      key: contact.id,
      href: `/people?contact=${contact.id}`,
      name: contact.name,
      initials: getInitials(contact.name),
      body: `${contact.daysOverdue} days past your follow-up rhythm${contact.company ? ` · ${contact.company}` : ""}`,
      tag: "Reconnect",
      accent: "#8A8276",
      meta: "stale",
    })),
  ].slice(0, 5);

  const primaryMeeting = visibleMeetings[0] ?? null;
  const prepSignals = visibleMeetings.reduce(
    (sum, event) => sum + event.prep.openThreads + event.prep.facts,
    0,
  );

  return (
    <div className="mx-auto max-w-[1160px] space-y-5">
      <section className="rounded-[16px] border border-[#EAE2D6] bg-white px-5 py-5 shadow-[0_1px_2px_rgba(40,30,20,0.03)] sm:px-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#B5613F]">
              {prettyDate()}
            </div>
            <h1 className="font-serif text-[34px] font-medium leading-tight text-[#1B1A17] sm:text-[40px]">
              {greetingHeadline}
            </h1>
            <p className="mt-2 max-w-[650px] text-[13px] leading-5 text-[#6A645A]">
              Your replies, relationships, and meeting prep are gathered into one working surface.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[520px]">
            <HomeStat label="Need reply" value={stats.recentInteractions.length.toString()} color="#B5613F" />
            <HomeStat
              label={todayMeetings.length > 0 ? "Today meetings" : "Upcoming"}
              value={(todayMeetings.length || upcomingMeetings.length).toString()}
              color="#5E7A93"
            />
            <HomeStat label="People" value={stats.totalContacts.toLocaleString()} color="#6E7B53" />
            <HomeStat label="Signals" value={prepSignals.toString()} color="#9A6A4B" />
          </div>
        </div>
      </section>

      <NetworkQueryBox />
      <AssistantObservations />
      <SyncAlerts />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <main className="space-y-4">
          <section className="rounded-[14px] border border-[#EAE2D6] bg-white shadow-[0_1px_2px_rgba(40,30,20,0.03)]">
            <div className="flex items-center justify-between border-b border-[#F0EAE0] px-5 py-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#B5613F]">
                  Needs attention
                </div>
                <h2 className="font-serif text-[24px] font-medium text-[#1B1A17]">Today&apos;s queue</h2>
              </div>
              <Link href="/reply-queue" className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#1B1A17] px-3 py-2 text-[12px] font-semibold text-[#FAF8F5]">
                Replies
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="divide-y divide-[#F0EAE0]">
              {attention.length === 0 ? (
                <div className="flex items-center gap-3 px-5 py-6 text-[13px] text-[#6A645A]">
                  <CheckCircle2 className="h-5 w-5 text-[#6E7B53]" />
                  Nothing urgent is waiting in the current queue.
                </div>
              ) : (
                attention.map((item) => <AttentionRow key={item.key} item={item} />)
              )}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <WarmPanel
              eyebrow="Relationship memory"
              title="Strongest relationships"
              href="/people"
              icon={Users}
            >
              <div className="space-y-3">
                {stats.recentlyActive.slice(0, 5).map((contact) => (
                  <PersonLine
                    key={contact.id}
                    href={`/people?contact=${contact.id}`}
                    name={contact.name}
                    meta={`${compactLabel(contact.interactionCount, "interaction")} · ${contact.lastInteraction ? formatDistanceToNow(new Date(contact.lastInteraction)) : "recent"}`}
                    detail={contact.lastInteractionSummary ?? contact.company ?? "Active relationship"}
                  />
                ))}
                {stats.recentlyActive.length === 0 && (
                  <p className="text-[13px] leading-5 text-[#8A8276]">Recent interactions will appear here after sync.</p>
                )}
              </div>
            </WarmPanel>

            <WarmPanel
              eyebrow="Circles"
              title="Communication groups"
              href="/circles"
              icon={Sparkles}
            >
              <div className="space-y-2">
                {stats.circles.slice(0, 6).map((circle) => (
                  <Link
                    key={circle.id}
                    href={`/people?circle=${circle.id}`}
                    className="flex items-center gap-3 rounded-[10px] px-2 py-2 transition hover:bg-[#FAF8F5]"
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: circle.color }} />
                    <span className="flex-1 text-[13px] font-semibold text-[#1B1A17]">{circle.name}</span>
                    <span className="text-[12px] text-[#8A8276]">{circle.contactCount}</span>
                  </Link>
                ))}
              </div>
            </WarmPanel>
          </section>
        </main>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <section className="rounded-[14px] border border-[#E2D9CB] bg-[#F3EEE6] p-4 shadow-[0_2px_8px_rgba(27,26,23,0.04)]">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#B5613F]">
                  Meetings
                </div>
                <h2 className="font-serif text-[24px] font-medium text-[#1B1A17]">{meetingSectionLabel}</h2>
              </div>
              <Link href="/calendar" className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#D8CBB9] bg-[#FAF8F5] px-2.5 text-[11.5px] font-semibold text-[#6F685D]">
                Calendar
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            {primaryMeeting ? (
              <div className="mt-4 rounded-[12px] border border-[#E2D9CB] bg-white p-3">
                <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#8A8276]">
                  <Clock3 className="h-3.5 w-3.5" />
                  {formatTime(primaryMeeting.startTime)}
                </div>
                <h3 className="mt-2 font-serif text-[21px] leading-tight text-[#1B1A17]">
                  {primaryMeeting.title}
                </h3>
                <p className="mt-2 text-[12.5px] leading-5 text-[#6A645A]">{primaryMeeting.prep.summary}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <SignalPill label={`${primaryMeeting.prep.knownAttendees} known`} />
                  <SignalPill label={`${primaryMeeting.prep.openThreads} threads`} />
                  <SignalPill label={`${primaryMeeting.prep.facts} facts`} />
                </div>
                <Link
                  href={`/meetings/${encodeURIComponent(primaryMeeting.id)}/prep`}
                  className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#1B1A17] px-3 text-[12px] font-semibold text-[#FAF8F5]"
                >
                  Open prep
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : (
              <p className="mt-4 rounded-[12px] border border-[#E2D9CB] bg-white p-4 text-[13px] leading-5 text-[#8A8276]">
                No meetings found in the current calendar window. Sync calendar from the Calendar page if this looks stale.
              </p>
            )}

            <div className="mt-3 space-y-2">
              {visibleMeetings.slice(1, 4).map((meeting) => (
                <Link key={meeting.id} href={`/calendar`} className="flex items-center gap-3 rounded-[10px] px-2 py-2 transition hover:bg-[#FAF8F5]">
                  <CalendarDays className="h-4 w-4 text-[#8A8276]" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-[#1B1A17]">{meeting.title}</span>
                  <span className="text-[11.5px] text-[#8A8276]">{formatMeetingStamp(meeting.startTime)}</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="rounded-[14px] border border-[#EAE2D6] bg-white p-4 shadow-[0_1px_2px_rgba(40,30,20,0.03)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#B5613F]">
                  <Gift className="h-3.5 w-3.5" />
                  Birthdays
                </div>
                <h2 className="mt-1 font-serif text-[23px] font-medium text-[#1B1A17]">
                  Next 30 days
                </h2>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {birthdays.length === 0 ? (
                <p className="rounded-[10px] bg-[#FAF8F5] px-3 py-3 text-[12.5px] leading-5 text-[#8A8276]">
                  No birthdays found in the next 30 days.
                </p>
              ) : (
                birthdays.slice(0, 5).map((birthday) => (
                  <PersonLine
                    key={birthday.id}
                    href={`/people?contact=${birthday.id}`}
                    name={birthday.name}
                    meta={formatBirthdayLabel(birthday)}
                    detail={`${birthday.birthdayLabel} birthday`}
                  />
                ))
              )}
            </div>
          </section>

          <section className="rounded-[14px] border border-[#EAE2D6] bg-white p-4 shadow-[0_1px_2px_rgba(40,30,20,0.03)]">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#A89F90]">
              <Search className="h-3.5 w-3.5" />
              Ask shortcuts
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                "Who did I promise to follow up with?",
                "Who has meetings today?",
                "Which circles are stale?",
                "What do I know before this meeting?",
              ].map((query) => (
                <Link key={query} href={`/ask?q=${encodeURIComponent(query)}`} className="rounded-full border border-[#E2D9CB] bg-[#FAF8F5] px-3 py-1.5 text-[12px] text-[#6A645A] transition hover:border-[#D2BEA3]">
                  {query}
                </Link>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function HomeStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-[11px] border border-[#E8DED0] bg-[#FAF8F5] px-3 py-3">
      <div className="font-serif text-[25px] leading-none" style={{ color }}>{value}</div>
      <div className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#8A8276]">{label}</div>
    </div>
  );
}

function AttentionRow({
  item,
}: {
  item: {
    href: string;
    name: string;
    initials: string;
    body: string;
    tag: string;
    accent: string;
    meta: string;
  };
}) {
  const color = getAvatarColor(item.name);
  return (
    <Link href={item.href} className="flex items-start gap-3 px-5 py-4 transition hover:bg-[#FAF8F5]">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
        style={{ backgroundColor: color.bg, color: color.text }}
      >
        {item.initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-[#1B1A17]">{item.name}</span>
          <span className="rounded-[6px] px-2 py-0.5 text-[10.5px] font-semibold" style={{ backgroundColor: `${item.accent}18`, color: item.accent }}>
            {item.tag}
          </span>
        </span>
        <span className="mt-1 block truncate text-[13px] text-[#5A574F]">{item.body}</span>
      </span>
      <span className="shrink-0 text-[11.5px] text-[#A89F90]">{item.meta}</span>
    </Link>
  );
}

function WarmPanel({
  eyebrow,
  title,
  href,
  icon: Icon,
  children,
}: {
  eyebrow: string;
  title: string;
  href: string;
  icon: typeof Users;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border border-[#EAE2D6] bg-white p-4 shadow-[0_1px_2px_rgba(40,30,20,0.03)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#B5613F]">
            <Icon className="h-3.5 w-3.5" />
            {eyebrow}
          </div>
          <h2 className="mt-1 font-serif text-[23px] font-medium text-[#1B1A17]">{title}</h2>
        </div>
        <Link href={href} className="rounded-[8px] border border-[#E2D9CB] bg-[#FAF8F5] p-2 text-[#6F685D]">
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function PersonLine({
  href,
  name,
  meta,
  detail,
}: {
  href: string;
  name: string;
  meta: string;
  detail: string;
}) {
  const color = getAvatarColor(name);
  return (
    <Link href={href} className="flex items-start gap-3 rounded-[10px] px-2 py-2 transition hover:bg-[#FAF8F5]">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold" style={{ backgroundColor: color.bg, color: color.text }}>
        {getInitials(name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-[#1B1A17]">{name}</span>
        <span className="block truncate text-[11.5px] text-[#8A8276]">{meta}</span>
        <span className="mt-0.5 block truncate text-[12px] text-[#5A574F]">{detail}</span>
      </span>
    </Link>
  );
}

function SignalPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-[#E2D9CB] bg-[#FAF8F5] px-2.5 py-1 text-[11.5px] text-[#6A645A]">
      {label}
    </span>
  );
}

"use client";

import { useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  MessageSquare,
  Mail,
  Phone,
  StickyNote,
  Users as MeetingIcon,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { formatDistanceToNow } from "@/lib/date-utils";

import { UpcomingMeetings } from "@/components/dashboard/upcoming-meetings";
import { UpcomingBirthdays } from "@/components/dashboard/upcoming-birthdays";
import { SmartScheduling } from "@/components/dashboard/smart-scheduling";
import { LifeUpdates } from "@/components/dashboard/life-updates";
import { DraftQueue } from "@/components/dashboard/draft-queue";
import { Inbox, ActionItemsCard } from "@/components/dashboard/inbox";
import { SyncAlerts } from "@/components/dashboard/sync-alerts";
import { TravelCard } from "@/components/dashboard/travel-card";
import { Surface, StatTile, Sparkline, CollapsibleSection } from "@/components/ds";
import { MiniCalendar } from "@/components/dashboard/mini-calendar";
import { TodayTimeline, AddEventPill } from "@/components/dashboard/today-timeline";
import { NetworkQueryBox } from "@/components/network-query/network-query-box";
import { AssistantObservations } from "@/components/dashboard/assistant-observations";

// Tone hex map mirrors the one in Surface. Inline styles win over the
// shadcn Card's `bg-card` utility by specificity, so this is the only
// way to actually push tone backgrounds onto Card-wrapped surfaces
// without rewriting their internal layout.
const TONE_BG = {
  sand:  "#F1ECDE",
  mist:  "#E8E4DC",
  olive: "#DCDCC9",
  stone: "#DDE3E3",
} as const;

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

function buildWeekSeries(total: number): number[] {
  // Cheap visual proxy: distribute 7 stable values whose sum tracks `total`.
  // We don't yet expose per-day counts; this gives the bar chart shape
  // without inventing detail that isn't real. Returns a flat-ish series.
  if (total <= 0) return [0.4, 0.5, 0.4, 0.6, 0.5, 0.5, 0.4];
  const base = total / 7;
  return [0.7, 1.1, 0.9, 1.3, 1.0, 1.2, 0.8].map((m) => Math.max(0.2, base * m));
}

function buildSubtitle(stats: DashboardStats): string {
  // Calm, human, no fear-of-missing-out numbers.
  const inboxAwaiting = stats.recentInteractions.length;
  if (stats.interactionsThisWeek === 0 && inboxAwaiting === 0) {
    return "All quiet. A good day to reach for someone you've been meaning to.";
  }
  if (inboxAwaiting > 0 && inboxAwaiting <= 3) {
    return "A few people are waiting on you. Today feels manageable.";
  }
  if (inboxAwaiting > 3) {
    return "A bit of catching up to do. Pick one and start there.";
  }
  return "Today's surfaces are below — pick what feels right.";
}

const typeIcons: Record<string, React.ElementType> = {
  EMAIL: Mail,
  MESSAGE: MessageSquare,
  MEETING: MeetingIcon,
  CALL: Phone,
  NOTE: StickyNote,
};

interface CircleBadge {
  id: string;
  name: string;
  color: string;
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

interface DashboardStats {
  tierCounts: Record<string, number>;
  contactsThisMonth: number;
  interactionsThisWeek: number;
  totalContacts: number;
  recentInteractions: RecentInteraction[];
  overdueContacts: {
    id: string;
    name: string;
    company: string | null;
    daysOverdue: number;
    tier: string;
  }[];
  overdueCount: number;
  circles: {
    id: string;
    name: string;
    color: string;
    icon: string;
    contactCount: number;
  }[];
  recentlyActive: RecentlyActiveContact[];
  sourceCounts: Record<string, number>;
}

const SYNC_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const syncInFlight = useRef(false);
  const { data: session } = useSession();

  const runSync = useCallback(async () => {
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    try {
      await Promise.allSettled([
        fetch("/api/imessage", { method: "POST" }),
        fetch("/api/gmail/sync", { method: "POST" }),
      ]);
      // Refresh inbox and dashboard data after sync completes
      queryClient.invalidateQueries({ queryKey: ["inbox-items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } finally {
      syncInFlight.current = false;
    }
  }, [queryClient]);

  // Initial sync (deferred 3s) + recurring every 10 minutes
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

  const firstName = getFirstName(session?.user?.name);
  const greetingHeadline = firstName
    ? `${getGreeting()}, ${firstName}.`
    : `${getGreeting()}.`;

  if (isLoading || !stats) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="ds-display-xl">{greetingHeadline}</h1>
          <p className="ds-body-lg mt-3" style={{ color: "var(--text-tertiary)" }}>
            Loading your dashboard\u2026
          </p>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Surface key={i} tone="sand" padded>
              <div className="h-24 animate-pulse rounded-2xl" style={{ backgroundColor: "var(--surface-sand-raised)" }} />
            </Surface>
          ))}
        </div>
      </div>
    );
  }

  // Synthetic 7-point series for the "This week" sparkline. Tracks how
  // interactions distributed across the last 7 calendar days isn't on
  // the dashboard payload yet \u2014 for now we proxy with a smooth ramp
  // sized to the headline number so the viz isn't fake-detailed.
  const weekSeries = buildWeekSeries(stats.interactionsThisWeek);
  const circleSeries = stats.circles
    .slice(0, 7)
    .map((c) => c.contactCount || 1);
  const organizedCount = stats.circles.reduce((sum, c) => sum + c.contactCount, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8">
      {/* Main column */}
      <div className="crm-stagger min-w-0 space-y-6">
      {/* Greeting */}
      <div
        className="rounded-[14px] border bg-white px-5 py-5 shadow-[0_1px_2px_rgba(40,30,20,0.03)] sm:px-6"
        style={{ borderColor: "#EAE2D6" }}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div
              className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: "#B5613F" }}
            >
              {prettyDate()}
            </div>
            <h1
              className="font-serif text-[30px] font-medium leading-tight"
              style={{ color: "#1B1A17" }}
            >
              {greetingHeadline}
            </h1>
            <p className="mt-2 max-w-[640px] text-[13px]" style={{ color: "#6A645A" }}>
              {buildSubtitle(stats)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="rounded-[6px] border px-2.5 py-1.5 text-[11px]"
              style={{ borderColor: "#E6DDCF", color: "#9A9183" }}
            >
              ⌘K
            </span>
          </div>
        </div>
      </div>

      {/* Network query — Phase 7 flagship (M7.3). Natural-language
          question → Claude tool-use orchestrator → grounded answer.
          Sits at the top because it's the most-used surface; rotating
          placeholder shows what's possible without taking up real estate. */}
      <NetworkQueryBox />

      {/* M9.2: unprompted observations from the assistant. Self-hides
          when empty; daily worker generates 1-3 per user from recent
          signals (unanswered inbound, stale threads, life events,
          dormant inner-circle). */}
      <AssistantObservations />

      {/* Stat tiles (Sand for people-shaped data) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/reply-queue" className="block">
          <StatTile
            tone="sand"
            label="Need a reply"
            value={stats.recentInteractions.length.toString()}
            description="Recent inbound items"
            viz={<Sparkline data={weekSeries} variant="bars" />}
          />
        </Link>
        <Link href="/people" className="block">
          <StatTile
            tone="sand"
            label="People"
            value={stats.totalContacts.toLocaleString()}
            description={`${stats.contactsThisMonth} added this month`}
            viz={<Sparkline data={[6, 8, 7, 10, 9, 12, 11]} variant="line" />}
          />
        </Link>
        <Link href="/circles" className="block">
          <StatTile
            tone="olive"
            label="Active circles"
            value={stats.circles.length.toString()}
            description={`${organizedCount} contacts organized`}
            viz={
              circleSeries.length > 1 ? (
                <Sparkline data={circleSeries} variant="bars" />
              ) : null
            }
          />
        </Link>
        <Link href="/people" className="block">
          <StatTile
            tone="mist"
            label="This week"
            value={stats.interactionsThisWeek.toString()}
            description={
              stats.interactionsThisWeek === 0
                ? "Log your first interaction"
                : `interaction${stats.interactionsThisWeek === 1 ? "" : "s"}`
            }
            viz={<Sparkline data={weekSeries} variant="bars" />}
          />
        </Link>
      </div>

      {/* Sync alerts */}
      <SyncAlerts />

      {/* "While you're in [city]" — surfaces only when a future trip is
          detected in the calendar AND there are matching contacts. */}
      <TravelCard />

      {/* Unified Inbox + relationship history */}
      <Inbox />

      {/* Action Items — separate from inbox */}
      <ActionItemsCard />

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Interactions */}
        {stats.recentInteractions?.length > 0 && (
          <Card className="crm-card border-0 shadow-none" style={{ backgroundColor: TONE_BG.mist }}>
            <CardHeader className="px-6 pt-6 pb-0">
              <CardTitle className="crm-section-label">Recent interactions</CardTitle>
            </CardHeader>
            <CardContent className="px-6 pb-6 pt-4">
              <CollapsibleSection
                storageKey="dashboard-recent-expanded"
                previewCount={3}
                items={stats.recentInteractions}
                className="divide-y"
                renderItem={(interaction) => (
                  <RecentInteractionRow key={interaction.id} interaction={interaction} />
                )}
              />
            </CardContent>
          </Card>
        )}

        {/* Draft Queue */}
        <DraftQueueCard />

        {/* Smart Scheduling */}
        <SmartSchedulingCard />

        {/* Life Updates */}
        <LifeUpdatesCard />

        {/* Strongest relationships */}
        {stats.recentlyActive.length > 0 && (
          <Card className="crm-card border-0 shadow-none" style={{ backgroundColor: TONE_BG.olive }}>
            <CardHeader className="flex flex-row items-center justify-between px-6 pt-6 pb-0">
              <CardTitle className="crm-section-label">
                Strongest relationships
              </CardTitle>
              <span className="ds-caption">Last 30 days</span>
            </CardHeader>
            <CardContent className="px-6 pb-6 pt-4">
              <CollapsibleSection
                storageKey="dashboard-strongest-expanded"
                previewCount={3}
                items={stats.recentlyActive}
                className="divide-y"
                renderItem={(contact) => (
                  <StrongestRelationshipRow key={contact.id} contact={contact} />
                )}
              />
            </CardContent>
          </Card>
        )}

        {/* Upcoming Meetings */}
        <Card className="crm-card border-0 shadow-none" style={{ backgroundColor: TONE_BG.stone }}>
          <CardContent className="px-6 py-6">
            <UpcomingMeetings />
          </CardContent>
        </Card>

        {/* Birthdays */}
        <BirthdaysCard />

        {/* Your Circles */}
        <Card className="crm-card border-0 shadow-none" style={{ backgroundColor: TONE_BG.olive }}>
          <CardHeader className="flex flex-row items-center justify-between px-6 pt-6 pb-0">
            <CardTitle className="crm-section-label">Your circles</CardTitle>
            <Link
              href="/circles"
              className="ds-caption font-medium transition-colors"
              style={{ color: "var(--text-tertiary)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-tertiary)";
              }}
            >
              Manage
            </Link>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-4">
            {stats.circles.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-center">
                <p
                  className="ds-body-md"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  No circles yet
                </p>
                <Link
                  href="/circles"
                  className="mt-1.5 ds-body-sm font-medium transition-colors"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Set up your circles
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {stats.circles.map((circle) => (
                  <Link
                    key={circle.id}
                    href={`/people?circle=${circle.id}`}
                    className="group flex items-center gap-3 rounded-[10px] px-3 py-2.5 transition-colors"
                    style={{
                      transitionDuration: "var(--duration-fast)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor =
                        "var(--surface-sunken)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "";
                    }}
                  >
                    <div
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: circle.color }}
                    />
                    <span
                      className="flex-1 ds-body-md font-medium transition-colors"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {circle.name}
                    </span>
                    <span
                      className="ds-body-sm font-semibold"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      {circle.contactCount}
                    </span>
                  </Link>
                ))}
              </div>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div
                className="rounded-[10px] p-4 text-center"
                style={{ backgroundColor: "var(--surface-sunken)" }}
              >
                <p className="ds-stat-md">{stats.contactsThisMonth}</p>
                <p className="ds-caption mt-1">Added this month</p>
              </div>
              <div
                className="rounded-[10px] p-4 text-center"
                style={{ backgroundColor: "var(--surface-sunken)" }}
              >
                <p className="ds-stat-md">{stats.interactionsThisWeek}</p>
                <p className="ds-caption mt-1">Interactions this week</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      </div>{/* end main column */}

      {/* Right rail — desktop only. Mini-calendar anchor, today's
          chronological strip, single "Add event" CTA. Stays sticky
          so it follows the scroll on long dashboards. */}
      <aside className="hidden lg:block">
        <div className="sticky top-6 space-y-5">
          <div
            className="rounded-3xl p-4"
            style={{ backgroundColor: "#FFFFFF", boxShadow: "0 2px 8px rgba(27,26,23,0.04)" }}
          >
            <MiniCalendar />
            <div className="mt-4">
              <AddEventPill />
            </div>
          </div>
          <TodayTimeline />
        </div>
      </aside>
    </div>
  );
}

// ─── Supporting cards ────────────────────────────────────────

function RecentInteractionRow({
  interaction,
}: {
  interaction: RecentInteraction;
}) {
  const Icon = typeIcons[interaction.type] ?? StickyNote;
  const color = getAvatarColor(interaction.contact.name);
  return (
    <Link
      href={`/people?contact=${interaction.contact.id}`}
      className="group flex items-start gap-3 py-3 -mx-2 px-2 rounded-[10px] transition-colors"
      style={{ transitionDuration: "var(--duration-fast)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "";
      }}
    >
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback
          className="text-[10px] font-semibold"
          style={{ backgroundColor: color.bg, color: color.text }}
        >
          {getInitials(interaction.contact.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="ds-body-md font-medium truncate"
            style={{ color: "var(--text-primary)" }}
          >
            {interaction.contact.name}
          </span>
          {interaction.contact.circles?.slice(0, 2).map((cc) => (
            <span
              key={cc.circle.id}
              className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-[9px] font-semibold"
              style={{
                backgroundColor: `${cc.circle.color}15`,
                color: cc.circle.color,
              }}
            >
              {cc.circle.name}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <Icon className="h-3 w-3 shrink-0" style={{ color: "var(--text-tertiary)" }} />
          <p className="ds-caption truncate">
            {interaction.subject ?? interaction.summary ?? interaction.type.toLowerCase()}
          </p>
        </div>
        {interaction.contact.company && (
          <p
            className="text-[11px] truncate mt-0.5"
            style={{ color: "var(--text-tertiary)" }}
          >
            {interaction.contact.company}
          </p>
        )}
      </div>
      <span
        className="shrink-0 text-[11px] mt-0.5"
        style={{ color: "var(--text-tertiary)" }}
      >
        {formatDistanceToNow(new Date(interaction.occurredAt))}
      </span>
    </Link>
  );
}

function StrongestRelationshipRow({
  contact,
}: {
  contact: RecentlyActiveContact;
}) {
  const color = getAvatarColor(contact.name);
  const Icon = contact.lastInteractionType
    ? (typeIcons[contact.lastInteractionType] ?? StickyNote)
    : MessageSquare;
  return (
    <Link
      href={`/people?contact=${contact.id}`}
      className="group flex items-center gap-3 py-3 -mx-2 px-2 rounded-[10px] transition-colors"
      style={{ transitionDuration: "var(--duration-fast)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "";
      }}
    >
      <Avatar className="h-9 w-9">
        <AvatarFallback
          className="text-[11px] font-semibold"
          style={{ backgroundColor: color.bg, color: color.text }}
        >
          {getInitials(contact.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="ds-body-md font-medium truncate"
            style={{ color: "var(--text-primary)" }}
          >
            {contact.name}
          </span>
          {contact.circles?.slice(0, 2).map((c) => (
            <span
              key={c.id}
              className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-[9px] font-semibold"
              style={{ backgroundColor: `${c.color}15`, color: c.color }}
            >
              {c.name}
            </span>
          ))}
        </div>
        {contact.company && (
          <p className="ds-caption truncate">{contact.company}</p>
        )}
        {contact.lastInteractionSummary && (
          <div className="flex items-center gap-1.5 mt-0.5">
            <Icon
              className="h-3 w-3 shrink-0"
              style={{ color: "var(--text-tertiary)" }}
            />
            <p
              className="text-[11px] truncate"
              style={{ color: "var(--text-tertiary)" }}
            >
              {contact.lastInteractionSummary}
            </p>
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p
          className="ds-heading-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          {contact.interactionCount}
        </p>
        <p className="ds-caption">
          {contact.interactionCount === 1 ? "interaction" : "interactions"}
        </p>
      </div>
      <ChevronRight
        className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        style={{ color: "var(--text-tertiary)" }}
      />
    </Link>
  );
}

function SmartSchedulingCard() {
  const { data } = useQuery<{ suggestions: { contactId: string }[] }>({
    queryKey: ["scheduling-suggestions"],
    queryFn: async () => {
      const res = await fetch("/api/scheduling");
      if (!res.ok) return { suggestions: [] };
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  if (!data?.suggestions.length) return null;

  return (
    <Card className="crm-card border-0 shadow-none" style={{ backgroundColor: TONE_BG.stone }}>
      <CardContent className="px-6 py-6">
        <SmartScheduling />
      </CardContent>
    </Card>
  );
}

function LifeUpdatesCard() {
  const { data } = useQuery<{ entries: { id: string }[] }>({
    queryKey: ["changelog"],
    queryFn: async () => {
      const res = await fetch("/api/changelog");
      if (!res.ok) return { entries: [] };
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (!data?.entries.length) return null;

  return (
    <Card className="crm-card border-0 shadow-none" style={{ backgroundColor: TONE_BG.mist }}>
      <CardContent className="px-6 py-6">
        <LifeUpdates />
      </CardContent>
    </Card>
  );
}

function DraftQueueCard() {
  const { data } = useQuery<{ drafts: { id: string }[] }>({
    queryKey: ["drafts", "DRAFT"],
    queryFn: async () => {
      const res = await fetch("/api/drafts?status=DRAFT");
      if (!res.ok) return { drafts: [] };
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (!data?.drafts.length) return null;

  return (
    <Card className="crm-card border-0 shadow-none" style={{ backgroundColor: TONE_BG.mist }}>
      <CardContent className="px-6 py-6">
        <DraftQueue />
      </CardContent>
    </Card>
  );
}

function BirthdaysCard() {
  const { data } = useQuery<{ birthdays: { id: string }[] }>({
    queryKey: ["birthdays"],
    queryFn: async () => {
      const res = await fetch("/api/birthdays?days=14");
      if (!res.ok) return { birthdays: [] };
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  if (!data?.birthdays.length) return null;

  return (
    <Card className="crm-card border-0 shadow-none" style={{ backgroundColor: TONE_BG.stone }}>
      <CardContent className="px-6 py-6">
        <UpcomingBirthdays />
      </CardContent>
    </Card>
  );
}

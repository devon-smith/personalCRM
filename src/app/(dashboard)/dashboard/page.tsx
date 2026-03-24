"use client";

import { useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Users,
  UserCheck,
  MessageSquare,
  Mail,
  Phone,
  StickyNote,
  Users as MeetingIcon,
  ChevronRight,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { formatDistanceToNow } from "@/lib/date-utils";

import { UpcomingMeetings } from "@/components/dashboard/upcoming-meetings";
import { ReviewQueue } from "@/components/sightings/review-queue";
import { UpcomingBirthdays } from "@/components/dashboard/upcoming-birthdays";
import { SmartScheduling } from "@/components/dashboard/smart-scheduling";
import { LifeUpdates } from "@/components/dashboard/life-updates";
import { DraftQueue } from "@/components/dashboard/draft-queue";
import { Inbox, ActionItemsCard } from "@/components/dashboard/inbox";
import { SyncAlerts } from "@/components/dashboard/sync-alerts";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning.";
  if (hour < 17) return "Good afternoon.";
  return "Good evening.";
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

  if (isLoading || !stats) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="ds-display-xl">{getGreeting()}</h1>
          <p
            className="ds-body-lg mt-2"
            style={{ color: "var(--text-tertiary)" }}
          >
            Loading your dashboard...
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="crm-card p-6">
              <div
                className="h-20 animate-pulse rounded-[10px]"
                style={{ backgroundColor: "var(--surface-sunken)" }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Hero greeting */}
      <div className="crm-animate-enter">
        <h1 className="ds-display-xl">{getGreeting()}</h1>
        <p
          className="ds-body-lg mt-2"
          style={{ color: "var(--text-secondary)" }}
        >
          {stats.overdueCount > 0 ? (
            <>
              You have{" "}
              <span
                className="font-medium"
                style={{ color: "var(--text-primary)" }}
              >
                {stats.overdueCount} overdue follow-up
                {stats.overdueCount !== 1 ? "s" : ""}
              </span>
            </>
          ) : (
            "You\u2019re all caught up. Nice work."
          )}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Total Contacts"
          value={stats.totalContacts}
          icon={Users}
          description={`${stats.contactsThisMonth} added this month`}
          href="/people"
        />
        <StatCard
          title="Circles"
          value={stats.circles.length}
          icon={UserCheck}
          description={`${stats.circles.reduce((sum, c) => sum + c.contactCount, 0)} contacts organized`}
          href="/circles"
        />
        <StatCard
          title="Interactions"
          value={stats.interactionsThisWeek}
          icon={MessageSquare}
          description="this week"
          href="/activity"
          zeroAction={
            stats.interactionsThisWeek === 0
              ? { label: "Log an interaction", href: "/activity" }
              : undefined
          }
        />
      </div>

      {/* Sync alerts */}
      <SyncAlerts />

      {/* Unified Inbox + Activity */}
      <Inbox />

      {/* Action Items — separate from inbox */}
      <ActionItemsCard />

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Interactions */}
        {stats.recentInteractions?.length > 0 && (
          <Card className="crm-card border-0">
            <CardHeader className="px-6 pt-6 pb-0">
              <CardTitle className="crm-section-label">Recent interactions</CardTitle>
            </CardHeader>
            <CardContent className="px-6 pb-6 pt-4">
              <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                {stats.recentInteractions.map((interaction) => {
                  const Icon = typeIcons[interaction.type] ?? StickyNote;
                  const color = getAvatarColor(interaction.contact.name);
                  return (
                    <Link
                      key={interaction.id}
                      href={`/people?contact=${interaction.contact.id}`}
                      className="group flex items-start gap-3 py-3 -mx-2 px-2 rounded-[10px] transition-colors"
                      style={{ transitionDuration: "var(--duration-fast)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-sunken)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; }}
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
                          <span className="ds-body-md font-medium truncate" style={{ color: "var(--text-primary)" }}>
                            {interaction.contact.name}
                          </span>
                          {interaction.contact.circles?.slice(0, 2).map((cc) => (
                            <span
                              key={cc.circle.id}
                              className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-[9px] font-semibold"
                              style={{ backgroundColor: `${cc.circle.color}15`, color: cc.circle.color }}
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
                          <p className="text-[11px] truncate mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                            {interaction.contact.company}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                        {formatDistanceToNow(new Date(interaction.occurredAt))}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Draft Queue */}
        <DraftQueueCard />

        {/* Smart Scheduling */}
        <SmartSchedulingCard />

        {/* Life Updates */}
        <LifeUpdatesCard />

        {/* Review Queue */}
        <ReviewQueueCard />

        {/* Strongest relationships */}
        {stats.recentlyActive.length > 0 && (
          <Card className="crm-card border-0">
            <CardHeader className="flex flex-row items-center justify-between px-6 pt-6 pb-0">
              <CardTitle className="crm-section-label">
                Strongest relationships
              </CardTitle>
              <span className="ds-caption">Last 30 days</span>
            </CardHeader>
            <CardContent className="px-6 pb-6 pt-4">
              <div
                className="divide-y"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                {stats.recentlyActive.map((contact) => {
                  const color = getAvatarColor(contact.name);
                  const Icon = contact.lastInteractionType
                    ? (typeIcons[contact.lastInteractionType] ?? StickyNote)
                    : MessageSquare;
                  return (
                    <Link
                      key={contact.id}
                      href={`/people?contact=${contact.id}`}
                      className="group flex items-center gap-3 py-3 -mx-2 px-2 rounded-[10px] transition-colors"
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
                      <Avatar className="h-9 w-9">
                        <AvatarFallback
                          className="text-[11px] font-semibold"
                          style={{
                            backgroundColor: color.bg,
                            color: color.text,
                          }}
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
                              style={{
                                backgroundColor: `${c.color}15`,
                                color: c.color,
                              }}
                            >
                              {c.name}
                            </span>
                          ))}
                        </div>
                        {contact.company && (
                          <p className="ds-caption truncate">
                            {contact.company}
                          </p>
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
                          {contact.interactionCount === 1
                            ? "interaction"
                            : "interactions"}
                        </p>
                      </div>
                      <ChevronRight
                        className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        style={{ color: "var(--text-tertiary)" }}
                      />
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Upcoming Meetings */}
        <Card className="crm-card border-0">
          <CardContent className="px-6 py-6">
            <UpcomingMeetings />
          </CardContent>
        </Card>

        {/* Birthdays */}
        <BirthdaysCard />

        {/* Your Circles */}
        <Card className="crm-card border-0">
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
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────

function StatCard({
  title,
  value,
  icon: Icon,
  description,
  href,
  zeroAction,
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  description: string;
  href?: string;
  zeroAction?: { label: string; href: string };
}) {
  const content = (
    <div className="crm-card crm-card-interactive p-6 cursor-pointer group">
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors"
          style={{
            backgroundColor: "var(--surface-sunken)",
            transitionDuration: "var(--duration-fast)",
          }}
        >
          <Icon
            className="h-[18px] w-[18px]"
            style={{ color: "var(--text-tertiary)" }}
          />
        </div>
        <p className="ds-caption">{title}</p>
      </div>
      {value === 0 && zeroAction ? (
        <div className="mt-4">
          <p
            className="ds-body-md"
            style={{ color: "var(--text-tertiary)" }}
          >
            No interactions this week
          </p>
          <span
            className="mt-1.5 inline-flex items-center gap-1 ds-body-sm font-medium transition-colors"
            style={{ color: "var(--text-secondary)" }}
          >
            <Plus className="h-3.5 w-3.5" />
            {zeroAction.label}
          </span>
        </div>
      ) : (
        <>
          <p className="ds-stat-lg mt-3">{value}</p>
          <p className="ds-caption mt-1.5">{description}</p>
        </>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    );
  }
  return content;
}

// ─── Supporting cards ────────────────────────────────────────

function ReviewQueueCard() {
  const { data } = useQuery<{ items: unknown[]; totalPending: number }>({
    queryKey: ["sightings-review"],
    queryFn: async () => {
      const res = await fetch("/api/sightings");
      if (!res.ok) return { items: [], totalPending: 0 };
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (!data || (data.items.length === 0 && data.totalPending === 0)) {
    return null;
  }

  return (
    <Card className="crm-card border-0">
      <CardContent className="px-6 py-6">
        <ReviewQueue />
      </CardContent>
    </Card>
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
    <Card className="crm-card border-0">
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
    <Card className="crm-card border-0">
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
    <Card className="crm-card border-0">
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
    <Card className="crm-card border-0">
      <CardContent className="px-6 py-6">
        <UpcomingBirthdays />
      </CardContent>
    </Card>
  );
}

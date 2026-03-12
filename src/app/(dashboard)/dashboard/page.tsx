"use client";

import { useQuery } from "@tanstack/react-query";
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
import { formatDistanceToNow } from "@/lib/date-utils";
import Link from "next/link";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import { ActionItems } from "@/components/dashboard/action-items";
import { UpcomingMeetings } from "@/components/dashboard/upcoming-meetings";
import { ReviewQueue } from "@/components/sightings/review-queue";

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

function getUrgencyStyle(daysOverdue: number): string {
  if (daysOverdue >= 14) return "bg-red-50 text-red-600";
  return "bg-gray-100 text-gray-600";
}

const tierStyles: Record<string, string> = {
  INNER_CIRCLE: "bg-amber-50 text-amber-700",
  PROFESSIONAL: "bg-blue-50 text-blue-700",
  ACQUAINTANCE: "bg-gray-100 text-gray-500",
};

const tierLabels: Record<string, string> = {
  INNER_CIRCLE: "Inner Circle",
  PROFESSIONAL: "Professional",
  ACQUAINTANCE: "Acquaintance",
};

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
}

interface DashboardStats {
  tierCounts: Record<string, number>;
  contactsThisMonth: number;
  interactionsThisWeek: number;
  totalContacts: number;
  recentInteractions: {
    id: string;
    type: string;
    subject: string | null;
    summary: string | null;
    occurredAt: string;
    contact: {
      id: string;
      name: string;
      company: string | null;
      tier: string;
      source: string;
    };
  }[];
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

export default function DashboardPage() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  if (isLoading || !stats) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-[40px] font-bold tracking-tight text-gray-900">{getGreeting()}</h1>
          <p className="mt-2 text-[16px] text-gray-400">Loading your dashboard...</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="crm-card rounded-2xl p-6">
              <div className="h-20 animate-pulse rounded-xl bg-gray-50" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Hero greeting */}
      <div>
        <h1 className="text-[40px] font-bold tracking-tight" style={{ color: "var(--crm-text-primary)" }}>
          {getGreeting()}
        </h1>
        <p className="mt-2 text-[16px]" style={{ color: "var(--crm-text-secondary)" }}>
          {stats.overdueCount > 0 ? (
            <>
              You have{" "}
              <span className="font-medium text-gray-900">
                {stats.overdueCount} overdue follow-up{stats.overdueCount !== 1 ? "s" : ""}
              </span>
            </>
          ) : (
            "You're all caught up. Nice work."
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
          title="Inner Circle"
          value={stats.tierCounts.INNER_CIRCLE ?? 0}
          icon={UserCheck}
          description={`of ${stats.totalContacts} contacts`}
          href="/people"
        />
        <StatCard
          title="Interactions"
          value={stats.interactionsThisWeek}
          icon={MessageSquare}
          description="this week"
          href="/activity"
          zeroAction={stats.interactionsThisWeek === 0 ? { label: "Log an interaction", href: "/activity" } : undefined}
        />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Follow-Up Queue */}
        <Card className="crm-card border-0 rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between px-6 pt-6 pb-0">
            <CardTitle className="crm-section-label">Follow-up queue</CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-4">
            {stats.overdueContacts.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-50">
                  <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-[14px] font-medium text-gray-900">All caught up</p>
                <p className="mt-1 text-[13px] text-gray-400">No overdue follow-ups</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: "var(--crm-border-light)" }}>
                {stats.overdueContacts.map((c) => {
                  const color = getAvatarColor(c.name);
                  const urgency = getUrgencyStyle(c.daysOverdue);
                  return (
                    <Link key={c.id} href={`/people?contact=${c.id}`} className="group flex items-center gap-3 py-3 cursor-pointer transition-colors hover:bg-gray-50 -mx-2 px-2 rounded-lg">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback
                          className="text-[11px] font-semibold"
                          style={{ backgroundColor: color.bg, color: color.text }}
                        >
                          {getInitials(c.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium text-gray-900 truncate">{c.name}</p>
                        {c.company && (
                          <p className="text-[12px] text-gray-400 truncate">{c.company}</p>
                        )}
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${urgency}`}>
                        {c.daysOverdue}d
                      </span>
                      <ChevronRight className="h-4 w-4 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action Items */}
        <Card className="crm-card border-0 rounded-2xl">
          <CardContent className="px-6 py-6">
            <ActionItems />
          </CardContent>
        </Card>

        {/* Review Queue (only shows when there are pending reviews) */}
        <Card className="crm-card border-0 rounded-2xl">
          <CardContent className="px-6 py-6">
            <ReviewQueue />
          </CardContent>
        </Card>

        {/* Recent Interactions (enhanced with contact context) */}
        <Card className="crm-card border-0 rounded-2xl">
          <CardHeader className="px-6 pt-6 pb-0">
            <CardTitle className="crm-section-label">Recent interactions</CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-4">
            {stats.recentInteractions.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-50">
                  <MessageSquare className="h-5 w-5 text-gray-400" />
                </div>
                <p className="text-[14px] font-medium text-gray-900">No interactions yet</p>
                <Link href="/activity" className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-gray-500 hover:text-gray-900 transition-colors">
                  <Plus className="h-3.5 w-3.5" />
                  Log your first interaction
                </Link>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: "var(--crm-border-light)" }}>
                {stats.recentInteractions.map((interaction) => {
                  const Icon = typeIcons[interaction.type] ?? StickyNote;
                  const color = getAvatarColor(interaction.contact.name);
                  return (
                    <Link
                      key={interaction.id}
                      href={`/people?contact=${interaction.contact.id}`}
                      className="group flex items-start gap-3 py-3 transition-colors hover:bg-gray-50 -mx-2 px-2 rounded-lg"
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
                          <span className="text-[14px] font-medium text-gray-900 truncate">
                            {interaction.contact.name}
                          </span>
                          {interaction.contact.tier && (
                            <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-semibold ${tierStyles[interaction.contact.tier] ?? ""}`}>
                              {tierLabels[interaction.contact.tier] ?? interaction.contact.tier}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Icon className="h-3 w-3 text-gray-300 shrink-0" />
                          <p className="text-[12px] text-gray-400 truncate">
                            {interaction.subject ?? interaction.summary ?? interaction.type.toLowerCase()}
                          </p>
                        </div>
                        {interaction.contact.company && (
                          <p className="text-[11px] text-gray-300 truncate mt-0.5">
                            {interaction.contact.company}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-[11px] text-gray-300 mt-0.5">
                        {formatDistanceToNow(new Date(interaction.occurredAt))}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recently Active Contacts (relationship pulse) */}
        {stats.recentlyActive.length > 0 && (
          <Card className="crm-card border-0 rounded-2xl">
            <CardHeader className="flex flex-row items-center justify-between px-6 pt-6 pb-0">
              <CardTitle className="crm-section-label">Strongest relationships</CardTitle>
              <span className="text-[11px] text-gray-400">Last 30 days</span>
            </CardHeader>
            <CardContent className="px-6 pb-6 pt-4">
              <div className="divide-y" style={{ borderColor: "var(--crm-border-light)" }}>
                {stats.recentlyActive.map((contact) => {
                  const color = getAvatarColor(contact.name);
                  const Icon = contact.lastInteractionType
                    ? (typeIcons[contact.lastInteractionType] ?? StickyNote)
                    : MessageSquare;
                  return (
                    <Link
                      key={contact.id}
                      href={`/people?contact=${contact.id}`}
                      className="group flex items-center gap-3 py-3 transition-colors hover:bg-gray-50 -mx-2 px-2 rounded-lg"
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
                          <span className="text-[14px] font-medium text-gray-900 truncate">
                            {contact.name}
                          </span>
                          <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-semibold ${tierStyles[contact.tier] ?? ""}`}>
                            {tierLabels[contact.tier] ?? contact.tier}
                          </span>
                        </div>
                        {contact.company && (
                          <p className="text-[12px] text-gray-400 truncate">{contact.company}</p>
                        )}
                        {contact.lastInteractionSummary && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Icon className="h-3 w-3 text-gray-300 shrink-0" />
                            <p className="text-[11px] text-gray-300 truncate">
                              {contact.lastInteractionSummary}
                            </p>
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[13px] font-semibold text-gray-700">
                          {contact.interactionCount}
                        </p>
                        <p className="text-[10px] text-gray-400">
                          {contact.interactionCount === 1 ? "interaction" : "interactions"}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Upcoming Meetings */}
        <Card className="crm-card border-0 rounded-2xl">
          <CardContent className="px-6 py-6">
            <UpcomingMeetings />
          </CardContent>
        </Card>

        {/* Your Circles */}
        <Card className="crm-card border-0 rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between px-6 pt-6 pb-0">
            <CardTitle className="crm-section-label">Your circles</CardTitle>
            <Link href="/circles" className="text-[12px] font-medium text-gray-400 hover:text-gray-900 transition-colors">
              Manage
            </Link>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-4">
            {stats.circles.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-center">
                <p className="text-[14px] text-gray-400">No circles yet</p>
                <Link href="/circles" className="mt-1.5 text-[13px] font-medium text-gray-500 hover:text-gray-900 transition-colors">
                  Set up your circles
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {stats.circles.map((circle) => (
                  <Link
                    key={circle.id}
                    href={`/people?circle=${circle.id}`}
                    className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-gray-50"
                  >
                    <div
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: circle.color }}
                    />
                    <span className="flex-1 text-[14px] font-medium text-gray-700 group-hover:text-gray-900 transition-colors">
                      {circle.name}
                    </span>
                    <span className="text-[13px] font-semibold text-gray-400">
                      {circle.contactCount}
                    </span>
                  </Link>
                ))}
              </div>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-gray-50 p-4 text-center">
                <p className="text-[24px] font-bold text-gray-900">{stats.contactsThisMonth}</p>
                <p className="text-[12px] text-gray-400">Added this month</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-4 text-center">
                <p className="text-[24px] font-bold text-gray-900">{stats.interactionsThisWeek}</p>
                <p className="text-[12px] text-gray-400">Interactions this week</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

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
    <div className="crm-card rounded-2xl p-6 cursor-pointer group">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-50 group-hover:bg-gray-100 transition-colors">
          <Icon className="h-[18px] w-[18px] text-gray-400" />
        </div>
        <p className="text-[13px] font-medium" style={{ color: "var(--crm-text-secondary)" }}>{title}</p>
      </div>
      {value === 0 && zeroAction ? (
        <div className="mt-4">
          <p className="text-[14px] text-gray-400">No interactions this week</p>
          <span className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-medium text-gray-500 group-hover:text-gray-900 transition-colors">
            <Plus className="h-3.5 w-3.5" />
            {zeroAction.label}
          </span>
        </div>
      ) : (
        <>
          <p className="mt-3 text-[36px] font-bold tracking-tight leading-none" style={{ color: "var(--crm-text-primary)" }}>{value}</p>
          <p className="mt-1.5 text-[12px]" style={{ color: "var(--crm-text-tertiary)" }}>{description}</p>
        </>
      )}
    </div>
  );

  if (href) {
    return <Link href={href} className="block">{content}</Link>;
  }
  return content;
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  UserCheck,
  MessageSquare,
  TrendingUp,
  AlertTriangle,
  Mail,
  Phone,
  StickyNote,
  Users as MeetingIcon,
} from "lucide-react";
import { formatDistanceToNow } from "@/lib/date-utils";
import Link from "next/link";
import { PipelineChart } from "@/components/dashboard/pipeline-chart";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getInitials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

const typeIcons: Record<string, React.ElementType> = {
  EMAIL: Mail,
  MESSAGE: MessageSquare,
  MEETING: MeetingIcon,
  CALL: Phone,
  NOTE: StickyNote,
};

interface DashboardStats {
  tierCounts: Record<string, number>;
  contactsThisMonth: number;
  interactionsThisWeek: number;
  totalContacts: number;
  pipelineData: { status: string; count: number }[];
  recentInteractions: {
    id: string;
    type: string;
    subject: string | null;
    summary: string | null;
    occurredAt: string;
    contact: { id: string; name: string };
  }[];
  overdueContacts: {
    id: string;
    name: string;
    company: string | null;
    daysOverdue: number;
    tier: string;
  }[];
  overdueCount: number;
  upcomingDeadlines: {
    id: string;
    company: string;
    roleTitle: string;
    deadline: string;
  }[];
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
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{getGreeting()}</h1>
          <p className="text-muted-foreground">Loading your dashboard...</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="py-6">
                <div className="h-16 animate-pulse rounded bg-gray-100" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{getGreeting()}, Devon</h1>
        <p className="text-muted-foreground">
          You have{" "}
          <span className="font-medium text-red-600">{stats.overdueCount} overdue follow-ups</span>
          {stats.upcomingDeadlines.length > 0 && (
            <>
              {" "}and{" "}
              <span className="font-medium text-yellow-600">
                {stats.upcomingDeadlines.length} upcoming deadlines
              </span>
            </>
          )}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Contacts"
          value={stats.totalContacts}
          icon={Users}
          description={`${stats.contactsThisMonth} added this month`}
        />
        <StatCard
          title="Inner Circle"
          value={stats.tierCounts.INNER_CIRCLE}
          icon={UserCheck}
          description={`of ${stats.totalContacts} contacts`}
          accent="text-purple-600"
        />
        <StatCard
          title="Interactions"
          value={stats.interactionsThisWeek}
          icon={MessageSquare}
          description="this week"
        />
        <StatCard
          title="Active Applications"
          value={stats.pipelineData.reduce((sum, p) => {
            if (p.status !== "REJECTED" && p.status !== "CLOSED") {
              return sum + p.count;
            }
            return sum;
          }, 0)}
          icon={TrendingUp}
          description="in pipeline"
        />
      </div>

      {/* Main grid: 2 columns */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Pipeline Funnel */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <PipelineChart data={stats.pipelineData} />
          </CardContent>
        </Card>

        {/* Follow-Up Queue */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Follow-Up Queue</CardTitle>
            <Link href="/reminders" className="text-sm text-blue-600 hover:underline">
              View All
            </Link>
          </CardHeader>
          <CardContent>
            {stats.overdueContacts.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                All caught up!
              </p>
            ) : (
              <div className="space-y-3">
                {stats.overdueContacts.map((c) => (
                  <div key={c.id} className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-blue-100 text-xs text-blue-700">
                        {getInitials(c.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
                      {c.company && (
                        <p className="text-xs text-gray-500 truncate">{c.company}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-red-600">
                      {c.daysOverdue}d overdue
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Interactions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Interactions</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.recentInteractions.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No recent interactions
              </p>
            ) : (
              <div className="space-y-3">
                {stats.recentInteractions.map((interaction) => {
                  const Icon = typeIcons[interaction.type] ?? StickyNote;
                  return (
                    <div key={interaction.id} className="flex items-start gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100">
                        <Icon className="h-3.5 w-3.5 text-gray-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          <span className="font-medium text-gray-900">
                            {interaction.contact.name}
                          </span>
                          {interaction.subject && (
                            <span className="text-gray-500"> — {interaction.subject}</span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400">
                          {formatDistanceToNow(new Date(interaction.occurredAt))}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Network Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Network Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <TierStat label="Inner Circle" count={stats.tierCounts.INNER_CIRCLE} color="bg-purple-100 text-purple-700" />
              <TierStat label="Professional" count={stats.tierCounts.PROFESSIONAL} color="bg-blue-100 text-blue-700" />
              <TierStat label="Acquaintance" count={stats.tierCounts.ACQUAINTANCE} color="bg-gray-100 text-gray-700" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-gray-50 p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{stats.contactsThisMonth}</p>
                <p className="text-xs text-gray-500">Added this month</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{stats.interactionsThisWeek}</p>
                <p className="text-xs text-gray-500">Interactions this week</p>
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
  accent,
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  description: string;
  accent?: string;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{title}</p>
          <Icon className={`h-4 w-4 ${accent ?? "text-gray-400"}`} />
        </div>
        <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-500">{description}</p>
      </CardContent>
    </Card>
  );
}

function TierStat({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div className="text-center">
      <Badge variant="secondary" className={`mb-1 ${color}`}>
        {label}
      </Badge>
      <p className="text-xl font-bold text-gray-900">{count}</p>
    </div>
  );
}

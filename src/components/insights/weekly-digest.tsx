"use client";

import {
  Sparkles,
  AlertTriangle,
  TrendingUp,
  Users,
  MessageSquare,
  UserPlus,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWeeklyDigest } from "@/lib/hooks/use-insights";

export function WeeklyDigestCard() {
  const { data, isLoading, error } = useWeeklyDigest();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-blue-500" />
          <span className="text-sm text-muted-foreground">
            Generating your weekly digest...
          </span>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Unable to generate digest. Make sure your Anthropic API key is
          configured.
        </CardContent>
      </Card>
    );
  }

  const { digest, cached, generatedAt } = data;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-500" />
          <h2 className="text-lg font-semibold text-gray-900">
            Weekly Digest
          </h2>
        </div>
        <span className="text-xs text-gray-400">
          {cached ? "Cached" : "Fresh"} ·{" "}
          {new Date(generatedAt).toLocaleDateString()}
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          icon={MessageSquare}
          label="Interactions"
          value={digest.stats.totalInteractions}
        />
        <StatCard
          icon={Users}
          label="Contacts Reached"
          value={digest.stats.contactsReached}
        />
        <StatCard
          icon={UserPlus}
          label="New Contacts"
          value={digest.stats.newContacts}
        />
      </div>

      {/* Highlights */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUp className="h-4 w-4 text-green-500" />
            Highlights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {digest.highlights.map((highlight, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-green-400" />
                {highlight}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Needs Attention */}
      {digest.needsAttention.length > 0 && (
        <Card className="border-yellow-200">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              Needs Attention
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {digest.needsAttention.map((item, i) => (
                <li key={i} className="text-sm">
                  <span className="font-medium text-gray-900">
                    {item.name}
                  </span>
                  <p className="text-gray-500">{item.reason}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Suggested Actions */}
      <Card className="border-blue-200">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-blue-500" />
            Suggested Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {digest.suggestedActions.map((action, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-gray-700"
              >
                <span className="mt-0.5 text-blue-400">→</span>
                {action}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center py-3">
        <Icon className="mb-1 h-4 w-4 text-gray-400" />
        <span className="text-2xl font-bold text-gray-900">{value}</span>
        <span className="text-xs text-gray-500">{label}</span>
      </CardContent>
    </Card>
  );
}

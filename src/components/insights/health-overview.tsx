"use client";

import { Activity, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { HealthScoreBar } from "./health-badge";
import {
  useAllHealthInsights,
  useComputeHealth,
  type CachedInsight,
} from "@/lib/hooks/use-insights";
import { useContacts } from "@/lib/hooks/use-contacts";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function HealthOverview() {
  const { data: insightsData, isLoading: insightsLoading } =
    useAllHealthInsights();
  const { data: contactsData } = useContacts();
  const computeHealth = useComputeHealth();

  const insights = insightsData?.insights ?? [];
  const contacts = contactsData ?? [];

  // Find contacts without health scores
  const scoredIds = new Set(insights.map((i: CachedInsight) => i.contact.id));
  const unscoredContacts = contacts.filter(
    (c: { id: string }) => !scoredIds.has(c.id)
  );

  const handleComputeAll = async () => {
    const toCompute = unscoredContacts.slice(0, 5); // batch 5 at a time
    for (const contact of toCompute) {
      await computeHealth.mutateAsync(contact.id);
    }
  };

  if (insightsLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-blue-500" />
          <span className="text-sm text-muted-foreground">
            Loading health scores...
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="h-4 w-4 text-blue-500" />
          Relationship Health
        </CardTitle>
        {unscoredContacts.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleComputeAll}
            disabled={computeHealth.isPending}
          >
            {computeHealth.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3 w-3" />
            )}
            Score {Math.min(unscoredContacts.length, 5)} contacts
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {insights.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            No health scores computed yet. Click the button above to analyze
            your contacts.
          </div>
        ) : (
          <div className="space-y-3">
            {insights.map((insight: CachedInsight) => (
              <div key={insight.contact.id} className="flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-blue-100 text-xs text-blue-700">
                    {getInitials(insight.contact.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="truncate text-sm font-medium text-gray-900">
                      {insight.contact.name}
                    </span>
                    <span className="ml-2 text-xs capitalize text-gray-400">
                      {insight.healthLabel}
                    </span>
                  </div>
                  <HealthScoreBar
                    score={insight.healthScore}
                    label={insight.healthLabel}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

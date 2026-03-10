"use client";

import { WeeklyDigestCard } from "@/components/insights/weekly-digest";
import { HealthOverview } from "@/components/insights/health-overview";
import { IntroductionsCard } from "@/components/insights/introductions-card";

export default function InsightsPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">AI Insights</h1>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Left column: Weekly Digest */}
        <div>
          <WeeklyDigestCard />
        </div>

        {/* Right column: Health + Introductions */}
        <div className="space-y-6">
          <HealthOverview />
          <IntroductionsCard />
        </div>
      </div>
    </div>
  );
}

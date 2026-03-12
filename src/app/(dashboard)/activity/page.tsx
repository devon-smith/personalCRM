"use client";

import { Card, CardContent } from "@/components/ui/card";
import { UnrespondedThreads } from "@/components/dashboard/unresponded-threads";

export default function ActivityPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="crm-animate-enter">
        <h1 className="ds-display-lg">Activity</h1>
        <p className="ds-body-sm mt-1" style={{ color: "var(--text-tertiary)" }}>
          Messages awaiting your reply
        </p>
      </div>

      {/* Awaiting Reply */}
      <Card className="crm-card border-0">
        <CardContent className="px-6 py-6">
          <UnrespondedThreads limit={10} />
        </CardContent>
      </Card>
    </div>
  );
}

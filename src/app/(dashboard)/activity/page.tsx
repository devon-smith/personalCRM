"use client";

import { Card, CardContent } from "@/components/ui/card";
import { NeedsResponse } from "@/components/dashboard/needs-response";

export default function ActivityPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="crm-animate-enter">
        <h1 className="ds-display-lg">Activity</h1>
        <p className="ds-body-sm mt-1" style={{ color: "var(--text-tertiary)" }}>
          People waiting on a reply from you
        </p>
      </div>

      {/* Needs Response */}
      <Card className="crm-card border-0">
        <CardContent className="px-6 py-6">
          <NeedsResponse />
        </CardContent>
      </Card>
    </div>
  );
}

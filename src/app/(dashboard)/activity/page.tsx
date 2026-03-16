"use client";

import { Inbox } from "@/components/dashboard/inbox";

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

      <Inbox />
    </div>
  );
}

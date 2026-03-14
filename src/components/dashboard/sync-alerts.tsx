"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Mail,
  ExternalLink,
  Trash2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

interface HealthData {
  gmail: {
    status: "connected" | "expired" | "disconnected";
    error: string | null;
    accountCount: number;
    lastSyncAt: string | null;
    syncEnabled: boolean;
  };
  imessage: {
    status: string;
    error: string | null;
    handlesTracked: number;
  };
  contacts: {
    csvImported: number;
    csvNoInteractions: number;
  };
  cleanup: {
    oldSummaryInteractions: number;
  };
}

export function SyncAlerts() {
  const queryClient = useQueryClient();

  const { data: health } = useQuery<HealthData>({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error("Health check failed");
      return res.json();
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true, // Re-check after returning from Google OAuth
    retry: false,
  });

  const cleanupMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/contacts/cleanup-csv", { method: "POST" });
      if (!res.ok) throw new Error("Cleanup failed");
      return res.json();
    },
    onSuccess: (data) => {
      toast(`Removed ${data.deleted} CSV contacts with no message data`);
      queryClient.invalidateQueries({ queryKey: ["health"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: () => toast.error("Cleanup failed"),
  });

  const interactionCleanupMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/interactions/cleanup", { method: "POST" });
      if (!res.ok) throw new Error("Cleanup failed");
      return res.json();
    },
    onSuccess: (data) => {
      toast(`Removed ${data.deleted} old summary interactions`);
      queryClient.invalidateQueries({ queryKey: ["health"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["needs-response"] });
    },
    onError: () => toast.error("Interaction cleanup failed"),
  });

  if (!health) return null;

  const alerts: Array<{
    key: string;
    type: "warning" | "info";
    icon: React.ReactNode;
    message: string;
    action?: React.ReactNode;
  }> = [];

  // Gmail re-auth alert
  if (health.gmail.status === "expired") {
    alerts.push({
      key: "gmail-expired",
      type: "warning",
      icon: <Mail className="h-4 w-4" />,
      message:
        "Gmail sync paused — your Google token has expired. Re-connect to resume email sync.",
      action: (
        <a
          href="/api/auth/add-google-account"
          className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12px] font-semibold transition-colors"
          style={{
            backgroundColor: "rgba(239,68,68,0.1)",
            color: "rgb(220,38,38)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "rgba(239,68,68,0.15)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "rgba(239,68,68,0.1)";
          }}
        >
          Re-connect Google
          <ExternalLink className="h-3 w-3" />
        </a>
      ),
    });
  }

  // Gmail disconnected
  if (health.gmail.status === "disconnected") {
    alerts.push({
      key: "gmail-disconnected",
      type: "info",
      icon: <Mail className="h-4 w-4" />,
      message:
        "Connect Gmail to sync emails and auto-discover contacts from your inbox.",
      action: (
        <a
          href="/api/auth/add-google-account"
          className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12px] font-semibold transition-colors"
          style={{
            backgroundColor: "var(--surface-sunken)",
            color: "var(--text-secondary)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--border)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
          }}
        >
          Connect Google
          <ExternalLink className="h-3 w-3" />
        </a>
      ),
    });
  }

  // Old summary interactions without real content
  if (health.cleanup.oldSummaryInteractions > 0) {
    alerts.push({
      key: "old-summaries",
      type: "info",
      icon: <Trash2 className="h-4 w-4" />,
      message: `${health.cleanup.oldSummaryInteractions} old daily summary interactions have no message content. Remove them to show only real messages.`,
      action: (
        <button
          onClick={() => interactionCleanupMutation.mutate()}
          disabled={interactionCleanupMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12px] font-semibold transition-colors"
          style={{
            backgroundColor: "var(--surface-sunken)",
            color: "var(--text-secondary)",
          }}
          onMouseEnter={(e) => {
            if (!interactionCleanupMutation.isPending) {
              e.currentTarget.style.backgroundColor = "var(--border)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
          }}
        >
          {interactionCleanupMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
          {interactionCleanupMutation.isPending ? "Cleaning..." : "Clean up"}
        </button>
      ),
    });
  }

  // CSV contacts without interactions
  if (health.contacts.csvNoInteractions > 0) {
    alerts.push({
      key: "csv-cleanup",
      type: "info",
      icon: <Trash2 className="h-4 w-4" />,
      message: `${health.contacts.csvNoInteractions} CSV-imported contacts have no message data. Remove them to keep your CRM clean.`,
      action: (
        <button
          onClick={() => cleanupMutation.mutate()}
          disabled={cleanupMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12px] font-semibold transition-colors"
          style={{
            backgroundColor: "var(--surface-sunken)",
            color: "var(--text-secondary)",
          }}
          onMouseEnter={(e) => {
            if (!cleanupMutation.isPending) {
              e.currentTarget.style.backgroundColor = "var(--border)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "var(--surface-sunken)";
          }}
        >
          {cleanupMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
          {cleanupMutation.isPending ? "Cleaning..." : "Remove"}
        </button>
      ),
    });
  }

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2.5 crm-animate-enter">
      {alerts.map((alert) => (
        <div
          key={alert.key}
          className="flex items-center gap-3 rounded-[12px] px-4 py-3"
          style={{
            backgroundColor:
              alert.type === "warning"
                ? "rgba(239,68,68,0.06)"
                : "var(--surface-sunken)",
            border: `1px solid ${alert.type === "warning" ? "rgba(239,68,68,0.15)" : "var(--border-subtle)"}`,
          }}
        >
          <span
            style={{
              color:
                alert.type === "warning"
                  ? "rgb(220,38,38)"
                  : "var(--text-tertiary)",
            }}
          >
            {alert.type === "warning" ? (
              <AlertTriangle className="h-4 w-4" />
            ) : (
              alert.icon
            )}
          </span>
          <p
            className="flex-1 text-[13px]"
            style={{
              color:
                alert.type === "warning"
                  ? "rgb(153,27,27)"
                  : "var(--text-secondary)",
            }}
          >
            {alert.message}
          </p>
          {alert.action}
        </div>
      ))}
    </div>
  );
}

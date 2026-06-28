"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Database, Loader2, Mail } from "lucide-react";
import type { GmailSourceHealthResponse } from "@/app/api/gmail/source-health/route";

export default function SourceHealthPage() {
  const { data, isLoading, error } = useQuery<GmailSourceHealthResponse>({
    queryKey: ["gmail-source-health"],
    queryFn: async () => {
      const res = await fetch("/api/gmail/source-health");
      if (!res.ok) throw new Error("Failed to load Gmail source health");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6">
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: "var(--text-tertiary)" }}
        >
          Deployment readiness
        </div>
        <h1 className="mt-1 ds-display-md" style={{ color: "var(--text-primary)" }}>
          Source health
        </h1>
        <p className="mt-1 max-w-2xl text-[13px]" style={{ color: "var(--text-tertiary)" }}>
          Gmail is the primary communication source. This page tracks whether
          sync, matching, reply queueing, and Gmail drafts are healthy.
        </p>
      </header>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-tertiary)" }}>
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading source health...
        </div>
      ) : error ? (
        <div className="rounded-[10px] border p-4 text-sm" style={{ borderColor: "var(--status-urgent)", color: "var(--status-urgent)" }}>
          Failed to load source health.
        </div>
      ) : data ? (
        <div className="space-y-6">
          <section
            className="rounded-[12px] border p-4"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-[10px]"
                  style={{ backgroundColor: "var(--surface-sunken)" }}
                >
                  <Mail className="h-5 w-5" style={{ color: "var(--accent-color)" }} />
                </div>
                <div>
                  <h2 className="ds-heading-sm">Gmail</h2>
                  <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
                    {data.accountCount} connected account{data.accountCount === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <StatusPill status={data.status} />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Metric label="Last sync" value={formatDate(data.lastSyncAt)} />
              <Metric label="Sync enabled" value={data.syncEnabled ? "Yes" : "No"} />
              <Metric label="Watch expires" value={formatDate(data.watchExpiration)} />
            </div>
          </section>

          <div className="grid gap-4 md:grid-cols-3">
            <Panel title="Messages" icon={Database}>
              <Metric label="Total" value={data.emailMessages.total.toLocaleString()} />
              <Metric label="Inbound" value={data.emailMessages.inbound.toLocaleString()} />
              <Metric label="Outbound" value={data.emailMessages.outbound.toLocaleString()} />
              <Metric label="Matched" value={data.emailMessages.matched.toLocaleString()} />
              <Metric label="Automated" value={data.emailMessages.automated.toLocaleString()} />
            </Panel>

            <Panel title="Reply Queue" icon={Mail}>
              <Metric label="Open" value={data.replyQueue.open.toLocaleString()} />
              <Metric label="Needs reply" value={data.replyQueue.needsReply.toLocaleString()} />
              <Metric label="No reply needed" value={data.replyQueue.classifiedNoReply.toLocaleString()} />
              <Metric label="Unmatched senders" value={data.unmatchedSenderCount.toLocaleString()} />
            </Panel>

            <Panel title="Drafts" icon={CheckCircle2}>
              <Metric label="Local drafts" value={data.drafts.localDrafts.toLocaleString()} />
              <Metric label="Saved to Gmail" value={data.drafts.savedToGmail.toLocaleString()} />
              <Metric label="Sent last 7 days" value={data.drafts.sentLast7Days.toLocaleString()} />
            </Panel>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { status: GmailSourceHealthResponse["status"] }) {
  const connected = status === "connected";
  const label =
    status === "connected"
      ? "Connected"
      : status === "needs_reconnect"
        ? "Needs reconnect"
        : "Disconnected";
  const Icon = connected ? CheckCircle2 : AlertTriangle;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
      style={{
        backgroundColor: connected ? "var(--status-success-bg)" : "var(--status-urgent-bg)",
        color: connected ? "var(--status-success)" : "var(--status-urgent)",
      }}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Database;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-[12px] border p-4"
      style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
        <h2 className="ds-heading-sm">{title}</h2>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span style={{ color: "var(--text-tertiary)" }}>{label}</span>
      <span className="font-medium" style={{ color: "var(--text-primary)" }}>
        {value}
      </span>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

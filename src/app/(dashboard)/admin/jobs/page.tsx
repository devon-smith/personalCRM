"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";

interface JobsResponse {
  taskCounts: Array<{ task: string; pending: number; failed: number; total: number }>;
  recent: Array<{
    id: string;
    task: string;
    attempts: number;
    maxAttempts: number;
    runAt: string;
    lockedAt: string | null;
    lastError: string | null;
    createdAt: string;
  }>;
  cron: Array<{
    identifier: string;
    lastExecution: string | null;
    /** Expected cadence in hours, or null if unknown. */
    cadenceHours: number | null;
  }>;
}

/**
 * /admin/jobs — visibility into Graphile Worker state.
 *
 * Single-user CRM so this is unconditionally accessible. Three sections:
 *   - Crontab health: when each scheduled task last ran.
 *   - Per-task counts: pending vs failed vs total.
 *   - Recent jobs feed: 20 most-recently-touched jobs with errors.
 */
export default function AdminJobsPage() {
  const { data, isLoading, error, dataUpdatedAt } = useQuery<JobsResponse>({
    queryKey: ["admin-jobs"],
    queryFn: async () => {
      const res = await fetch("/api/admin/jobs");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: 5000,
  });
  // dataUpdatedAt is provided by react-query on each refetch; locks "now"
  // to the moment the data was fetched so staleness math is pure.
  const nowMs = dataUpdatedAt || 0;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[860px] pt-14">
        <div className="flex items-center gap-2 ds-body-sm" style={{ color: "var(--text-tertiary)" }}>
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading worker state…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-[860px] pt-14">
        <p className="ds-body-sm" style={{ color: "var(--status-error)" }}>
          {error instanceof Error ? error.message : "Worker not reachable. Is the worker process running?"}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[860px] pt-14 pb-16">
      <h1 className="ds-display-lg">Worker</h1>
      <p className="ds-caption mt-1">Graphile Worker queue state · refreshes every 5s</p>

      {/* Cron health */}
      <section className="mt-8">
        <h2 className="ds-heading-sm">Schedules</h2>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {data.cron.map((c) => {
            // Schedule-aware staleness. A task is stale only if it HAS
            // run at least once AND that run is older than 2x its
            // expected cadence. Tasks that have never run are
            // informational — not yet stale — because the worker may
            // just not have been up long enough to fire them.
            const cadenceHours = c.cadenceHours;
            const stale =
              c.lastExecution !== null &&
              cadenceHours != null &&
              nowMs - new Date(c.lastExecution).getTime() >
                cadenceHours * 2 * 60 * 60 * 1000;

            return (
              <div
                key={c.identifier}
                className="rounded-[10px] p-3"
                style={{
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--surface)",
                }}
              >
                <div className="flex items-center gap-2">
                  {stale ? (
                    <AlertTriangle
                      className="h-3 w-3"
                      style={{ color: "var(--status-warning, #D97706)" }}
                    />
                  ) : (
                    <CheckCircle2
                      className="h-3 w-3"
                      style={{ color: "var(--status-success, #16A34A)" }}
                    />
                  )}
                  <span className="ds-body-sm font-medium">{c.identifier}</span>
                  {cadenceHours != null && (
                    <span
                      className="ml-auto text-[10px]"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      every {formatCadence(cadenceHours)}
                    </span>
                  )}
                </div>
                <p className="ds-caption mt-1">
                  {c.lastExecution
                    ? `Last run ${formatRelative(c.lastExecution, nowMs)}`
                    : "Never run"}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Per-task counts */}
      <section className="mt-8">
        <h2 className="ds-heading-sm">Task queue</h2>
        <table className="mt-2 w-full text-[13px]">
          <thead style={{ color: "var(--text-tertiary)" }}>
            <tr>
              <th className="text-left font-medium py-2">Task</th>
              <th className="text-right font-medium py-2">Pending</th>
              <th className="text-right font-medium py-2">Failed</th>
              <th className="text-right font-medium py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.taskCounts.length === 0 ? (
              <tr>
                <td colSpan={4} className="ds-caption py-3" style={{ color: "var(--text-tertiary)" }}>
                  No jobs in the queue.
                </td>
              </tr>
            ) : (
              data.taskCounts.map((t) => (
                <tr key={t.task} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="py-2 font-medium">{t.task}</td>
                  <td className="py-2 text-right">{t.pending}</td>
                  <td
                    className="py-2 text-right"
                    style={{ color: t.failed > 0 ? "var(--status-error, #DC2626)" : undefined }}
                  >
                    {t.failed}
                  </td>
                  <td className="py-2 text-right" style={{ color: "var(--text-tertiary)" }}>
                    {t.total}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* Recent jobs */}
      <section className="mt-8">
        <h2 className="ds-heading-sm">Recent jobs</h2>
        <div className="mt-2 space-y-2">
          {data.recent.length === 0 ? (
            <p className="ds-caption">No jobs yet.</p>
          ) : (
            data.recent.map((j) => (
              <div
                key={j.id}
                className="rounded-[10px] p-3"
                style={{
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--surface)",
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="ds-body-sm font-medium">{j.task}</span>
                    <span className="ds-caption">#{j.id}</span>
                    {j.lockedAt && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{
                          backgroundColor: "var(--surface-sunken)",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        running
                      </span>
                    )}
                  </div>
                  <span
                    className="ds-caption"
                    style={{
                      color:
                        j.attempts >= j.maxAttempts
                          ? "var(--status-error, #DC2626)"
                          : "var(--text-tertiary)",
                    }}
                  >
                    {j.attempts}/{j.maxAttempts} attempt{j.maxAttempts === 1 ? "" : "s"}
                  </span>
                </div>
                {j.lastError && (
                  <p
                    className="mt-1 text-[11px] font-mono"
                    style={{ color: "var(--status-error, #DC2626)" }}
                  >
                    {j.lastError.slice(0, 200)}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function formatCadence(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours}h`;
  const days = hours / 24;
  return days === 1 ? "day" : `${days}d`;
}

function formatRelative(iso: string, nowMs: number): string {
  const ms = nowMs - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Activity,
  AlertCircle,
  BarChart3,
  Cable,
  CheckCircle2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import type { UsageResponse } from "@/app/api/usage/route";

const WINDOWS: Array<{ days: number; label: string }> = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];
const USAGE_STALE_TIME_MS = 5 * 60_000;

function formatUsd(cents: number): string {
  if (cents < 0.01) return "<$0.01";
  if (cents < 1) return `$${cents.toFixed(3)}`;
  if (cents < 10) return `$${cents.toFixed(2)}`;
  return `$${cents.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatLabel(value: string): string {
  return value.replace(/_/g, " ");
}

export default function UsagePage() {
  const [days, setDays] = useState(30);
  const { data, isLoading, error } = useQuery<UsageResponse>({
    queryKey: ["usage", days],
    queryFn: async () => {
      const res = await fetch(`/api/usage?days=${days}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    staleTime: USAGE_STALE_TIME_MS,
  });

  return (
    <div className="crm-stagger space-y-8 pt-14">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 ds-body-sm mb-3 transition-colors"
          style={{ color: "var(--text-tertiary)" }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Settings
        </Link>
        <h1 className="ds-display-lg">API usage</h1>
        <p
          className="ds-body-sm mt-1"
          style={{ color: "var(--text-tertiary)" }}
        >
          Generation spend, provider-call telemetry, and sync health.
          Costs are estimates based on published per-million-token rates
          where token data is available.
        </p>
      </div>

      <div className="flex items-center gap-2">
        {WINDOWS.map((w) => (
          <button
            key={w.days}
            onClick={() => setDays(w.days)}
            className="rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              backgroundColor:
                days === w.days ? "var(--text-primary)" : "var(--surface-sunken)",
              color: days === w.days ? "var(--surface)" : "var(--text-secondary)",
            }}
          >
            {w.label}
          </button>
        ))}
      </div>

      {error && (
        <div
          className="crm-card flex items-center gap-3 p-4"
          style={{ borderColor: "var(--status-urgent)" }}
        >
          <AlertCircle
            className="h-4 w-4"
            style={{ color: "var(--status-urgent)" }}
          />
          <p className="ds-body-sm">Failed to load usage stats.</p>
        </div>
      )}

      {isLoading && (
        <p className="ds-body-sm" style={{ color: "var(--text-tertiary)" }}>
          Loading…
        </p>
      )}

      {data && (
        <>
          {/* Totals strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Generation cost"
              value={formatUsd(data.totalCostUsd)}
              tone="primary"
            />
            <StatCard label="API calls" value={data.totalCalls.toLocaleString()} />
            <StatCard
              label="Input tokens"
              value={formatTokens(data.totalTokensIn)}
            />
            <StatCard
              label="Output tokens"
              value={formatTokens(data.totalTokensOut)}
            />
          </div>

          {/* By provider */}
          <section>
            <h2 className="ds-heading-md mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              By provider
            </h2>
            {data.byProvider.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                {data.byProvider.map((row) => (
                  <div key={row.provider} className="crm-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p
                          className="text-[11px] font-medium uppercase tracking-wide"
                          style={{ color: "var(--text-tertiary)" }}
                        >
                          {row.label}
                        </p>
                        <p className="ds-display-md mt-1 tabular-nums">
                          {formatUsd(row.estimatedCostUsd)}
                        </p>
                      </div>
                      <span
                        className="rounded-full px-2 py-1 text-[11px]"
                        style={{
                          color: "var(--text-tertiary)",
                          backgroundColor: "var(--surface-sunken)",
                        }}
                      >
                        {row.modelCount} {row.modelCount === 1 ? "model" : "models"}
                      </span>
                    </div>
                    <div
                      className="mt-3 grid grid-cols-3 gap-2 border-t pt-3 text-[11px]"
                      style={{ borderColor: "var(--border-subtle)" }}
                    >
                      <MiniMetric label="Calls" value={row.callCount.toLocaleString()} />
                      <MiniMetric label="In" value={formatTokens(row.tokensIn)} />
                      <MiniMetric label="Out" value={formatTokens(row.tokensOut)} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Sync health */}
          <section>
            <h2 className="ds-heading-md mb-3 flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Sync health
            </h2>
            {data.sync.totalRuns === 0 ? (
              <EmptyState message="No sync runs in this window yet." />
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard
                    label="Sync runs"
                    value={data.sync.totalRuns.toLocaleString()}
                  />
                  <StatCard
                    label="Google calls"
                    value={data.sync.totalProviderCalls.toLocaleString()}
                  />
                  <StatCard
                    label="Success rate"
                    value={`${Math.round((data.sync.successRuns / data.sync.totalRuns) * 100)}%`}
                  />
                  <StatCard
                    label="Errors"
                    value={data.sync.errorRuns.toLocaleString()}
                    tone={data.sync.errorRuns > 0 ? "warning" : undefined}
                  />
                </div>

                <SyncBudgetPanel sync={data.sync} />

                <div className="grid gap-3 lg:grid-cols-2">
                  <SyncSourceTable rows={data.sync.bySource} />
                  <SyncTriggerTable rows={data.sync.byTrigger} />
                </div>

                {data.sync.byErrorCategory.length > 0 && (
                  <div className="crm-card p-4">
                    <div
                      className="text-[11px] font-medium uppercase tracking-wide"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      Error categories
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {data.sync.byErrorCategory.map((row) => (
                        <span
                          key={row.category}
                          className="rounded-full px-2.5 py-1 text-[12px] capitalize"
                          style={{
                            color: "var(--status-urgent)",
                            backgroundColor: "var(--status-urgent-bg)",
                          }}
                        >
                          {formatLabel(row.category)} · {row.runCount}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* External provider calls */}
          <section>
            <h2 className="ds-heading-md mb-3 flex items-center gap-2">
              <Cable className="h-4 w-4" />
              External provider calls
            </h2>
            {data.providerCalls.totalCalls === 0 ? (
              <EmptyState message="No non-generation provider calls in this window yet." />
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard
                    label="Provider calls"
                    value={data.providerCalls.totalCalls.toLocaleString()}
                  />
                  <StatCard
                    label="Items handled"
                    value={data.providerCalls.totalItems.toLocaleString()}
                  />
                  <StatCard
                    label="Embedding cost"
                    value={formatUsd(data.providerCalls.estimatedCostUsd)}
                  />
                  <StatCard
                    label="Errors"
                    value={data.providerCalls.totalErrors.toLocaleString()}
                    tone={
                      data.providerCalls.totalErrors > 0 ? "warning" : undefined
                    }
                  />
                </div>
                <ProviderCallTable rows={data.providerCalls.byFeature} />
              </div>
            )}
          </section>

          {/* By feature */}
          <section>
            <h2 className="ds-heading-md mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4" />
              By feature
            </h2>
            {data.byFeature.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="crm-card overflow-x-auto">
                <table className="w-full min-w-[480px] text-[13px]">
                  <thead>
                    <tr
                      className="text-left"
                      style={{
                        color: "var(--text-tertiary)",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <th className="px-4 py-2 font-medium">Feature</th>
                      <th className="px-4 py-2 font-medium text-right">Calls</th>
                      <th className="px-4 py-2 font-medium text-right">
                        Tokens in
                      </th>
                      <th className="px-4 py-2 font-medium text-right">
                        Tokens out
                      </th>
                      <th className="px-4 py-2 font-medium text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byFeature.map((row) => (
                      <tr
                        key={row.feature}
                        style={{ borderBottom: "1px solid var(--border-subtle)" }}
                      >
                        <td className="px-4 py-2.5">{row.label}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {row.callCount.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatTokens(row.tokensIn)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatTokens(row.tokensOut)}
                        </td>
                        <td
                          className="px-4 py-2.5 text-right tabular-nums font-medium"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {formatUsd(row.estimatedCostUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* By model */}
          <section>
            <h2 className="ds-heading-md mb-3">By model</h2>
            {data.byModel.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="crm-card overflow-x-auto">
                <table className="w-full min-w-[480px] text-[13px]">
                  <thead>
                    <tr
                      className="text-left"
                      style={{
                        color: "var(--text-tertiary)",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <th className="px-4 py-2 font-medium">Model</th>
                      <th className="px-4 py-2 font-medium">Provider</th>
                      <th className="px-4 py-2 font-medium text-right">Calls</th>
                      <th className="px-4 py-2 font-medium text-right">
                        Tokens
                      </th>
                      <th className="px-4 py-2 font-medium text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byModel.map((row) => (
                      <tr
                        key={row.model}
                        style={{ borderBottom: "1px solid var(--border-subtle)" }}
                      >
                        <td className="px-4 py-2.5">{row.label}</td>
                        <td
                          className="px-4 py-2.5 capitalize"
                          style={{ color: "var(--text-tertiary)" }}
                        >
                          {row.provider}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {row.callCount.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatTokens(row.tokensIn + row.tokensOut)}
                        </td>
                        <td
                          className="px-4 py-2.5 text-right tabular-nums font-medium"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {formatUsd(row.estimatedCostUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Daily trend */}
          <section>
            <h2 className="ds-heading-md mb-3">Daily trend</h2>
            {data.byDay.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="crm-card overflow-x-auto">
                <table className="w-full min-w-[480px] text-[13px]">
                  <thead>
                    <tr
                      className="text-left"
                      style={{
                        color: "var(--text-tertiary)",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 font-medium text-right">Calls</th>
                      <th className="px-4 py-2 font-medium text-right">
                        Tokens in
                      </th>
                      <th className="px-4 py-2 font-medium text-right">
                        Tokens out
                      </th>
                      <th className="px-4 py-2 font-medium text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byDay.slice(0, 14).map((row) => (
                      <tr
                        key={row.date}
                        style={{ borderBottom: "1px solid var(--border-subtle)" }}
                      >
                        <td className="px-4 py-2.5">{formatDay(row.date)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {row.callCount.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatTokens(row.tokensIn)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatTokens(row.tokensOut)}
                        </td>
                        <td
                          className="px-4 py-2.5 text-right tabular-nums font-medium"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {formatUsd(row.estimatedCostUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p
            className="text-[11px] mt-4"
            style={{ color: "var(--text-tertiary)" }}
          >
            Costs are estimates based on published rates and may differ
            from actual provider invoices (cache discounts, volume tiers,
            free quotas not applied).
          </p>
        </>
      )}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-medium" style={{ color: "var(--text-primary)" }}>
        {value}
      </p>
      <p style={{ color: "var(--text-tertiary)" }}>{label}</p>
    </div>
  );
}

function SyncBudgetPanel({ sync }: { sync: UsageResponse["sync"] }) {
  const fallbackCalls =
    sync.byTrigger.find((row) => row.trigger === "browser_fallback")
      ?.providerCalls ?? 0;

  if (sync.budgetAlerts.length === 0) {
    return (
      <div
        className="crm-card flex items-start gap-3 p-4"
        style={{
          borderColor: "var(--status-success-bg)",
          backgroundColor: "var(--status-success-bg)",
        }}
      >
        <CheckCircle2
          className="mt-0.5 h-4 w-4 shrink-0"
          style={{ color: "var(--status-success)" }}
        />
        <div className="min-w-0">
          <p className="ds-body-sm font-medium">Sync is within budget</p>
          <p
            className="mt-1 text-[12px] leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            Google sync used {sync.totalProviderCalls.toLocaleString()} of{" "}
            {sync.budget.windowProviderCallLimit.toLocaleString()} calls in this
            window. Browser fallback used {fallbackCalls.toLocaleString()} of{" "}
            {sync.budget.windowBrowserFallbackCallLimit.toLocaleString()} calls.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {sync.budgetAlerts.map((alert) => {
        const isWarning = alert.severity === "warning";
        return (
          <div
            key={alert.id}
            className="crm-card flex items-start gap-3 p-4"
            style={{
              borderColor: isWarning
                ? "var(--status-warning)"
                : "var(--border-subtle)",
              backgroundColor: isWarning
                ? "var(--status-warning-bg)"
                : "var(--surface)",
            }}
          >
            {isWarning ? (
              <TriangleAlert
                className="mt-0.5 h-4 w-4 shrink-0"
                style={{ color: "var(--status-warning)" }}
              />
            ) : (
              <AlertCircle
                className="mt-0.5 h-4 w-4 shrink-0"
                style={{ color: "var(--status-info)" }}
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="ds-body-sm font-medium">{alert.title}</p>
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    color: isWarning
                      ? "var(--status-warning)"
                      : "var(--status-info)",
                    backgroundColor: isWarning
                      ? "rgba(176, 139, 63, 0.12)"
                      : "var(--status-info-bg)",
                  }}
                >
                  {formatBudgetAlertValue(alert)}
                </span>
              </div>
              <p
                className="mt-1 text-[12px] leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                {alert.message}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatBudgetAlertValue(
  alert: UsageResponse["sync"]["budgetAlerts"][number],
) {
  const actual =
    alert.unit === "%"
      ? `${alert.actual.toLocaleString()}%`
      : `${alert.actual.toLocaleString()} ${alert.unit}`;
  if (alert.limit === null) return actual;
  const limit =
    alert.unit === "%"
      ? `${alert.limit.toLocaleString()}%`
      : `${alert.limit.toLocaleString()} ${alert.unit}`;
  return `${actual} / ${limit}`;
}

function ProviderCallTable({
  rows,
}: {
  rows: UsageResponse["providerCalls"]["byFeature"];
}) {
  return (
    <div className="crm-card overflow-x-auto">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr
            className="text-left"
            style={{
              color: "var(--text-tertiary)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <th className="px-4 py-2 font-medium">Feature</th>
            <th className="px-4 py-2 font-medium">Provider</th>
            <th className="px-4 py-2 font-medium text-right">Calls</th>
            <th className="px-4 py-2 font-medium text-right">Items</th>
            <th className="px-4 py-2 font-medium text-right">Tokens</th>
            <th className="px-4 py-2 font-medium text-right">Errors</th>
            <th className="px-4 py-2 font-medium text-right">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.provider}:${row.service}:${row.feature}`}
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              <td className="px-4 py-2.5">{row.label}</td>
              <td
                className="px-4 py-2.5 capitalize"
                style={{ color: "var(--text-tertiary)" }}
              >
                {formatLabel(row.provider)} · {formatLabel(row.service)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {row.callCount.toLocaleString()}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {row.itemCount.toLocaleString()}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {formatTokens(row.tokensIn + row.tokensOut)}
              </td>
              <td
                className="px-4 py-2.5 text-right tabular-nums"
                style={{
                  color:
                    row.errorCalls > 0
                      ? "var(--status-urgent)"
                      : "var(--text-tertiary)",
                }}
              >
                {row.errorCalls.toLocaleString()}
              </td>
              <td
                className="px-4 py-2.5 text-right tabular-nums font-medium"
                style={{ color: "var(--text-primary)" }}
              >
                {formatUsd(row.estimatedCostUsd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SyncSourceTable({
  rows,
}: {
  rows: UsageResponse["sync"]["bySource"];
}) {
  return (
    <div className="crm-card overflow-x-auto">
      <table className="w-full min-w-[420px] text-[13px]">
        <thead>
          <tr
            className="text-left"
            style={{
              color: "var(--text-tertiary)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <th className="px-4 py-2 font-medium">Source</th>
            <th className="px-4 py-2 font-medium text-right">Runs</th>
            <th className="px-4 py-2 font-medium text-right">Calls</th>
            <th className="px-4 py-2 font-medium text-right">Errors</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.source}
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              <td className="px-4 py-2.5 capitalize">{row.source}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {row.runCount.toLocaleString()}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {row.providerCalls.toLocaleString()}
              </td>
              <td
                className="px-4 py-2.5 text-right tabular-nums"
                style={{
                  color:
                    row.errorRuns > 0
                      ? "var(--status-urgent)"
                      : "var(--text-tertiary)",
                }}
              >
                {row.errorRuns.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SyncTriggerTable({
  rows,
}: {
  rows: UsageResponse["sync"]["byTrigger"];
}) {
  return (
    <div className="crm-card overflow-x-auto">
      <table className="w-full min-w-[420px] text-[13px]">
        <thead>
          <tr
            className="text-left"
            style={{
              color: "var(--text-tertiary)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <th className="px-4 py-2 font-medium">Trigger</th>
            <th className="px-4 py-2 font-medium text-right">Runs</th>
            <th className="px-4 py-2 font-medium text-right">Calls</th>
            <th className="px-4 py-2 font-medium text-right">Errors</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.trigger}
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              <td className="px-4 py-2.5 capitalize">
                {formatLabel(row.trigger)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {row.runCount.toLocaleString()}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {row.providerCalls.toLocaleString()}
              </td>
              <td
                className="px-4 py-2.5 text-right tabular-nums"
                style={{
                  color:
                    row.errorRuns > 0
                      ? "var(--status-urgent)"
                      : "var(--text-tertiary)",
                }}
              >
                {row.errorRuns.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDay(date: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "primary" | "warning";
}) {
  return (
    <div className="crm-card p-4">
      <p
        className="text-[11px] font-medium uppercase tracking-wide"
        style={{ color: "var(--text-tertiary)" }}
      >
        {label}
      </p>
      <p
        className="ds-display-md mt-1 tabular-nums"
        style={{
          color:
            tone === "primary"
              ? "var(--text-primary)"
              : tone === "warning"
                ? "var(--status-urgent)"
                : "var(--text-secondary)",
        }}
      >
        {value}
      </p>
    </div>
  );
}

function EmptyState({
  message = "No API usage in this window yet. Generate a draft or run a query to populate.",
}: {
  message?: string;
}) {
  return (
    <div
      className="crm-card p-6 text-center"
      style={{ color: "var(--text-tertiary)" }}
    >
      <p className="ds-body-sm">{message}</p>
    </div>
  );
}

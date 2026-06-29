"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Activity, AlertCircle, BarChart3 } from "lucide-react";
import type { UsageResponse } from "@/app/api/usage/route";

const WINDOWS: Array<{ days: number; label: string }> = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

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

export default function UsagePage() {
  const [days, setDays] = useState(30);
  const { data, isLoading, error } = useQuery<UsageResponse>({
    queryKey: ["usage", days],
    queryFn: async () => {
      const res = await fetch(`/api/usage?days=${days}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    staleTime: 60_000,
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
          Token spend across Claude, Voyage, and search APIs. Costs are
          estimates based on published per-million-token rates.
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
          style={{ borderColor: "var(--accent-coral)" }}
        >
          <AlertCircle
            className="h-4 w-4"
            style={{ color: "var(--accent-coral)" }}
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
              label="Estimated cost"
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
  tone?: "primary";
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
          color: tone === "primary" ? "var(--text-primary)" : "var(--text-secondary)",
        }}
      >
        {value}
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="crm-card p-6 text-center"
      style={{ color: "var(--text-tertiary)" }}
    >
      <p className="ds-body-sm">
        No API usage in this window yet. Generate a draft or run a query
        to populate.
      </p>
    </div>
  );
}

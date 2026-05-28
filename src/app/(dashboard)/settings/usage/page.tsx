"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowLeft, Activity, AlertCircle } from "lucide-react";
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

import { useState } from "react";

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

          {/* By feature */}
          <section>
            <h2 className="ds-heading-md mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4" />
              By feature
            </h2>
            {data.byFeature.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="crm-card overflow-hidden">
                <table className="w-full text-[13px]">
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
              <div className="crm-card overflow-hidden">
                <table className="w-full text-[13px]">
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

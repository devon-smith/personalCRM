import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { privateCacheHeaders } from "@/lib/http/cache";
import { estimateCost, featureLabel, priceFor } from "@/lib/pricing";

/**
 * GET /api/usage — aggregated API token spend (M0.x.14).
 *
 * Aggregates AIGenerationLog rows for the signed-in user across a
 * window (default: trailing 30 days). Returns per-feature and per-model
 * breakdowns plus a total. Cost is estimated via @/lib/pricing.
 *
 * Query params:
 *   ?days=7|30|90  — rolling window (default 30)
 */

export interface UsageRow {
  feature: string;
  featureLabel: string;
  model: string;
  modelLabel: string;
  callCount: number;
  tokensIn: number;
  tokensOut: number;
  estimatedCostUsd: number;
}

export interface UsageResponse {
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  totalCalls: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  rows: UsageRow[];
  byFeature: Array<{
    feature: string;
    label: string;
    callCount: number;
    tokensIn: number;
    tokensOut: number;
    estimatedCostUsd: number;
  }>;
  byModel: Array<{
    model: string;
    label: string;
    provider: string;
    callCount: number;
    tokensIn: number;
    tokensOut: number;
    estimatedCostUsd: number;
  }>;
  byProvider: Array<{
    provider: string;
    label: string;
    modelCount: number;
    callCount: number;
    tokensIn: number;
    tokensOut: number;
    estimatedCostUsd: number;
  }>;
  byDay: Array<{
    date: string;
    callCount: number;
    tokensIn: number;
    tokensOut: number;
    estimatedCostUsd: number;
  }>;
  sync: {
    totalRuns: number;
    totalProviderCalls: number;
    totalItemsProcessed: number;
    successRuns: number;
    errorRuns: number;
    runningRuns: number;
    budget: {
      providerCallsPerDay: number;
      browserFallbackCallsPerDay: number;
      errorRatePercent: number;
      windowProviderCallLimit: number;
      windowBrowserFallbackCallLimit: number;
    };
    budgetAlerts: Array<{
      id: string;
      severity: "warning" | "info";
      title: string;
      message: string;
      actual: number;
      limit: number | null;
      unit: string;
    }>;
    bySource: Array<{
      source: string;
      runCount: number;
      successRuns: number;
      errorRuns: number;
      providerCalls: number;
      itemsProcessed: number;
    }>;
    byTrigger: Array<{
      trigger: string;
      runCount: number;
      errorRuns: number;
      providerCalls: number;
    }>;
    byStatus: Array<{
      status: string;
      runCount: number;
    }>;
    byErrorCategory: Array<{
      category: string;
      runCount: number;
    }>;
  };
}

const SYNC_BUDGET = {
  providerCallsPerDay: 40,
  browserFallbackCallsPerDay: 4,
  errorRatePercent: 10,
};

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const daysRaw = url.searchParams.get("days");
  const days = clampDays(daysRaw ? parseInt(daysRaw, 10) : 30);

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - days * 24 * 60 * 60 * 1000);

  const [rows, dailyRows, syncRows] = await Promise.all([
    prisma.aIGenerationLog.groupBy({
      by: ["feature", "model"],
      where: {
        userId: session.user.id,
        createdAt: { gte: windowStart, lte: windowEnd },
      },
      _count: { _all: true },
      _sum: { tokensIn: true, tokensOut: true },
    }),
    prisma.$queryRaw<
      Array<{
        day: Date;
        model: string;
        call_count: bigint;
        tokens_in: bigint | null;
        tokens_out: bigint | null;
      }>
    >`
      SELECT
        date_trunc('day', "createdAt") AS day,
        model,
        COUNT(*)::bigint AS call_count,
        COALESCE(SUM("tokensIn"), 0)::bigint AS tokens_in,
        COALESCE(SUM("tokensOut"), 0)::bigint AS tokens_out
      FROM "AIGenerationLog"
      WHERE "userId" = ${session.user.id}
        AND "createdAt" >= ${windowStart}
        AND "createdAt" <= ${windowEnd}
      GROUP BY day, model
      ORDER BY day DESC
    `,
    prisma.$queryRaw<
      Array<{
        source: string;
        trigger: string;
        status: string;
        error_category: string | null;
        run_count: bigint;
        provider_calls: bigint | null;
        items_processed: bigint | null;
      }>
    >`
      SELECT
        source,
        trigger,
        status,
        "metadata"->>'errorCategory' AS error_category,
        COUNT(*)::bigint AS run_count,
        COALESCE(SUM("providerCalls"), 0)::bigint AS provider_calls,
        COALESCE(SUM("itemsProcessed"), 0)::bigint AS items_processed
      FROM "SyncRun"
      WHERE "userId" = ${session.user.id}
        AND "startedAt" >= ${windowStart}
        AND "startedAt" <= ${windowEnd}
      GROUP BY source, trigger, status, error_category
      ORDER BY source ASC, trigger ASC, status ASC
    `,
  ]);

  const usageRows: UsageRow[] = rows
    .map((r) => {
      const tokensIn = r._sum.tokensIn ?? 0;
      const tokensOut = r._sum.tokensOut ?? 0;
      const cost = estimateCost(r.model, tokensIn, tokensOut);
      return {
        feature: r.feature,
        featureLabel: featureLabel(r.feature),
        model: r.model,
        modelLabel: priceFor(r.model).label,
        callCount: r._count._all,
        tokensIn,
        tokensOut,
        estimatedCostUsd: cost,
      };
    })
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

  // Aggregate by feature
  const featureMap = new Map<
    string,
    { callCount: number; tokensIn: number; tokensOut: number; cost: number }
  >();
  for (const r of usageRows) {
    const prev = featureMap.get(r.feature) ?? {
      callCount: 0,
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
    };
    featureMap.set(r.feature, {
      callCount: prev.callCount + r.callCount,
      tokensIn: prev.tokensIn + r.tokensIn,
      tokensOut: prev.tokensOut + r.tokensOut,
      cost: prev.cost + r.estimatedCostUsd,
    });
  }
  const byFeature = Array.from(featureMap.entries())
    .map(([feature, agg]) => ({
      feature,
      label: featureLabel(feature),
      callCount: agg.callCount,
      tokensIn: agg.tokensIn,
      tokensOut: agg.tokensOut,
      estimatedCostUsd: agg.cost,
    }))
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

  // Aggregate by model
  const modelMap = new Map<
    string,
    { callCount: number; tokensIn: number; tokensOut: number; cost: number }
  >();
  for (const r of usageRows) {
    const prev = modelMap.get(r.model) ?? {
      callCount: 0,
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
    };
    modelMap.set(r.model, {
      callCount: prev.callCount + r.callCount,
      tokensIn: prev.tokensIn + r.tokensIn,
      tokensOut: prev.tokensOut + r.tokensOut,
      cost: prev.cost + r.estimatedCostUsd,
    });
  }
  const byModel = Array.from(modelMap.entries())
    .map(([model, agg]) => ({
      model,
      label: priceFor(model).label,
      provider: priceFor(model).provider,
      callCount: agg.callCount,
      tokensIn: agg.tokensIn,
      tokensOut: agg.tokensOut,
      estimatedCostUsd: agg.cost,
    }))
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

  // Aggregate by provider
  const providerMap = new Map<
    string,
    {
      callCount: number;
      tokensIn: number;
      tokensOut: number;
      cost: number;
      models: Set<string>;
    }
  >();
  for (const r of usageRows) {
    const provider = priceFor(r.model).provider;
    const prev = providerMap.get(provider) ?? {
      callCount: 0,
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      models: new Set<string>(),
    };
    prev.models.add(r.model);
    providerMap.set(provider, {
      callCount: prev.callCount + r.callCount,
      tokensIn: prev.tokensIn + r.tokensIn,
      tokensOut: prev.tokensOut + r.tokensOut,
      cost: prev.cost + r.estimatedCostUsd,
      models: prev.models,
    });
  }
  const byProvider = Array.from(providerMap.entries())
    .map(([provider, agg]) => ({
      provider,
      label: providerLabel(provider),
      modelCount: agg.models.size,
      callCount: agg.callCount,
      tokensIn: agg.tokensIn,
      tokensOut: agg.tokensOut,
      estimatedCostUsd: agg.cost,
    }))
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

  // Aggregate by day while keeping per-model pricing accurate.
  const dayMap = new Map<
    string,
    { callCount: number; tokensIn: number; tokensOut: number; cost: number }
  >();
  for (const row of dailyRows) {
    const key = row.day.toISOString().slice(0, 10);
    const tokensIn = Number(row.tokens_in ?? 0);
    const tokensOut = Number(row.tokens_out ?? 0);
    const prev = dayMap.get(key) ?? {
      callCount: 0,
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
    };
    dayMap.set(key, {
      callCount: prev.callCount + Number(row.call_count),
      tokensIn: prev.tokensIn + tokensIn,
      tokensOut: prev.tokensOut + tokensOut,
      cost: prev.cost + estimateCost(row.model, tokensIn, tokensOut),
    });
  }
  const byDay = Array.from(dayMap.entries())
    .map(([date, agg]) => ({
      date,
      callCount: agg.callCount,
      tokensIn: agg.tokensIn,
      tokensOut: agg.tokensOut,
      estimatedCostUsd: agg.cost,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const totals = usageRows.reduce(
    (acc, r) => ({
      calls: acc.calls + r.callCount,
      in: acc.in + r.tokensIn,
      out: acc.out + r.tokensOut,
      cost: acc.cost + r.estimatedCostUsd,
    }),
    { calls: 0, in: 0, out: 0, cost: 0 },
  );
  const sync = buildSyncUsage(syncRows, days);

  const response: UsageResponse = {
    windowDays: days,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    totalCalls: totals.calls,
    totalTokensIn: totals.in,
    totalTokensOut: totals.out,
    totalCostUsd: totals.cost,
    rows: usageRows,
    byFeature,
    byModel,
    byProvider,
    byDay,
    sync,
  };

  return NextResponse.json(response, {
    headers: privateCacheHeaders(5 * 60, 30 * 60),
  });
}

function buildSyncUsage(
  rows: Array<{
    source: string;
    trigger: string;
    status: string;
    error_category: string | null;
    run_count: bigint;
    provider_calls: bigint | null;
    items_processed: bigint | null;
  }>,
  days: number,
): UsageResponse["sync"] {
  const sourceMap = new Map<
    string,
    {
      runCount: number;
      successRuns: number;
      errorRuns: number;
      providerCalls: number;
      itemsProcessed: number;
    }
  >();
  const triggerMap = new Map<
    string,
    { runCount: number; errorRuns: number; providerCalls: number }
  >();
  const statusMap = new Map<string, number>();
  const errorMap = new Map<string, number>();
  const windowProviderCallLimit = SYNC_BUDGET.providerCallsPerDay * days;
  const windowBrowserFallbackCallLimit =
    SYNC_BUDGET.browserFallbackCallsPerDay * days;

  let totalRuns = 0;
  let totalProviderCalls = 0;
  let totalItemsProcessed = 0;
  let successRuns = 0;
  let errorRuns = 0;
  let runningRuns = 0;
  let browserFallbackProviderCalls = 0;

  for (const row of rows) {
    const runCount = Number(row.run_count);
    const providerCalls = Number(row.provider_calls ?? 0);
    const itemsProcessed = Number(row.items_processed ?? 0);
    const isSuccess = row.status === "success";
    const isError = row.status === "error";
    const isRunning = row.status === "running";

    totalRuns += runCount;
    totalProviderCalls += providerCalls;
    totalItemsProcessed += itemsProcessed;
    if (isSuccess) successRuns += runCount;
    if (isError) errorRuns += runCount;
    if (isRunning) runningRuns += runCount;
    if (row.trigger === "browser_fallback") {
      browserFallbackProviderCalls += providerCalls;
    }

    const source = sourceMap.get(row.source) ?? {
      runCount: 0,
      successRuns: 0,
      errorRuns: 0,
      providerCalls: 0,
      itemsProcessed: 0,
    };
    sourceMap.set(row.source, {
      runCount: source.runCount + runCount,
      successRuns: source.successRuns + (isSuccess ? runCount : 0),
      errorRuns: source.errorRuns + (isError ? runCount : 0),
      providerCalls: source.providerCalls + providerCalls,
      itemsProcessed: source.itemsProcessed + itemsProcessed,
    });

    const trigger = triggerMap.get(row.trigger) ?? {
      runCount: 0,
      errorRuns: 0,
      providerCalls: 0,
    };
    triggerMap.set(row.trigger, {
      runCount: trigger.runCount + runCount,
      errorRuns: trigger.errorRuns + (isError ? runCount : 0),
      providerCalls: trigger.providerCalls + providerCalls,
    });

    statusMap.set(row.status, (statusMap.get(row.status) ?? 0) + runCount);
    if (isError) {
      const category = row.error_category ?? "uncategorized";
      errorMap.set(category, (errorMap.get(category) ?? 0) + runCount);
    }
  }

  const errorRatePercent =
    totalRuns > 0 ? Math.round((errorRuns / totalRuns) * 100) : 0;
  const budgetAlerts: UsageResponse["sync"]["budgetAlerts"] = [];

  if (totalProviderCalls > windowProviderCallLimit) {
    budgetAlerts.push({
      id: "sync-provider-call-budget",
      severity: "warning",
      title: "Google sync call budget exceeded",
      message:
        "Sync used more Google provider calls than expected for this window. Check for repeated full syncs, provider retries, or an unhealthy worker.",
      actual: totalProviderCalls,
      limit: windowProviderCallLimit,
      unit: "calls",
    });
  }

  if (browserFallbackProviderCalls > windowBrowserFallbackCallLimit) {
    budgetAlerts.push({
      id: "browser-fallback-budget",
      severity: "warning",
      title: "Browser fallback is doing too much sync work",
      message:
        "Browser fallback should be rare in production. If it carries the sync load, users pay the latency cost and Google calls become harder to control.",
      actual: browserFallbackProviderCalls,
      limit: windowBrowserFallbackCallLimit,
      unit: "calls",
    });
  }

  if (errorRuns > 0 && errorRatePercent >= SYNC_BUDGET.errorRatePercent) {
    budgetAlerts.push({
      id: "sync-error-rate",
      severity: "warning",
      title: "Sync error rate is elevated",
      message:
        "A rising error rate usually means auth churn, provider rate limits, or network instability. Resolve this before adding more automatic sync frequency.",
      actual: errorRatePercent,
      limit: SYNC_BUDGET.errorRatePercent,
      unit: "%",
    });
  }

  if (runningRuns > 0) {
    budgetAlerts.push({
      id: "sync-runs-still-running",
      severity: "info",
      title: "Sync runs are still marked running",
      message:
        "One or more sync runs have not finished yet. If this persists, inspect worker health before increasing sync cadence.",
      actual: runningRuns,
      limit: null,
      unit: "runs",
    });
  }

  return {
    totalRuns,
    totalProviderCalls,
    totalItemsProcessed,
    successRuns,
    errorRuns,
    runningRuns,
    budget: {
      providerCallsPerDay: SYNC_BUDGET.providerCallsPerDay,
      browserFallbackCallsPerDay: SYNC_BUDGET.browserFallbackCallsPerDay,
      errorRatePercent: SYNC_BUDGET.errorRatePercent,
      windowProviderCallLimit,
      windowBrowserFallbackCallLimit,
    },
    budgetAlerts,
    bySource: Array.from(sourceMap.entries())
      .map(([source, aggregate]) => ({ source, ...aggregate }))
      .sort((a, b) => b.providerCalls - a.providerCalls),
    byTrigger: Array.from(triggerMap.entries())
      .map(([trigger, aggregate]) => ({ trigger, ...aggregate }))
      .sort((a, b) => b.providerCalls - a.providerCalls),
    byStatus: Array.from(statusMap.entries())
      .map(([status, runCount]) => ({ status, runCount }))
      .sort((a, b) => b.runCount - a.runCount),
    byErrorCategory: Array.from(errorMap.entries())
      .map(([category, runCount]) => ({ category, runCount }))
      .sort((a, b) => b.runCount - a.runCount),
  };
}

function providerLabel(provider: string): string {
  if (provider === "anthropic") return "Anthropic";
  if (provider === "voyage") return "Voyage";
  if (provider === "openai") return "OpenAI";
  return "Unknown";
}

function clampDays(d: number): number {
  if (!Number.isFinite(d) || d < 1) return 30;
  if (d > 365) return 365;
  return Math.floor(d);
}

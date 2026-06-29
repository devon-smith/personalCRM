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
}

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

  const [rows, dailyRows] = await Promise.all([
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
  };

  return NextResponse.json(response, {
    headers: privateCacheHeaders(5 * 60, 30 * 60),
  });
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

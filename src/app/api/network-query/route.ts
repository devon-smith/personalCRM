import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runNetworkQuery } from "@/lib/intelligence/network-query";
import { logAIGeneration } from "@/lib/ai-generation-log";

/**
 * POST /api/network-query
 *
 * Body: { query: string }
 * Returns: NetworkQueryResult (answer + suggestedContacts + reasoningTrace)
 *
 * Synchronous for now — Claude tool-use loop runs server-side, response
 * lands when the orchestrator returns. Typical queries finish in
 * 5-12 seconds. Streaming upgrade is M7.3b.
 *
 * Logs cost to AIGenerationLog under feature="network_query".
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { query?: string };
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return NextResponse.json(
      { error: "query is required" },
      { status: 400 },
    );
  }
  if (query.length > 1000) {
    return NextResponse.json(
      { error: "query too long (max 1000 chars)" },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  try {
    const result = await runNetworkQuery({
      prisma,
      userId: session.user.id,
      query,
    });

    // Provenance: record which contacts the answer cites so we can
    // attribute later ("you've asked about Marcus 4 times in queries
    // this week").
    await logAIGeneration({
      userId: session.user.id,
      feature: "network_query",
      model: "claude-sonnet-4-20250514",
      inputRefs: result.suggestedContacts.map((s) => `contact:${s.contactId}`),
      tokensIn: result.usage.inputTokens,
      tokensOut: result.usage.outputTokens,
      latencyMs: Date.now() - startedAt,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAIGeneration({
      userId: session.user.id,
      feature: "network_query",
      model: "claude-sonnet-4-20250514",
      inputRefs: [],
      error: message,
      latencyMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "Query failed", detail: message },
      { status: 500 },
    );
  }
}

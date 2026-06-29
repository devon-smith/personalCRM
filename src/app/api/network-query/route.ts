import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  NETWORK_QUERY_MODEL,
  type NetworkQueryResult,
  runNetworkQuery,
  runNetworkQueryStream,
} from "@/lib/intelligence/network-query";
import { logAIGeneration } from "@/lib/ai-generation-log";

const RECENT_QUERY_REUSE_WINDOW_MS = 2 * 60 * 1000;

/**
 * POST /api/network-query
 *
 * Two modes:
 *
 *   Default: synchronous JSON response with the full result. Same
 *   shape as before — easy to call from scripts, tests, ops.
 *
 *   ?stream=1: Server-Sent Events. Emits live progress as the
 *   orchestrator unfolds:
 *     event: iteration_start  data: { iteration }
 *     event: tool_called      data: { tool, input }
 *     event: tool_result      data: { tool, summary, ok }
 *     event: text_delta       data: { text }
 *     event: complete         data: { result }   (final NetworkQueryResult)
 *     event: error            data: { message }
 *
 * SSE consumers should keep reading until they see `event: complete`
 * or `event: error`. The connection closes after either.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    query?: string;
    parentQueryId?: string;
  };
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const parentQueryId =
    typeof body.parentQueryId === "string" && body.parentQueryId.length > 0
      ? body.parentQueryId
      : null;
  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }
  if (query.length > 1000) {
    return NextResponse.json(
      { error: "query too long (max 1000 chars)" },
      { status: 400 },
    );
  }

  const verifiedParentQueryId = await verifyParentQueryId(
    session.user.id,
    parentQueryId,
  );

  // Rapid exact-match retries are almost always double submits,
  // reloads, or network retries. Reuse the saved answer for a short
  // window so they don't launch a second Claude/tool loop. Asking the
  // same question later still produces a fresh snapshot.
  const cached = await loadRecentSavedResult(
    session.user.id,
    query,
    verifiedParentQueryId,
  );
  if (cached) {
    if (new URL(req.url).searchParams.get("stream") === "1") {
      return cachedStreamResponse(cached.id, cached.result);
    }
    return NextResponse.json({
      ...cached.result,
      savedQueryId: cached.id,
      cached: true,
    });
  }

  // M0.x.11 — when a parentQueryId is set (follow-up flow), load
  // the parent's question + answer and seed the orchestrator with
  // them as turn 1. Refines stopped producing empty answers as
  // soon as Claude saw the prior turn structurally.
  const priorContext = await loadPriorContext(
    session.user.id,
    verifiedParentQueryId,
  );

  const url = new URL(req.url);
  if (url.searchParams.get("stream") === "1") {
    return streamResponse(
      session.user.id,
      query,
      verifiedParentQueryId,
      priorContext,
    );
  }

  // Non-streaming path (unchanged from M7.3).
  const startedAt = Date.now();
  try {
    const result = await runNetworkQuery({
      prisma,
      userId: session.user.id,
      query,
      priorContext,
    });
    // M0.x.7: every query auto-saves with its answer. Trust depends
    // on Jennifer being able to come back and re-read what we told
    // her — the old flow lost that the moment she navigated away.
    const saved = await persistSavedQuery(
      session.user.id,
      query,
      result,
      verifiedParentQueryId,
    );
    await logAIGeneration({
      userId: session.user.id,
      feature: "network_query",
      model: NETWORK_QUERY_MODEL,
      inputRefs: result.suggestedContacts.map((s) => `contact:${s.contactId}`),
      outputId: saved.id,
      tokensIn: result.usage.inputTokens,
      tokensOut: result.usage.outputTokens,
      latencyMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ...result, savedQueryId: saved.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAIGeneration({
      userId: session.user.id,
      feature: "network_query",
      model: NETWORK_QUERY_MODEL,
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

function cachedStreamResponse(
  savedQueryId: string,
  result: NetworkQueryResult,
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      const payload = `event: complete\ndata: ${JSON.stringify({
        result: { ...result, savedQueryId, cached: true },
      })}\n\n`;
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function streamResponse(
  userId: string,
  query: string,
  parentQueryId: string | null,
  priorContext: { question: string; answer: string } | undefined,
): Response {
  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const body = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      try {
        for await (const ev of runNetworkQueryStream({
          prisma,
          userId,
          query,
          priorContext,
        })) {
          // Forward every event as SSE EXCEPT complete — we wrap
          // that one with the persisted savedQueryId so the client
          // can deep-link immediately.
          if (ev.type !== "complete") {
            const { type, ...rest } = ev;
            send(type, rest);
          }

          if (ev.type === "complete") {
            // M0.x.7: persist before sending the complete event so a
            // refresh sees the same id in history immediately.
            const saved = await persistSavedQuery(
              userId,
              query,
              ev.result,
              parentQueryId,
            );
            send("complete", {
              result: { ...ev.result, savedQueryId: saved.id },
            });
            // Final logging — same shape as the non-streaming path.
            await logAIGeneration({
              userId,
              feature: "network_query",
              model: NETWORK_QUERY_MODEL,
              inputRefs: ev.result.suggestedContacts.map(
                (s) => `contact:${s.contactId}`,
              ),
              outputId: saved.id,
              tokensIn: ev.result.usage.inputTokens,
              tokensOut: ev.result.usage.outputTokens,
              latencyMs: Date.now() - startedAt,
            });
            continue;
          }
          if (ev.type === "error") {
            await logAIGeneration({
              userId,
              feature: "network_query",
              model: NETWORK_QUERY_MODEL,
              inputRefs: [],
              error: ev.message,
              latencyMs: Date.now() - startedAt,
            });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send("error", { message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Critical: turn off proxy buffering on Vercel / nginx. SSE
      // without flushing is just a slow JSON response.
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * M0.x.7: persist a completed query + its full answer + evidence as
 * a SavedQuery row. We never dedupe on query text — same question
 * asked twice produces two snapshots (her network may have changed
 * between runs, and the second answer might be materially
 * different). Title falls back to the first 80 chars of the query.
 *
 * M0.x.9: when parentQueryId is set, link this as a follow-up to a
 * prior query + bump the parent's followUpCount. Validates that the
 * parent belongs to the same user before linking — never allow a
 * follow-up to escape its owner.
 */
async function persistSavedQuery(
  userId: string,
  query: string,
  result: NetworkQueryResult,
  parentQueryId: string | null,
): Promise<{ id: string }> {
  // M0.x.9 — guard against persisting "ghost" rows when Claude
  // returns an empty answer (structured-output parse failure, etc).
  // The history panel would render those as "No answer cached" and
  // confuse Jennifer (she sees a row with no content from a query
  // she ran moments ago). Throw instead — the caller already
  // catches and surfaces an error event.
  if (!result.answer || result.answer.trim().length === 0) {
    throw new Error("Query produced an empty answer — not persisting");
  }

  const evidence = {
    suggestedContacts: result.suggestedContacts,
    reasoningTrace: result.reasoningTrace,
    tokensIn: result.usage.inputTokens,
    tokensOut: result.usage.outputTokens,
  };
  const title =
    result.title ??
    (query.length > 80 ? query.slice(0, 77) + "…" : query);

  // Verify parent ownership before linking. A bogus parentQueryId
  // becomes a top-level row instead of leaking cross-user data.
  let verifiedParent: string | null = null;
  if (parentQueryId) {
    const parent = await prisma.savedQuery.findFirst({
      where: { id: parentQueryId, userId },
      select: { id: true },
    });
    if (parent) verifiedParent = parent.id;
  }

  // One transaction: create the row + bump the parent's count atomically
  // so the denormalized counter can't drift on a partial failure.
  const [saved] = await prisma.$transaction([
    prisma.savedQuery.create({
      data: {
        userId,
        query,
        title,
        answer: result.answer,
        evidence: evidence as unknown as object,
        lastRunAt: new Date(),
        parentQueryId: verifiedParent,
      },
      select: { id: true },
    }),
    ...(verifiedParent
      ? [
          prisma.savedQuery.update({
            where: { id: verifiedParent },
            data: { followUpCount: { increment: 1 } },
          }),
        ]
      : []),
  ]);
  return saved;
}

async function verifyParentQueryId(
  userId: string,
  parentQueryId: string | null,
): Promise<string | null> {
  if (!parentQueryId) return null;
  const parent = await prisma.savedQuery.findFirst({
    where: { id: parentQueryId, userId },
    select: { id: true },
  });
  return parent?.id ?? null;
}

async function loadRecentSavedResult(
  userId: string,
  query: string,
  parentQueryId: string | null,
): Promise<{ id: string; result: NetworkQueryResult } | null> {
  const since = new Date(Date.now() - RECENT_QUERY_REUSE_WINDOW_MS);
  const saved = await prisma.savedQuery.findFirst({
    where: {
      userId,
      query,
      parentQueryId,
      answer: { not: null },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      answer: true,
      evidence: true,
    },
  });
  if (!saved?.answer) return null;
  return {
    id: saved.id,
    result: {
      title: saved.title,
      answer: saved.answer,
      suggestedContacts: parseSavedSuggestions(saved.evidence),
      reasoningTrace: parseSavedReasoningTrace(saved.evidence),
      rawAnswer: saved.answer,
      usage: parseSavedUsage(saved.evidence),
    },
  };
}

function parseSavedSuggestions(evidence: unknown): NetworkQueryResult["suggestedContacts"] {
  const value = getEvidenceArray(evidence, "suggestedContacts");
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      contactId: typeof item.contactId === "string" ? item.contactId : "",
      name: typeof item.name === "string" ? item.name : "",
      reason: typeof item.reason === "string" ? item.reason : "",
    }))
    .filter((item) => item.contactId && item.name);
}

function parseSavedReasoningTrace(evidence: unknown): NetworkQueryResult["reasoningTrace"] {
  const value = getEvidenceArray(evidence, "reasoningTrace");
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      tool: typeof item.tool === "string" ? item.tool : "unknown",
      input: item.input,
      summary: typeof item.summary === "string" ? item.summary : "",
    }))
    .filter((item) => item.summary);
}

function parseSavedUsage(evidence: unknown): NetworkQueryResult["usage"] {
  if (!isRecord(evidence)) {
    return { inputTokens: 0, outputTokens: 0 };
  }
  return {
    inputTokens:
      typeof evidence.tokensIn === "number" && Number.isFinite(evidence.tokensIn)
        ? evidence.tokensIn
        : 0,
    outputTokens:
      typeof evidence.tokensOut === "number" && Number.isFinite(evidence.tokensOut)
        ? evidence.tokensOut
        : 0,
  };
}

function getEvidenceArray(evidence: unknown, key: string): unknown[] {
  if (!isRecord(evidence)) return [];
  const value = evidence[key];
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * M0.x.11 — load a parent query's question + answer to seed the
 * follow-up conversation. Returns undefined when no parent (top-
 * level query) or when the parent doesn't belong to this user
 * (owner-scoped). Empty/null parent answers also return undefined
 * — seeding with an empty assistant turn would confuse Claude.
 */
async function loadPriorContext(
  userId: string,
  parentQueryId: string | null,
): Promise<{ question: string; answer: string } | undefined> {
  if (!parentQueryId) return undefined;
  const parent = await prisma.savedQuery.findFirst({
    where: { id: parentQueryId, userId },
    select: { query: true, answer: true },
  });
  if (!parent) return undefined;
  if (!parent.answer || parent.answer.trim().length === 0) return undefined;
  return { question: parent.query, answer: parent.answer };
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  runNetworkQuery,
  runNetworkQueryStream,
} from "@/lib/intelligence/network-query";
import { logAIGeneration } from "@/lib/ai-generation-log";

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

  const body = (await req.json().catch(() => ({}))) as { query?: string };
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }
  if (query.length > 1000) {
    return NextResponse.json(
      { error: "query too long (max 1000 chars)" },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  if (url.searchParams.get("stream") === "1") {
    return streamResponse(session.user.id, query);
  }

  // Non-streaming path (unchanged from M7.3).
  const startedAt = Date.now();
  try {
    const result = await runNetworkQuery({
      prisma,
      userId: session.user.id,
      query,
    });
    // M0.x.7: every query auto-saves with its answer. Trust depends
    // on Jennifer being able to come back and re-read what we told
    // her — the old flow lost that the moment she navigated away.
    const saved = await persistSavedQuery(session.user.id, query, result);
    await logAIGeneration({
      userId: session.user.id,
      feature: "network_query",
      model: "claude-sonnet-4-20250514",
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

function streamResponse(userId: string, query: string): Response {
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
            const saved = await persistSavedQuery(userId, query, ev.result);
            send("complete", {
              result: { ...ev.result, savedQueryId: saved.id },
            });
            // Final logging — same shape as the non-streaming path.
            await logAIGeneration({
              userId,
              feature: "network_query",
              model: "claude-sonnet-4-20250514",
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
              model: "claude-sonnet-4-20250514",
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
 */
async function persistSavedQuery(
  userId: string,
  query: string,
  result: import("@/lib/intelligence/network-query").NetworkQueryResult,
): Promise<{ id: string }> {
  const evidence = {
    suggestedContacts: result.suggestedContacts,
    reasoningTrace: result.reasoningTrace,
    tokensIn: result.usage.inputTokens,
    tokensOut: result.usage.outputTokens,
  };
  const title =
    result.title ??
    (query.length > 80 ? query.slice(0, 77) + "…" : query);
  const saved = await prisma.savedQuery.create({
    data: {
      userId,
      query,
      title,
      answer: result.answer,
      evidence: evidence as unknown as object,
      lastRunAt: new Date(),
    },
    select: { id: true },
  });
  return saved;
}

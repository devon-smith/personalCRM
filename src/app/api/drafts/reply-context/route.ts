import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadReplyContext } from "@/lib/draft-reply-context";

/**
 * POST /api/drafts/reply-context
 * Body: { threadKey: string }
 *
 * Returns the structured "what Jennifer is replying to" payload:
 * the latest inbound message (full body when Gmail returns one),
 * plus up to 5 messages of thread history. The composer renders
 * it above the configure step so Jennifer can see what she's
 * about to reply to BEFORE clicking Generate.
 *
 * Same loader the draft generator uses — single source of truth
 * for what the model and the UI see.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const threadKey = typeof body?.threadKey === "string" ? body.threadKey : null;
    if (!threadKey) {
      return NextResponse.json(
        { error: "threadKey required in body" },
        { status: 400 },
      );
    }

    const ctx = await loadReplyContext({
      prisma,
      userId: session.user.id,
      threadKey,
    });

    if (!ctx) {
      return NextResponse.json({ replyContext: null });
    }

    return NextResponse.json({
      replyContext: {
        latestInbound: {
          fromEmail: ctx.latestInbound.fromEmail,
          fromName: ctx.latestInbound.fromName,
          subject: ctx.latestInbound.subject,
          body: ctx.latestInbound.body,
          bodyIsFull: ctx.latestInbound.bodyIsFull,
          occurredAt: ctx.latestInbound.occurredAt.toISOString(),
        },
        threadHistory: ctx.threadHistory.map((m) => ({
          direction: m.direction,
          fromEmail: m.fromEmail,
          fromName: m.fromName,
          subject: m.subject,
          snippet: m.snippet,
          occurredAt: m.occurredAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    console.error("[POST /api/drafts/reply-context]", error);
    return NextResponse.json(
      { error: "Failed to load reply context" },
      { status: 500 },
    );
  }
}

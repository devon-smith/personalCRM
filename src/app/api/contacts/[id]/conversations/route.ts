import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/contacts/[contactId]/conversations
 *
 * Returns all interactions for a contact grouped by channel,
 * ordered oldest-first (chat order). Supports pagination.
 *
 * Query params:
 *   ?limit=100  — max messages per channel (default 100)
 *   ?before=ISO — load messages before this date (for paging)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const { id: contactId } = await params;
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "100", 10) || 100, 500);
    const before = searchParams.get("before");

    // Verify contact ownership
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, userId },
      select: {
        id: true,
        name: true,
        company: true,
        email: true,
        phone: true,
        linkedinUrl: true,
      },
    });

    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    // Build where clause
    const where: Record<string, unknown> = { userId, contactId };
    if (before) {
      where.occurredAt = { lt: new Date(before) };
    }

    // Fetch all interactions (we'll group client-side after fetching)
    // Get the most recent `limit` per channel by fetching more and slicing
    const interactions = await prisma.interaction.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      take: limit * 6, // fetch extra to cover multiple channels
      select: {
        id: true,
        type: true,
        direction: true,
        channel: true,
        subject: true,
        summary: true,
        occurredAt: true,
        sourceId: true,
      },
    });

    // Group by channel
    const channelMap = new Map<string, typeof interactions>();
    for (const ix of interactions) {
      const ch = ix.channel ?? "other";
      const list = channelMap.get(ch) ?? [];
      list.push(ix);
      channelMap.set(ch, list);
    }

    // Build response: limit per channel, reverse to oldest-first
    const channels = Array.from(channelMap.entries()).map(([channel, msgs]) => {
      const limited = msgs.slice(0, limit);
      // Deduplicate: same direction + timestamps within 2 min + same first 50 chars
      const deduped = deduplicateMessages(limited);
      deduped.reverse(); // oldest first for chat display

      return {
        channel,
        messageCount: msgs.length,
        hasMore: msgs.length > limit,
        latestAt: msgs[0]?.occurredAt.toISOString() ?? null,
        messages: deduped.map((m) => ({
          id: m.id,
          type: m.type,
          direction: m.direction,
          summary: m.summary,
          subject: m.subject,
          occurredAt: m.occurredAt.toISOString(),
          sourceId: m.sourceId,
        })),
      };
    });

    // Sort channels by most recent first
    channels.sort((a, b) => {
      if (!a.latestAt) return 1;
      if (!b.latestAt) return -1;
      return new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime();
    });

    return NextResponse.json({ channels, contact });
  } catch (error) {
    console.error("[GET /api/contacts/[contactId]/conversations]", error);
    return NextResponse.json(
      { error: "Failed to fetch conversations" },
      { status: 500 },
    );
  }
}

/**
 * Deduplicate messages that appear from multiple sync sources
 * (e.g., Notion sync + Mac chat.db sync for the same iMessage).
 */
function deduplicateMessages<
  T extends {
    direction: string;
    occurredAt: Date;
    summary: string | null;
    sourceId: string | null;
  },
>(messages: T[]): T[] {
  const result: T[] = [];
  const seen = new Set<string>();

  for (const msg of messages) {
    const prefix = (msg.summary ?? "").slice(0, 50);
    const minuteBucket = Math.floor(msg.occurredAt.getTime() / 120_000);
    const key = `${msg.direction}:${minuteBucket}:${prefix}`;

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(msg);
  }

  return result;
}

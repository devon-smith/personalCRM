import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getThreadsWithDrafts } from "@/lib/gmail/drafts";
import { computePriority } from "@/lib/inbox-priority";

// ─── In-memory cache (short TTL to avoid redundant queries) ──

interface CachedResponse {
  readonly data: string;
  readonly expiresAt: number;
}
let inboxCache: CachedResponse | null = null;
const CACHE_TTL_MS = 3000; // 3 seconds

/** Invalidate the inbox cache (call after resolve, dismiss, sync, etc.) */
export function invalidateInboxCache() {
  inboxCache = null;
}

/**
 * GET /api/inbox-items
 *
 * Reads directly from the InboxItem table (single source of truth).
 * Returns OPEN items and SNOOZED items whose snooze has expired.
 *
 * Response: { items, totalOpen, groupChats, totalGroupChats }
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (inboxCache && Date.now() < inboxCache.expiresAt) {
      return new NextResponse(inboxCache.data, {
        headers: { "content-type": "application/json" },
      });
    }

    const userId = session.user.id;
    const now = new Date();

    // Reopen snoozed items whose snooze has expired
    await prisma.inboxItem.updateMany({
      where: {
        userId,
        status: "SNOOZED",
        snoozeUntil: { lte: now },
      },
      data: {
        status: "OPEN",
        snoozeUntil: null,
      },
    });

    // Fetch all OPEN items + draft threadIds in parallel
    const [openItems, draftThreadIds] = await Promise.all([
      prisma.inboxItem.findMany({
        where: {
          userId,
          status: "OPEN",
        },
        orderBy: { triggerAt: "desc" },
      }),
      getThreadsWithDrafts(userId),
    ]);

    // Split into 1:1 and group chats
    const oneToOne = openItems.filter((item) => !item.isGroupChat);
    const groups = openItems.filter((item) => item.isGroupChat);

    // Build response items using denormalized fields on InboxItem
    const buildItem = (item: typeof openItems[number]) => {
      // Check if this email thread has an active Gmail draft
      // threadKey format for email is "gmail:{threadId}"
      const hasDraft =
        item.channel === "email" &&
        item.threadKey.startsWith("gmail:") &&
        draftThreadIds.has(item.threadKey.slice(6));

      // Compute priority (use cached if available and fresh, otherwise recompute)
      const p = computePriority({
        tier: item.tier,
        channel: item.channel,
        triggerAt: item.triggerAt,
        messageCount: item.messageCount,
        isGroupChat: item.isGroupChat,
      });

      return {
        id: item.id,
        contactId: item.contactId,
        contactName: item.contactName,
        company: item.company ?? null,
        tier: item.tier,
        channel: item.channel,
        threadKey: item.threadKey,
        isGroupChat: item.isGroupChat,
        contactEmail: item.contactEmail ?? null,
        contactPhone: item.contactPhone ?? null,
        contactLinkedinUrl: item.contactLinkedinUrl ?? null,
        triggerAt: item.triggerAt.toISOString(),
        lastInboundAt: item.triggerAt.toISOString(),
        messagePreview: Array.isArray(item.messagePreview) ? item.messagePreview : [],
        messageCount: item.messageCount,
        status: item.status,
        needsReplyReason: null,
        hasDraft,
        priority: p.priority,
        priorityScore: p.score,
        priorityReason: p.reason,
      };
    };

    const items = oneToOne.map(buildItem);
    // Sort by priority score descending (drafts sink to bottom within their score)
    items.sort((a, b) => {
      if (a.hasDraft && !b.hasDraft) return 1;
      if (!a.hasDraft && b.hasDraft) return -1;
      return b.priorityScore - a.priorityScore;
    });

    const groupChats = groups
      .map(buildItem)
      .filter((g) => (g.messagePreview as unknown[]).length > 0);
    groupChats.sort((a, b) => b.priorityScore - a.priorityScore);

    const responseBody = JSON.stringify({
      items: items.slice(0, 50),
      totalOpen: items.length,
      groupChats: groupChats.slice(0, 50),
      totalGroupChats: groupChats.length,
    });

    inboxCache = { data: responseBody, expiresAt: Date.now() + CACHE_TTL_MS };

    return new NextResponse(responseBody, {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    console.error("[GET /api/inbox-items]", error);
    return NextResponse.json(
      { error: "Failed to fetch inbox" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getThreadsWithDrafts } from "@/lib/gmail/drafts";
import { computePriority } from "@/lib/inbox-priority";

// ─── In-memory cache (short TTL to avoid redundant queries) ──

interface CachedResponse {
  readonly key: string;
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
 * Query params:
 *   ?view=needs-reply (default) — needsResponse IS NULL OR needsResponse=true
 *   ?view=all                   — every OPEN item, including ones the
 *                                 classifier marked "doesn't need a reply"
 *
 * Response: { items, totalOpen, groupChats, totalGroupChats, filteredOut }
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const view = url.searchParams.get("view") === "all" ? "all" : "needs-reply";
    const cacheKey = `view:${view}`;

    if (
      inboxCache &&
      inboxCache.key === cacheKey &&
      Date.now() < inboxCache.expiresAt
    ) {
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

    // Count items the classifier hid so the UI can show "N more filtered"
    // without a separate request.
    const filteredOut =
      view === "needs-reply"
        ? await prisma.inboxItem.count({
            where: { userId, status: "OPEN", needsResponse: false },
          })
        : 0;

    // Fetch OPEN items (filtered by view) + draft threadIds in parallel.
    // Fail-open: when needsResponse IS NULL the classifier hasn't run
    // yet, so we show the item to avoid hiding real replies.
    const baseWhere = { userId, status: "OPEN" } as const;
    const where =
      view === "all"
        ? baseWhere
        : {
            ...baseWhere,
            OR: [{ needsResponse: null }, { needsResponse: true }],
          };

    const [openItems, draftThreadIds] = await Promise.all([
      prisma.inboxItem.findMany({
        where,
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

      const persistedSourceRecordIds = Array.isArray(item.sourceRecordIds)
        ? (item.sourceRecordIds as unknown as string[])
        : [];

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
        hasDraft,
        priority: p.priority,
        priorityScore: p.score,
        priorityReason: p.reason,
        // Provenance — for the EvidenceChevron affordance
        sourceSystem: item.sourceSystem ?? null,
        sourceRecordIds: persistedSourceRecordIds,
        triggerInteractionId: item.triggerInteractionId,
        // M0.x.2 classifier output
        needsResponse: item.needsResponse,
        responseConfidence: item.responseConfidence,
        responseReason: item.responseReason,
        responseCategory: item.responseCategory,
        classifiedAt: item.classifiedAt ? item.classifiedAt.toISOString() : null,
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
      filteredOut,
      view,
    });

    inboxCache = {
      key: cacheKey,
      data: responseBody,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };

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

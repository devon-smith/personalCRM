import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getReplyQueueInbox } from "@/lib/reply-queue/inbox-items";

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
    const userId = session.user.id;
    const cacheKey = `user:${userId}:view:${view}`;

    if (
      inboxCache &&
      inboxCache.key === cacheKey &&
      Date.now() < inboxCache.expiresAt
    ) {
      return new NextResponse(inboxCache.data, {
        headers: { "content-type": "application/json" },
      });
    }

    const responseBody = JSON.stringify(await getReplyQueueInbox(userId, view));

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

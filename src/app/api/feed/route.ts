import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/feed
 *
 * Returns the user's FeedItem rows for the /feed page. Filter by
 * itemType ("?type=job_change,publication") and highlighted-only
 * ("?highlighted=1"). Capped at 50 items per request; clients can
 * paginate via "?before=<isoDate>" for "Load earlier".
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const url = new URL(req.url);
  const typeParam = url.searchParams.get("type");
  const highlightedOnly = url.searchParams.get("highlighted") === "1";
  const before = url.searchParams.get("before");

  const types = typeParam
    ? typeParam.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  const where = {
    userId,
    isHidden: false,
    ...(types && types.length > 0 ? { itemType: { in: types } } : {}),
    ...(highlightedOnly ? { isHighlighted: true } : {}),
    ...(before ? { detectedAt: { lt: new Date(before) } } : {}),
  };

  const items = await prisma.feedItem.findMany({
    where,
    orderBy: [{ isHighlighted: "desc" }, { detectedAt: "desc" }],
    take: 50,
    select: {
      id: true,
      contactId: true,
      itemType: true,
      headline: true,
      body: true,
      sourceType: true,
      sourceRecordId: true,
      linkUrl: true,
      detectedAt: true,
      isHighlighted: true,
      contact: {
        select: { name: true, company: true, tier: true },
      },
    },
  });

  // Earliest detectedAt is the cursor for the next "Load earlier" call.
  const cursor =
    items.length > 0
      ? items[items.length - 1].detectedAt.toISOString()
      : null;

  return NextResponse.json({
    items: items.map((i) => ({
      ...i,
      detectedAt: i.detectedAt.toISOString(),
    })),
    cursor,
  });
}

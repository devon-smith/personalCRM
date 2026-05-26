import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/feed/visit
 *
 * Updates User.lastFeedVisitAt to now. Called from the /feed page
 * on mount so the rail-nav dot indicator clears.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await prisma.user.update({
    where: { id: session.user.id },
    data: { lastFeedVisitAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}

/**
 * GET /api/feed/visit
 *
 * Returns { hasUnseen: boolean } — true when there are FeedItem rows
 * created since the user's last /feed visit. Powers the rail-nav dot.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const [user, latestItem] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { lastFeedVisitAt: true },
    }),
    prisma.feedItem.findFirst({
      where: { userId, isHidden: false },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  const hasUnseen = Boolean(
    latestItem &&
      (!user?.lastFeedVisitAt || latestItem.createdAt > user.lastFeedVisitAt),
  );
  return NextResponse.json({ hasUnseen });
}

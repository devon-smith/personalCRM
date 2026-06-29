import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deploymentFeatures } from "@/lib/deployment-features";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/feed/:itemId/hide
 *
 * Hide a feed item from the user's /feed surface. Persists across
 * runs of the aggregator — once hidden, the row stays hidden even
 * if its underlying source signal re-fires.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  if (!deploymentFeatures.feed) {
    return NextResponse.json({ error: "Feed is disabled" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { itemId } = await params;
  const userId = session.user.id;

  const updated = await prisma.feedItem.updateMany({
    where: { id: itemId, userId },
    data: { isHidden: true },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

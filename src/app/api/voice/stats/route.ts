import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RELATIONSHIP_TYPES } from "@/lib/voice/relationship-classifier";

/**
 * GET /api/voice/stats
 *
 * Returns the voice corpus index status for the current user — how
 * many emails have been indexed, when the index was last refreshed,
 * the date window covered, and counts by relationship type.
 *
 * Powers the header strip on /voice and is the smoke test
 * for "the worker ran and wrote something."
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await prisma.voiceProfile.findUnique({
    where: { userId: session.user.id },
  });

  // groupBy counts give us the per-relationship-type breakdown without
  // loading every VoiceExample row.
  const grouped = await prisma.voiceExample.groupBy({
    by: ["relationshipType"],
    where: { userId: session.user.id },
    _count: { _all: true },
  });
  const countsByType: Record<string, number> = {};
  for (const rt of RELATIONSHIP_TYPES) countsByType[rt] = 0;
  for (const row of grouped) {
    countsByType[row.relationshipType] = row._count._all;
  }

  return NextResponse.json({
    indexedEmailCount: profile?.indexedEmailCount ?? 0,
    oldestIndexedAt: profile?.oldestIndexedAt?.toISOString() ?? null,
    newestIndexedAt: profile?.newestIndexedAt?.toISOString() ?? null,
    lastIndexedAt: profile?.lastIndexedAt?.toISOString() ?? null,
    countsByType,
  });
}

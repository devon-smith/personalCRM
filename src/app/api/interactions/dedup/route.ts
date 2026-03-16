import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/interactions/dedup
 * Preview duplicate iMessage interactions (same GUID under both imsg: and imsg-ind: prefixes).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Get all backfill-format sourceIds (imsg:{guid})
  const backfillInteractions = await prisma.interaction.findMany({
    where: {
      userId,
      sourceId: { startsWith: "imsg:" },
      NOT: { sourceId: { startsWith: "imsg-ind:" } },
    },
    select: { id: true, sourceId: true },
  });

  // Get all regular-sync sourceIds (imsg-ind:{guid})
  const regularInteractions = await prisma.interaction.findMany({
    where: {
      userId,
      sourceId: { startsWith: "imsg-ind:" },
    },
    select: { id: true, sourceId: true },
  });

  // Build a set of GUIDs from regular sync
  const regularGuids = new Set(
    regularInteractions.map((i) => (i.sourceId ?? "").replace("imsg-ind:", "")),
  );

  // Find backfill interactions whose GUID also exists in regular sync
  const duplicates = backfillInteractions.filter((i) => {
    const guid = (i.sourceId ?? "").replace("imsg:", "");
    return regularGuids.has(guid);
  });

  return NextResponse.json({
    backfillTotal: backfillInteractions.length,
    regularTotal: regularInteractions.length,
    duplicateCount: duplicates.length,
    message: duplicates.length > 0
      ? `Found ${duplicates.length} duplicate interactions. POST to this endpoint to remove them.`
      : "No duplicates found.",
  });
}

/**
 * POST /api/interactions/dedup
 * Remove duplicate iMessage interactions, keeping the imsg-ind: versions.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Get all backfill-format interactions
  const backfillInteractions = await prisma.interaction.findMany({
    where: {
      userId,
      sourceId: { startsWith: "imsg:" },
      NOT: { sourceId: { startsWith: "imsg-ind:" } },
    },
    select: { id: true, sourceId: true },
  });

  // Get regular-sync GUIDs
  const regularGuids = new Set(
    (
      await prisma.interaction.findMany({
        where: { userId, sourceId: { startsWith: "imsg-ind:" } },
        select: { sourceId: true },
      })
    ).map((i) => (i.sourceId ?? "").replace("imsg-ind:", "")),
  );

  // Find IDs to delete (backfill entries that have a matching regular entry)
  const idsToDelete = backfillInteractions
    .filter((i) => regularGuids.has((i.sourceId ?? "").replace("imsg:", "")))
    .map((i) => i.id);

  if (idsToDelete.length === 0) {
    return NextResponse.json({
      deleted: 0,
      message: "No duplicates found.",
    });
  }

  // Delete in batches of 500
  let totalDeleted = 0;
  for (let i = 0; i < idsToDelete.length; i += 500) {
    const batch = idsToDelete.slice(i, i + 500);
    const result = await prisma.interaction.deleteMany({
      where: { id: { in: batch } },
    });
    totalDeleted += result.count;
  }

  console.log(`[dedup] Deleted ${totalDeleted} duplicate iMessage interactions`);

  return NextResponse.json({
    deleted: totalDeleted,
    message: `Removed ${totalDeleted} duplicate interactions (kept imsg-ind: versions).`,
  });
}

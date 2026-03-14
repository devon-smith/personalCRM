import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/contacts/cleanup-csv
 *
 * Removes CSV-imported contacts that have zero interactions.
 * These are contacts imported from a file that never matched any
 * message data — they add noise without relationship signal.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Find CSV contacts with no interactions
  const toDelete = await prisma.contact.findMany({
    where: {
      userId,
      source: "CSV_IMPORT",
      interactions: { none: {} },
    },
    select: { id: true, name: true },
  });

  if (toDelete.length === 0) {
    return NextResponse.json({ deleted: 0, contacts: [] });
  }

  const ids = toDelete.map((c) => c.id);

  // Delete in bulk — cascade handles related records (circles, sightings, etc.)
  const result = await prisma.contact.deleteMany({
    where: { id: { in: ids }, userId },
  });

  console.log(
    `[cleanup-csv] Deleted ${result.count} CSV contacts with no interactions`,
  );

  return NextResponse.json({
    deleted: result.count,
    contacts: toDelete.map((c) => c.name),
  });
}

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { invalidateInboxCache } from "@/app/api/inbox-items/route";

/**
 * POST /api/inbox-items/bulk-resolve
 * Marks all OPEN inbox items as RESOLVED.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const now = new Date();

    const result = await prisma.inboxItem.updateMany({
      where: {
        userId,
        status: "OPEN",
      },
      data: {
        status: "RESOLVED",
        resolvedAt: now,
        resolvedBy: "manual",
      },
    });

    console.log(`[inbox] Bulk-resolved ${result.count} inbox item(s)`);
    invalidateInboxCache();
    return NextResponse.json({ ok: true, resolved: result.count });
  } catch (error) {
    console.error("[POST /api/inbox-items/bulk-resolve]", error);
    return NextResponse.json(
      { error: "Failed to bulk-resolve" },
      { status: 500 },
    );
  }
}

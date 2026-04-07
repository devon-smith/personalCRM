import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { invalidateInboxCache } from "@/app/api/inbox-items/route";

/**
 * POST /api/inbox-items/:itemId/resolve
 * Manually mark an inbox item as resolved.
 * Also dismisses all non-dismissed INBOUND interactions for the chat
 * so that the item doesn't resurface from stale data.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { itemId } = await params;
    const userId = session.user.id;
    const now = new Date();

    // Look up the InboxItem to get context for the interaction update
    const inboxItem = await prisma.inboxItem.findUnique({
      where: { id: itemId, userId },
    });

    if (!inboxItem) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    // Update InboxItem to RESOLVED
    await prisma.inboxItem.update({
      where: { id: itemId },
      data: {
        status: "RESOLVED",
        resolvedAt: now,
        resolvedBy: "manual",
      },
    });

    // Also dismiss INBOUND interactions for this contact+channel
    // so stale data doesn't cause issues
    await prisma.interaction.updateMany({
      where: {
        userId,
        contactId: inboxItem.contactId,
        direction: "INBOUND",
        dismissedAt: null,
      },
      data: { dismissedAt: now },
    });

    console.log(`[inbox] Manually resolved inbox item ${itemId}`);

    invalidateInboxCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/inbox-items/[itemId]/resolve]", error);
    return NextResponse.json(
      { error: "Failed to resolve item" },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { invalidateInboxCache } from "@/app/api/inbox-items/route";

/**
 * POST /api/inbox-items/:itemId/mute
 * Dismiss the inbox item AND mute the thread so future inbound
 * on this chatId is auto-dismissed.
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

    // Look up the InboxItem to get the threadKey
    const inboxItem = await prisma.inboxItem.findUnique({
      where: { id: itemId, userId },
    });

    if (!inboxItem) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    // Dismiss the inbox item
    await prisma.inboxItem.update({
      where: { id: itemId },
      data: {
        status: "DISMISSED",
        resolvedAt: new Date(),
        resolvedBy: "muted",
        snoozeUntil: null,
      },
    });

    // Add the Gmail threadId to muted threads if this is an email thread
    if (
      inboxItem.channel === "email" &&
      inboxItem.threadKey.startsWith("gmail:")
    ) {
      const gmailThreadId = inboxItem.threadKey.slice(6);

      const syncState = await prisma.gmailSyncState.findUnique({
        where: { userId },
        select: { mutedThreads: true },
      });

      const current = syncState?.mutedThreads ?? [];
      if (!current.includes(gmailThreadId)) {
        await prisma.gmailSyncState.update({
          where: { userId },
          data: {
            mutedThreads: [...current, gmailThreadId],
          },
        });
      }
    }

    invalidateInboxCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/inbox-items/[itemId]/mute]", error);
    return NextResponse.json(
      { error: "Failed to mute thread" },
      { status: 500 },
    );
  }
}

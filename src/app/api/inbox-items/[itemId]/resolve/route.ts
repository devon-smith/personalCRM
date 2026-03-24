import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { invalidateInboxCache } from "@/app/api/inbox-items/route";

/**
 * POST /api/inbox-items/:chatId/resolve
 * Manually mark a conversation as replied to.
 * Creates a synthetic OUTBOUND interaction with the same chatId,
 * which makes the computed inbox query automatically exclude it.
 * In v2, itemId IS the chatId.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { itemId: chatId } = await params;
    const body = await req.json().catch(() => ({})) as { channel?: string };
    const channel = body.channel ?? "text";

    // Find the latest inbound interaction for this chat to get contactId
    const latestInbound = await prisma.interaction.findFirst({
      where: {
        userId: session.user.id,
        chatId,
        direction: "INBOUND",
      },
      orderBy: { occurredAt: "desc" },
      select: { contactId: true, channel: true, isGroupChat: true },
    });

    if (!latestInbound) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    // Dismiss all non-dismissed INBOUND interactions for this chat.
    // The inbox DISTINCT ON query filters "dismissedAt IS NULL", so
    // dismissed interactions are hidden. When a NEW inbound arrives
    // (without dismissedAt), the chat reappears naturally.
    const now = new Date();
    const dismissed = await prisma.interaction.updateMany({
      where: {
        userId: session.user.id,
        chatId,
        direction: "INBOUND",
        dismissedAt: null,
      },
      data: { dismissedAt: now },
    });

    console.log(`[inbox] Manually resolved chat ${chatId} (${dismissed.count} interactions dismissed)`);

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

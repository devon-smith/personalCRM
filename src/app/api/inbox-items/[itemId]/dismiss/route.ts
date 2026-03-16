import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/inbox-items/:chatId/dismiss
 * Permanently dismiss a conversation from the inbox.
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

    await prisma.inboxDismissal.upsert({
      where: {
        userId_chatId_channel: {
          userId: session.user.id,
          chatId,
          channel,
        },
      },
      create: {
        userId: session.user.id,
        chatId,
        channel,
        snoozeUntil: null, // permanent dismiss
      },
      update: {
        dismissedAt: new Date(),
        snoozeUntil: null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/inbox-items/[itemId]/dismiss]", error);
    return NextResponse.json(
      { error: "Failed to dismiss item" },
      { status: 500 },
    );
  }
}

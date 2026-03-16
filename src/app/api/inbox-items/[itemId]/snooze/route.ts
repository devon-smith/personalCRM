import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/inbox-items/:chatId/snooze
 * Snooze a conversation for a specified number of hours.
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
    const { hours, channel } = (await req.json()) as { hours: number; channel?: string };

    if (!hours || hours < 1) {
      return NextResponse.json({ error: "hours is required" }, { status: 400 });
    }

    const snoozeUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
    const ch = channel ?? "text";

    await prisma.inboxDismissal.upsert({
      where: {
        userId_chatId_channel: {
          userId: session.user.id,
          chatId,
          channel: ch,
        },
      },
      create: {
        userId: session.user.id,
        chatId,
        channel: ch,
        snoozeUntil,
      },
      update: {
        dismissedAt: new Date(),
        snoozeUntil,
      },
    });

    return NextResponse.json({ ok: true, snoozeUntil: snoozeUntil.toISOString() });
  } catch (error) {
    console.error("[POST /api/inbox-items/[itemId]/snooze]", error);
    return NextResponse.json(
      { error: "Failed to snooze item" },
      { status: 500 },
    );
  }
}

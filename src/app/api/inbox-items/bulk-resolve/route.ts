import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/inbox-items/bulk-resolve
 * Marks all currently visible inbox conversations as "replied to"
 * by creating synthetic OUTBOUND interactions for each open chat.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    // Find all chats where latest message is inbound (same logic as GET)
    interface ChatRow {
      chatId: string;
      contactId: string;
      direction: string;
      channel: string;
      isGroupChat: boolean;
    }

    const inboxChats = await prisma.$queryRaw<ChatRow[]>`
      SELECT DISTINCT ON ("chatId")
        "chatId",
        "contactId",
        "direction",
        "channel",
        "isGroupChat"
      FROM "Interaction"
      WHERE "userId" = ${userId}
        AND "chatId" IS NOT NULL
        AND "dismissedAt" IS NULL
        AND "occurredAt" > ${thirtyDaysAgo}
        AND "type" != 'NOTE'
      ORDER BY "chatId", "occurredAt" DESC
    `;

    const needsReply = inboxChats.filter((r) => r.direction === "INBOUND");

    // Dismiss all non-dismissed INBOUND interactions for these chats
    const now = new Date();
    const chatIds = needsReply.map((r) => r.chatId);

    const dismissed = chatIds.length > 0
      ? await prisma.interaction.updateMany({
          where: {
            userId,
            chatId: { in: chatIds },
            direction: "INBOUND",
            dismissedAt: null,
          },
          data: { dismissedAt: now },
        })
      : { count: 0 };

    const resolved = needsReply.length;
    console.log(`[inbox] Bulk-resolved ${resolved} conversation(s), ${dismissed.count} interactions dismissed`);
    return NextResponse.json({ ok: true, resolved });
  } catch (error) {
    console.error("[POST /api/inbox-items/bulk-resolve]", error);
    return NextResponse.json(
      { error: "Failed to bulk-resolve" },
      { status: 500 },
    );
  }
}

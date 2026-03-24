import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/threads/backfill
 *
 * Populates the Thread table from existing Interaction.chatId data.
 * Safe to run multiple times — uses upsert on (userId, source, sourceThreadId).
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    // 1. Get all distinct chatIds with metadata
    const chatSummaries = await prisma.$queryRaw<{
      chatId: string;
      isGroupChat: boolean;
      chatName: string | null;
      lastActivityAt: Date;
      messageCount: number;
    }[]>`
      SELECT
        "chatId",
        bool_or("isGroupChat") as "isGroupChat",
        MAX("chatName") as "chatName",
        MAX("occurredAt") as "lastActivityAt",
        COUNT(*)::int as "messageCount"
      FROM "Interaction"
      WHERE "userId" = ${userId}
        AND "chatId" IS NOT NULL
        AND "threadId" IS NULL
      GROUP BY "chatId"
    `;

    if (chatSummaries.length === 0) {
      return NextResponse.json({ threadsCreated: 0, interactionsLinked: 0, participantsAdded: 0 });
    }

    let threadsCreated = 0;
    let interactionsLinked = 0;
    let participantsAdded = 0;

    for (const chat of chatSummaries) {
      const { source, sourceThreadId } = parseChatId(chat.chatId);

      // Upsert Thread
      const thread = await prisma.thread.upsert({
        where: {
          userId_source_sourceThreadId: {
            userId,
            source,
            sourceThreadId,
          },
        },
        create: {
          userId,
          source,
          sourceThreadId,
          isGroup: chat.isGroupChat,
          displayName: chat.chatName,
          lastActivityAt: chat.lastActivityAt,
        },
        update: {
          // Update lastActivityAt if newer
          lastActivityAt: chat.lastActivityAt,
          // Update displayName if we have one and the existing is null
          ...(chat.chatName ? { displayName: chat.chatName } : {}),
        },
      });

      threadsCreated++;

      // Link interactions to this thread
      const linked = await prisma.interaction.updateMany({
        where: {
          userId,
          chatId: chat.chatId,
          threadId: null,
        },
        data: {
          threadId: thread.id,
        },
      });
      interactionsLinked += linked.count;

      // Add participants
      const contactIds = await prisma.$queryRaw<{ contactId: string }[]>`
        SELECT DISTINCT "contactId"
        FROM "Interaction"
        WHERE "userId" = ${userId}
          AND "chatId" = ${chat.chatId}
      `;

      for (const { contactId } of contactIds) {
        try {
          await prisma.threadParticipant.upsert({
            where: {
              threadId_contactId: {
                threadId: thread.id,
                contactId,
              },
            },
            create: {
              threadId: thread.id,
              contactId,
            },
            update: {},
          });
          participantsAdded++;
        } catch {
          // Contact may have been deleted — skip
        }
      }
    }

    console.log(
      `[thread-backfill] Created ${threadsCreated} threads, linked ${interactionsLinked} interactions, added ${participantsAdded} participants`,
    );

    return NextResponse.json({ threadsCreated, interactionsLinked, participantsAdded });
  } catch (error) {
    console.error("[POST /api/threads/backfill]", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Backfill failed", detail: message }, { status: 500 });
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function parseChatId(chatId: string): { source: string; sourceThreadId: string } {
  if (chatId.startsWith("imsg-chat:")) {
    return { source: "imessage", sourceThreadId: chatId.replace("imsg-chat:", "") };
  }
  if (chatId.startsWith("gmail:") || chatId.startsWith("email:")) {
    return { source: "gmail", sourceThreadId: chatId.replace(/^(gmail|email):/, "") };
  }
  if (chatId.startsWith("1:1:") && chatId.endsWith(":linkedin")) {
    return { source: "linkedin", sourceThreadId: chatId };
  }
  if (chatId.startsWith("linkedin:")) {
    return { source: "linkedin", sourceThreadId: chatId.replace("linkedin:", "") };
  }
  // Unknown format — use the chatId as-is with source "unknown"
  return { source: "unknown", sourceThreadId: chatId };
}

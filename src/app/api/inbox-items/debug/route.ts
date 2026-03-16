import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getChatDuplicates } from "@/lib/imessage";

const TAPBACK_VERBS = ["Loved", "Liked", "Laughed at", "Emphasized", "Disliked", "Questioned"];
const TAPBACK_SQL_PATTERNS = [
  ...TAPBACK_VERBS.flatMap((v) => [
    `${v} \u201C`,
    `${v} "`,
    `${v} a `,
    `${v} an `,
  ]),
  "(in group chat) Loved",
  "(in group chat) Liked",
  "(in group chat) Laughed at",
  "(in group chat) Emphasized",
  "(in group chat) Disliked",
  "(in group chat) Questioned",
  "Reacted ",
];
const TAPBACK_SQL = TAPBACK_SQL_PATTERNS
  .map((p) => `"summary" NOT LIKE '${p.replace(/'/g, "''")}%'`)
  .join(" AND ");

/**
 * GET /api/inbox-items/debug
 * Diagnostic endpoint for v2 computed inbox
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // 1. chatId stats
  const chatIdStats = await prisma.$queryRaw<
    { total: number; with_chat_id: number; null_chat_id: number }[]
  >`
    SELECT COUNT(*)::int as total,
           COUNT("chatId")::int as with_chat_id,
           (COUNT(*) - COUNT("chatId"))::int as null_chat_id
    FROM "Interaction" WHERE "userId" = ${userId}
  `;

  // 2. chat.db duplication (both group_id AND chat_identifier)
  const chatDupes = await getChatDuplicates();

  // 3. Inbox counts (with and without tapback filter)
  const rawInboxCount = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM (
      SELECT DISTINCT ON ("chatId") "chatId", direction
      FROM "Interaction"
      WHERE "userId" = ${userId} AND "chatId" IS NOT NULL
        AND "occurredAt" > NOW() - INTERVAL '30 days' AND "type" != 'NOTE'
      ORDER BY "chatId", "occurredAt" DESC
    ) sub WHERE direction = 'INBOUND'
  `;
  const filteredInboxCount = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM (
      SELECT DISTINCT ON ("chatId") "chatId", direction
      FROM "Interaction"
      WHERE "userId" = ${userId} AND "chatId" IS NOT NULL
        AND "occurredAt" > NOW() - INTERVAL '30 days' AND "type" != 'NOTE'
        AND (${Prisma.raw(TAPBACK_SQL)})
      ORDER BY "chatId", "occurredAt" DESC
    ) sub WHERE direction = 'INBOUND'
  `;

  // 4. For inbox conversations, check outbound presence with SAME chatId
  const outboundCheck = await prisma.$queryRaw<
    { chatId: string; contactName: string; inbound: number; outbound: number; latest_summary: string }[]
  >`
    WITH inbox_chats AS (
      SELECT sub."chatId", sub."contactId", LEFT(sub.summary, 60) as latest_summary
      FROM (
        SELECT DISTINCT ON ("chatId") "chatId", "contactId", direction, summary
        FROM "Interaction"
        WHERE "userId" = ${userId} AND "chatId" IS NOT NULL
          AND "occurredAt" > NOW() - INTERVAL '30 days' AND "type" != 'NOTE'
        ORDER BY "chatId", "occurredAt" DESC
      ) sub WHERE sub.direction = 'INBOUND'
      LIMIT 15
    )
    SELECT ic."chatId", c.name as "contactName",
      (SELECT COUNT(*)::int FROM "Interaction" WHERE "chatId" = ic."chatId" AND direction = 'INBOUND') as inbound,
      (SELECT COUNT(*)::int FROM "Interaction" WHERE "chatId" = ic."chatId" AND direction = 'OUTBOUND') as outbound,
      ic.latest_summary
    FROM inbox_chats ic
    JOIN "Contact" c ON c.id = ic."contactId"
  `;

  // 5. Look up specific ROWIDs from the fragmentation data to see if they map to same chat
  // Extract ROWID numbers from fragmented chatIds
  const fragChatIds = await prisma.$queryRaw<{ chatId: string; contact_name: string; msg_count: number }[]>`
    SELECT "chatId" as "chatId", c.name as contact_name, COUNT(*)::int as msg_count
    FROM "Interaction" i
    JOIN "Contact" c ON c.id = i."contactId"
    WHERE i."userId" = ${userId}
      AND "chatId" LIKE 'imsg-chat:%'
    GROUP BY "chatId", c.name
    ORDER BY c.name, "chatId"
  `;

  return NextResponse.json({
    chatIdStats: chatIdStats[0],
    chatDbDuplicates: {
      byIdentifier: chatDupes.byIdentifier,
      byGroupId: chatDupes.byGroupId,
      totalChats: chatDupes.allChats.length,
      // Only show chats that are in our fragmented inbox for cross-reference
      relevantChats: chatDupes.allChats.filter((c) =>
        fragChatIds.some((f) => f.chatId === `imsg-chat:${c.rowId}`),
      ),
      error: chatDupes.error,
    },
    inboxCount: {
      withoutTapbackFilter: rawInboxCount[0]?.count ?? 0,
      withTapbackFilter: filteredInboxCount[0]?.count ?? 0,
    },
    outboundDetectionCheck: outboundCheck,
    interactionsByChatId: fragChatIds,
  });
}

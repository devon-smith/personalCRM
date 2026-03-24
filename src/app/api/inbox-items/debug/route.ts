import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getChatDuplicates, getAttributedBodyStats } from "@/lib/imessage";
import { TAPBACK_SQL } from "@/lib/filters";

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

  // 5. iMessage direction breakdown per chatId — the smoking gun check
  const imsgDirections = await prisma.$queryRaw<{
    chatId: string; contact_name: string; inbound: number; outbound: number;
  }[]>`
    SELECT i."chatId" as "chatId", c.name as contact_name,
      SUM(CASE WHEN i.direction = 'INBOUND' THEN 1 ELSE 0 END)::int as inbound,
      SUM(CASE WHEN i.direction = 'OUTBOUND' THEN 1 ELSE 0 END)::int as outbound
    FROM "Interaction" i
    JOIN "Contact" c ON c.id = i."contactId"
    WHERE i."userId" = ${userId}
      AND i."chatId" LIKE 'imsg-chat:%'
    GROUP BY i."chatId", c.name
    ORDER BY outbound DESC, c.name
  `;

  // 6. Total outbound iMessage count
  const outboundTotal = await prisma.$queryRaw<{ total: number; with_chatid: number; null_chatid: number }[]>`
    SELECT COUNT(*)::int as total,
           COUNT("chatId")::int as with_chatid,
           (COUNT(*) - COUNT("chatId"))::int as null_chatid
    FROM "Interaction"
    WHERE "userId" = ${userId}
      AND direction = 'OUTBOUND'
      AND channel IN ('iMessage', 'SMS')
  `;

  // 7. Sample outbound iMessage interactions
  const outboundSamples = await prisma.$queryRaw<{
    chatId: string | null; channel: string; summary: string; contactName: string; occurredAt: Date;
  }[]>`
    SELECT i."chatId", i.channel, LEFT(i.summary, 60) as summary, c.name as "contactName", i."occurredAt"
    FROM "Interaction" i
    JOIN "Contact" c ON c.id = i."contactId"
    WHERE i."userId" = ${userId}
      AND i.direction = 'OUTBOUND'
      AND i.channel IN ('iMessage', 'SMS')
    ORDER BY i."occurredAt" DESC
    LIMIT 15
  `;

  // 8. attributedBody stats — how many messages have text=NULL but content in attributedBody?
  const attributedBodyStats = await getAttributedBodyStats(60);

  // 9. Lilian "Coop" investigation — check if group chat messages leaked into 1:1 chatId
  const lilianContactId = "5a1da19f-f8a0-4a99-b317-2893f6b197c1";
  const lilianCoopMessages = await prisma.interaction.findMany({
    where: {
      userId,
      contactId: lilianContactId,
      summary: { contains: "Coop" },
    },
    select: { chatId: true, summary: true, direction: true, occurredAt: true, sourceId: true },
    orderBy: { occurredAt: "desc" },
    take: 5,
  });
  console.log("[debug] Lilian 'Coop' messages:", JSON.stringify(lilianCoopMessages, null, 2));

  // 10. All distinct chatIds for Lilian's interactions
  const lilianChatIds = await prisma.interaction.groupBy({
    by: ["chatId"],
    where: {
      userId,
      contactId: lilianContactId,
      chatId: { not: null },
    },
    _count: true,
    orderBy: { _count: { chatId: "desc" } },
  });
  console.log("[debug] Lilian chatId distribution:", JSON.stringify(lilianChatIds, null, 2));

  return NextResponse.json({
    chatIdStats: chatIdStats[0],
    attributedBodyStats,
    chatDbDuplicates: {
      byIdentifier: chatDupes.byIdentifier,
      byGroupId: chatDupes.byGroupId,
      totalChats: chatDupes.allChats.length,
      // Only show chats that are in our DB interactions for cross-reference
      relevantChats: chatDupes.allChats.filter((c) =>
        imsgDirections.some((f: { chatId: string }) => f.chatId === `imsg-chat:${c.rowId}`),
      ),
      error: chatDupes.error,
    },
    inboxCount: {
      withoutTapbackFilter: rawInboxCount[0]?.count ?? 0,
      withTapbackFilter: filteredInboxCount[0]?.count ?? 0,
    },
    outboundDetectionCheck: outboundCheck,
    imsgDirections: imsgDirections,
    outboundImsgTotal: outboundTotal[0],
    outboundImsgSamples: outboundSamples,
    lilianInvestigation: {
      coopMessages: lilianCoopMessages,
      chatIdDistribution: lilianChatIds,
    },
  });
}

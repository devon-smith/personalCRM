import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/interactions/cleanup
 *
 * Preview what would be cleaned up — old daily summary interactions
 * without real message content.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Find interactions that are old-style daily summaries (no real content)
  // These have patterns like:
  //   sourceId: "imsg:{handleId}:{date}" (old daily format)
  //   summary: "N messages (X sent, Y received)"
  //   subject: "iMessage conversation" or "SMS conversation"
  const oldDailySummaries = await prisma.interaction.count({
    where: {
      userId,
      type: "MESSAGE",
      sourceId: { startsWith: "imsg:" },
      NOT: { sourceId: { startsWith: "imsg-ind:" } },
    },
  });

  // Find interactions with boilerplate summaries (CSV-style or daily summary)
  const boilerplateSummaries = await prisma.interaction.count({
    where: {
      userId,
      type: "MESSAGE",
      OR: [
        { summary: { contains: "messages (" } },       // "N messages (X sent, Y received)"
        { summary: { contains: "message (" } },         // "1 message (0 sent, 1 received)"
      ],
    },
  });

  // Total interactions with real content
  const realContent = await prisma.interaction.count({
    where: {
      userId,
      type: "MESSAGE",
      sourceId: { startsWith: "imsg-ind:" },
    },
  });

  const notionContent = await prisma.interaction.count({
    where: {
      userId,
      type: "MESSAGE",
      sourceId: { startsWith: "notion:" },
    },
  });

  return NextResponse.json({
    oldDailySummaries,
    boilerplateSummaries,
    realMessageContent: realContent,
    notionContent,
    wouldDelete: boilerplateSummaries,
    safe: realContent + notionContent,
  });
}

/**
 * POST /api/interactions/cleanup
 *
 * Removes old daily summary interactions that don't have real message
 * content. Keeps individual messages (imsg-ind:) and Notion messages.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Delete interactions with boilerplate summary patterns
  // These are daily summaries like "5 messages (2 sent, 3 received)"
  const deletedBoilerplate = await prisma.interaction.deleteMany({
    where: {
      userId,
      type: "MESSAGE",
      OR: [
        { summary: { contains: "messages (" } },
        { summary: { contains: "message (" } },
      ],
    },
  });

  console.log(
    `[cleanup] Deleted ${deletedBoilerplate.count} boilerplate summary interactions`,
  );

  // Update lastInteraction for all affected contacts
  const contacts = await prisma.contact.findMany({
    where: { userId, lastInteraction: { not: null } },
    select: { id: true },
  });

  let updated = 0;
  for (const c of contacts) {
    const latest = await prisma.interaction.findFirst({
      where: { contactId: c.id },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    });
    await prisma.contact.update({
      where: { id: c.id },
      data: { lastInteraction: latest?.occurredAt ?? null },
    });
    updated++;
  }

  return NextResponse.json({
    deleted: deletedBoilerplate.count,
    contactsUpdated: updated,
  });
}

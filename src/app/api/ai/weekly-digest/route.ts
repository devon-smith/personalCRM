import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateWeeklyDigest } from "@/lib/ai-insights";
import { getOverdueContacts } from "@/lib/followups";

function getWeekStart(): Date {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());
  start.setHours(0, 0, 0, 0);
  return start;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const weekStart = getWeekStart();

  // Check for cached digest this week
  const cached = await prisma.weeklyDigest.findFirst({
    where: {
      userId,
      weekStart: { gte: weekStart },
    },
    orderBy: { createdAt: "desc" },
  });

  if (cached) {
    try {
      return NextResponse.json({
        digest: JSON.parse(cached.content),
        cached: true,
        generatedAt: cached.createdAt,
      });
    } catch {
      // corrupted cache, regenerate
    }
  }

  // Gather data for digest
  const [contacts, recentInteractions, overdueContacts, newContactsCount] =
    await Promise.all([
      prisma.contact.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          company: true,
          tier: true,
          lastInteraction: true,
        },
      }),
      prisma.interaction.findMany({
        where: { userId, occurredAt: { gte: weekStart } },
        include: { contact: { select: { name: true } } },
        orderBy: { occurredAt: "desc" },
        take: 20,
      }),
      getOverdueContacts(userId),
      prisma.contact.count({
        where: { userId, createdAt: { gte: weekStart } },
      }),
    ]);

  const interactionsForDigest = recentInteractions.map((i) => ({
    contactName: i.contact.name,
    type: i.type,
    direction: i.direction,
    summary: i.summary,
    occurredAt: i.occurredAt,
  }));

  const digest = await generateWeeklyDigest(
    contacts,
    interactionsForDigest,
    overdueContacts.length,
    newContactsCount
  );

  // Cache the digest
  await prisma.weeklyDigest.create({
    data: {
      userId,
      content: JSON.stringify(digest),
      weekStart,
    },
  });

  return NextResponse.json({
    digest,
    cached: false,
    generatedAt: new Date(),
  });
}

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getOverdueContacts } from "@/lib/followups";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    contactsByTier,
    contactsThisMonth,
    interactionsThisWeek,
    recentInteractions,
    overdueContacts,
    circles,
    recentlyActiveContacts,
    contactsBySource,
  ] = await Promise.all([
    prisma.contact.groupBy({
      by: ["tier"],
      where: { userId },
      _count: true,
    }),
    prisma.contact.count({
      where: { userId, createdAt: { gte: startOfMonth } },
    }),
    prisma.interaction.count({
      where: { userId, occurredAt: { gte: startOfWeek } },
    }),
    prisma.interaction.findMany({
      where: { userId },
      orderBy: { occurredAt: "desc" },
      take: 10,
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            company: true,
            tier: true,
            source: true,
          },
        },
      },
    }),
    getOverdueContacts(userId),
    prisma.circle.findMany({
      where: { userId },
      include: { _count: { select: { contacts: true } } },
      orderBy: { sortOrder: "asc" },
    }),
    // Contacts with the most recent interactions (relationship pulse)
    prisma.contact.findMany({
      where: {
        userId,
        lastInteraction: { gte: thirtyDaysAgo },
      },
      orderBy: { lastInteraction: "desc" },
      take: 10,
      include: {
        _count: { select: { interactions: true } },
        interactions: {
          orderBy: { occurredAt: "desc" },
          take: 1,
          select: { type: true, summary: true, occurredAt: true },
        },
      },
    }),
    // Contacts grouped by source
    prisma.contact.groupBy({
      by: ["source"],
      where: { userId },
      _count: true,
    }),
  ]);

  const tierCounts: Record<string, number> = {
    INNER_CIRCLE: 0,
    PROFESSIONAL: 0,
    ACQUAINTANCE: 0,
  };
  for (const t of contactsByTier) {
    tierCounts[t.tier] = t._count;
  }

  const circleSummary = circles.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    icon: c.icon,
    contactCount: c._count.contacts,
  }));

  const recentlyActive = recentlyActiveContacts.map((c) => {
    const lastInt = c.interactions[0] ?? null;
    return {
      id: c.id,
      name: c.name,
      company: c.company,
      tier: c.tier,
      source: c.source,
      interactionCount: c._count.interactions,
      lastInteraction: c.lastInteraction?.toISOString() ?? null,
      lastInteractionType: lastInt?.type ?? null,
      lastInteractionSummary: lastInt?.summary ?? null,
    };
  });

  const sourceCounts: Record<string, number> = {};
  for (const s of contactsBySource) {
    sourceCounts[s.source] = s._count;
  }

  return NextResponse.json({
    tierCounts,
    contactsThisMonth,
    interactionsThisWeek,
    totalContacts: Object.values(tierCounts).reduce((a, b) => a + b, 0),
    recentInteractions,
    overdueContacts: overdueContacts.slice(0, 5),
    overdueCount: overdueContacts.length,
    circles: circleSummary,
    recentlyActive,
    sourceCounts,
  });
}

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getOverdueContacts } from "@/lib/followups";

const EXCLUDED_MESSAGE_CHANNELS = ["iMessage", "SMS"];

const dashboardInteractionWhere = {
  NOT: [
    { channel: { in: EXCLUDED_MESSAGE_CHANNELS } },
    { sourceId: { startsWith: "imsg" } },
    { sourceId: { startsWith: "manual-reply:" } },
  ],
};

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
      where: {
        userId,
        occurredAt: { gte: startOfWeek },
        ...dashboardInteractionWhere,
      },
    }),
    // Recent interactions — one per contact, showing latest
    prisma.contact.findMany({
      where: {
        userId,
        interactions: { some: dashboardInteractionWhere },
      },
      orderBy: { lastInteraction: "desc" },
      take: 40,
      select: {
        id: true,
        name: true,
        company: true,
        tier: true,
        source: true,
        lastInteraction: true,
        circles: {
          select: {
            circle: { select: { id: true, name: true, color: true } },
          },
        },
        interactions: {
          where: dashboardInteractionWhere,
          orderBy: { occurredAt: "desc" },
          take: 1,
          select: {
            id: true,
            type: true,
            direction: true,
            channel: true,
            subject: true,
            summary: true,
            occurredAt: true,
          },
        },
        _count: {
          select: {
            interactions: { where: dashboardInteractionWhere },
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
    // Strongest relationships — by recent interaction volume (last 30 days)
    prisma.contact.findMany({
      where: {
        userId,
        interactions: {
          some: {
            occurredAt: { gte: thirtyDaysAgo },
            ...dashboardInteractionWhere,
          },
        },
      },
      orderBy: { lastInteraction: "desc" },
      take: 40,
      select: {
        id: true,
        name: true,
        company: true,
        tier: true,
        source: true,
        lastInteraction: true,
        _count: { select: { interactions: { where: dashboardInteractionWhere } } },
        interactions: {
          where: dashboardInteractionWhere,
          orderBy: { occurredAt: "desc" },
          take: 1,
          select: { type: true, summary: true, occurredAt: true },
        },
        circles: {
          select: {
            circle: { select: { id: true, name: true, color: true } },
          },
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

  const recentlyActive = recentlyActiveContacts
    .map((c) => {
      const lastInt = c.interactions[0] ?? null;
      return {
        id: c.id,
        name: c.name,
        company: c.company,
        tier: c.tier,
        source: c.source,
        interactionCount: c._count.interactions,
        lastInteraction: lastInt?.occurredAt.toISOString() ?? null,
        lastInteractionType: lastInt?.type ?? null,
        lastInteractionSummary: lastInt?.summary ?? null,
        circles: c.circles.map((cc) => ({
          id: cc.circle.id,
          name: cc.circle.name,
          color: cc.circle.color,
        })),
      };
    })
    .sort((a, b) => b.interactionCount - a.interactionCount)
    .slice(0, 5);

  const sourceCounts: Record<string, number> = {};
  for (const s of contactsBySource) {
    sourceCounts[s.source] = s._count;
  }

  // Transform recent contacts into the recentInteractions shape the frontend expects
  const recentInteractionsFormatted = recentInteractions
    .filter((c) => c.interactions.length > 0)
    .map((c) => {
      const latest = c.interactions[0];
      return {
        id: latest.id,
        type: latest.type,
        subject: latest.subject,
        summary: latest.summary,
        occurredAt: latest.occurredAt.toISOString(),
        direction: latest.direction,
        channel: latest.channel,
        messageCount: c._count.interactions,
        contact: {
          id: c.id,
          name: c.name,
          company: c.company,
          tier: c.tier,
          source: c.source,
          circles: c.circles,
        },
      };
    })
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, 8);

  return NextResponse.json({
    tierCounts,
    contactsThisMonth,
    interactionsThisWeek,
    totalContacts: Object.values(tierCounts).reduce((a, b) => a + b, 0),
    recentInteractions: recentInteractionsFormatted,
    overdueContacts: overdueContacts.slice(0, 5),
    overdueCount: overdueContacts.length,
    circles: circleSummary,
    recentlyActive,
    sourceCounts,
  });
}

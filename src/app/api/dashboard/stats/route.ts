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

  const [
    contactsByTier,
    contactsThisMonth,
    interactionsThisWeek,
    pipelineCounts,
    recentInteractions,
    overdueContacts,
    upcomingDeadlines,
  ] = await Promise.all([
    // Contacts by tier
    prisma.contact.groupBy({
      by: ["tier"],
      where: { userId },
      _count: true,
    }),
    // Contacts added this month
    prisma.contact.count({
      where: { userId, createdAt: { gte: startOfMonth } },
    }),
    // Interactions this week
    prisma.interaction.count({
      where: { userId, occurredAt: { gte: startOfWeek } },
    }),
    // Pipeline counts by status
    prisma.jobApplication.groupBy({
      by: ["status"],
      where: { userId },
      _count: true,
    }),
    // Recent interactions
    prisma.interaction.findMany({
      where: { userId },
      orderBy: { occurredAt: "desc" },
      take: 10,
      include: {
        contact: { select: { id: true, name: true } },
      },
    }),
    // Overdue follow-ups
    getOverdueContacts(userId),
    // Upcoming deadlines
    prisma.jobApplication.findMany({
      where: {
        userId,
        deadline: { gte: now },
        status: { notIn: ["REJECTED", "CLOSED"] },
      },
      orderBy: { deadline: "asc" },
      take: 5,
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

  const pipelineData = pipelineCounts.map((p) => ({
    status: p.status,
    count: p._count,
  }));

  return NextResponse.json({
    tierCounts,
    contactsThisMonth,
    interactionsThisWeek,
    totalContacts: Object.values(tierCounts).reduce((a, b) => a + b, 0),
    pipelineData,
    recentInteractions,
    overdueContacts: overdueContacts.slice(0, 5),
    overdueCount: overdueContacts.length,
    upcomingDeadlines,
  });
}

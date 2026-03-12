/**
 * Circle Health Analytics
 *
 * Provides rich health metrics for each circle:
 * warmth breakdown, trends, most active/neglected contacts,
 * unresponded emails, and pending action items.
 */

import { prisma } from "./prisma";

// ─── Types ──────────────────────────────────────────────────

export interface CircleHealth {
  circleId: string;
  circleName: string;
  color: string;
  totalContacts: number;
  warmthBreakdown: { good: number; mid: number; cold: number; none: number };
  interactionsThisWeek: number;
  interactionsThisMonth: number;
  mostActiveContact: { name: string; interactionCount: number } | null;
  mostNeglectedContact: { name: string; daysSinceContact: number } | null;
  actionItems: number;
  avgDaysBetweenInteractions: number | null;
  trend: "improving" | "stable" | "declining";
}

// ─── Main functions ─────────────────────────────────────────

export async function getCircleHealth(
  circleId: string,
  userId: string,
): Promise<CircleHealth | null> {
  const circle = await prisma.circle.findFirst({
    where: { id: circleId, userId },
    select: {
      id: true,
      name: true,
      color: true,
      followUpDays: true,
      contacts: {
        select: {
          contact: {
            select: {
              id: true,
              name: true,
              lastInteraction: true,
              importedAt: true,
            },
          },
        },
      },
    },
  });

  if (!circle) return null;

  const contactIds = circle.contacts.map((cc) => cc.contact.id);
  if (contactIds.length === 0) {
    return {
      circleId: circle.id,
      circleName: circle.name,
      color: circle.color,
      totalContacts: 0,
      warmthBreakdown: { good: 0, mid: 0, cold: 0, none: 0 },
      interactionsThisWeek: 0,
      interactionsThisMonth: 0,
      mostActiveContact: null,
      mostNeglectedContact: null,
      actionItems: 0,
      avgDaysBetweenInteractions: null,
      trend: "stable",
    };
  }

  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // Warmth breakdown
  const warmth = { good: 0, mid: 0, cold: 0, none: 0 };
  let mostNeglected: { name: string; daysSinceContact: number } | null = null;

  for (const cc of circle.contacts) {
    const c = cc.contact;
    if (!c.lastInteraction) {
      warmth.none++;
      const daysImported = c.importedAt
        ? Math.floor((now.getTime() - c.importedAt.getTime()) / (1000 * 60 * 60 * 24))
        : 999;
      if (!mostNeglected || daysImported > mostNeglected.daysSinceContact) {
        mostNeglected = { name: c.name, daysSinceContact: daysImported };
      }
      continue;
    }

    const daysSince = Math.floor(
      (now.getTime() - c.lastInteraction.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysSince <= circle.followUpDays) warmth.good++;
    else if (daysSince <= circle.followUpDays * 1.5) warmth.mid++;
    else warmth.cold++;

    if (!mostNeglected || daysSince > mostNeglected.daysSinceContact) {
      mostNeglected = { name: c.name, daysSinceContact: daysSince };
    }
  }

  // Interaction counts
  const [weekCount, monthCount, prevMonthCount] = await Promise.all([
    prisma.interaction.count({
      where: { contactId: { in: contactIds }, userId, occurredAt: { gte: oneWeekAgo } },
    }),
    prisma.interaction.count({
      where: { contactId: { in: contactIds }, userId, occurredAt: { gte: thirtyDaysAgo } },
    }),
    prisma.interaction.count({
      where: {
        contactId: { in: contactIds },
        userId,
        occurredAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
      },
    }),
  ]);

  // Most active contact (by interaction count last 30 days)
  const activeContacts = await prisma.interaction.groupBy({
    by: ["contactId"],
    where: { contactId: { in: contactIds }, userId, occurredAt: { gte: thirtyDaysAgo } },
    _count: { _all: true },
    orderBy: { _count: { contactId: "desc" } },
    take: 1,
  });

  let mostActive: CircleHealth["mostActiveContact"] = null;
  if (activeContacts.length > 0) {
    const activeContact = circle.contacts.find(
      (cc) => cc.contact.id === activeContacts[0].contactId,
    );
    if (activeContact) {
      mostActive = {
        name: activeContact.contact.name,
        interactionCount: activeContacts[0]._count._all,
      };
    }
  }

  // Action item count
  const actionItems = await prisma.actionItem.count({
    where: { userId, contactId: { in: contactIds }, status: "OPEN" },
  });

  // Average days between interactions
  let avgDays: number | null = null;
  if (monthCount > 0 && contactIds.length > 0) {
    const contactsWithInteractions = new Set(
      activeContacts.map((a) => a.contactId),
    );
    if (contactsWithInteractions.size > 0) {
      avgDays = Math.round(30 / (monthCount / contactsWithInteractions.size));
    }
  }

  // Trend: compare this 30 days vs previous 30 days
  let trend: CircleHealth["trend"] = "stable";
  if (monthCount > prevMonthCount * 1.2) trend = "improving";
  else if (monthCount < prevMonthCount * 0.8) trend = "declining";

  return {
    circleId: circle.id,
    circleName: circle.name,
    color: circle.color,
    totalContacts: contactIds.length,
    warmthBreakdown: warmth,
    interactionsThisWeek: weekCount,
    interactionsThisMonth: monthCount,
    mostActiveContact: mostActive,
    mostNeglectedContact: mostNeglected,
    actionItems,
    avgDaysBetweenInteractions: avgDays,
    trend,
  };
}

export async function getAllCircleHealth(
  userId: string,
): Promise<CircleHealth[]> {
  const circles = await prisma.circle.findMany({
    where: { userId },
    select: { id: true },
    orderBy: { sortOrder: "asc" },
  });

  const results: CircleHealth[] = [];
  for (const circle of circles) {
    const health = await getCircleHealth(circle.id, userId);
    if (health) results.push(health);
  }

  // Sort by most action-needing first
  return results.sort((a, b) => {
    // Circles with action items first
    if (a.actionItems !== b.actionItems) return b.actionItems - a.actionItems;
    // Then by cold contacts
    const aCold = a.warmthBreakdown.cold + a.warmthBreakdown.none;
    const bCold = b.warmthBreakdown.cold + b.warmthBreakdown.none;
    return bCold - aCold;
  });
}

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

  /**
   * Breadth-based health (0-100). Percentage of circle members who have
   * had any interaction in the last 12 months, weighted by tier (Inner
   * Circle 3x, Professional 2x, Acquaintance 1x). Replaces the old
   * cadence-based "fraction of contacts hit in time" framing — measures
   * "is this circle alive" rather than "have I hit my cadence target".
   */
  breadthScore: number;

  /**
   * Contacts whose recent (last 30 days) interaction rate has dropped
   * meaningfully vs. their prior baseline (days 31-90). Sorted by drift
   * magnitude descending; top 3 surface as "Reignite this circle"
   * suggestions on the UI. Empty when nobody qualifies.
   */
  driftingContacts: Array<{
    contactId: string;
    name: string;
    /** 0..1; 1.0 = went from active to zero in the recent window. */
    driftMagnitude: number;
    daysSinceLastInteraction: number | null;
  }>;
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
              tier: true,
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
      breadthScore: 0,
      driftingContacts: [],
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

  // Breadth-based health + drift detection. These supplement the
  // cadence-based warmth above with metrics that ask "is this circle
  // alive?" rather than "did I hit my follow-up target?".
  const { breadthScore, driftingContacts } = await computeBreadthAndDrift(
    userId,
    circle.contacts.map((cc) => cc.contact),
  );

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
    breadthScore,
    driftingContacts,
  };
}

// ─── Breadth + drift computation ────────────────────────────

interface CircleContact {
  id: string;
  name: string;
  tier: string;
  lastInteraction: Date | null;
}

const TIER_WEIGHT: Record<string, number> = {
  INNER_CIRCLE: 3,
  PROFESSIONAL: 2,
  ACQUAINTANCE: 1,
};

/**
 * Pure breadth-score calculation. Exported for unit testing.
 * Returns 0..100.
 */
export function computeBreadthScore(
  contacts: Array<{ tier: string; lastInteraction: Date | null }>,
  windowMs: number = 365 * 86_400_000,
  now: number = Date.now(),
): number {
  if (contacts.length === 0) return 0;
  const cutoff = new Date(now - windowMs);
  let weightedActive = 0;
  let weightedTotal = 0;
  for (const c of contacts) {
    const w = TIER_WEIGHT[c.tier] ?? 1;
    weightedTotal += w;
    if (c.lastInteraction && c.lastInteraction >= cutoff) {
      weightedActive += w;
    }
  }
  return weightedTotal > 0
    ? Math.round((weightedActive / weightedTotal) * 100)
    : 0;
}

/**
 * Pure drift classification. Returns whether a contact qualifies as
 * "drifting" + the magnitude (0..1, higher = more drift).
 */
export function classifyDrift(
  recentCount: number,
  priorCount: number,
  recentWindowDays: number = 30,
  priorWindowDays: number = 60,
): { drifting: boolean; magnitude: number } {
  const recentRate = recentCount / recentWindowDays;
  const priorRate = priorCount / priorWindowDays;
  // Floor below which the baseline is too small to draw drift conclusions
  // from. 0.1/day = 6 interactions over 60 days.
  if (priorRate < 0.1) return { drifting: false, magnitude: 0 };
  if (recentRate >= priorRate * 0.5) return { drifting: false, magnitude: 0 };
  return {
    drifting: true,
    magnitude: Math.min(1, 1 - recentRate / priorRate),
  };
}

/**
 * Compute the breadth health metric + identify drifting contacts.
 * Runs one grouped count to avoid an N+1 over circle members.
 */
async function computeBreadthAndDrift(
  userId: string,
  contacts: CircleContact[],
): Promise<{
  breadthScore: number;
  driftingContacts: CircleHealth["driftingContacts"];
}> {
  if (contacts.length === 0) return { breadthScore: 0, driftingContacts: [] };

  const now = Date.now();
  const thirtyDaysAgo = new Date(now - 30 * 86_400_000);
  const ninetyDaysAgo = new Date(now - 90 * 86_400_000);

  // Breadth: weighted fraction of contacts with any interaction in the
  // last 12 months. Pure helper so the math is unit-testable.
  const breadthScore = computeBreadthScore(contacts);

  // Drift: group interactions per contact for recent (0-30) and prior
  // (31-90) windows in one grouped query each. The prior window is
  // intentionally 2x the recent window so a single quiet week doesn't
  // dominate the baseline.
  const contactIds = contacts.map((c) => c.id);
  const [recent, prior] = await Promise.all([
    prisma.interaction.groupBy({
      by: ["contactId"],
      where: {
        userId,
        contactId: { in: contactIds },
        occurredAt: { gte: thirtyDaysAgo },
      },
      _count: { _all: true },
    }),
    prisma.interaction.groupBy({
      by: ["contactId"],
      where: {
        userId,
        contactId: { in: contactIds },
        occurredAt: { gte: ninetyDaysAgo, lt: thirtyDaysAgo },
      },
      _count: { _all: true },
    }),
  ]);

  const recentByContact = new Map(recent.map((r) => [r.contactId, r._count._all]));
  const priorByContact = new Map(prior.map((p) => [p.contactId, p._count._all]));

  const driftingContacts: CircleHealth["driftingContacts"] = [];
  for (const c of contacts) {
    const recentCount = recentByContact.get(c.id) ?? 0;
    const priorCount = priorByContact.get(c.id) ?? 0;
    const drift = classifyDrift(recentCount, priorCount);
    if (!drift.drifting) continue;

    const daysSinceLastInteraction = c.lastInteraction
      ? Math.floor((now - c.lastInteraction.getTime()) / 86_400_000)
      : null;

    driftingContacts.push({
      contactId: c.id,
      name: c.name,
      driftMagnitude: drift.magnitude,
      daysSinceLastInteraction,
    });
  }

  driftingContacts.sort((a, b) => b.driftMagnitude - a.driftMagnitude);
  return { breadthScore, driftingContacts: driftingContacts.slice(0, 3) };
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

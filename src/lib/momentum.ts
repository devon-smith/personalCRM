import { prisma } from "@/lib/prisma";

export type MomentumTrend = "accelerating" | "steady" | "slowing" | "fading" | "inactive";

export interface ContactMomentum {
  readonly contactId: string;
  /** Interactions per 2-week bucket, oldest→newest (6 buckets = 12 weeks) */
  readonly sparkline: readonly number[];
  readonly trend: MomentumTrend;
  /** -1 (fading fast) to +1 (accelerating fast) */
  readonly velocity: number;
}

/**
 * Compute interaction momentum for a set of contacts.
 * Buckets interactions into 6 two-week periods over the last 12 weeks
 * and calculates the velocity/trend of the relationship.
 */
export async function getContactMomentum(
  userId: string,
  contactIds?: readonly string[],
): Promise<readonly ContactMomentum[]> {
  const now = new Date();
  const twelveWeeksAgo = new Date(now);
  twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84); // 12 weeks

  const where = {
    userId,
    occurredAt: { gte: twelveWeeksAgo },
    ...(contactIds ? { contactId: { in: [...contactIds] } } : {}),
  };

  const interactions = await prisma.interaction.findMany({
    where,
    select: { contactId: true, occurredAt: true },
    orderBy: { occurredAt: "asc" },
  });

  // Group by contact
  const byContact = new Map<string, Date[]>();
  for (const i of interactions) {
    const dates = byContact.get(i.contactId) ?? [];
    dates.push(i.occurredAt);
    byContact.set(i.contactId, dates);
  }

  // If specific contactIds requested, include ones with no interactions
  const allIds = contactIds
    ? contactIds
    : [...byContact.keys()];

  const results: ContactMomentum[] = [];

  for (const contactId of allIds) {
    const dates = byContact.get(contactId) ?? [];

    // Build 6 two-week buckets
    const buckets = [0, 0, 0, 0, 0, 0];
    for (const date of dates) {
      const daysAgo = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
      const bucketIdx = Math.min(5, Math.floor(daysAgo / 14));
      // Reverse so index 0 = oldest, 5 = most recent
      buckets[5 - bucketIdx]++;
    }

    const velocity = computeVelocity(buckets);
    const trend = classifyTrend(buckets, velocity);

    results.push({
      contactId,
      sparkline: buckets,
      trend,
      velocity,
    });
  }

  return results;
}

/**
 * Weighted linear regression of buckets to get velocity.
 * Returns -1 to +1 normalized value.
 */
function computeVelocity(buckets: readonly number[]): number {
  const n = buckets.length;
  const total = buckets.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;

  // Weight recent buckets more heavily
  let weightedSum = 0;
  let weightTotal = 0;
  for (let i = 0; i < n; i++) {
    const weight = i + 1; // 1..6, newer = higher
    weightedSum += buckets[i] * weight;
    weightTotal += weight;
  }

  const weightedAvg = weightedSum / weightTotal;
  const simpleAvg = total / n;

  if (simpleAvg === 0) return 0;

  // Ratio > 1 means accelerating, < 1 means decelerating
  const ratio = weightedAvg / simpleAvg;
  // Normalize to [-1, 1] range
  return Math.max(-1, Math.min(1, (ratio - 1) * 2));
}

function classifyTrend(
  buckets: readonly number[],
  velocity: number,
): MomentumTrend {
  const total = buckets.reduce((a, b) => a + b, 0);
  if (total === 0) return "inactive";

  const recentHalf = buckets[4] + buckets[5];
  const olderHalf = buckets[0] + buckets[1];

  if (velocity > 0.3) return "accelerating";
  if (velocity < -0.3 && recentHalf === 0) return "fading";
  if (velocity < -0.15) return "slowing";
  return "steady";
}

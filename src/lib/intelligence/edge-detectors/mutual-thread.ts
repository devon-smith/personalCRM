/**
 * Mutual-thread edge detector (M7.2).
 *
 * Two contacts share a `mutual_thread` edge if they both appear as
 * ThreadParticipants on the same Thread. Subsumes co-meeting
 * detection (calendar-source threads) and mutual-email-thread
 * detection in one query.
 *
 * Strength is a function of:
 *   - how recent the most recent shared thread was (decays over time)
 *   - how many distinct shared threads they have (caps at 5 for
 *     diminishing returns)
 */

import type { PrismaClient } from "@/generated/prisma/client";
import type { EdgeProposal } from ".";

const SINCE_DAYS_DEFAULT = 365; // re-scan threads from the last year

export interface DetectMutualThreadParams {
  prisma: PrismaClient;
  userId: string;
  /** Optional override for how far back to look (epoch ms). */
  sinceMs?: number;
}

export async function detectMutualThreadEdges(
  params: DetectMutualThreadParams,
): Promise<EdgeProposal[]> {
  const { prisma, userId } = params;
  const since = params.sinceMs
    ? new Date(params.sinceMs)
    : new Date(Date.now() - SINCE_DAYS_DEFAULT * 24 * 60 * 60 * 1000);

  // Pull all threads touched within the window with their participants.
  const threads = await prisma.thread.findMany({
    where: { userId, lastActivityAt: { gte: since } },
    select: {
      id: true,
      source: true,
      lastActivityAt: true,
      participants: { select: { contactId: true } },
    },
  });

  // Accumulate: pair → { observationCount, mostRecent, threadIds }
  interface Accumulator {
    observationCount: number;
    mostRecent: Date;
    threadIds: string[];
    sources: Set<string>;
  }
  const pairMap = new Map<string, Accumulator>();

  for (const thread of threads) {
    const participants = thread.participants.map((p) => p.contactId);
    if (participants.length < 2) continue;
    // All 2-combinations within this thread.
    for (let i = 0; i < participants.length; i++) {
      for (let j = i + 1; j < participants.length; j++) {
        const a = participants[i];
        const b = participants[j];
        if (a === b) continue;
        const key = pairKey(a, b);
        const acc = pairMap.get(key);
        if (acc) {
          acc.observationCount++;
          if (thread.lastActivityAt > acc.mostRecent) {
            acc.mostRecent = thread.lastActivityAt;
          }
          if (acc.threadIds.length < 10) acc.threadIds.push(thread.id);
          acc.sources.add(thread.source);
        } else {
          pairMap.set(key, {
            observationCount: 1,
            mostRecent: thread.lastActivityAt,
            threadIds: [thread.id],
            sources: new Set([thread.source]),
          });
        }
      }
    }
  }

  const proposals: EdgeProposal[] = [];
  for (const [key, acc] of pairMap) {
    const [contactA, contactB] = unpairKey(key);
    proposals.push({
      contactA,
      contactB,
      edgeType: "mutual_thread",
      strength: scoreStrength(acc.observationCount, acc.mostRecent),
      evidence: {
        observationCount: acc.observationCount,
        threadIds: acc.threadIds,
        sources: Array.from(acc.sources),
        lastActivityAt: acc.mostRecent.toISOString(),
      },
    });
  }
  return proposals;
}

// ─── Pure helpers (exported for testing) ───────────────────

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

export function unpairKey(key: string): [string, string] {
  const idx = key.indexOf("::");
  return [key.slice(0, idx), key.slice(idx + 2)];
}

/**
 * Strength = recency_factor × count_factor, both 0-1.
 * - recency: 1.0 if within 30 days, decays linearly to 0.3 at 1 year
 * - count: log-scale, caps at 5 shared threads = 1.0
 */
export function scoreStrength(observationCount: number, mostRecent: Date): number {
  const daysAgo = (Date.now() - mostRecent.getTime()) / (24 * 60 * 60 * 1000);
  const recencyFactor =
    daysAgo <= 30 ? 1.0 : Math.max(0.3, 1.0 - (daysAgo - 30) / 365);
  const countFactor = Math.min(1.0, Math.log2(observationCount + 1) / Math.log2(6));
  return Math.round(recencyFactor * countFactor * 100) / 100;
}

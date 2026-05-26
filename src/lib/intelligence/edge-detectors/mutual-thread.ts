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
 *   - how much volume (total interactions) the shared threads carry —
 *     two contacts in a single 50-message thread should rank above two
 *     contacts in five threads of 1 message each. (M0.8)
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

  // Pull all threads touched within the window with their participants
  // and an interaction count. _count is one round-trip so the volume
  // signal doesn't cost us a second query per thread.
  const threads = await prisma.thread.findMany({
    where: { userId, lastActivityAt: { gte: since } },
    select: {
      id: true,
      source: true,
      lastActivityAt: true,
      participants: { select: { contactId: true } },
      _count: { select: { interactions: true } },
    },
  });

  interface Accumulator {
    observationCount: number;
    mostRecent: Date;
    threadIds: string[];
    sources: Set<string>;
    totalInteractions: number;
  }
  const pairMap = new Map<string, Accumulator>();

  for (const thread of threads) {
    const participants = thread.participants.map((p) => p.contactId);
    if (participants.length < 2) continue;
    const threadInteractions = thread._count.interactions;
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
          acc.totalInteractions += threadInteractions;
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
            totalInteractions: threadInteractions,
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
      strength: scoreStrength(
        acc.observationCount,
        acc.mostRecent,
        acc.totalInteractions,
      ),
      evidence: {
        observationCount: acc.observationCount,
        interactionCount: acc.totalInteractions,
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
 * Strength = recency × count × volume, each in [0, 1].
 *
 * - recency: 1.0 if within 30 days, decays linearly to 0.3 at 1 year
 * - count: log-scale, caps at 5 shared threads = 1.0
 * - volume (M0.8): floors at 0.5 for low totals, ramps to 1.0 at 50+
 *   interactions across the shared threads. Two contacts in one
 *   60-message thread now outrank two contacts in two 1-message
 *   threads — the count factor alone gave the latter twice the score,
 *   which underweighted the relationship signal in long threads.
 *
 * `totalInteractions` is optional so existing callers that don't have
 * the volume signal (older tests, direct unit-test usage) still get
 * the prior pair-count × recency behavior; the volume factor defaults
 * to 1.0 in that path.
 */
export function scoreStrength(
  observationCount: number,
  mostRecent: Date,
  totalInteractions?: number,
): number {
  const daysAgo = (Date.now() - mostRecent.getTime()) / (24 * 60 * 60 * 1000);
  const recencyFactor =
    daysAgo <= 30 ? 1.0 : Math.max(0.3, 1.0 - (daysAgo - 30) / 365);
  const countFactor = Math.min(1.0, Math.log2(observationCount + 1) / Math.log2(6));
  const volumeFactor =
    totalInteractions === undefined
      ? 1.0
      : volumeStrengthFactor(totalInteractions);
  return Math.round(recencyFactor * countFactor * volumeFactor * 100) / 100;
}

/**
 * Volume factor: 0.5 floor (so a missing volume signal can't zero
 * out a strong recency × count signal), ramps log-shape up to 1.0
 * at 50 interactions. Scaled from `totalInteractions / 10` so the
 * curve hits 1.0 at exactly 50.
 *
 * Exported for tests + reuse if other edge types want the same shape.
 */
export function volumeStrengthFactor(totalInteractions: number): number {
  if (totalInteractions <= 0) return 0.5;
  const x = totalInteractions / 10;
  const ramp = Math.log2(x + 1) / Math.log2(6);
  return Math.min(1.0, 0.5 + 0.5 * ramp);
}

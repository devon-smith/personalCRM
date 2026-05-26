/**
 * Introduced-by-user edge detector (M7.2 expansion).
 *
 * Emits an `introduced_by_user` edge between two contacts when:
 *   1. They both appeared as ThreadParticipants in the same Thread
 *   2. The thread's earliest Interaction was OUTBOUND from the user
 *      (i.e., the user started the conversation)
 *   3. The two contacts did NOT co-appear in any earlier Thread
 *
 * This captures real introductions Jennifer has made via email or
 * calendar — a stronger signal than "they were once in the same
 * thread" (mutual_thread) because it implies intent.
 *
 * Pure relational logic. No LLM. Strength: 0.8 — explicit user
 * action, valuable signal for "who did I introduce to whom" queries.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import type { EdgeProposal } from ".";
import { pairKey } from "./mutual-thread";

const SINCE_DAYS_DEFAULT = 365;

export interface DetectIntroducedParams {
  prisma: PrismaClient;
  userId: string;
  sinceMs?: number;
}

export async function detectIntroducedEdges(
  params: DetectIntroducedParams,
): Promise<EdgeProposal[]> {
  const { prisma, userId } = params;
  const since = params.sinceMs
    ? new Date(params.sinceMs)
    : new Date(Date.now() - SINCE_DAYS_DEFAULT * 24 * 60 * 60 * 1000);

  // Pull all multi-participant threads within the window, with their
  // earliest interaction. We only consider threads where the user
  // initiated — i.e., the first message in the thread was OUTBOUND.
  const threads = await prisma.thread.findMany({
    where: {
      userId,
      lastActivityAt: { gte: since },
    },
    select: {
      id: true,
      lastActivityAt: true,
      participants: { select: { contactId: true } },
      interactions: {
        select: { direction: true, occurredAt: true },
        orderBy: { occurredAt: "asc" },
        take: 1,
      },
    },
  });

  // Build a chronological list of all multi-participant threads with
  // a "userInitiated" flag. We walk them in order and only flag a
  // pair as `introduced_by_user` the FIRST time we see them co-occur
  // — and only if that first co-occurrence was in a user-initiated
  // thread.
  const seenPairs = new Set<string>();

  const allThreads = threads
    .filter((t) => t.participants.length >= 2)
    .map((t) => ({
      threadId: t.id,
      participantIds: t.participants.map((p) => p.contactId),
      startedAt:
        t.interactions[0]?.occurredAt ?? t.lastActivityAt,
      userInitiated: t.interactions[0]?.direction === "OUTBOUND",
    }))
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  const proposals: EdgeProposal[] = [];

  for (const t of allThreads) {
    for (let i = 0; i < t.participantIds.length; i++) {
      for (let j = i + 1; j < t.participantIds.length; j++) {
        const a = t.participantIds[i];
        const b = t.participantIds[j];
        if (a === b) continue;
        const key = pairKey(a, b);
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        // First sighting of this pair. If the thread that produced
        // the sighting is user-initiated → this is an introduction.
        if (t.userInitiated) {
          proposals.push({
            contactA: a,
            contactB: b,
            edgeType: "introduced_by_user",
            strength: 0.8,
            evidence: {
              threadId: t.threadId,
              introducedAt: t.startedAt.toISOString(),
            },
          });
        }
      }
    }
  }

  return proposals;
}

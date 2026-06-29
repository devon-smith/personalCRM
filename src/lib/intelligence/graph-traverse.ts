/**
 * Graph traversal API (M7.2).
 *
 * Lightweight query layer over ContactEdge. Exposes `findNeighbors`
 * which is the workhorse for "People who know X" surfaces + future
 * M7.3 network query tool calls.
 *
 * Single-hop only for now. Multi-hop traversal is straightforward to
 * add (recursive call with depth budget) but deferred until M7.3
 * proves the use case.
 */

import type { PrismaClient } from "@/generated/prisma/client";

export interface FindNeighborsParams {
  prisma: PrismaClient;
  userId: string;
  contactId: string;
  /** Restrict to specific edge types. Omit for all. */
  edgeTypes?: string[];
  /** Minimum edge strength (0-1). Default 0.3 — filters out the
   *  weakest decayed mutual-thread signals. */
  minStrength?: number;
  /** Max neighbors to return. Default 25. */
  limit?: number;
}

export interface NeighborResult {
  contactId: string;
  name: string;
  email: string | null;
  company: string | null;
  role: string | null;
  avatarUrl: string | null;
  edgeType: string;
  strength: number;
  observationCount: number;
  lastReinforcedAt: Date;
  /** Source-record references — schema depends on edgeType. Useful
   *  for "why we think they know each other" UI text. */
  evidence: unknown;
}

const DEFAULT_MIN_STRENGTH = 0.3;
const DEFAULT_LIMIT = 25;

/**
 * Returns the contacts directly connected to `contactId` via
 * ContactEdge. Sorted by `strength × recency_boost` descending so
 * recently-reinforced strong edges land on top.
 */
export async function findNeighbors(
  params: FindNeighborsParams,
): Promise<NeighborResult[]> {
  const {
    prisma,
    userId,
    contactId,
    edgeTypes,
    minStrength = DEFAULT_MIN_STRENGTH,
    limit = DEFAULT_LIMIT,
  } = params;

  // Edges are stored with canonical (from < to) ordering, so we look
  // up both directions — the target contact can be in either slot.
  const edges = await prisma.contactEdge.findMany({
    where: {
      userId,
      strength: { gte: minStrength },
      ...(edgeTypes && edgeTypes.length > 0 ? { edgeType: { in: edgeTypes } } : {}),
      OR: [{ fromContactId: contactId }, { toContactId: contactId }],
    },
    select: {
      fromContactId: true,
      toContactId: true,
      edgeType: true,
      strength: true,
      observationCount: true,
      lastReinforcedAt: true,
      evidence: true,
    },
    // Over-fetch slightly; we'll re-sort by combined score below.
    take: limit * 3,
  });

  if (edges.length === 0) return [];

  // Resolve neighbor contact info in one round-trip.
  const neighborIds = Array.from(
    new Set(
      edges.map((e) =>
        e.fromContactId === contactId ? e.toContactId : e.fromContactId,
      ),
    ),
  );
  // M0.4 — drop system-artifact neighbors. The edge exists in the
  // graph (we keep the row for analytics) but it shouldn't surface in
  // "people who know X" lists or network-query tool calls.
  const contacts = await prisma.contact.findMany({
    where: { id: { in: neighborIds }, isNoise: false },
    select: {
      id: true,
      name: true,
      email: true,
      company: true,
      role: true,
      avatarUrl: true,
    },
  });
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  // Rank with a combined score so a 0.6-strength edge reinforced
  // yesterday beats a 0.9-strength edge reinforced 2 years ago.
  return edges
    .map((edge) => {
      const otherId =
        edge.fromContactId === contactId ? edge.toContactId : edge.fromContactId;
      const c = contactById.get(otherId);
      if (!c) return null;
      return {
        contactId: c.id,
        name: c.name,
        email: c.email,
        company: c.company,
        role: c.role,
        avatarUrl: c.avatarUrl,
        edgeType: edge.edgeType,
        strength: edge.strength,
        observationCount: edge.observationCount,
        lastReinforcedAt: edge.lastReinforcedAt,
        evidence: edge.evidence,
        _score: combinedScore(edge.strength, edge.lastReinforcedAt),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, ...rest }) => {
      void _score;
      return rest;
    });
}

/**
 * Combined ranking score for sort. strength × recency boost; recency
 * boost is 1.0 within 7 days, fades to 0.5 at 6 months, then to
 * the 0.2 floor at 1 year and beyond.
 */
export function combinedScore(
  strength: number,
  lastReinforcedAt: Date,
): number {
  const daysAgo =
    (Date.now() - lastReinforcedAt.getTime()) / (24 * 60 * 60 * 1000);
  let boost: number;
  if (daysAgo <= 7) boost = 1.0;
  else if (daysAgo <= 180) boost = 1.0 - ((daysAgo - 7) / (180 - 7)) * 0.5;
  else if (daysAgo <= 365) boost = 0.5 - ((daysAgo - 180) / (365 - 180)) * 0.3;
  else boost = 0.2;
  return strength * boost;
}

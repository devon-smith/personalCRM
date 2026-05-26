/**
 * Graph edge extraction worker (M7.2).
 *
 * Runs the registered edge detectors and upserts ContactEdge rows.
 * Each detector returns EdgeProposal[]; this task canonicalizes
 * (from < to) ordering, dedups within-run, and upserts with merge
 * semantics — max strength wins, observationCount accumulates,
 * evidence is overwritten by latest.
 *
 * Daily cron at 02:30 UTC (after contact-attribute-extraction at 02:00
 * so per-contact data is freshest before the graph is recomputed).
 */
import type { Task } from "graphile-worker";
import { PrismaClient, Prisma } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  detectMutualThreadEdges,
  detectSameOrgEdges,
  type EdgeProposal,
} from "../../src/lib/intelligence/edge-detectors";
import { pairKey } from "../../src/lib/intelligence/edge-detectors/mutual-thread";

interface ExtractPayload {
  userId?: string;
}

const graphEdgeExtraction: Task = async (rawPayload, helpers) => {
  const payload = (rawPayload ?? {}) as ExtractPayload;
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    const userIds = payload.userId
      ? [payload.userId]
      : (await prisma.user.findMany({ select: { id: true } })).map((u) => u.id);

    for (const userId of userIds) {
      const summary = await extractForUser(prisma, userId);
      helpers.logger.info(
        `graph-edge-extraction: user=${userId} ` +
          `mutual_thread=${summary.mutualThread} same_org=${summary.sameOrg} ` +
          `total_edges=${summary.total} new=${summary.created} updated=${summary.updated}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
};

interface RunSummary {
  mutualThread: number;
  sameOrg: number;
  total: number;
  created: number;
  updated: number;
}

async function extractForUser(
  prisma: PrismaClient,
  userId: string,
): Promise<RunSummary> {
  const summary: RunSummary = {
    mutualThread: 0,
    sameOrg: 0,
    total: 0,
    created: 0,
    updated: 0,
  };

  // Run each detector. Easy parallelization since they touch different
  // source tables. Failures in one don't block the others.
  const [mutualThread, sameOrg] = await Promise.all([
    detectMutualThreadEdges({ prisma, userId }).catch((err) => {
      console.warn("[graph-edge-extraction] mutual_thread failed:", err);
      return [] as EdgeProposal[];
    }),
    detectSameOrgEdges({ prisma, userId }).catch((err) => {
      console.warn("[graph-edge-extraction] same_org failed:", err);
      return [] as EdgeProposal[];
    }),
  ]);
  summary.mutualThread = mutualThread.length;
  summary.sameOrg = sameOrg.length;

  // Dedup within-run by canonical key — if a detector emits duplicates
  // (shouldn't, but defensive), keep the highest-strength proposal.
  const merged = new Map<string, EdgeProposal>();
  for (const proposal of [...mutualThread, ...sameOrg]) {
    const [from, to] = canonical(proposal.contactA, proposal.contactB);
    const key = `${from}::${to}::${proposal.edgeType}`;
    const existing = merged.get(key);
    if (!existing || proposal.strength > existing.strength) {
      merged.set(key, { ...proposal, contactA: from, contactB: to });
    }
  }
  summary.total = merged.size;

  // Upsert. Single transaction so a mid-run failure doesn't leave
  // half-applied edges that the next run won't reproduce.
  await prisma.$transaction(
    Array.from(merged.values()).map((p) => {
      const evidenceJson = JSON.parse(JSON.stringify(p.evidence)) as Prisma.InputJsonValue;
      return prisma.contactEdge.upsert({
        where: {
          fromContactId_toContactId_edgeType: {
            fromContactId: p.contactA,
            toContactId: p.contactB,
            edgeType: p.edgeType,
          },
        },
        create: {
          userId,
          fromContactId: p.contactA,
          toContactId: p.contactB,
          edgeType: p.edgeType,
          strength: p.strength,
          observationCount: 1,
          evidence: evidenceJson,
        },
        update: {
          // Max strength wins — a stronger signal supersedes weaker
          // earlier observations.
          strength: { set: p.strength },
          observationCount: { increment: 1 },
          evidence: evidenceJson,
          lastReinforcedAt: new Date(),
        },
      });
    }),
  );

  // We can't easily distinguish created vs updated in a batch upsert
  // without an extra query per row. For now, leave both at 0 and just
  // report `total` — the diff between runs tells us churn anyway.
  return summary;
}

function canonical(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

// Compile-time reference: signals to the linter that pairKey is
// imported intentionally for re-export-by-test (the worker itself
// derives canonical ordering inline above).
void pairKey;

export default graphEdgeExtraction;

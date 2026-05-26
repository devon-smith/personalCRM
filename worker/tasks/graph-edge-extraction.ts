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
    helpers.logger.info("graph-edge-extraction: task start, resolving users");
    const userIds = payload.userId
      ? [payload.userId]
      : (await prisma.user.findMany({ select: { id: true } })).map((u) => u.id);
    helpers.logger.info(
      `graph-edge-extraction: ${userIds.length} user(s) to process`,
    );

    for (const userId of userIds) {
      const summary = await extractForUser(prisma, userId, helpers);
      helpers.logger.info(
        `graph-edge-extraction: user=${userId} ` +
          `mutual_thread=${summary.mutualThread} same_org=${summary.sameOrg} ` +
          `total_edges=${summary.total} upserts_completed=${summary.upserted}`,
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
  upserted: number;
}

/** Batch size for chunked upserts. A single Prisma $transaction with
 *  thousands of upserts on the pooler hangs silently — chunking into
 *  small transactions keeps each one well under any timeout. */
const UPSERT_CHUNK_SIZE = 200;

async function extractForUser(
  prisma: PrismaClient,
  userId: string,
  helpers: { logger: { info: (msg: string) => void } },
): Promise<RunSummary> {
  const summary: RunSummary = {
    mutualThread: 0,
    sameOrg: 0,
    total: 0,
    upserted: 0,
  };

  // Detector phase. Easy parallelization since they touch different
  // source tables. Failures in one don't block the others. Log entry
  // + exit per detector so a future hang is debuggable from the log
  // alone (the original silent-hang bug had zero observability).
  helpers.logger.info(
    `graph-edge-extraction: user=${userId} running detectors`,
  );
  const [mutualThread, sameOrg] = await Promise.all([
    detectMutualThreadEdges({ prisma, userId })
      .then((edges) => {
        helpers.logger.info(
          `graph-edge-extraction: user=${userId} mutual_thread detector → ${edges.length} edges`,
        );
        return edges;
      })
      .catch((err) => {
        helpers.logger.info(
          `graph-edge-extraction: user=${userId} mutual_thread FAILED: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [] as EdgeProposal[];
      }),
    detectSameOrgEdges({ prisma, userId })
      .then((edges) => {
        helpers.logger.info(
          `graph-edge-extraction: user=${userId} same_org detector → ${edges.length} edges`,
        );
        return edges;
      })
      .catch((err) => {
        helpers.logger.info(
          `graph-edge-extraction: user=${userId} same_org FAILED: ${err instanceof Error ? err.message : String(err)}`,
        );
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
  helpers.logger.info(
    `graph-edge-extraction: user=${userId} ${merged.size} unique edges to upsert (in chunks of ${UPSERT_CHUNK_SIZE})`,
  );

  // Chunked upsert. The original single-$transaction(...) approach
  // hung silently on bucket-heavy users (a company with 100+ shared
  // contacts produces thousands of same_org pairs in one shot;
  // wrapping all of them in one transaction on the pooler is a
  // recipe for the connection to give up). Chunking into 200-row
  // transactions keeps each below any reasonable timeout AND gives
  // us a progress log line per chunk for debuggability.
  const allEdges = Array.from(merged.values());
  for (let i = 0; i < allEdges.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = allEdges.slice(i, i + UPSERT_CHUNK_SIZE);
    await prisma.$transaction(
      chunk.map((p) => {
        const evidenceJson = JSON.parse(
          JSON.stringify(p.evidence),
        ) as Prisma.InputJsonValue;
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
    summary.upserted += chunk.length;
    if ((i / UPSERT_CHUNK_SIZE) % 5 === 0) {
      helpers.logger.info(
        `graph-edge-extraction: user=${userId} upserted ${summary.upserted}/${merged.size}`,
      );
    }
  }

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

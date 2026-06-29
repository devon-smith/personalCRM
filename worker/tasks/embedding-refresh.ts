/**
 * Re-embed contacts whose embeddingUpdatedAt is stale relative to
 * their updatedAt. Caps at 100 contacts per run so a busy moment
 * doesn't block other tasks.
 *
 * Cron-triggered every 5 minutes via worker/index.ts. Idempotent —
 * if no contacts need refreshing the task no-ops in <100ms.
 */
import type { Task } from "graphile-worker";
import { PrismaClient, Prisma } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  buildContactEmbedText,
  embedBatch,
  formatVectorLiteral,
  MAX_BATCH_SIZE,
  VoyageError,
} from "../../src/lib/search/embeddings";

const BATCH_CAP = 100;

const embeddingRefresh: Task = async (_payload, helpers) => {
  if (!process.env.VOYAGE_API_KEY) {
    helpers.logger.debug("VOYAGE_API_KEY not set — skipping embedding refresh");
    return;
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    const stale = await prisma.$queryRaw<Array<{
      id: string;
      userId: string;
      name: string;
      email: string | null;
      role: string | null;
      company: string | null;
      city: string | null;
      state: string | null;
      country: string | null;
      circleNames: string[];
    }>>(Prisma.sql`
      SELECT c.id, c."userId", c.name, c.email, c.role, c.company, c.city, c.state, c.country,
             COALESCE(
               ARRAY(
                 SELECT cc.name
                 FROM "Circle" cc
                 JOIN "ContactCircle" jc ON jc."circleId" = cc.id
                 WHERE jc."contactId" = c.id
               ),
               ARRAY[]::text[]
             ) AS "circleNames"
      FROM "Contact" c
      WHERE c."embedding" IS NULL
         OR c."embeddingUpdatedAt" IS NULL
         OR c."embeddingUpdatedAt" < c."updatedAt"
      LIMIT ${BATCH_CAP}
    `);

    if (stale.length === 0) {
      helpers.logger.debug("No stale embeddings.");
      return;
    }

    helpers.logger.info(`Refreshing ${stale.length} contact embedding(s)`);

    // Single batch — BATCH_CAP is at or below MAX_BATCH_SIZE so we
    // don't need to chunk. If we ever raise the cap, add a chunk loop.
    if (stale.length > MAX_BATCH_SIZE) {
      throw new Error(`BATCH_CAP > MAX_BATCH_SIZE; need to chunk`);
    }

    const texts = stale.map(buildContactEmbedText);
    const userIds = new Set(stale.map((contact) => contact.userId));
    const singleUserId = userIds.size === 1 ? stale[0]?.userId : null;
    let embeddings: number[][];
    try {
      const result = await embedBatch(texts, "document", {
        userId: singleUserId,
        feature: "contact_embedding_refresh",
        metadata: {
          contactCount: stale.length,
          userCount: userIds.size,
        },
      });
      embeddings = result.embeddings;
    } catch (err) {
      // Voyage transient failures bubble up so Graphile retries with
      // backoff. Terminal errors (bad key etc.) also retry but plateau
      // at the maxAttempts ceiling — see worker/index.ts.
      if (err instanceof VoyageError && err.retryable) throw err;
      throw err;
    }

    for (let i = 0; i < stale.length; i++) {
      const literal = formatVectorLiteral(embeddings[i]);
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "Contact"
        SET "embedding" = ${literal}::vector,
            "embeddingUpdatedAt" = NOW()
        WHERE id = ${stale[i].id}
      `);
    }

    helpers.logger.info(`Embedded ${stale.length} contacts.`);
  } finally {
    await prisma.$disconnect();
  }
};

export default embeddingRefresh;

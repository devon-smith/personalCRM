/**
 * Feed aggregator worker (M0.x.3).
 *
 * Runs daily at 04:30 UTC (just after life-event extraction at
 * 03:30 so newly-extracted signals make it into the same morning's
 * feed). Walks every user and writes FeedItem rows from the
 * registered sources.
 *
 * Cost shape: pure Prisma upserts, no external API calls. Cheap
 * enough to run on demand too — payload `{ userId }` lets the
 * /api/feed/aggregate endpoint or scripts/feed-aggregate-now.ts
 * kick a one-off run.
 */
import type { Task } from "graphile-worker";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { aggregateForUser } from "../../src/lib/feed/aggregator.js";

interface AggregatePayload {
  userId?: string;
}

const feedAggregate: Task = async (rawPayload, helpers) => {
  const payload = (rawPayload ?? {}) as AggregatePayload;
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    const userIds = payload.userId
      ? [payload.userId]
      : (await prisma.user.findMany({ select: { id: true } })).map(
          (u) => u.id,
        );

    for (const userId of userIds) {
      const summary = await aggregateForUser(prisma, userId);
      helpers.logger.info(
        `feed-aggregate: user=${userId} ` +
          `changelog=${summary.scannedChangelog} ` +
          `lifeEvents=${summary.scannedLifeEvents} ` +
          `upserted=${summary.upserted} ` +
          `highlighted=${summary.highlighted}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
};

export default feedAggregate;

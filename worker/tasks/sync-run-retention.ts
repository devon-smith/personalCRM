/**
 * Cleanup durable SyncRun telemetry.
 *
 * Runs daily. Keeps enough history for debugging cost/freshness trends
 * without letting high-frequency Gmail sync telemetry grow forever.
 */
import type { Task } from "graphile-worker";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { cleanupSyncRuns } from "../../src/lib/sync/run-retention";

const syncRunRetention: Task = async (_payload, helpers) => {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    const summary = await cleanupSyncRuns(prisma);
    helpers.logger.info(
      `sync-run-retention: markedAbandoned=${summary.markedAbandoned} ` +
        `deletedSuccess=${summary.deletedSuccess} ` +
        `deletedErrors=${summary.deletedErrors}`,
    );
  } finally {
    await prisma.$disconnect();
  }
};

export default syncRunRetention;

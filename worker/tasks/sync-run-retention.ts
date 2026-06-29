/**
 * Cleanup durable SyncRun telemetry.
 *
 * Runs daily. Keeps enough history for debugging cost/freshness trends
 * without letting high-frequency Gmail sync telemetry grow forever.
 */
import type { Task } from "graphile-worker";
import { createWorkerPrismaClient } from "../db.js";
import { cleanupSyncRuns } from "../../src/lib/sync/run-retention";

const syncRunRetention: Task = async (_payload, helpers) => {
  const prisma = createWorkerPrismaClient();

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

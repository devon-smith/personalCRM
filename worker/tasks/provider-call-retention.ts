/**
 * Cleanup durable ProviderCallLog telemetry.
 *
 * Runs daily. Keeps enough provider-call detail for Settings usage,
 * deployment tuning, and debugging while preventing utility-call logs
 * from growing indefinitely after Google telemetry coverage expands.
 */
import type { Task } from "graphile-worker";
import { createWorkerPrismaClient } from "../db.js";
import { cleanupProviderCallLogs } from "../../src/lib/provider-call-retention";

const providerCallRetention: Task = async (_payload, helpers) => {
  const prisma = createWorkerPrismaClient();

  try {
    const summary = await cleanupProviderCallLogs(prisma);
    helpers.logger.info(
      `provider-call-retention: deletedRows=${summary.deletedRows} ` +
        `retentionDays=${summary.retentionDays} ` +
        `cutoff=${summary.cutoff.toISOString()}`,
    );
  } finally {
    await prisma.$disconnect();
  }
};

export default providerCallRetention;

/**
 * Cleanup durable ProviderCallLog telemetry.
 *
 * Runs daily. Keeps enough provider-call detail for Settings usage,
 * deployment tuning, and debugging while preventing utility-call logs
 * from growing indefinitely after Google telemetry coverage expands.
 */
import type { Task } from "graphile-worker";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { cleanupProviderCallLogs } from "../../src/lib/provider-call-retention";

const providerCallRetention: Task = async (_payload, helpers) => {
  const connectionString =
    process.env.WORKER_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL or WORKER_DATABASE_URL is required");
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

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

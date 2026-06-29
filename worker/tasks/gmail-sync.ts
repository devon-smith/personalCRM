/**
 * Server-side Gmail sync. Walks every user with a Google account and
 * runs the existing incrementalGmailSync (falls back to initial sync
 * when no historyId is on file).
 *
 * This is the queue-side counterpart to the browser-driven useAutoSync
 * hook. Both still run today — once we have a feature flag that toggles
 * useAutoSync off, the browser path can be retired.
 */
import type { Task } from "graphile-worker";
import { createWorkerPrismaClient } from "../db.js";
import { runGmailSyncForUser } from "../../src/lib/sync/google-sync-runs";
import { parseSyncTrigger } from "../../src/lib/sync/run-telemetry";

interface GmailSyncPayload {
  triggeredBy?: string;
  userId?: string;
}

const gmailSync: Task = async (rawPayload, helpers) => {
  const payload = (rawPayload ?? {}) as GmailSyncPayload;
  const trigger = parseSyncTrigger(payload.triggeredBy);
  const prisma = createWorkerPrismaClient();

  try {
    // Single-user app for now; if multi-user is added later, walk all
    // users with a connected Google account.
    const users = await prisma.user.findMany({
      where: {
        ...(payload.userId ? { id: payload.userId } : {}),
        accounts: { some: { provider: "google" } },
      },
      select: { id: true, email: true },
    });

    if (users.length === 0) {
      helpers.logger.debug("No users with Google accounts.");
      return;
    }

    let totalProcessed = 0;
    let failures = 0;
    for (const u of users) {
      try {
        const r = await runGmailSyncForUser(u.id, trigger);
        totalProcessed += r.processed;
        if (r.processed > 0) {
          helpers.logger.info(`  ${u.email}: ${r.processed} new emails`);
        }
      } catch (err) {
        failures++;
        helpers.logger.error(
          `  ${u.email}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    helpers.logger.info(
      `gmail-sync: ${totalProcessed} emails across ${users.length} user(s), ${failures} failure(s)`,
    );
  } finally {
    await prisma.$disconnect();
  }
};

export default gmailSync;

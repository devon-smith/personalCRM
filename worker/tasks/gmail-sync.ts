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
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { incrementalGmailSync } from "../../src/lib/gmail/sync";

const gmailSync: Task = async (_payload, helpers) => {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    // Single-user app for now; if multi-user is added later, walk all
    // users with a connected Google account.
    const users = await prisma.user.findMany({
      where: { accounts: { some: { provider: "google" } } },
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
        const r = await incrementalGmailSync(u.id);
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

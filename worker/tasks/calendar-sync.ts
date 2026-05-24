/**
 * Server-side Google Calendar sync. Mirrors the gmail-sync task but
 * targets calendar events. Runs less frequently because calendar
 * events change far less often than email arrives.
 */
import type { Task } from "graphile-worker";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { syncCalendarEvents } from "../../src/lib/calendar";

const calendarSync: Task = async (_payload, helpers) => {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    const users = await prisma.user.findMany({
      where: { accounts: { some: { provider: "google" } } },
      select: { id: true, email: true },
    });

    if (users.length === 0) {
      helpers.logger.debug("No users with Google accounts.");
      return;
    }

    let totalLogged = 0;
    let failures = 0;
    for (const u of users) {
      try {
        const r = await syncCalendarEvents(u.id, 90);
        totalLogged += r.interactionsLogged ?? 0;
        if ((r.interactionsLogged ?? 0) > 0) {
          helpers.logger.info(
            `  ${u.email}: ${r.interactionsLogged} meeting(s) logged`,
          );
        }
      } catch (err) {
        failures++;
        helpers.logger.error(
          `  ${u.email}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    helpers.logger.info(
      `calendar-sync: ${totalLogged} meeting(s) logged across ${users.length} user(s), ${failures} failure(s)`,
    );
  } finally {
    await prisma.$disconnect();
  }
};

export default calendarSync;

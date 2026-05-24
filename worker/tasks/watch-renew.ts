/**
 * Renew Gmail + Calendar Pub/Sub watch channels (Milestones 1.2, 1.3).
 *
 * Gmail watches expire after 7 days. Each call to users.watch replaces
 * the prior watch, so renewal is just "call it again." We re-establish
 * any GmailSyncState whose watchExpiration is within 24h.
 *
 * Calendar channels expire on a per-channel basis (default ~30 days).
 * We re-establish any CalendarWatchChannel whose expiration is within
 * 48h.
 *
 * Cron-fired every 6 days at 03:17 UTC so both kinds have headroom.
 * No-op when GMAIL_PUBSUB_TOPIC / WEBHOOK_BASE_URL aren't set — push
 * isn't configured.
 */
import type { Task } from "graphile-worker";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { establishGmailWatch } from "../../src/lib/gmail/watch";
import { establishCalendarWatches } from "../../src/lib/calendar-watch";

const GMAIL_RENEWAL_GRACE_MS = 24 * 60 * 60 * 1000;        // renew if expires <24h
const CALENDAR_RENEWAL_GRACE_MS = 48 * 60 * 60 * 1000;     // renew if expires <48h

const watchRenew: Task = async (_payload, helpers) => {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    const gmailEnabled = !!process.env.GMAIL_PUBSUB_TOPIC;
    const calendarEnabled =
      !!process.env.WEBHOOK_BASE_URL && !!process.env.WEBHOOK_TOKEN;

    if (!gmailEnabled && !calendarEnabled) {
      helpers.logger.debug(
        "Push sync not configured (GMAIL_PUBSUB_TOPIC / WEBHOOK_BASE_URL unset) — skipping.",
      );
      return;
    }

    let gmailRenewed = 0;
    let calendarRenewed = 0;
    let failed = 0;

    if (gmailEnabled) {
      const gmailNeedingRenewal = await prisma.gmailSyncState.findMany({
        where: {
          OR: [
            { watchExpiration: null },
            { watchExpiration: { lt: new Date(Date.now() + GMAIL_RENEWAL_GRACE_MS) } },
          ],
        },
        select: { userId: true },
      });

      for (const row of gmailNeedingRenewal) {
        try {
          const r = await establishGmailWatch(row.userId);
          if (r) {
            gmailRenewed++;
            helpers.logger.info(
              `  gmail watch renewed for ${row.userId} → expires ${r.expiration.toISOString()}`,
            );
          }
        } catch (err) {
          failed++;
          helpers.logger.error(
            `  gmail watch renew failed for ${row.userId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    if (calendarEnabled) {
      // Walk distinct users with any expiring channel. establishCalendarWatches
      // re-establishes ALL calendars for the user, which is fine since we
      // currently only watch "primary" per account.
      const calendarNeedingRenewal = await prisma.calendarWatchChannel.findMany({
        where: {
          expiration: { lt: new Date(Date.now() + CALENDAR_RENEWAL_GRACE_MS) },
        },
        select: { userId: true, calendarId: true },
      });

      const byUser = new Map<string, Set<string>>();
      for (const c of calendarNeedingRenewal) {
        if (!byUser.has(c.userId)) byUser.set(c.userId, new Set());
        byUser.get(c.userId)!.add(c.calendarId);
      }

      for (const [userId, calendarSet] of byUser) {
        try {
          const r = await establishCalendarWatches(userId, [...calendarSet]);
          calendarRenewed += r.length;
          for (const ch of r) {
            helpers.logger.info(
              `  calendar watch renewed: ${ch.calendarId} → expires ${ch.expiration.toISOString()}`,
            );
          }
        } catch (err) {
          failed++;
          helpers.logger.error(
            `  calendar watch renew failed for ${userId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    helpers.logger.info(
      `watch-renew: ${gmailRenewed} gmail, ${calendarRenewed} calendar, ${failed} failed`,
    );
  } finally {
    await prisma.$disconnect();
  }
};

export default watchRenew;

/**
 * One-shot backfill: walk OPEN InboxItems and auto-resolve any whose
 * underlying thread has already been replied to.
 *
 * `onOutboundInteraction` (lib/inbox.ts) handles this going forward
 * during sync — every outbound Gmail message flips matching OPEN
 * items to RESOLVED. But items created BEFORE that hook was wired,
 * or items where the outbound landed via a non-tracked path
 * (manual mark-as-sent, race conditions), can persist.
 *
 * Strategy: use the local EmailMessage table as the source of truth.
 * For each OPEN InboxItem with a threadKey, look for an outbound
 * message in the same Gmail thread with occurredAt > triggerAt. If
 * present → Jennifer replied → resolve.
 *
 * Local-table only — no Gmail API hits. Fast even on 1000+ items.
 *
 * Idempotent. Safe to re-run.
 *
 *   npx tsx scripts/auto-resolve-inbox.ts
 *   npx tsx scripts/auto-resolve-inbox.ts --dry-run
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

interface RunStats {
  scanned: number;
  resolved: number;
  noOutbound: number;
  noThreadKey: number;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const verbose = process.argv.includes("--verbose");

  console.log(`[auto-resolve-inbox] start dryRun=${dryRun}`);

  // Pull all currently-OPEN inbox items. Bound the scan to email-
  // channel items — the auto-resolve flow we're backfilling only
  // applies to threads we can verify via EmailMessage. Other channels
  // (imessage, linkedin) have their own resolution paths.
  const items = await prisma.inboxItem.findMany({
    where: { status: "OPEN", channel: "email" },
    select: {
      id: true,
      userId: true,
      threadKey: true,
      contactName: true,
      triggerAt: true,
    },
  });

  const stats: RunStats = {
    scanned: items.length,
    resolved: 0,
    noOutbound: 0,
    noThreadKey: 0,
  };

  const toResolve: Array<{
    id: string;
    contactName: string;
    triggerAt: Date;
    repliedAt: Date;
  }> = [];

  for (const item of items) {
    // No threadKey = no way to look up the thread's outbound history.
    // Most items have a threadKey post-Gmail-sync; legacy ones may not.
    if (!item.threadKey) {
      stats.noThreadKey++;
      continue;
    }

    // Look for an OUTBOUND EmailMessage in the same thread with
    // occurredAt strictly after the trigger. Strictly-after — equal
    // timestamps would mean the trigger IS the outbound, which would
    // be wrong (the trigger is the inbound that created the item).
    const outbound = await prisma.emailMessage.findFirst({
      where: {
        userId: item.userId,
        threadId: item.threadKey,
        direction: "OUTBOUND",
        occurredAt: { gt: item.triggerAt },
      },
      orderBy: { occurredAt: "asc" }, // earliest reply wins
      select: { occurredAt: true },
    });

    if (!outbound) {
      stats.noOutbound++;
      if (verbose) {
        console.log(
          `[skip] ${item.contactName} (item=${item.id}, thread=${item.threadKey}) — no outbound after triggerAt`,
        );
      }
      continue;
    }

    toResolve.push({
      id: item.id,
      contactName: item.contactName,
      triggerAt: item.triggerAt,
      repliedAt: outbound.occurredAt,
    });
  }

  for (const r of toResolve) {
    console.log(
      `[resolve] ${r.contactName} item=${r.id} triggerAt=${r.triggerAt.toISOString()} repliedAt=${r.repliedAt.toISOString()}`,
    );
  }

  if (!dryRun && toResolve.length > 0) {
    // Batch update — all rows get the same resolvedAt=now to mark
    // when the backfill ran. The thread-level repliedAt is logged
    // above per-row for audit, but stored resolvedAt is the backfill
    // run time so we can later identify which items were resolved
    // by this script vs by the live hook.
    const now = new Date();
    await prisma.inboxItem.updateMany({
      where: { id: { in: toResolve.map((r) => r.id) } },
      data: {
        status: "RESOLVED",
        resolvedAt: now,
        resolvedBy: "auto_backfill",
      },
    });
    stats.resolved = toResolve.length;
  }

  console.log(
    `[auto-resolve-inbox] done scanned=${stats.scanned} ` +
      `resolved=${stats.resolved} no_outbound=${stats.noOutbound} ` +
      `no_thread_key=${stats.noThreadKey} dryRun=${dryRun}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[auto-resolve-inbox] failed:", err);
    process.exit(1);
  });

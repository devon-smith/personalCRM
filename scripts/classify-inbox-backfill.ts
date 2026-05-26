/**
 * M0.x.2 backfill: enqueue inbox-classify jobs for every OPEN InboxItem
 * that hasn't been classified yet.
 *
 * Idempotent — items that already have `classifiedAt` set are skipped
 * by the worker (unless --force is passed). Re-running the script is
 * safe: it adds new jobs only for the un-classified backlog.
 *
 *   npx tsx scripts/classify-inbox-backfill.ts
 *   npx tsx scripts/classify-inbox-backfill.ts --dry-run
 *   npx tsx scripts/classify-inbox-backfill.ts --force
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { enqueue } from "../worker/queue-client";

interface RunStats {
  scanned: number;
  enqueued: number;
  skipped: number;
}

const BATCH_SIZE = 50;

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");

  console.log(
    `[classify-inbox-backfill] start dryRun=${dryRun} force=${force}`,
  );

  const items = await prisma.inboxItem.findMany({
    where: {
      status: "OPEN",
      ...(force ? {} : { classifiedAt: null }),
    },
    orderBy: { triggerAt: "desc" },
    select: {
      id: true,
      userId: true,
      contactName: true,
      channel: true,
      classifiedAt: true,
    },
  });

  const stats: RunStats = {
    scanned: items.length,
    enqueued: 0,
    skipped: 0,
  };

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    if (dryRun) {
      console.log(
        `[batch ${Math.floor(i / BATCH_SIZE) + 1}] would enqueue ${batch.length} items`,
      );
      stats.enqueued += batch.length;
      continue;
    }

    await Promise.all(
      batch.map((item) =>
        enqueue("inbox-classify", { inboxItemId: item.id, force })
          .then(() => {
            stats.enqueued++;
          })
          .catch((err) => {
            stats.skipped++;
            console.warn(
              `[skip] item=${item.id} (${item.contactName}) — ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }),
      ),
    );
  }

  console.log(
    `[classify-inbox-backfill] done scanned=${stats.scanned} ` +
      `enqueued=${stats.enqueued} skipped=${stats.skipped} dryRun=${dryRun}`,
  );

  if (!dryRun) {
    console.log(
      "[classify-inbox-backfill] jobs run via graphile-worker; " +
        "monitor with /admin/jobs",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[classify-inbox-backfill] failed:", err);
    process.exit(1);
  });

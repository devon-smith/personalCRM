/**
 * Release graphile-worker locks held by dead workers.
 *
 * Background: when a worker process dies mid-job (OOM, container
 * SIGKILL, dev-server restart with no graceful shutdown), the row
 * in graphile_worker._private_jobs keeps `locked_at` / `locked_by`
 * set forever. graphile-worker will eventually release them via
 * `forbidden_flags` / TTL on the lock side, but in practice we see
 * rows that sit locked indefinitely.
 *
 * Safe to run anytime — only touches rows where:
 *   - locked_at is older than 6 hours (well past any real job)
 *   - last_error is NULL (the row never failed loudly — if it did,
 *     graphile-worker is already handling the retry / surface it)
 *
 * Run manually when the queue is backed up and the worker logs show
 * no progress, or weekly via cron. There is no danger to running
 * twice; a row that gets re-locked between SELECT and UPDATE will
 * fail the WHERE filter on the next run.
 *
 *   npx tsx scripts/release-stale-locks.ts
 *   npx tsx scripts/release-stale-locks.ts --dry-run
 */

import "dotenv/config";
import { Pool } from "pg";

interface StaleLock {
  id: string;
  task: string;
  locked_by: string | null;
  locked_at: string;
  attempts: number;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const connectionString =
    process.env.WORKER_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL (or WORKER_DATABASE_URL) is required");
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  try {
    // Preview first — useful even in non-dry mode so the log shows
    // what got released.
    // task_id is graphile-worker's internal FK; resolve via _private_tasks
    // for the log line — keeps the script self-explanatory when you read
    // the output without going back to query the DB.
    const previewResult = await pool.query<StaleLock>(`
      SELECT
        j.id::text,
        COALESCE(t.identifier, j.task_id::text) AS task,
        j.locked_by,
        j.locked_at::text,
        j.attempts
      FROM graphile_worker._private_jobs j
      LEFT JOIN graphile_worker._private_tasks t ON t.id = j.task_id
      WHERE j.locked_at IS NOT NULL
        AND j.locked_at < NOW() - INTERVAL '6 hours'
        AND j.last_error IS NULL
      ORDER BY j.locked_at ASC
    `);

    console.log(
      `[release-stale-locks] found ${previewResult.rowCount} stale-locked job(s) dryRun=${dryRun}`,
    );
    for (const row of previewResult.rows) {
      console.log(
        `  job=${row.id} task=${row.task} ` +
          `locked_at=${row.locked_at} locked_by=${row.locked_by ?? "?"} attempts=${row.attempts}`,
      );
    }

    if (dryRun || previewResult.rowCount === 0) {
      return;
    }

    const releaseResult = await pool.query(`
      UPDATE graphile_worker._private_jobs
         SET locked_at = NULL,
             locked_by = NULL,
             attempts = 0
       WHERE locked_at IS NOT NULL
         AND locked_at < NOW() - INTERVAL '6 hours'
         AND last_error IS NULL
    `);

    console.log(
      `[release-stale-locks] released ${releaseResult.rowCount} job(s)`,
    );
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[release-stale-locks] failed:", err);
    process.exit(1);
  });

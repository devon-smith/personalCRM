import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/jobs
 *
 * Read-only view into the graphile_worker queue state. Returns:
 *   - taskCounts: count of jobs per task name, broken out by state
 *     (pending / running / failed terminally)
 *   - recent: 20 most recently-touched jobs with their last error
 *   - cron: each registered crontab's last_execution timestamp + the
 *     expected cadence in hours, so the UI can decide what counts as
 *     "stale" per schedule rather than applying a 6h blanket rule
 *     that mislabels nightly tasks as overdue on every fresh boot
 *
 * Single-user app, so any authenticated user can see this. Becomes
 * a per-tenant filter once multi-user lands.
 */

/**
 * Expected cadence per scheduled task, in hours. Used by the UI to
 * decide whether "last run X ago" or "never run" means trouble. Keep
 * in sync with the crontab in worker/index.ts; the worker doesn't
 * expose this back to the DB so we mirror it here.
 */
const CADENCE_HOURS: Record<string, number> = {
  "embedding-refresh": 5 / 60,         // every 5 min
  "gmail-sync": 3 / 60,                // every 3 min
  "calendar-sync": 30 / 60,            // every 30 min
  "circle-google-sync": 24,            // daily
  "openalex-affiliation-diff": 24,     // daily
  "watch-renew": 24 * 6,               // every 6 days
};
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [taskCounts, recent, cron] = await Promise.all([
    prisma.$queryRaw<Array<{
      task: string;
      pending: bigint;
      failed: bigint;
      total: bigint;
    }>>`
      SELECT t.identifier AS task,
             COUNT(*) FILTER (WHERE j.is_available = true)::bigint AS pending,
             COUNT(*) FILTER (WHERE j.attempts >= j.max_attempts)::bigint AS failed,
             COUNT(*)::bigint AS total
      FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks t ON t.id = j.task_id
      GROUP BY t.identifier
      ORDER BY t.identifier ASC
    `,
    prisma.$queryRaw<Array<{
      id: bigint;
      task: string;
      attempts: number;
      max_attempts: number;
      run_at: Date;
      locked_at: Date | null;
      last_error: string | null;
      created_at: Date;
    }>>`
      SELECT j.id, t.identifier AS task, j.attempts, j.max_attempts,
             j.run_at, j.locked_at, j.last_error, j.created_at
      FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks t ON t.id = j.task_id
      ORDER BY j.updated_at DESC
      LIMIT 20
    `,
    prisma.$queryRaw<Array<{
      identifier: string;
      last_execution: Date | null;
    }>>`
      SELECT identifier, last_execution
      FROM graphile_worker._private_known_crontabs
      ORDER BY identifier ASC
    `,
  ]);

  return NextResponse.json({
    taskCounts: taskCounts.map((t) => ({
      task: t.task,
      pending: Number(t.pending),
      failed: Number(t.failed),
      total: Number(t.total),
    })),
    recent: recent.map((r) => ({
      id: r.id.toString(),
      task: r.task,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      runAt: r.run_at.toISOString(),
      lockedAt: r.locked_at?.toISOString() ?? null,
      lastError: r.last_error,
      createdAt: r.created_at.toISOString(),
    })),
    cron: cron.map((c) => ({
      identifier: c.identifier,
      lastExecution: c.last_execution?.toISOString() ?? null,
      cadenceHours: CADENCE_HOURS[c.identifier] ?? null,
    })),
  });
}

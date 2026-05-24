/**
 * Programmatic job enqueue for the Next.js side. Use from API routes,
 * webhook handlers, etc. when you need to add a job from a stateless
 * request rather than waiting for the cron schedule.
 *
 * Each call grabs a short-lived connection from the pool — fine for
 * low-frequency enqueues (a handful per webhook). For high-volume use
 * cases (e.g. an embedding-backfill burst), consider batching via the
 * worker process itself.
 */
import { Pool } from "pg";
import { makeWorkerUtils } from "graphile-worker";
import type { WorkerUtils } from "graphile-worker";

let cachedUtils: WorkerUtils | null = null;

async function getUtils(): Promise<WorkerUtils> {
  if (cachedUtils) return cachedUtils;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  cachedUtils = await makeWorkerUtils({ pgPool: pool });
  return cachedUtils;
}

/**
 * Enqueue a task by name. Payload must be JSON-serializable. Returns
 * the inserted job id.
 *
 * Most callers don't need to pass options — the worker config has
 * sane defaults for retry-with-backoff. Override only when you need
 * a specific priority or queueName for serialization.
 */
export async function enqueue(
  taskName: string,
  payload: Record<string, unknown> = {},
  opts: {
    priority?: number;
    runAt?: Date;
    queueName?: string;
    maxAttempts?: number;
  } = {},
): Promise<string> {
  const utils = await getUtils();
  const job = await utils.addJob(taskName, payload, opts);
  return job.id;
}

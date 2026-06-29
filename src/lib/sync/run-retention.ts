import type { PrismaClient } from "@/generated/prisma/client";

export const SUCCESS_RETENTION_DAYS = 90;
export const ERROR_RETENTION_DAYS = 180;
export const RUNNING_STALE_DAYS = 1;

export interface SyncRunRetentionSummary {
  markedAbandoned: number;
  deletedSuccess: number;
  deletedErrors: number;
}

export async function cleanupSyncRuns(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<SyncRunRetentionSummary> {
  const successCutoff = subtractDays(now, SUCCESS_RETENTION_DAYS);
  const errorCutoff = subtractDays(now, ERROR_RETENTION_DAYS);
  const runningCutoff = subtractDays(now, RUNNING_STALE_DAYS);

  const [abandoned, successful, errors] = await Promise.all([
    prisma.syncRun.updateMany({
      where: {
        status: "running",
        startedAt: { lt: runningCutoff },
      },
      data: {
        status: "error",
        finishedAt: now,
        error: "Marked abandoned by sync-run-retention.",
        metadata: { errorCategory: "abandoned" },
      },
    }),
    prisma.syncRun.deleteMany({
      where: {
        status: "success",
        startedAt: { lt: successCutoff },
      },
    }),
    prisma.syncRun.deleteMany({
      where: {
        status: "error",
        startedAt: { lt: errorCutoff },
      },
    }),
  ]);

  return {
    markedAbandoned: abandoned.count,
    deletedSuccess: successful.count,
    deletedErrors: errors.count,
  };
}

export function subtractDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

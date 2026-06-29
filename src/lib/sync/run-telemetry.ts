import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export type SyncSource = "gmail" | "calendar";
export type SyncTrigger = "cron" | "manual" | "webhook" | "browser_fallback";

interface SyncRunSummary {
  itemsProcessed?: number | null;
  providerCalls?: number | null;
  metadata?: Prisma.InputJsonValue;
}

interface RecordSyncRunInput<T> {
  userId: string;
  source: SyncSource;
  trigger: SyncTrigger;
  run: () => Promise<T>;
  summarize?: (result: T) => SyncRunSummary;
  metadata?: Prisma.InputJsonValue;
}

export async function recordSyncRun<T>({
  userId,
  source,
  trigger,
  run,
  summarize,
  metadata,
}: RecordSyncRunInput<T>): Promise<T> {
  const startedAt = new Date();
  let runId: string | null = null;

  try {
    const created = await prisma.syncRun.create({
      data: {
        userId,
        source,
        trigger,
        status: "running",
        startedAt,
        metadata,
      },
      select: { id: true },
    });
    runId = created.id;
  } catch (error) {
    console.warn("[sync-run] failed to create telemetry row:", formatError(error));
  }

  try {
    const result = await run();
    const finishedAt = new Date();
    const summary = summarize?.(result);

    if (runId) {
      await prisma.syncRun
        .update({
          where: { id: runId },
          data: {
            status: "success",
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            itemsProcessed: summary?.itemsProcessed ?? null,
            providerCalls: summary?.providerCalls ?? null,
            metadata: summary?.metadata ?? metadata,
          },
        })
        .catch((error) => {
          console.warn("[sync-run] failed to update telemetry row:", formatError(error));
        });
    }

    return result;
  } catch (error) {
    const finishedAt = new Date();
    if (runId) {
      await prisma.syncRun
        .update({
          where: { id: runId },
          data: {
            status: "error",
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            error: formatError(error).slice(0, 2000),
          },
        })
        .catch((updateError) => {
          console.warn("[sync-run] failed to mark telemetry error:", formatError(updateError));
        });
    }
    throw error;
  }
}

export function parseSyncTrigger(value: unknown): SyncTrigger {
  if (value === "webhook") return "webhook";
  if (value === "browser_fallback") return "browser_fallback";
  if (value === "manual") return "manual";
  return "cron";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

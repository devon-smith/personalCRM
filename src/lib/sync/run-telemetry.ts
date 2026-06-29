import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { withProviderCallCounter } from "@/lib/sync/provider-call-counter";

export type SyncSource = "gmail" | "calendar";
export type SyncTrigger = "cron" | "manual" | "webhook" | "browser_fallback";
export type SyncErrorCategory =
  | "auth"
  | "network"
  | "provider"
  | "rate_limit"
  | "unknown";

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
    const { result, total: providerCallTotal } = await withProviderCallCounter(run);
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
            providerCalls: summary?.providerCalls ?? providerCallTotal,
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
    const errorMessage = formatError(error);
    const errorCategory = classifySyncError(error);
    if (runId) {
      await prisma.syncRun
        .update({
          where: { id: runId },
          data: {
            status: "error",
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            error: errorMessage.slice(0, 2000),
            metadata: mergeErrorMetadata(metadata, errorCategory),
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

export function classifySyncError(error: unknown): SyncErrorCategory {
  const message = formatError(error).toLowerCase();

  if (/\b429\b/.test(message) || message.includes("rate limit")) {
    return "rate_limit";
  }
  if (
    /\b(401|403)\b/.test(message) ||
    message.includes("invalid_grant") ||
    message.includes("access denied") ||
    message.includes("no valid google access token") ||
    message.includes("reconnect") ||
    message.includes("unauthorized") ||
    message.includes("forbidden")
  ) {
    return "auth";
  }
  if (
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("econn") ||
    message.includes("timed out") ||
    message.includes("timeout")
  ) {
    return "network";
  }
  if (
    /\b5\d\d\b/.test(message) ||
    message.includes("gmail api error") ||
    message.includes("calendar api error") ||
    message.includes("google")
  ) {
    return "provider";
  }
  return "unknown";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mergeErrorMetadata(
  metadata: Prisma.InputJsonValue | undefined,
  errorCategory: SyncErrorCategory,
): Prisma.InputJsonValue {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return { ...metadata, errorCategory };
  }
  if (metadata === undefined) return { errorCategory };
  return { errorCategory, previousMetadata: metadata };
}

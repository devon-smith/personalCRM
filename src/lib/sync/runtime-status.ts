import type { PrismaClient } from "@/generated/prisma/client";

export type BrowserSyncMode = "enabled" | "disabled";
export type WorkerRuntimeStatus = "healthy" | "stale" | "not_configured";

export interface WorkerCronStatus {
  task: "gmail-sync" | "calendar-sync";
  lastExecution: string | null;
  cadenceMinutes: number;
  stale: boolean;
}

export interface SyncRuntimeStatus {
  browserSync: {
    mode: BrowserSyncMode;
    reason: string;
  };
  worker: {
    status: WorkerRuntimeStatus;
    crons: WorkerCronStatus[];
  };
}

const CRON_CADENCE_MINUTES: Record<WorkerCronStatus["task"], number> = {
  "gmail-sync": 3,
  "calendar-sync": 30,
};

const STALE_MULTIPLIER = 3;

export async function getSyncRuntimeStatus(
  prisma: PrismaClient,
): Promise<SyncRuntimeStatus> {
  const browserSync = getBrowserSyncMode();
  const worker = await getWorkerStatus(prisma);
  return { browserSync, worker };
}

function getBrowserSyncMode(): SyncRuntimeStatus["browserSync"] {
  if (process.env.NEXT_PUBLIC_DISABLE_BROWSER_SYNC === "true") {
    return {
      mode: "disabled",
      reason: "Force-disabled by NEXT_PUBLIC_DISABLE_BROWSER_SYNC.",
    };
  }

  if (process.env.NODE_ENV === "production") {
    if (process.env.NEXT_PUBLIC_ENABLE_BROWSER_SYNC === "true") {
      return {
        mode: "enabled",
        reason: "Production override is enabled.",
      };
    }
    return {
      mode: "disabled",
      reason: "Production defaults to worker-mode sync.",
    };
  }

  return {
    mode: "enabled",
    reason: "Local development fallback is enabled.",
  };
}

async function getWorkerStatus(
  prisma: PrismaClient,
): Promise<SyncRuntimeStatus["worker"]> {
  try {
    const rows = await prisma.$queryRaw<
      Array<{ identifier: string; last_execution: Date | null }>
    >`
      SELECT identifier, last_execution
      FROM graphile_worker._private_known_crontabs
      WHERE identifier IN ('gmail-sync', 'calendar-sync')
      ORDER BY identifier ASC
    `;

    const crons = (["gmail-sync", "calendar-sync"] as const).map((task) => {
      const row = rows.find((candidate) => candidate.identifier === task);
      const lastExecution = row?.last_execution ?? null;
      const cadenceMinutes = CRON_CADENCE_MINUTES[task];
      return {
        task,
        lastExecution: lastExecution?.toISOString() ?? null,
        cadenceMinutes,
        stale: isCronStale(lastExecution, cadenceMinutes),
      };
    });

    if (rows.length === 0 || crons.every((cron) => !cron.lastExecution)) {
      return { status: "not_configured", crons };
    }

    return {
      status: crons.some((cron) => cron.stale) ? "stale" : "healthy",
      crons,
    };
  } catch {
    return {
      status: "not_configured",
      crons: (["gmail-sync", "calendar-sync"] as const).map((task) => ({
        task,
        lastExecution: null,
        cadenceMinutes: CRON_CADENCE_MINUTES[task],
        stale: true,
      })),
    };
  }
}

function isCronStale(lastExecution: Date | null, cadenceMinutes: number): boolean {
  if (!lastExecution) return true;
  return (
    Date.now() - lastExecution.getTime() >
    cadenceMinutes * STALE_MULTIPLIER * 60 * 1000
  );
}

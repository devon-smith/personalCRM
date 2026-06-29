import type { PrismaClient } from "@/generated/prisma/client";

export type BrowserSyncMode = "enabled" | "disabled";
export type WorkerRuntimeStatus = "healthy" | "stale" | "not_configured";

export interface WorkerCronStatus {
  task: "gmail-sync" | "calendar-sync";
  lastExecution: string | null;
  cadenceMinutes: number;
  stale: boolean;
}

export interface RecentSyncRunStatus {
  id: string;
  source: string;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  itemsProcessed: number | null;
  providerCalls: number | null;
  error: string | null;
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
  recentRuns: RecentSyncRunStatus[];
}

const CRON_CADENCE_MINUTES: Record<WorkerCronStatus["task"], number> = {
  "gmail-sync": 3,
  "calendar-sync": 30,
};

const STALE_MULTIPLIER = 3;

export async function getSyncRuntimeStatus(
  prisma: PrismaClient,
  userId?: string,
): Promise<SyncRuntimeStatus> {
  const [worker, recentRuns] = await Promise.all([
    getWorkerStatus(prisma),
    userId ? getRecentSyncRuns(prisma, userId) : Promise.resolve([]),
  ]);
  return { browserSync: getBrowserSyncMode(), worker, recentRuns };
}

function getBrowserSyncMode(): SyncRuntimeStatus["browserSync"] {
  if (process.env.NEXT_PUBLIC_DISABLE_BROWSER_SYNC === "true") {
    return {
      mode: "disabled",
      reason: "Force-disabled by NEXT_PUBLIC_DISABLE_BROWSER_SYNC.",
    };
  }

  if (process.env.NEXT_PUBLIC_ENABLE_BROWSER_SYNC === "true") {
    return {
      mode: "enabled",
      reason: "Explicitly enabled by NEXT_PUBLIC_ENABLE_BROWSER_SYNC.",
    };
  }

  return {
    mode: "disabled",
    reason: "Browser fallback is opt-in; worker/manual sync own freshness.",
  };
}

async function getRecentSyncRuns(
  prisma: PrismaClient,
  userId: string,
): Promise<RecentSyncRunStatus[]> {
  try {
    const runs = await prisma.syncRun.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
      take: 6,
      select: {
        id: true,
        source: true,
        trigger: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        durationMs: true,
        itemsProcessed: true,
        providerCalls: true,
        error: true,
      },
    });

    return runs.map((run) => ({
      id: run.id,
      source: run.source,
      trigger: run.trigger,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      durationMs: run.durationMs,
      itemsProcessed: run.itemsProcessed,
      providerCalls: run.providerCalls,
      error: run.error,
    }));
  } catch {
    return [];
  }
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

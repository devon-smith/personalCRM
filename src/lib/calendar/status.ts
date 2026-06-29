import { prisma } from "@/lib/prisma";

export type CalendarConnectionState =
  | "connected"
  | "not_connected"
  | "missing_scope";

export interface CalendarSyncStatus {
  connection: CalendarConnectionState;
  canSync: boolean;
  hasGoogleAccount: boolean;
  hasCalendarScope: boolean;
  syncedMeetingCount: number;
  lastMeetingSyncedAt: string | null;
  lastSyncRunAt: string | null;
  lastSyncRunStatus: string | null;
  lastSyncRunError: string | null;
}

export async function getCalendarSyncStatus(
  userId: string,
): Promise<CalendarSyncStatus> {
  const [accounts, syncedMeetingCount, lastMeetingSync, lastSyncRun] =
    await Promise.all([
      prisma.account.findMany({
        where: {
          userId,
          provider: "google",
          access_token: { not: null },
          needsReconnect: false,
        },
        select: { scope: true },
      }),
      prisma.interaction.count({
        where: {
          userId,
          type: "MEETING",
          sourceId: { startsWith: "cal:" },
        },
      }),
      prisma.interaction.findFirst({
        where: {
          userId,
          type: "MEETING",
          sourceId: { startsWith: "cal:" },
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      prisma.syncRun.findFirst({
        where: { userId, source: "calendar" },
        orderBy: { startedAt: "desc" },
        select: {
          startedAt: true,
          status: true,
          error: true,
        },
      }),
    ]);

  const hasGoogleAccount = accounts.length > 0;
  const hasCalendarScope = accounts.some(
    (account) =>
      (!account.scope || account.scope.includes("calendar.readonly")),
  );
  const connection: CalendarConnectionState = !hasGoogleAccount
    ? "not_connected"
    : hasCalendarScope
      ? "connected"
      : "missing_scope";

  return {
    connection,
    canSync: connection === "connected",
    hasGoogleAccount,
    hasCalendarScope,
    syncedMeetingCount,
    lastMeetingSyncedAt: lastMeetingSync?.createdAt.toISOString() ?? null,
    lastSyncRunAt: lastSyncRun?.startedAt.toISOString() ?? null,
    lastSyncRunStatus: lastSyncRun?.status ?? null,
    lastSyncRunError: lastSyncRun?.error ?? null,
  };
}

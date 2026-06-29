import { syncCalendarEvents, type CalendarSyncResult } from "@/lib/calendar";
import {
  initialGmailSync,
  incrementalGmailSync,
  type GmailSyncResult,
} from "@/lib/gmail/sync";
import { prisma } from "@/lib/prisma";
import { recordSyncRun, type SyncTrigger } from "@/lib/sync/run-telemetry";

export async function runGmailSyncForUser(
  userId: string,
  trigger: SyncTrigger,
): Promise<GmailSyncResult> {
  const syncState = await prisma.gmailSyncState.findUnique({
    where: { userId },
    select: { historyId: true },
  });
  const mode = syncState?.historyId ? "incremental" : "initial";

  return recordSyncRun({
    userId,
    source: "gmail",
    trigger,
    metadata: { mode },
    run: async (): Promise<GmailSyncResult> =>
      syncState?.historyId
        ? incrementalGmailSync(userId)
        : initialGmailSync(userId),
    summarize: (result) => {
      const total = "total" in result ? result.total : null;
      const done = "done" in result ? result.done : null;
      return {
        itemsProcessed: result.processed,
        metadata: {
          mode,
          processed: result.processed,
          total,
          done,
          changedThreadCount: result.changedThreads.length,
        },
      };
    },
  });
}

export async function runCalendarSyncForUser(
  userId: string,
  trigger: SyncTrigger,
  days: number = 90,
): Promise<CalendarSyncResult> {
  return recordSyncRun({
    userId,
    source: "calendar",
    trigger,
    metadata: { days },
    run: () => syncCalendarEvents(userId, days),
    summarize: (result) => ({
      itemsProcessed: result.eventsScanned,
      metadata: {
        days,
        eventsScanned: result.eventsScanned,
        interactionsLogged: result.interactionsLogged,
        interactionsExisted: result.interactionsExisted,
        contactsMatched: result.contactsMatched,
      },
    }),
  });
}

import { prisma } from "@/lib/prisma";
import { initialGmailSync } from "@/lib/gmail/sync";
import { discoverContactsFromGmail } from "@/lib/gmail/discover";
import { extractActionItemsBackfill } from "@/lib/gmail/extract-actions";

// ─── Types ───────────────────────────────────────────────────

export interface GmailBackfillResult {
  readonly syncProcessed: number;
  readonly syncTotal: number;
  readonly discoverContactsCreated: number;
  readonly discoverInteractionsLogged: number;
  readonly discoverContactsExisted: number;
  readonly discoverError: string | null;
  readonly actionItemsFound: number;
  readonly actionItemsSaved: number;
  readonly actionItemsError: string | null;
}

export interface BackfillResult {
  readonly gmail: GmailBackfillResult | null;
  readonly totalInteractionsAfter: number;
  readonly totalContacts: number;
}

// ─── Gmail backfill ─────────────────────────────────────────

export async function backfillGmail(
  userId: string,
): Promise<GmailBackfillResult> {
  console.log("[backfill] Starting Gmail backfill (90 days)");

  // Run the existing initial sync (already does 90 days with pagination)
  const syncResult = await initialGmailSync(userId, 100);
  console.log(
    `[backfill] Gmail sync: ${syncResult.processed} processed, ${syncResult.total} total`,
  );

  // Also run discover to find new contacts from emails
  // This can fail on token issues — don't let it break the whole backfill
  let discoverContactsCreated = 0;
  let discoverInteractionsLogged = 0;
  let discoverContactsExisted = 0;
  let discoverError: string | null = null;

  try {
    const discoverResult = await discoverContactsFromGmail(userId, 90, 500);
    discoverContactsCreated = discoverResult.contactsCreated;
    discoverInteractionsLogged = discoverResult.interactionsLogged;
    discoverContactsExisted = discoverResult.contactsExisted;
    console.log(
      `[backfill] Gmail discover: ${discoverResult.contactsCreated} contacts created, ${discoverResult.interactionsLogged} interactions logged`,
    );
  } catch (err) {
    discoverError = err instanceof Error ? err.message : "Discover failed";
    console.error("[backfill] Gmail discover failed (non-fatal):", discoverError);
  }

  // Run email action item extraction (90-day backfill)
  let actionItemsFound = 0;
  let actionItemsSaved = 0;
  let actionItemsError: string | null = null;

  try {
    const actionResult = await extractActionItemsBackfill(userId, 90);
    actionItemsFound = actionResult.actionsFound;
    actionItemsSaved = actionResult.actionsSaved;
    console.log(
      `[backfill] Email actions: ${actionResult.actionsFound} found, ${actionResult.actionsSaved} saved`,
    );
  } catch (err) {
    actionItemsError = err instanceof Error ? err.message : "Action extraction failed";
    console.error("[backfill] Email action extraction failed (non-fatal):", actionItemsError);
  }

  return {
    syncProcessed: syncResult.processed,
    syncTotal: syncResult.total,
    discoverContactsCreated,
    discoverInteractionsLogged,
    discoverContactsExisted,
    discoverError,
    actionItemsFound,
    actionItemsSaved,
    actionItemsError,
  };
}

// ─── Full backfill ──────────────────────────────────────────

export async function runBackfill(
  userId: string,
  sources: readonly string[],
): Promise<BackfillResult> {
  let gmailResult: GmailBackfillResult | null = null;

  if (sources.includes("gmail")) {
    try {
      gmailResult = await backfillGmail(userId);
    } catch (err) {
      console.error("[backfill] Gmail backfill failed:", err);
    }
  }

  // Get final counts
  const [totalInteractions, totalContacts] = await Promise.all([
    prisma.interaction.count({ where: { userId } }),
    prisma.contact.count({ where: { userId } }),
  ]);

  return {
    gmail: gmailResult,
    totalInteractionsAfter: totalInteractions,
    totalContacts,
  };
}

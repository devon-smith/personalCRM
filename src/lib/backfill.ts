import { prisma } from "@/lib/prisma";
import { getAllMessages } from "@/lib/imessage";
import { normalizePhone } from "@/lib/name-utils";
import { initialGmailSync } from "@/lib/gmail/sync";
import { discoverContactsFromGmail } from "@/lib/gmail/discover";
import { extractActionItemsBackfill } from "@/lib/gmail/extract-actions";

// ─── Types ───────────────────────────────────────────────────

export interface HandleSuggestion {
  readonly contactId: string;
  readonly contactName: string;
  readonly reason: string;
  readonly confidence: number;
}

export interface UnmatchedHandle {
  readonly handle: string;
  readonly messageCount: number;
  readonly service: string;
  readonly suggestions?: readonly HandleSuggestion[];
}

export interface IMessageBackfillResult {
  readonly messagesScanned: number;
  readonly contactsMatched: number;
  readonly interactionsCreated: number;
  readonly alreadyExisted: number;
  readonly shortCodeFiltered: number;
  readonly unmatchedHandles: readonly UnmatchedHandle[];
}

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
  readonly imessage: IMessageBackfillResult | null;
  readonly gmail: GmailBackfillResult | null;
  readonly totalInteractionsAfter: number;
  readonly totalContacts: number;
}

// ─── Short-code filter ──────────────────────────────────────

function isShortCode(handle: string): boolean {
  if (handle.includes("@")) return false;
  const digits = handle.replace(/\D/g, "");
  return digits.length < 7;
}

// ─── iMessage backfill ──────────────────────────────────────

export async function backfillIMessages(
  userId: string,
  days: number = 90,
): Promise<IMessageBackfillResult> {
  console.log(`[backfill] Starting iMessage backfill for ${days} days`);

  // 1. Read all messages from chat.db
  const { messages, error } = await getAllMessages(days);
  if (error) {
    console.error("[backfill] chat.db error:", error);
    return {
      messagesScanned: 0,
      contactsMatched: 0,
      interactionsCreated: 0,
      alreadyExisted: 0,
      shortCodeFiltered: 0,
      unmatchedHandles: [],
    };
  }

  console.log(`[backfill] Read ${messages.length} messages from chat.db`);

  // 2. Filter out short-code SMS
  let shortCodeFiltered = 0;
  const filteredMessages = messages.filter((m) => {
    if (isShortCode(m.handleId)) {
      shortCodeFiltered++;
      return false;
    }
    return true;
  });

  console.log(
    `[backfill] After filtering short codes: ${filteredMessages.length} messages (${shortCodeFiltered} short codes removed)`,
  );

  // 3. Load contacts for matching
  const contacts = await prisma.contact.findMany({
    where: { userId },
    select: { id: true, phone: true, additionalPhones: true, email: true, additionalEmails: true },
  });

  const byPhone = new Map<string, string>();
  const byEmail = new Map<string, string>();

  for (const c of contacts) {
    if (c.phone) {
      byPhone.set(normalizePhone(c.phone), c.id);
    }
    for (const ap of c.additionalPhones) {
      byPhone.set(normalizePhone(ap), c.id);
    }
    if (c.email) {
      byEmail.set(c.email.toLowerCase(), c.id);
    }
    for (const extra of c.additionalEmails) {
      byEmail.set(extra.toLowerCase(), c.id);
    }
  }

  // 4. Match handles → contacts, build a handle→contactId map
  const handleToContact = new Map<string, string>();
  const unmatchedCounts = new Map<string, { count: number; service: string }>();

  const uniqueHandles = new Set(filteredMessages.map((m) => m.handleId));

  for (const handle of uniqueHandles) {
    let contactId: string | undefined;

    if (handle.includes("@")) {
      contactId = byEmail.get(handle.toLowerCase());
    } else {
      const normalized = normalizePhone(handle);
      contactId = byPhone.get(normalized);
      // Try last-10-digit fallback
      if (!contactId) {
        const digits = normalized.replace(/\D/g, "");
        const last10 = digits.slice(-10);
        for (const [storedPhone, id] of byPhone) {
          if (storedPhone.replace(/\D/g, "").slice(-10) === last10) {
            contactId = id;
            break;
          }
        }
      }
    }

    if (contactId) {
      handleToContact.set(handle, contactId);
    }
  }

  // 5. Get existing sourceIds for dedup
  const existingSourceIds = new Set(
    (
      await prisma.interaction.findMany({
        where: {
          userId,
          sourceId: { startsWith: "imsg:" },
        },
        select: { sourceId: true },
      })
    ).map((i) => i.sourceId),
  );

  // Also get "imsg-ind:" sourceIds (from the regular sync)
  const existingIndSourceIds = new Set(
    (
      await prisma.interaction.findMany({
        where: {
          userId,
          sourceId: { startsWith: "imsg-ind:" },
        },
        select: { sourceId: true },
      })
    ).map((i) => i.sourceId),
  );

  // 6. Build batch of interactions to create
  let interactionsCreated = 0;
  let alreadyExisted = 0;
  const matchedContactIds = new Set<string>();
  const BATCH_SIZE = 500;
  let batch: Array<{
    userId: string;
    contactId: string;
    type: "MESSAGE";
    direction: "INBOUND" | "OUTBOUND";
    channel: string;
    subject: string;
    summary: string;
    occurredAt: Date;
    sourceId: string;
  }> = [];

  for (let i = 0; i < filteredMessages.length; i++) {
    const msg = filteredMessages[i];
    const contactId = handleToContact.get(msg.handleId);

    if (!contactId) {
      // Track unmatched
      const existing = unmatchedCounts.get(msg.handleId);
      if (existing) {
        existing.count++;
      } else {
        unmatchedCounts.set(msg.handleId, { count: 1, service: msg.service });
      }
      continue;
    }

    const sourceId = `imsg:${msg.guid}`;

    // Check both old and new sourceId formats
    if (existingSourceIds.has(sourceId) || existingIndSourceIds.has(`imsg-ind:${msg.guid}`)) {
      alreadyExisted++;
      continue;
    }

    matchedContactIds.add(contactId);

    const summary =
      msg.text && msg.text.length > 500
        ? msg.text.slice(0, 500) + "..."
        : (msg.text ?? "");

    batch.push({
      userId,
      contactId,
      type: "MESSAGE",
      direction: msg.isFromMe ? "OUTBOUND" : "INBOUND",
      channel: msg.service === "SMS" ? "SMS" : "iMessage",
      subject: `${msg.service === "SMS" ? "SMS" : "iMessage"} message`,
      summary,
      occurredAt: msg.date,
      sourceId,
    });

    // Flush batch
    if (batch.length >= BATCH_SIZE) {
      const result = await prisma.interaction.createMany({
        data: batch,
        skipDuplicates: true,
      });
      interactionsCreated += result.count;
      console.log(
        `[backfill] Processed ${i + 1}/${filteredMessages.length} messages, ${matchedContactIds.size} contacts matched`,
      );
      batch = [];
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    const result = await prisma.interaction.createMany({
      data: batch,
      skipDuplicates: true,
    });
    interactionsCreated += result.count;
  }

  console.log(
    `[backfill] iMessage complete: ${interactionsCreated} created, ${alreadyExisted} existed, ${matchedContactIds.size} contacts`,
  );

  // 7. Update lastInteraction for matched contacts
  for (const contactId of matchedContactIds) {
    const latest = await prisma.interaction.findFirst({
      where: { contactId, userId },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    });
    if (latest) {
      await prisma.contact.update({
        where: { id: contactId },
        data: { lastInteraction: latest.occurredAt },
      });
    }
  }

  // 8. Build unmatched handles report, sorted by message count
  const rawUnmatched = [...unmatchedCounts.entries()]
    .map(([handle, { count, service }]) => ({
      handle,
      messageCount: count,
      service,
    }))
    .sort((a, b) => b.messageCount - a.messageCount);

  if (rawUnmatched.length > 0) {
    console.log(`[backfill] Top unmatched handles:`);
    for (const uh of rawUnmatched.slice(0, 20)) {
      console.log(`  ${uh.handle} — ${uh.messageCount} messages (${uh.service})`);
    }
  }

  // 9. Auto-suggest for handles with 5+ messages
  const unmatchedHandles: UnmatchedHandle[] = rawUnmatched.map((uh) => {
    if (uh.messageCount < 5) return uh;

    const suggestions: HandleSuggestion[] = [];
    const handleDigits = uh.handle.replace(/\D/g, "");
    const isEmail = uh.handle.includes("@");

    if (!isEmail && handleDigits.length >= 7) {
      const last4 = handleDigits.slice(-4);
      const areaCode = handleDigits.length >= 10
        ? handleDigits.slice(-10, -7)
        : null;

      for (const c of contacts) {
        if (!c.phone) continue;
        const cDigits = normalizePhone(c.phone).replace(/\D/g, "");
        const cLast4 = cDigits.slice(-4);
        const cAreaCode = cDigits.length >= 10
          ? cDigits.slice(-10, -7)
          : null;

        if (areaCode && cAreaCode === areaCode && cLast4 === last4) {
          suggestions.push({
            contactId: c.id,
            contactName: "",  // We only have id from the select
            reason: `Same area code (${areaCode}) + last 4 digits`,
            confidence: 0.5,
          });
        } else if (areaCode && cAreaCode === areaCode) {
          suggestions.push({
            contactId: c.id,
            contactName: "",
            reason: `Same area code (${areaCode})`,
            confidence: 0.2,
          });
        }
      }
    }

    return {
      ...uh,
      suggestions: suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 5),
    };
  });

  return {
    messagesScanned: filteredMessages.length,
    contactsMatched: matchedContactIds.size,
    interactionsCreated,
    alreadyExisted,
    shortCodeFiltered,
    unmatchedHandles,
  };
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
  days: number = 90,
): Promise<BackfillResult> {
  let imessageResult: IMessageBackfillResult | null = null;
  let gmailResult: GmailBackfillResult | null = null;

  if (sources.includes("imessage")) {
    try {
      imessageResult = await backfillIMessages(userId, days);
    } catch (err) {
      console.error("[backfill] iMessage backfill failed:", err);
    }
  }

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
    imessage: imessageResult,
    gmail: gmailResult,
    totalInteractionsAfter: totalInteractions,
    totalContacts,
  };
}

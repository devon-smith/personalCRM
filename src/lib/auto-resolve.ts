import { prisma } from "@/lib/prisma";
import { normalizeChannel } from "@/lib/filters";

// ─── Types ──────────────────────────────────────────────────

export interface AutoResolveResult {
  readonly inboxItemsResolved: number;
  readonly actionItemsResolved: number;
  readonly snoozesCleared: number;
}

function doesReplyResolve(replyChannel: string, itemChannel: string | null): boolean {
  // If no channel on the item, assume it matches
  if (!itemChannel) return true;
  // Meeting resolves everything (you talked in person)
  if (replyChannel === "meeting" || replyChannel === "calendar") return true;
  return normalizeChannel(replyChannel) === normalizeChannel(itemChannel);
}

// ─── Parse classification from context JSON ─────────────────

function parseClassification(context: string | null): string | null {
  if (!context) return null;
  try {
    const parsed = JSON.parse(context);
    return parsed.classification ?? null;
  } catch {
    return null;
  }
}

// ─── Main auto-resolve function ─────────────────────────────

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Called whenever an OUTBOUND interaction is created for a contact.
 * Automatically resolves inbox snoozes and applicable action items.
 */
export async function autoResolveOnOutbound(
  userId: string,
  contactId: string,
  channel: string,
  occurredAt: Date,
): Promise<AutoResolveResult> {
  let snoozesCleared = 0;
  let actionItemsResolved = 0;

  // a) Clear any active snoozes — you've actually replied
  const snoozeDeletion = await prisma.snoozedContact.deleteMany({
    where: { userId, contactId },
  });
  snoozesCleared = snoozeDeletion.count;

  // b) Find OPEN action items for this contact
  const openItems = await prisma.actionItem.findMany({
    where: {
      userId,
      contactId,
      status: "OPEN",
    },
  });

  for (const item of openItems) {
    // Don't resolve stale items (>30 days old)
    const itemAge = occurredAt.getTime() - item.extractedAt.getTime();
    if (itemAge > THIRTY_DAYS_MS) continue;

    // Only resolve items created before the reply
    if (item.extractedAt > occurredAt) continue;

    // Check channel compatibility
    const itemChannel = item.channel ?? parseChannelFromContext(item.context);
    if (!doesReplyResolve(channel, itemChannel)) continue;

    // Get classification from the dedicated field or context JSON
    const classification = item.classification ?? parseClassification(item.context);

    if (classification === "action_required") {
      // DON'T auto-complete — replying doesn't mean you did the action.
      // The inbox resolution (needs-response query) handles visibility.
      continue;
    }

    // invitation, fyi, reply_only, or unknown — mark as DONE
    await prisma.actionItem.update({
      where: { id: item.id },
      data: {
        status: "DONE",
        resolvedAt: occurredAt,
        resolvedBy: "auto",
      },
    });
    actionItemsResolved++;
  }

  // Inbox items resolve naturally via needs-response query
  // (it checks for OUTBOUND after last INBOUND).
  // No extra DB writes needed for inbox resolution.
  const inboxItemsResolved = snoozesCleared > 0 ? 1 : 0;

  if (actionItemsResolved > 0 || snoozesCleared > 0) {
    console.log(
      `[auto-resolve] ${channel}: ${actionItemsResolved} action items resolved, ${snoozesCleared} snoozes cleared`,
    );
  }

  return { inboxItemsResolved, actionItemsResolved, snoozesCleared };
}

// ─── Helpers ────────────────────────────────────────────────

function parseChannelFromContext(context: string | null): string | null {
  if (!context) return null;
  try {
    const parsed = JSON.parse(context);
    return parsed.channel ?? null;
  } catch {
    return null;
  }
}

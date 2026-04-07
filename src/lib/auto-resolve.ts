import { prisma } from "@/lib/prisma";
import { normalizeChannel } from "@/lib/filters";

// ─── Types ──────────────────────────────────────────────────

export interface AutoResolveResult {
  readonly actionItemsResolved: number;
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
  let actionItemsResolved = 0;

  // Find OPEN action items for this contact
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

  if (actionItemsResolved > 0) {
    console.log(
      `[auto-resolve] ${channel}: ${actionItemsResolved} action items resolved`,
    );
  }

  return { actionItemsResolved };
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

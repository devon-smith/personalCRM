/**
 * Pure helpers for the inbox-draft-prepopulate worker (M0.9 task 5).
 *
 * Build a generateDraft input from an OPEN InboxItem. The worker
 * orchestrates DB I/O; this module owns the shape decisions:
 *   - which channels are eligible (only email today)
 *   - how to derive threadSubject + threadSnippet from
 *     messagePreview JSON
 *   - the default tone + context for an auto-draft
 *
 * Kept pure so the worker can be tested without spinning up a
 * Prisma client or Anthropic mock.
 */

import type { GenerateDraftParams } from "@/lib/draft-generator";

export interface InboxItemForDraft {
  readonly id: string;
  readonly userId: string;
  readonly contactId: string;
  readonly channel: string;
  readonly messagePreview: unknown;
}

interface MessagePreviewEntry {
  summary?: string;
  occurredAt?: string;
  channel?: string;
}

/**
 * Eligible channels: only email today. iMessage / LinkedIn don't
 * map onto the `reply_email` DraftContext, and a generic
 * `follow_up` for those would be more confusing than helpful.
 */
export function isEligibleForAutoDraft(item: {
  channel: string;
}): boolean {
  return item.channel === "email" || item.channel === "gmail";
}

/**
 * Pull the most recent message summary from the InboxItem's JSON
 * preview blob. Returns null when the structure is missing or empty.
 */
export function extractLatestPreviewSummary(
  messagePreview: unknown,
): string | null {
  if (!Array.isArray(messagePreview)) return null;
  const previews = messagePreview as MessagePreviewEntry[];
  for (const p of previews) {
    if (typeof p?.summary === "string" && p.summary.trim().length > 0) {
      return p.summary.trim();
    }
  }
  return null;
}

/**
 * Translate an InboxItem into the params generateDraft expects.
 *
 *   - tone: "warm" — sensible default; user can change in the modal
 *   - context: "reply_email" — auto-draft is always a reply
 *   - threadSubject: first 140 chars of the latest preview summary
 *   - threadSnippet: full preview summary
 *
 * Returns null when the item isn't eligible (caller skips).
 */
export function buildDraftInputFromInboxItem(
  item: InboxItemForDraft,
): GenerateDraftParams | null {
  if (!isEligibleForAutoDraft(item)) return null;
  const summary = extractLatestPreviewSummary(item.messagePreview);
  return {
    userId: item.userId,
    contactId: item.contactId,
    tone: "warm",
    context: "reply_email",
    threadSubject: summary ? summary.slice(0, 140) : undefined,
    threadSnippet: summary ?? undefined,
    contextDetail: summary ?? undefined,
  };
}

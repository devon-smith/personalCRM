/**
 * Reply-context loader (M0.x.4).
 *
 * The draft generator's "reply_email" mode needs the actual inbound
 * message Jennifer is replying to, plus a few messages of thread
 * history, plus the sender. Without this Claude generates a generic
 * outreach email — exactly what the spec says NOT to do.
 *
 * Strategy:
 *   1. Pull last N EmailMessage rows from the thread (cheap).
 *   2. Identify the most recent INBOUND row — that's the one being
 *      replied to.
 *   3. If its `fullBody` is already cached, use it. Otherwise fetch
 *      from Gmail's messages.get API on demand and persist back to
 *      EmailMessage.fullBody for next time (extends the M6.1
 *      voice-corpus pattern to inbound rows).
 *   4. Fall back to snippet if the Gmail fetch fails — better
 *      truncated context than no context.
 *
 * Pure I/O — takes prisma + userId + threadKey, returns structured
 * data. The prompt-construction lives in draft-generator.ts.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import { fetchMessageBody } from "@/lib/gmail/fetch-body";

const THREAD_HISTORY_DEPTH = 5;

export interface ReplyContextMessage {
  /** "INBOUND" | "OUTBOUND" */
  readonly direction: string;
  readonly fromEmail: string;
  readonly fromName: string | null;
  readonly subject: string | null;
  readonly snippet: string | null;
  readonly occurredAt: Date;
}

export interface ReplyContext {
  readonly latestInbound: {
    readonly fromEmail: string;
    readonly fromName: string | null;
    readonly subject: string | null;
    /** Best body available — fullBody from Gmail if fetched, else
     *  the 500-char snippet, else empty. */
    readonly body: string;
    /** True when `body` came from Gmail's full-fetch (vs. snippet). */
    readonly bodyIsFull: boolean;
    readonly occurredAt: Date;
  };
  /** Last N messages in the thread, oldest first. Includes the
   *  latestInbound row. */
  readonly threadHistory: ReplyContextMessage[];
}

interface LoadReplyContextArgs {
  readonly prisma: PrismaClient;
  readonly userId: string;
  /** InboxItem.threadKey — "gmail:<threadId>" for Gmail. We strip the
   *  "gmail:" prefix here because EmailMessage.threadId stores the
   *  raw Gmail thread ID. */
  readonly threadKey: string;
}

/** Strip the "gmail:" channel prefix from an InboxItem threadKey. */
export function normalizeThreadId(threadKey: string): string {
  if (threadKey.startsWith("gmail:")) return threadKey.slice("gmail:".length);
  return threadKey;
}

export async function loadReplyContext(
  args: LoadReplyContextArgs,
): Promise<ReplyContext | null> {
  const threadId = normalizeThreadId(args.threadKey);
  if (!threadId) return null;

  const recent = await args.prisma.emailMessage.findMany({
    where: {
      userId: args.userId,
      threadId,
    },
    orderBy: { occurredAt: "desc" },
    take: THREAD_HISTORY_DEPTH,
    select: {
      id: true,
      direction: true,
      fromEmail: true,
      fromName: true,
      subject: true,
      snippet: true,
      fullBody: true,
      occurredAt: true,
    },
  });

  if (recent.length === 0) return null;

  const latestInbound = recent.find((m) => m.direction === "INBOUND");
  if (!latestInbound) return null;

  // Decide which body to surface. Prefer cached fullBody; otherwise
  // try Gmail; otherwise fall back to snippet.
  let body = latestInbound.fullBody ?? "";
  let bodyIsFull = body.length > 0;

  if (!bodyIsFull) {
    // Fetch from Gmail. EmailMessage.id is a CRM cuid; we need the
    // gmailId for the API call. Look it up cheaply (one row).
    const withGmailId = await args.prisma.emailMessage.findUnique({
      where: { id: latestInbound.id },
      select: { gmailId: true },
    });
    if (withGmailId?.gmailId) {
      try {
        const fetched = await fetchMessageBody(args.userId, withGmailId.gmailId);
        if (fetched?.body) {
          body = fetched.body;
          bodyIsFull = true;
          // Persist for next time — same cache pattern as M6.1.
          // Best-effort; never blocks the response on failure.
          await args.prisma.emailMessage
            .update({
              where: { id: latestInbound.id },
              data: { fullBody: fetched.body },
            })
            .catch(() => {
              // Ignore — the in-memory result is still good.
            });
        }
      } catch {
        // Gmail unavailable / token issue / message deleted — fall
        // back to snippet.
      }
    }
  }

  if (!bodyIsFull) {
    body = latestInbound.snippet ?? "";
  }

  // Reverse so oldest is first (chronological for the prompt).
  const history = [...recent].reverse().map((m) => ({
    direction: m.direction,
    fromEmail: m.fromEmail,
    fromName: m.fromName,
    subject: m.subject,
    snippet: m.snippet,
    occurredAt: m.occurredAt,
  }));

  return {
    latestInbound: {
      fromEmail: latestInbound.fromEmail,
      fromName: latestInbound.fromName,
      subject: latestInbound.subject,
      body,
      bodyIsFull,
      occurredAt: latestInbound.occurredAt,
    },
    threadHistory: history,
  };
}

/**
 * Build the "YOU ARE REPLYING TO THIS MESSAGE" block injected into
 * Claude's system prompt. Exported so we can unit-test the wording
 * + structure without a real Anthropic call.
 */
export function buildReplyPromptBlock(ctx: ReplyContext): string {
  const inbound = ctx.latestInbound;
  const sentLabel = formatRelativeDate(inbound.occurredAt);
  const fromLine = inbound.fromName
    ? `${inbound.fromName} <${inbound.fromEmail}>`
    : inbound.fromEmail;

  const historyLines = ctx.threadHistory
    .slice(0, -1) // exclude the latest inbound, shown in full below
    .map((m) => {
      const who =
        m.direction === "OUTBOUND" ? "You" : m.fromName ?? m.fromEmail;
      const date = m.occurredAt.toISOString().slice(0, 10);
      const subj = m.subject ? ` [${m.subject}]` : "";
      const snip = (m.snippet ?? "").slice(0, 200);
      return `  - ${date} ${who}${subj}: ${snip}`;
    });

  const historyBlock =
    historyLines.length > 0
      ? `PRIOR THREAD CONTEXT (oldest first):\n${historyLines.join("\n")}\n\n`
      : "";

  const bodyTag = inbound.bodyIsFull
    ? ""
    : "\n\n[Note: only the message snippet is available — Gmail's full body could not be fetched. Reply based on what's here without inventing details.]";

  return `YOU ARE REPLYING TO THIS MESSAGE. Read it carefully and write a reply that directly addresses what was said. Reference specific points from their message — do NOT write a generic catch-up email.

${historyBlock}THE MESSAGE TO REPLY TO:
From: ${fromLine}
Subject: ${inbound.subject ?? "(no subject)"}
Sent: ${sentLabel}

${inbound.body}${bodyTag}`;
}

function formatRelativeDate(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  }
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

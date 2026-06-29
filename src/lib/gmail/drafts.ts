import { getAllGoogleAccessTokens, googleFetchWithToken, getGoogleAccessToken } from "./client";
import { buildRawMessage, buildReplySubject } from "./mime";
import { logProviderCall } from "@/lib/provider-call-log";

// ─── Types ──────────────────────────────────────────────────

interface GmailDraft {
  id: string;
  message: {
    id: string;
    threadId: string;
  };
}

interface GmailDraftsResponse {
  drafts?: GmailDraft[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface CreateGmailDraftInput {
  /** From: header. The connected Google account's email. */
  from: string;
  /** Recipient email. Required. */
  to: string;
  /** Subject line (without "Re:" — buildReplySubject handles that). */
  subject: string;
  /** Plain-text body. */
  body: string;
  /** Optional HTML body — produces a multipart/alternative draft so
   *  Gmail renders the rich version while keeping plain-text fallback. */
  htmlBody?: string | null;
  /** Existing Gmail threadId to attach this draft to (for replies). */
  threadId?: string | null;
  /** Message-Id of the message we're replying to (for proper threading
   *  via In-Reply-To / References). */
  inReplyToMessageId?: string | null;
  /** Existing References chain to extend. */
  references?: string | null;
  /** If set, update this Gmail draft instead of creating a new one. */
  existingDraftId?: string | null;
  /** True if this is a reply (prepends "Re:" to subject idempotently). */
  isReply?: boolean;
}

export interface CreateGmailDraftResult {
  draftId: string;
  messageId: string;
  threadId: string;
}

export interface SendGmailDraftResult {
  messageId: string;
  threadId: string;
}

// ─── In-memory cache (2 min TTL) ────────────────────────────

interface CacheEntry {
  readonly threadIds: Set<string>;
  readonly expiresAt: number;
}

const CACHE_TTL_MS = 2 * 60 * 1000;
const draftCache = new Map<string, CacheEntry>();

/**
 * Fetch all Gmail drafts and return a Set of threadIds that have drafts.
 * Results are cached for 2 minutes per user.
 */
export async function getThreadsWithDrafts(userId: string): Promise<Set<string>> {
  const cached = draftCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.threadIds;
  }

  const tokens = await getAllGoogleAccessTokens(userId);
  if (tokens.length === 0) {
    return new Set();
  }

  const threadIds = new Set<string>();

  for (const { accountId, token } of tokens) {
    let pageToken: string | undefined;

    do {
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
      url.searchParams.set("maxResults", "100");
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const startedAt = Date.now();
      let res: Response;
      try {
        res = await googleFetchWithToken(token, url.toString());
      } catch (err) {
        await logGmailProviderCall({
          userId,
          operation: "gmail.drafts.list",
          feature: "gmail_draft_thread_scan",
          status: "error",
          latencyMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : "network error",
        });
        throw err;
      }
      if (!res.ok) {
        await logGmailProviderCall({
          userId,
          operation: "gmail.drafts.list",
          feature: "gmail_draft_thread_scan",
          status: "error",
          latencyMs: Date.now() - startedAt,
          error: `Gmail drafts.list failed: ${res.status}`,
        });
        break;
      }

      const data = (await res.json()) as GmailDraftsResponse;
      await logGmailProviderCall({
        userId,
        operation: "gmail.drafts.list",
        feature: "gmail_draft_thread_scan",
        status: "success",
        latencyMs: Date.now() - startedAt,
        itemCount: data.drafts?.length ?? 0,
        metadata: {
          accountId,
          hasNextPage: Boolean(data.nextPageToken),
        },
      });

      for (const draft of data.drafts ?? []) {
        if (draft.message?.threadId) {
          threadIds.add(draft.message.threadId);
        }
      }

      pageToken = data.nextPageToken;
    } while (pageToken);
  }

  draftCache.set(userId, {
    threadIds,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return threadIds;
}

/**
 * Create (or update) a Gmail draft via the Gmail API. Builds RFC 5322
 * MIME, base64url-encodes it, and POSTs to drafts.create — or PUTs to
 * drafts/{id} when `existingDraftId` is supplied so regenerations don't
 * leave behind duplicate drafts in Gmail.
 *
 * Invalidates the read-side cache so the inbox UI's "has draft" indicator
 * picks up the new draft immediately.
 *
 * Throws on any non-2xx response or when no valid access token exists
 * (caller should surface "reconnect Google" guidance to the user).
 */
export async function createGmailDraft(
  userId: string,
  input: CreateGmailDraftInput,
): Promise<CreateGmailDraftResult> {
  const token = await getGoogleAccessToken(userId);
  if (!token) {
    throw new Error("No valid Google access token. Reconnect Google to save drafts.");
  }

  const subject = input.isReply
    ? buildReplySubject(input.subject)
    : input.subject;

  const raw = buildRawMessage({
    from: input.from,
    to: input.to,
    subject,
    body: input.body,
    htmlBody: input.htmlBody,
    inReplyToMessageId: input.inReplyToMessageId,
    references: input.references,
  });

  const payload: Record<string, unknown> = {
    message: {
      raw,
      ...(input.threadId ? { threadId: input.threadId } : {}),
    },
  };

  const url = input.existingDraftId
    ? `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${input.existingDraftId}`
    : "https://gmail.googleapis.com/gmail/v1/users/me/drafts";
  const method = input.existingDraftId ? "PUT" : "POST";

  const operation = input.existingDraftId
    ? "gmail.drafts.update"
    : "gmail.drafts.create";
  const startedAt = Date.now();
  let res: Response;
  try {
    res = await googleFetchWithToken(token, url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    await logGmailProviderCall({
      userId,
      operation,
      feature: "gmail_draft_save",
      status: "error",
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : "network error",
    });
    throw err;
  }

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    await logGmailProviderCall({
      userId,
      operation,
      feature: "gmail_draft_save",
      status: "error",
      latencyMs: Date.now() - startedAt,
      error: `Gmail drafts.${input.existingDraftId ? "update" : "create"} failed: ${res.status}`,
      metadata: {
        isReply: input.isReply ?? false,
        hasThreadId: Boolean(input.threadId),
        hasExistingDraftId: Boolean(input.existingDraftId),
      },
    });
    throw new Error(`Gmail drafts.${input.existingDraftId ? "update" : "create"} failed: ${res.status} ${errorBody}`);
  }

  const data = (await res.json()) as {
    id: string;
    message: { id: string; threadId: string };
  };
  await logGmailProviderCall({
    userId,
    operation,
    feature: "gmail_draft_save",
    status: "success",
    latencyMs: Date.now() - startedAt,
    itemCount: 1,
    metadata: {
      isReply: input.isReply ?? false,
      hasThreadId: Boolean(input.threadId),
      hasExistingDraftId: Boolean(input.existingDraftId),
    },
  });

  // Invalidate the read cache so "has draft" badges refresh on next read.
  draftCache.delete(userId);

  return {
    draftId: data.id,
    messageId: data.message.id,
    threadId: data.message.threadId,
  };
}

export async function sendGmailDraft(
  userId: string,
  draftId: string,
): Promise<SendGmailDraftResult> {
  const token = await getGoogleAccessToken(userId);
  if (!token) {
    throw new Error("No valid Google access token. Reconnect Google to send drafts.");
  }

  const startedAt = Date.now();
  let res: Response;
  try {
    res = await googleFetchWithToken(
      token,
      "https://gmail.googleapis.com/gmail/v1/users/me/drafts/send",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draftId }),
      },
    );
  } catch (err) {
    await logGmailProviderCall({
      userId,
      operation: "gmail.drafts.send",
      feature: "gmail_draft_send",
      status: "error",
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : "network error",
    });
    throw err;
  }

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    await logGmailProviderCall({
      userId,
      operation: "gmail.drafts.send",
      feature: "gmail_draft_send",
      status: "error",
      latencyMs: Date.now() - startedAt,
      error: `Gmail drafts.send failed: ${res.status}`,
      metadata: { draftId },
    });
    throw new Error(`Gmail drafts.send failed: ${res.status} ${errorBody}`);
  }

  const data = (await res.json()) as { id: string; threadId: string };
  await logGmailProviderCall({
    userId,
    operation: "gmail.drafts.send",
    feature: "gmail_draft_send",
    status: "success",
    latencyMs: Date.now() - startedAt,
    itemCount: 1,
    metadata: { draftId },
  });
  draftCache.delete(userId);

  return {
    messageId: data.id,
    threadId: data.threadId,
  };
}

async function logGmailProviderCall(input: {
  userId: string;
  operation: string;
  feature: string;
  status: "success" | "error";
  latencyMs: number;
  itemCount?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}) {
  await logProviderCall({
    userId: input.userId,
    provider: "google",
    service: "gmail",
    operation: input.operation,
    feature: input.feature,
    callCount: 1,
    itemCount: input.itemCount ?? null,
    status: input.status,
    latencyMs: input.latencyMs,
    error: input.error,
    metadata: input.metadata,
  });
}

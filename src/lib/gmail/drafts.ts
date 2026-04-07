import { getAllGoogleAccessTokens, googleFetchWithToken } from "./client";

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

  for (const { token } of tokens) {
    let pageToken: string | undefined;

    do {
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
      url.searchParams.set("maxResults", "100");
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const res = await googleFetchWithToken(token, url.toString());
      if (!res.ok) break;

      const data = (await res.json()) as GmailDraftsResponse;

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

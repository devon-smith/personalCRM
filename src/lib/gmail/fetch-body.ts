/**
 * Fetch full email bodies from Gmail for the voice corpus (M6.1).
 *
 * The /messages list + get with format=metadata path that sync.ts uses
 * only returns headers + snippet. For voice modeling we need the full
 * text/plain (or extracted text/html) body. Gmail's per-message size
 * limit + base64url payload nesting makes this its own concern.
 */

import { googleFetch } from "./client";

interface GmailPayloadPart {
  mimeType: string;
  body?: { data?: string; size?: number };
  parts?: GmailPayloadPart[];
}

interface GmailMessageWithBody {
  id: string;
  threadId: string;
  internalDate: string;
  payload: GmailPayloadPart;
  snippet?: string;
}

export interface FetchedEmailBody {
  gmailId: string;
  body: string; // plain text body, signature + quotes still present
  /** True if we got an HTML-only body and extracted text from it (lossy). */
  fromHtml: boolean;
}

/**
 * Fetch a single message's body. Returns null if Gmail returns 404 (the
 * message was deleted between list and get) or if the body extraction
 * fails (encrypted attachments, etc.) — the caller treats null as "skip
 * and move on" rather than as a hard failure.
 */
export async function fetchMessageBody(
  userId: string,
  gmailId: string,
): Promise<FetchedEmailBody | null> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailId}?format=full`;
  const res = await googleFetch(userId, url);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Gmail messages.get ${gmailId} failed: ${res.status}`);
  }
  const message = (await res.json()) as GmailMessageWithBody;
  const extracted = extractBody(message.payload);
  if (!extracted) return null;
  return { gmailId, body: extracted.body, fromHtml: extracted.fromHtml };
}

/**
 * Batched body fetch. Gmail allows ~5 req/sec for the messages.get
 * endpoint per user — we serialize with a small concurrency window
 * rather than blast in parallel. Returns the bodies we managed to
 * fetch; failures are silently skipped (caller logs aggregate count).
 *
 * Concurrency of 4 keeps us well under the quota and is good enough
 * for backfilling thousands of emails over minutes, not hours.
 */
export async function fetchMessageBodiesBatch(
  userId: string,
  gmailIds: ReadonlyArray<string>,
  concurrency: number = 4,
): Promise<Map<string, FetchedEmailBody>> {
  const out = new Map<string, FetchedEmailBody>();
  const queue = [...gmailIds];

  async function worker() {
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) return;
      try {
        const result = await fetchMessageBody(userId, id);
        if (result) out.set(id, result);
      } catch {
        // Skip; aggregate failure count is the caller's concern.
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return out;
}

// ─── Body extraction ───────────────────────────────────────

interface ExtractedBody {
  body: string;
  fromHtml: boolean;
}

/**
 * Walk the Gmail payload tree to find a text/plain part. Falls back to
 * stripping HTML if only text/html is available. Returns null if no
 * readable body can be assembled.
 */
function extractBody(payload: GmailPayloadPart): ExtractedBody | null {
  const plain = findPart(payload, "text/plain");
  if (plain && plain.body?.data) {
    return { body: decodeBase64Url(plain.body.data), fromHtml: false };
  }
  const html = findPart(payload, "text/html");
  if (html && html.body?.data) {
    return { body: htmlToText(decodeBase64Url(html.body.data)), fromHtml: true };
  }
  // Some messages stash the body directly on the root payload (no parts).
  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === "text/plain") return { body: decoded, fromHtml: false };
    if (payload.mimeType === "text/html") {
      return { body: htmlToText(decoded), fromHtml: true };
    }
  }
  return null;
}

function findPart(
  part: GmailPayloadPart,
  targetMime: string,
): GmailPayloadPart | null {
  if (part.mimeType === targetMime) return part;
  if (!part.parts) return null;
  for (const child of part.parts) {
    const found = findPart(child, targetMime);
    if (found) return found;
  }
  return null;
}

function decodeBase64Url(data: string): string {
  // Gmail uses URL-safe base64 without padding. Convert + restore.
  const standardized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standardized + "===".slice((standardized.length + 3) % 4);
  return Buffer.from(padded, "base64").toString("utf-8");
}

/**
 * Strip HTML tags and decode common entities. Not a full HTML parser —
 * we just want readable text for feature extraction. Anything pathological
 * (script tags, CSS) gets dropped along with the markup.
 */
function htmlToText(html: string): string {
  return html
    // Remove style + script blocks entirely.
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    // Block-level tags become newlines so paragraphs survive.
    .replace(/<\/(p|div|br|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Strip remaining tags.
    .replace(/<[^>]+>/g, " ")
    // Decode the handful of entities that actually show up in mail.
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&[a-z]+;/gi, " ")
    // Collapse whitespace runs.
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

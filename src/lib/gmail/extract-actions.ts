import { prisma } from "@/lib/prisma";
import { googleFetch, getAllGoogleAccessTokens, googleFetchWithToken } from "./client";
import Anthropic from "@anthropic-ai/sdk";

const hasApiKey =
  !!process.env.ANTHROPIC_API_KEY &&
  process.env.ANTHROPIC_API_KEY !== "your-anthropic-api-key";

const anthropic = hasApiKey
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ─── Gmail types ───

interface GmailThread {
  id: string;
  messages: GmailFullMessage[];
}

interface GmailFullMessage {
  id: string;
  threadId: string;
  internalDate: string;
  payload: {
    headers: Array<{ name: string; value: string }>;
    body?: { data?: string };
    parts?: Array<{
      mimeType: string;
      body?: { data?: string };
      parts?: Array<{
        mimeType: string;
        body?: { data?: string };
      }>;
    }>;
  };
  snippet: string;
}

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
}

type Classification = "action_required" | "invitation" | "fyi";

interface AIClassification {
  readonly classification: Classification;
  readonly title: string | null;
  readonly urgency: "low" | "medium" | "high" | null;
  readonly reasoning: string;
}

export interface ExtractResult {
  threadsAnalyzed: number;
  actionsFound: number;
  actionsSaved: number;
}

// ─── Helpers ───

function getHeader(
  headers: Array<{ name: string; value: string }>,
  name: string,
): string | null {
  return (
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
    null
  );
}

function extractEmail(headerValue: string): string | null {
  const match =
    headerValue.match(/<([^>]+)>/) ??
    headerValue.match(/([^\s<,]+@[^\s>,]+)/);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Decode base64url-encoded Gmail body content.
 */
function decodeBody(encoded: string): string {
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(base64, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

/**
 * Extract plain text body from a Gmail message payload.
 * Walks the MIME tree looking for text/plain parts.
 */
function getMessageBody(message: GmailFullMessage): string {
  // Direct body
  if (message.payload.body?.data) {
    return decodeBody(message.payload.body.data);
  }

  // Walk parts looking for text/plain
  const parts = message.payload.parts ?? [];
  for (const part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return decodeBody(part.body.data);
    }
    // Nested multipart
    if (part.parts) {
      for (const subPart of part.parts) {
        if (subPart.mimeType === "text/plain" && subPart.body?.data) {
          return decodeBody(subPart.body.data);
        }
      }
    }
  }

  // Fallback to snippet
  return message.snippet ?? "";
}

/**
 * Clean up email body: strip signatures, forwarded headers, excessive whitespace.
 */
function cleanEmailBody(raw: string): string {
  const sigMarkers = [
    /^--\s*$/m,
    /^Sent from my /m,
    /^Get Outlook for /m,
    /^On .+ wrote:$/m,
    /^---------- Forwarded message/m,
  ];

  let body = raw;
  for (const marker of sigMarkers) {
    const match = body.match(marker);
    if (match?.index !== undefined && match.index > 50) {
      body = body.slice(0, match.index);
    }
  }

  return body.replace(/\n{3,}/g, "\n\n").trim();
}

// ─── Gmail fetching ───

/**
 * Fetch recent threads with full message bodies.
 * Paginates through all messages in the time window.
 */
async function fetchRecentThreads(
  userId: string,
  days: number = 90,
  maxThreads: number = 200,
): Promise<GmailThread[]> {
  const after = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
  const query = `after:${after} in:inbox -category:promotions -category:social -category:updates`;

  const allThreadIds = new Set<string>();
  let pageToken: string | undefined;

  // Paginate through message list to collect unique thread IDs
  do {
    const listUrl = new URL(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    );
    listUrl.searchParams.set("q", query);
    listUrl.searchParams.set("maxResults", "100");
    if (pageToken) listUrl.searchParams.set("pageToken", pageToken);

    const listRes = await googleFetch(userId, listUrl.toString());
    if (!listRes.ok) {
      console.error(`[extract-actions] Gmail list error: ${listRes.status}`);
      break;
    }

    const listData = (await listRes.json()) as GmailListResponse;
    for (const msg of listData.messages ?? []) {
      allThreadIds.add(msg.threadId);
    }

    pageToken = listData.nextPageToken;

    if (allThreadIds.size >= maxThreads) break;
  } while (pageToken);

  // Take up to maxThreads
  const threadIds = [...allThreadIds].slice(0, maxThreads);

  // Fetch each thread with full content (batched)
  const threads: GmailThread[] = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < threadIds.length; i += BATCH_SIZE) {
    const batch = threadIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (threadId) => {
        const threadUrl = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`;
        const threadRes = await googleFetch(userId, threadUrl);
        if (!threadRes.ok) return null;
        return (await threadRes.json()) as GmailThread;
      }),
    );

    for (const thread of results) {
      if (thread) threads.push(thread);
    }
  }

  return threads;
}

/**
 * Fetch threads using a specific account token (for multi-account backfill).
 */
async function fetchRecentThreadsWithToken(
  token: string,
  days: number = 90,
  maxThreads: number = 200,
): Promise<GmailThread[]> {
  const after = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
  const query = `after:${after} in:inbox -category:promotions -category:social -category:updates`;

  const allThreadIds = new Set<string>();
  let pageToken: string | undefined;

  do {
    const listUrl = new URL(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    );
    listUrl.searchParams.set("q", query);
    listUrl.searchParams.set("maxResults", "100");
    if (pageToken) listUrl.searchParams.set("pageToken", pageToken);

    const listRes = await googleFetchWithToken(token, listUrl.toString());
    if (!listRes.ok) {
      console.error(`[extract-actions] Gmail list error: ${listRes.status}`);
      break;
    }

    const listData = (await listRes.json()) as GmailListResponse;
    for (const msg of listData.messages ?? []) {
      allThreadIds.add(msg.threadId);
    }

    pageToken = listData.nextPageToken;

    if (allThreadIds.size >= maxThreads) break;
  } while (pageToken);

  const threadIds = [...allThreadIds].slice(0, maxThreads);
  const threads: GmailThread[] = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < threadIds.length; i += BATCH_SIZE) {
    const batch = threadIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (threadId) => {
        const threadUrl = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`;
        const threadRes = await googleFetchWithToken(token, threadUrl);
        if (!threadRes.ok) return null;
        return (await threadRes.json()) as GmailThread;
      }),
    );

    for (const thread of results) {
      if (thread) threads.push(thread);
    }
  }

  return threads;
}

// ─── AI Analysis ───

function buildThreadSummary(
  thread: GmailThread,
  userEmails: Set<string>,
): { summary: string; lastSenderEmail: string | null; isInbound: boolean } | null {
  // Take the last 3 messages in the thread for context
  const recentMessages = thread.messages.slice(-3);
  const parts: string[] = [];
  let lastSenderEmail: string | null = null;
  let lastIsInbound = false;

  for (const msg of recentMessages) {
    const from = getHeader(msg.payload.headers, "From") ?? "Unknown";
    const to = getHeader(msg.payload.headers, "To") ?? "";
    const subject = getHeader(msg.payload.headers, "Subject") ?? "(no subject)";
    const date = new Date(parseInt(msg.internalDate)).toLocaleDateString();
    const fromEmail = extractEmail(from);
    const isOutbound = fromEmail ? userEmails.has(fromEmail) : false;
    const direction = isOutbound ? "SENT" : "RECEIVED";

    lastSenderEmail = fromEmail;
    lastIsInbound = !isOutbound;

    let body = getMessageBody(msg);
    body = cleanEmailBody(body);
    if (body.length > 800) {
      body = body.slice(0, 800) + "...";
    }

    parts.push(
      `[${direction}] ${date} | From: ${from} | To: ${to}\nSubject: ${subject}\n${body}`,
    );
  }

  if (parts.length === 0) return null;

  return {
    summary: parts.join("\n\n---\n\n"),
    lastSenderEmail,
    isInbound: lastIsInbound,
  };
}

/**
 * Classify an email thread using the strict prompt matching message-actions.ts.
 */
async function classifyThread(
  threadSummary: string,
  senderName: string,
): Promise<AIClassification | null> {
  if (!anthropic) return null;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `You are classifying an email thread for a personal CRM. Your job is to determine if this thread contains a DIRECT REQUEST for the recipient to take a specific real-world action.

Email thread (most recent messages from ${senderName}):
"${threadSummary.slice(0, 1500)}"

An action item means the sender is EXPLICITLY asking the recipient to DO something specific. The key word is "asking" — the sender must be directing a request AT the recipient.

Classify as "action_required" ONLY if ALL of these are true:
1. The sender is making a request directed at the recipient (not sharing info)
2. The request requires a real-world action beyond just replying to the email
3. The action is specific and concrete (not vague like "let's catch up sometime")

Examples of action_required:
- "Can you send me the deck?" → YES (send something)
- "Can you intro me to Sarah?" → YES (make a connection)
- "Please book the restaurant for Saturday" → YES (make a reservation)
- "Can you review this doc and give feedback?" → YES (review something)
- "You said you'd send me that link" → YES (unfulfilled commitment)
- "Can you Venmo me $20 for last night?" → YES (send money)

Examples that are NOT action_required:
- "Here's the update on the project" → NO (sharing info)
- "Thanks for sending that over" → NO (acknowledgment)
- "Let me know if you have questions" → NO (open-ended)
- "Looking forward to catching up" → NO (vague)
- "FYI the meeting got moved to 3pm" → NO (informational)
- "Great work on the presentation!" → NO (praise)
- "I'll send you the details tomorrow" → NO (they'll do it, not you)
- Newsletter or automated emails → NO (not personal)

Classify as "invitation" ONLY if the sender is EXPLICITLY inviting the recipient to a specific event with a concrete time, date, or place mentioned:
- "Dinner at my place Friday at 7?" → YES (specific event + time + place)
- "Want to play tennis Saturday morning?" → YES (specific activity + time)
- "You're invited to my birthday party March 20th" → YES (specific event + date)
- "We should hang out sometime" → NO (too vague)
- "Want to grab lunch?" → NO (no specific time/place)

If there is no specific time, date, or place mentioned, it is NOT an invitation.

Everything else is "fyi". When in doubt, classify as "fyi". It is much better to miss an action item than to create a false one.

Return JSON only:
{
  "classification": "action_required",
  "title": "Send Cooper the pitch deck",
  "urgency": "medium",
  "reasoning": "one sentence why"
}

If classification is "fyi", set title to null and urgency to null.`,
        },
      ],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]) as AIClassification;
  } catch (error) {
    console.error("[extract-actions] AI classification failed:", error);
    return null;
  }
}

// ─── Main extraction pipeline ───

const ACTIONABLE_CLASSIFICATIONS: ReadonlySet<Classification> = new Set([
  "action_required",
  "invitation",
]);

export async function extractActionItems(
  userId: string,
): Promise<ExtractResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const userEmail = user?.email?.toLowerCase();
  const userName = user?.name ?? "the user";
  if (!userEmail) throw new Error("User has no email address");

  // Build set of all user emails
  const syncState = await prisma.gmailSyncState.findUnique({
    where: { userId },
    select: { additionalUserEmails: true },
  });
  const userEmails = new Set<string>();
  userEmails.add(userEmail);
  for (const e of syncState?.additionalUserEmails ?? []) {
    userEmails.add(e.toLowerCase());
  }

  // 1. Fetch recent threads (7 days for regular scan, small batch)
  const threads = await fetchRecentThreads(userId, 7, 30);

  // 2. Load contacts for matching (including additionalEmails)
  const contacts = await prisma.contact.findMany({
    where: { userId, email: { not: null } },
    select: { id: true, name: true, email: true, additionalEmails: true },
  });
  const contactByEmail = new Map<string, string>();
  const contactNameByEmail = new Map<string, string>();
  for (const c of contacts) {
    if (c.email) {
      contactByEmail.set(c.email.toLowerCase(), c.id);
      contactNameByEmail.set(c.email.toLowerCase(), c.name);
    }
    for (const ae of c.additionalEmails) {
      contactByEmail.set(ae.toLowerCase(), c.id);
      contactNameByEmail.set(ae.toLowerCase(), c.name);
    }
  }

  // 3. Load existing action item threadIds to avoid reprocessing
  const existingThreadIds = new Set(
    (
      await prisma.actionItem.findMany({
        where: { userId, threadId: { not: null } },
        select: { threadId: true },
      })
    ).map((a) => a.threadId!),
  );

  let threadsAnalyzed = 0;
  let actionsFound = 0;
  let actionsSaved = 0;

  // 4. Analyze each thread
  for (const thread of threads) {
    if (existingThreadIds.has(thread.id)) continue;

    const result = buildThreadSummary(thread, userEmails);
    if (!result) continue;

    // Only classify inbound threads (someone sent to us)
    if (!result.isInbound) {
      // Mark as processed so we don't re-check
      const lastMsg = thread.messages[thread.messages.length - 1];
      await prisma.actionItem.create({
        data: {
          userId,
          status: "DISMISSED",
          title: "Outbound",
          sourceId: `email:${lastMsg.id}`,
          threadId: thread.id,
        },
      });
      continue;
    }

    threadsAnalyzed++;

    const senderName = result.lastSenderEmail
      ? (contactNameByEmail.get(result.lastSenderEmail) ?? result.lastSenderEmail)
      : "Unknown";

    const classification = await classifyThread(result.summary, senderName);

    if (!classification) continue;

    const lastMsg = thread.messages[thread.messages.length - 1];
    const counterpartyEmail = result.lastSenderEmail;
    const contactId = counterpartyEmail
      ? contactByEmail.get(counterpartyEmail) ?? null
      : null;

    if (!ACTIONABLE_CLASSIFICATIONS.has(classification.classification)) {
      // Store dismissed marker
      await prisma.actionItem.create({
        data: {
          userId,
          contactId,
          status: "DISMISSED",
          title: classification.title || "FYI",
          context: result.summary.slice(0, 200),
          sourceId: `email:${lastMsg.id}`,
          threadId: thread.id,
        },
      });
      continue;
    }

    actionsFound++;

    // Get subject and preview
    const subject = getHeader(lastMsg.payload.headers, "Subject");
    const preview = getMessageBody(lastMsg);
    const cleanPreview = cleanEmailBody(preview).slice(0, 200);

    await prisma.actionItem.create({
      data: {
        userId,
        contactId,
        status: "OPEN",
        title: classification.title || "Action needed",
        channel: "gmail",
        classification: classification.classification,
        context: JSON.stringify({
          classification: classification.classification,
          urgency: classification.urgency ?? "medium",
          reasoning: classification.reasoning,
          channel: "gmail",
          preview: cleanPreview,
          occurredAt: new Date(parseInt(lastMsg.internalDate)).toISOString(),
        }),
        sourceId: `email:${lastMsg.id}`,
        threadId: thread.id,
      },
    });
    actionsSaved++;
  }

  return { threadsAnalyzed, actionsFound, actionsSaved };
}

// ─── Backfill extraction (90 days, all accounts) ───

export async function extractActionItemsBackfill(
  userId: string,
  days: number = 90,
): Promise<ExtractResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const userEmail = user?.email?.toLowerCase();
  const userName = user?.name ?? "the user";
  if (!userEmail) throw new Error("User has no email address");

  // Build set of all user emails
  const syncState = await prisma.gmailSyncState.findUnique({
    where: { userId },
    select: { additionalUserEmails: true },
  });
  const userEmails = new Set<string>();
  userEmails.add(userEmail);
  for (const e of syncState?.additionalUserEmails ?? []) {
    userEmails.add(e.toLowerCase());
  }

  // Get all account tokens
  const accountTokens = await getAllGoogleAccessTokens(userId);
  if (accountTokens.length === 0) {
    console.error("[extract-actions] No valid Google tokens");
    return { threadsAnalyzed: 0, actionsFound: 0, actionsSaved: 0 };
  }

  // Fetch threads from all accounts
  const allThreads: GmailThread[] = [];
  const seenThreadIds = new Set<string>();

  for (const { token } of accountTokens) {
    const threads = await fetchRecentThreadsWithToken(token, days, 200);
    for (const thread of threads) {
      if (!seenThreadIds.has(thread.id)) {
        seenThreadIds.add(thread.id);
        allThreads.push(thread);
      }
    }
  }

  console.log(`[extract-actions] Backfill: ${allThreads.length} threads from ${days} days across ${accountTokens.length} accounts`);

  // Load contacts for matching (including additionalEmails)
  const contacts = await prisma.contact.findMany({
    where: { userId, email: { not: null } },
    select: { id: true, name: true, email: true, additionalEmails: true },
  });
  const contactByEmail = new Map<string, string>();
  const contactNameByEmail = new Map<string, string>();
  for (const c of contacts) {
    if (c.email) {
      contactByEmail.set(c.email.toLowerCase(), c.id);
      contactNameByEmail.set(c.email.toLowerCase(), c.name);
    }
    for (const ae of c.additionalEmails) {
      contactByEmail.set(ae.toLowerCase(), c.id);
      contactNameByEmail.set(ae.toLowerCase(), c.name);
    }
  }

  // Load existing action item threadIds to avoid reprocessing
  const existingThreadIds = new Set(
    (
      await prisma.actionItem.findMany({
        where: { userId, threadId: { not: null } },
        select: { threadId: true },
      })
    ).map((a) => a.threadId!),
  );

  let threadsAnalyzed = 0;
  let actionsFound = 0;
  let actionsSaved = 0;
  const MAX_CLASSIFICATIONS = 100; // Cap AI calls per backfill run

  for (const thread of allThreads) {
    if (threadsAnalyzed >= MAX_CLASSIFICATIONS) break;
    if (existingThreadIds.has(thread.id)) continue;

    const result = buildThreadSummary(thread, userEmails);
    if (!result) continue;

    // Only classify inbound threads
    if (!result.isInbound) {
      const lastMsg = thread.messages[thread.messages.length - 1];
      await prisma.actionItem.create({
        data: {
          userId,
          status: "DISMISSED",
          title: "Outbound",
          sourceId: `email:${lastMsg.id}`,
          threadId: thread.id,
        },
      });
      continue;
    }

    threadsAnalyzed++;

    const senderName = result.lastSenderEmail
      ? (contactNameByEmail.get(result.lastSenderEmail) ?? result.lastSenderEmail)
      : "Unknown";

    const classification = await classifyThread(result.summary, senderName);

    if (!classification) continue;

    const lastMsg = thread.messages[thread.messages.length - 1];
    const counterpartyEmail = result.lastSenderEmail;
    const contactId = counterpartyEmail
      ? contactByEmail.get(counterpartyEmail) ?? null
      : null;

    if (!ACTIONABLE_CLASSIFICATIONS.has(classification.classification)) {
      await prisma.actionItem.create({
        data: {
          userId,
          contactId,
          status: "DISMISSED",
          title: classification.title || "FYI",
          context: result.summary.slice(0, 200),
          sourceId: `email:${lastMsg.id}`,
          threadId: thread.id,
        },
      });
      continue;
    }

    actionsFound++;

    const preview = getMessageBody(lastMsg);
    const cleanPreview = cleanEmailBody(preview).slice(0, 200);

    await prisma.actionItem.create({
      data: {
        userId,
        contactId,
        status: "OPEN",
        title: classification.title || "Action needed",
        channel: "gmail",
        classification: classification.classification,
        context: JSON.stringify({
          classification: classification.classification,
          urgency: classification.urgency ?? "medium",
          reasoning: classification.reasoning,
          channel: "gmail",
          preview: cleanPreview,
          occurredAt: new Date(parseInt(lastMsg.internalDate)).toISOString(),
        }),
        sourceId: `email:${lastMsg.id}`,
        threadId: thread.id,
      },
    });
    actionsSaved++;
  }

  console.log(`[extract-actions] Backfill complete: ${threadsAnalyzed} analyzed, ${actionsFound} found, ${actionsSaved} saved`);

  return { threadsAnalyzed, actionsFound, actionsSaved };
}

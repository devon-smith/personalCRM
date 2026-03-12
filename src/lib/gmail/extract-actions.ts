import { prisma } from "@/lib/prisma";
import { googleFetch } from "./client";
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

interface ExtractedAction {
  title: string;
  type: "action" | "follow_up" | "waiting";
  context: string;
  dueHint: string | null; // e.g. "by Friday", "next week", "ASAP"
}

interface ThreadAnalysis {
  actions: ExtractedAction[];
  conversationDone: boolean;
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
  // Trim at common signature markers
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

  // Collapse whitespace
  return body.replace(/\n{3,}/g, "\n\n").trim();
}

// ─── Gmail fetching ───

/**
 * Fetch recent threads with full message bodies.
 */
async function fetchRecentThreads(
  userId: string,
  maxThreads: number = 20,
): Promise<GmailThread[]> {
  // Get recent message IDs (last 7 days)
  const after = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
  const listUrl = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
  );
  listUrl.searchParams.set("q", `after:${after} in:inbox`);
  listUrl.searchParams.set("maxResults", "50");

  const listRes = await googleFetch(userId, listUrl.toString());
  if (!listRes.ok) throw new Error(`Gmail list error: ${listRes.status}`);

  const listData = (await listRes.json()) as {
    messages?: Array<{ id: string; threadId: string }>;
  };

  if (!listData.messages?.length) return [];

  // Collect unique thread IDs (most recent first)
  const threadIds = [
    ...new Set(listData.messages.map((m) => m.threadId)),
  ].slice(0, maxThreads);

  // Fetch each thread with full content
  const threads: GmailThread[] = [];
  for (const threadId of threadIds) {
    const threadUrl = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`;
    const threadRes = await googleFetch(userId, threadUrl);
    if (!threadRes.ok) continue;

    const thread = (await threadRes.json()) as GmailThread;
    threads.push(thread);
  }

  return threads;
}

// ─── AI Analysis ───

function buildThreadSummary(
  thread: GmailThread,
  userEmail: string,
): string | null {
  // Take the last 3 messages in the thread for context
  const recentMessages = thread.messages.slice(-3);
  const parts: string[] = [];

  for (const msg of recentMessages) {
    const from = getHeader(msg.payload.headers, "From") ?? "Unknown";
    const to = getHeader(msg.payload.headers, "To") ?? "";
    const subject = getHeader(msg.payload.headers, "Subject") ?? "(no subject)";
    const date = new Date(parseInt(msg.internalDate)).toLocaleDateString();
    const fromEmail = extractEmail(from);
    const direction = fromEmail === userEmail ? "SENT" : "RECEIVED";

    let body = getMessageBody(msg);
    body = cleanEmailBody(body);
    // Limit body length per message
    if (body.length > 800) {
      body = body.slice(0, 800) + "...";
    }

    parts.push(
      `[${direction}] ${date} | From: ${from} | To: ${to}\nSubject: ${subject}\n${body}`,
    );
  }

  if (parts.length === 0) return null;
  return parts.join("\n\n---\n\n");
}

async function analyzeThread(
  threadSummary: string,
  userName: string,
): Promise<ThreadAnalysis> {
  if (!anthropic) {
    return { actions: [], conversationDone: false };
  }

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `Analyze this email thread for ${userName}. Extract any action items, follow-ups, or things they need to do.

EMAIL THREAD:
${threadSummary}

Rules:
- Only extract items where ${userName} needs to take action or follow up
- "action" = something they need to DO (reply, send something, complete a task)
- "follow_up" = something to check back on later (waiting for a response, deadline approaching)
- "waiting" = they're waiting on someone else (no action needed yet, but track it)
- If the conversation looks resolved/complete, mark conversationDone as true
- Skip pleasantries, newsletters, automated emails — only real tasks
- Be specific in titles: "Reply to Sarah about meeting time" not "Follow up"
- If there's a due date mentioned, include it in dueHint

Return JSON:
{
  "actions": [
    { "title": "...", "type": "action", "context": "brief quote from email", "dueHint": "by Friday" }
  ],
  "conversationDone": false
}

If no actions found, return { "actions": [], "conversationDone": true }`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";

  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
        conversationDone: parsed.conversationDone ?? false,
      };
    }
  } catch {
    // fallback
  }

  return { actions: [], conversationDone: false };
}

// ─── Main extraction pipeline ───

export async function extractActionItems(
  userId: string,
): Promise<ExtractResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const userEmail = user?.email?.toLowerCase();
  const userName = user?.name ?? "the user";
  if (!userEmail) throw new Error("User has no email address");

  // 1. Fetch recent threads
  const threads = await fetchRecentThreads(userId, 20);

  // 2. Load contacts for matching
  const contacts = await prisma.contact.findMany({
    where: { userId, email: { not: null } },
    select: { id: true, email: true },
  });
  const contactByEmail = new Map(
    contacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c.id]),
  );

  // 3. Load existing action item sourceIds to avoid reprocessing
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
    // Skip already-processed threads
    if (existingThreadIds.has(thread.id)) continue;

    const summary = buildThreadSummary(thread, userEmail);
    if (!summary) continue;

    threadsAnalyzed++;

    const analysis = await analyzeThread(summary, userName);

    if (analysis.conversationDone || analysis.actions.length === 0) continue;

    // Find the counterparty contact
    const lastMsg = thread.messages[thread.messages.length - 1];
    const fromHeader = getHeader(lastMsg.payload.headers, "From") ?? "";
    const toHeader = getHeader(lastMsg.payload.headers, "To") ?? "";
    const fromEmail = extractEmail(fromHeader);
    const toEmail = extractEmail(toHeader);
    const counterpartyEmail =
      fromEmail === userEmail ? toEmail : fromEmail;
    const contactId = counterpartyEmail
      ? contactByEmail.get(counterpartyEmail) ?? null
      : null;

    // 5. Save action items
    for (const action of analysis.actions) {
      actionsFound++;

      // Parse due date hint
      let dueDate: Date | null = null;
      if (action.dueHint) {
        dueDate = parseDueHint(action.dueHint);
      }

      await prisma.actionItem.create({
        data: {
          userId,
          contactId,
          title: action.title.slice(0, 255),
          context: action.context?.slice(0, 500) ?? null,
          sourceId: lastMsg.id,
          threadId: thread.id,
          dueDate,
          status: action.type === "waiting" ? "OPEN" : "OPEN",
        },
      });
      actionsSaved++;
    }
  }

  return { threadsAnalyzed, actionsFound, actionsSaved };
}

/**
 * Parse natural language due date hints into actual dates.
 */
function parseDueHint(hint: string): Date | null {
  const lower = hint.toLowerCase().trim();
  const now = new Date();

  if (lower.includes("asap") || lower.includes("urgent") || lower.includes("today")) {
    return now;
  }
  if (lower.includes("tomorrow")) {
    return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
  if (lower.includes("end of week") || lower.includes("this week") || lower.includes("by friday")) {
    const daysUntilFriday = (5 - now.getDay() + 7) % 7 || 7;
    return new Date(now.getTime() + daysUntilFriday * 24 * 60 * 60 * 1000);
  }
  if (lower.includes("next week") || lower.includes("by monday")) {
    const daysUntilMonday = (1 - now.getDay() + 7) % 7 || 7;
    return new Date(now.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000);
  }
  if (lower.includes("end of month") || lower.includes("this month")) {
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return endOfMonth;
  }

  // Try day names
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  for (let i = 0; i < days.length; i++) {
    if (lower.includes(days[i])) {
      const daysUntil = (i - now.getDay() + 7) % 7 || 7;
      return new Date(now.getTime() + daysUntil * 24 * 60 * 60 * 1000);
    }
  }

  return null;
}

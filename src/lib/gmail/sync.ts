import { prisma } from "@/lib/prisma";
import { googleFetch } from "./client";

interface GmailMessage {
  id: string;
  threadId: string;
}

interface GmailMessageDetail {
  id: string;
  threadId: string;
  internalDate: string;
  payload: {
    headers: Array<{ name: string; value: string }>;
  };
  snippet: string;
}

interface GmailListResponse {
  messages?: GmailMessage[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailHistoryResponse {
  history?: Array<{
    id: string;
    messagesAdded?: Array<{ message: GmailMessage }>;
  }>;
  historyId?: string;
  nextPageToken?: string;
}

type ProcessResult =
  | { matched: true }
  | { matched: false; unmatchedEmail: string | null };

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string | null {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function extractEmail(headerValue: string): string | null {
  const match = headerValue.match(/<([^>]+)>/) ?? headerValue.match(/([^\s<,]+@[^\s>,]+)/);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Merge new unmatched senders into the running tally.
 * Keeps the top 50 by message count.
 */
function mergeUnmatchedSenders(
  existing: Array<{ email: string; count: number }>,
  newCounts: Map<string, number>,
): Array<{ email: string; count: number }> {
  const merged = new Map<string, number>();

  for (const entry of existing) {
    merged.set(entry.email, (merged.get(entry.email) ?? 0) + entry.count);
  }
  for (const [email, count] of newCounts) {
    merged.set(email, (merged.get(email) ?? 0) + count);
  }

  return Array.from(merged.entries())
    .map(([email, count]) => ({ email, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);
}

/**
 * Filter out noreply, automated, and system email addresses
 * that aren't real people you'd want as contacts.
 */
function isHumanEmail(email: string): boolean {
  const automated = [
    "noreply", "no-reply", "donotreply", "do-not-reply",
    "notifications", "notification", "mailer-daemon", "postmaster",
    "support", "help", "info", "admin", "system", "automated",
    "updates", "newsletter", "digest", "alert", "alerts",
    "billing", "invoice", "receipt", "order", "shipping",
    "calendar-notification", "drive-shares",
  ];
  const local = email.split("@")[0];
  if (automated.some((prefix) => local.includes(prefix))) return false;

  const automatedDomains = [
    "googlegroups.com", "github.com", "linkedin.com",
    "facebookmail.com", "slack.com", "notion.so",
    "calendly.com", "stripe.com", "paypal.com",
  ];
  const domain = email.split("@")[1];
  if (automatedDomains.some((d) => domain === d)) return false;

  return true;
}

/**
 * Initial sync — fetch recent emails (last 90 days) and create Interaction records.
 * Tracks unmatched senders for gap analysis.
 */
export async function initialGmailSync(
  userId: string,
  batchSize: number = 50,
): Promise<{ processed: number; total: number; done: boolean }> {
  await prisma.gmailSyncState.upsert({
    where: { userId },
    create: { userId, syncEnabled: true },
    update: {},
  });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const userEmail = user?.email?.toLowerCase();

  const contacts = await prisma.contact.findMany({
    where: { userId, email: { not: null } },
    select: { id: true, email: true },
  });
  const contactsByEmail = new Map(
    contacts
      .filter((c) => c.email)
      .map((c) => [c.email!.toLowerCase(), c.id]),
  );

  const after = Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000);
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("q", `after:${after}`);
  url.searchParams.set("maxResults", String(batchSize));

  const res = await googleFetch(userId, url.toString());
  if (!res.ok) {
    throw new Error(`Gmail API error: ${res.status}`);
  }

  const data = (await res.json()) as GmailListResponse;
  const messages = data.messages ?? [];

  let processed = 0;
  const unmatchedCounts = new Map<string, number>();

  for (const msg of messages) {
    const detail = await fetchMessageDetail(userId, msg.id);
    if (!detail) continue;

    const result = await processMessage(userId, userEmail, detail, contactsByEmail);
    if (result.matched) {
      processed++;
    } else if (result.unmatchedEmail && isHumanEmail(result.unmatchedEmail)) {
      unmatchedCounts.set(
        result.unmatchedEmail,
        (unmatchedCounts.get(result.unmatchedEmail) ?? 0) + 1,
      );
    }
  }

  // Get current historyId for incremental sync
  const profileRes = await googleFetch(
    userId,
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
  );
  if (profileRes.ok) {
    const profile = (await profileRes.json()) as { historyId: string };
    const merged = mergeUnmatchedSenders([], unmatchedCounts);
    await prisma.gmailSyncState.update({
      where: { userId },
      data: {
        historyId: profile.historyId,
        lastSyncAt: new Date(),
        syncEnabled: true,
        unmatchedSenders: merged,
      },
    });
  }

  await classifyContactTiers(userId);

  return {
    processed,
    total: data.resultSizeEstimate ?? messages.length,
    done: !data.nextPageToken,
  };
}

/**
 * Incremental sync — fetch only new messages since last sync via historyId.
 * Also tracks unmatched senders.
 */
export async function incrementalGmailSync(
  userId: string,
): Promise<{ processed: number }> {
  const syncState = await prisma.gmailSyncState.findUnique({
    where: { userId },
  });

  if (!syncState?.historyId) {
    return initialGmailSync(userId);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  const userEmail = user?.email?.toLowerCase();

  const contacts = await prisma.contact.findMany({
    where: { userId, email: { not: null } },
    select: { id: true, email: true },
  });
  const contactsByEmail = new Map(
    contacts
      .filter((c) => c.email)
      .map((c) => [c.email!.toLowerCase(), c.id]),
  );

  let processed = 0;
  let pageToken: string | undefined;
  let latestHistoryId = syncState.historyId;
  const unmatchedCounts = new Map<string, number>();

  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/history");
    url.searchParams.set("startHistoryId", syncState.historyId);
    url.searchParams.set("historyTypes", "messageAdded");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const res = await googleFetch(userId, url.toString());
    if (!res.ok) {
      if (res.status === 404) {
        return initialGmailSync(userId);
      }
      throw new Error(`Gmail history API error: ${res.status}`);
    }

    const data = (await res.json()) as GmailHistoryResponse;

    if (data.historyId) {
      latestHistoryId = data.historyId;
    }

    for (const historyItem of data.history ?? []) {
      for (const added of historyItem.messagesAdded ?? []) {
        const detail = await fetchMessageDetail(userId, added.message.id);
        if (!detail) continue;

        const result = await processMessage(userId, userEmail, detail, contactsByEmail);
        if (result.matched) {
          processed++;
        } else if (result.unmatchedEmail && isHumanEmail(result.unmatchedEmail)) {
          unmatchedCounts.set(
            result.unmatchedEmail,
            (unmatchedCounts.get(result.unmatchedEmail) ?? 0) + 1,
          );
        }
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  // Merge new unmatched senders with existing ones
  const existingSenders = (syncState.unmatchedSenders as Array<{ email: string; count: number }>) ?? [];
  const merged = mergeUnmatchedSenders(existingSenders, unmatchedCounts);

  await prisma.gmailSyncState.update({
    where: { userId },
    data: {
      historyId: latestHistoryId,
      lastSyncAt: new Date(),
      unmatchedSenders: merged,
    },
  });

  await classifyContactTiers(userId);

  return { processed };
}

async function fetchMessageDetail(
  userId: string,
  messageId: string,
): Promise<GmailMessageDetail | null> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`;

  const res = await googleFetch(userId, url);
  if (!res.ok) return null;

  return (await res.json()) as GmailMessageDetail;
}

async function processMessage(
  userId: string,
  userEmail: string | undefined,
  detail: GmailMessageDetail,
  contactsByEmail: Map<string, string>,
): Promise<ProcessResult> {
  const fromHeader = getHeader(detail.payload.headers, "From");
  const toHeader = getHeader(detail.payload.headers, "To");
  const subject = getHeader(detail.payload.headers, "Subject");

  if (!fromHeader || !toHeader) return { matched: false, unmatchedEmail: null };

  const fromEmail = extractEmail(fromHeader);
  const toEmail = extractEmail(toHeader);

  if (!fromEmail || !toEmail) return { matched: false, unmatchedEmail: null };

  const isOutbound = fromEmail === userEmail;
  const contactEmail = isOutbound ? toEmail : fromEmail;
  const contactId = contactsByEmail.get(contactEmail);

  if (!contactId) {
    return { matched: false, unmatchedEmail: contactEmail };
  }

  // Check for duplicates by sourceId
  const existing = await prisma.interaction.findFirst({
    where: { sourceId: detail.id, userId },
  });
  if (existing) return { matched: false, unmatchedEmail: null };

  await prisma.interaction.create({
    data: {
      userId,
      contactId,
      type: "EMAIL",
      direction: isOutbound ? "OUTBOUND" : "INBOUND",
      subject: subject?.slice(0, 255) ?? null,
      summary: detail.snippet?.slice(0, 500) ?? null,
      occurredAt: new Date(parseInt(detail.internalDate)),
      sourceId: detail.id,
    },
  });

  await prisma.contact.update({
    where: { id: contactId },
    data: { lastInteraction: new Date(parseInt(detail.internalDate)) },
  });

  return { matched: true };
}

/**
 * Classify contacts into tiers based on email interaction frequency.
 */
async function classifyContactTiers(userId: string): Promise<void> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const contacts = await prisma.contact.findMany({
    where: { userId },
    select: {
      id: true,
      tier: true,
      _count: {
        select: {
          interactions: {
            where: { occurredAt: { gte: ninetyDaysAgo } },
          },
        },
      },
    },
  });

  for (const contact of contacts) {
    const count = contact._count.interactions;
    const newTier =
      count >= 10
        ? "INNER_CIRCLE"
        : count >= 3
          ? "PROFESSIONAL"
          : "ACQUAINTANCE";

    if (newTier !== contact.tier) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { tier: newTier },
      });
    }
  }
}

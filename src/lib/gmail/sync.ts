import { prisma } from "@/lib/prisma";
import { googleFetch, googleFetchWithToken, getAllGoogleAccessTokens } from "./client";
import { autoResolveOnOutbound } from "@/lib/auto-resolve";
import { onInboundInteraction, onOutboundInteraction } from "@/lib/inbox";

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

function extractDisplayName(headerValue: string): string | null {
  const match = headerValue.match(/^"?([^"<]+?)"?\s*</);
  return match?.[1]?.trim() ?? null;
}

/** Decode HTML entities that Gmail API returns in snippets. */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
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
 * Build a set of all email addresses belonging to the user (primary + additional).
 */
function buildUserEmailSet(
  primaryEmail: string | null | undefined,
  additionalEmails: string[],
): Set<string> {
  const set = new Set<string>();
  if (primaryEmail) set.add(primaryEmail.toLowerCase());
  for (const e of additionalEmails) set.add(e.toLowerCase());
  return set;
}

/**
 * Build a lookup map from all emails (primary + additional) to contact IDs.
 */
function buildEmailLookup(
  contacts: Array<{ id: string; email: string | null; additionalEmails: string[] }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of contacts) {
    if (c.email) {
      map.set(c.email.toLowerCase(), c.id);
    }
    for (const ae of c.additionalEmails) {
      map.set(ae.toLowerCase(), c.id);
    }
  }
  return map;
}

/**
 * Fetch and process messages from a single Google account for initial sync.
 */
async function syncAccountInitial(
  token: string,
  userId: string,
  userEmails: Set<string>,
  contactsByEmail: Map<string, string>,
  contactNames: Map<string, string>,
  unmatchedCounts: Map<string, number>,
  batchSize: number,
): Promise<{ processed: number; total: number }> {
  const after = Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000);
  let processed = 0;
  let totalMessages = 0;
  let pageToken: string | undefined;

  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", `after:${after}`);
    url.searchParams.set("maxResults", String(batchSize));
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const res = await googleFetchWithToken(token, url.toString());
    if (!res.ok) {
      console.error(`Gmail API error for account: ${res.status}`);
      break;
    }

    const data = (await res.json()) as GmailListResponse;
    const messages = data.messages ?? [];
    totalMessages += messages.length;

    for (let i = 0; i < messages.length; i += 10) {
      const batch = messages.slice(i, i + 10);
      const results = await Promise.all(
        batch.map(async (msg) => {
          const detail = await fetchMessageDetail(userId, msg.id, token);
          if (!detail) return null;
          return processMessage(userId, userEmails, detail, contactsByEmail, contactNames);
        }),
      );

      for (const result of results) {
        if (!result) continue;
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

  return { processed, total: totalMessages };
}

/**
 * Initial sync — fetch all emails from the last 90 days across ALL linked Google accounts.
 * Paginates through the full result set.
 * Tracks unmatched senders for gap analysis.
 */
export async function initialGmailSync(
  userId: string,
  batchSize: number = 100,
): Promise<{ processed: number; total: number; done: boolean }> {
  await prisma.gmailSyncState.upsert({
    where: { userId },
    create: { userId, syncEnabled: true },
    update: {},
  });

  const [user, syncState, accountTokens] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.gmailSyncState.findUnique({ where: { userId }, select: { additionalUserEmails: true } }),
    getAllGoogleAccessTokens(userId),
  ]);
  const userEmails = buildUserEmailSet(user?.email, syncState?.additionalUserEmails ?? []);

  if (accountTokens.length === 0) {
    console.error("No valid Google tokens for user", userId);
    return { processed: 0, total: 0, done: true };
  }

  const contacts = await prisma.contact.findMany({
    where: { userId },
    select: { id: true, name: true, email: true, additionalEmails: true },
  });
  const contactsByEmail = buildEmailLookup(contacts);
  const contactNames = new Map(contacts.map((c) => [c.id, c.name]));

  let processed = 0;
  let totalMessages = 0;
  const unmatchedCounts = new Map<string, number>();

  // Sync from each linked Google account
  for (const { token } of accountTokens) {
    const result = await syncAccountInitial(
      token, userId, userEmails, contactsByEmail, contactNames,
      unmatchedCounts, batchSize,
    );
    processed += result.processed;
    totalMessages += result.total;
  }

  // Get current historyId from primary account for incremental sync
  const profileRes = await googleFetchWithToken(
    accountTokens[0].token,
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
    total: totalMessages,
    done: true,
  };
}

/**
 * Incremental sync for a single account using history API.
 * Returns messages added since startHistoryId.
 */
async function syncAccountIncremental(
  token: string,
  userId: string,
  startHistoryId: string,
  userEmails: Set<string>,
  contactsByEmail: Map<string, string>,
  contactNames: Map<string, string>,
  unmatchedCounts: Map<string, number>,
): Promise<{ processed: number; historyId: string | null; needsFullSync: boolean }> {
  let processed = 0;
  let pageToken: string | undefined;
  let latestHistoryId: string | null = null;

  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/history");
    url.searchParams.set("startHistoryId", startHistoryId);
    url.searchParams.set("historyTypes", "messageAdded");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const res = await googleFetchWithToken(token, url.toString());
    if (!res.ok) {
      if (res.status === 404) {
        return { processed: 0, historyId: null, needsFullSync: true };
      }
      console.error(`Gmail history API error for account: ${res.status}`);
      break;
    }

    const data = (await res.json()) as GmailHistoryResponse;

    if (data.historyId) {
      latestHistoryId = data.historyId;
    }

    for (const historyItem of data.history ?? []) {
      for (const added of historyItem.messagesAdded ?? []) {
        const detail = await fetchMessageDetail(userId, added.message.id, token);
        if (!detail) continue;

        const result = await processMessage(userId, userEmails, detail, contactsByEmail, contactNames);
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

  return { processed, historyId: latestHistoryId, needsFullSync: false };
}

/**
 * Incremental sync — fetch only new messages since last sync across ALL accounts.
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

  const [user, accountTokens] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    getAllGoogleAccessTokens(userId),
  ]);
  const userEmails = buildUserEmailSet(user?.email, syncState.additionalUserEmails ?? []);

  if (accountTokens.length === 0) {
    console.error("No valid Google tokens for user", userId);
    return { processed: 0 };
  }

  const contacts = await prisma.contact.findMany({
    where: { userId },
    select: { id: true, name: true, email: true, additionalEmails: true },
  });
  const contactsByEmail = buildEmailLookup(contacts);
  const contactNames = new Map(contacts.map((c) => [c.id, c.name]));

  let processed = 0;
  let latestHistoryId = syncState.historyId;
  const unmatchedCounts = new Map<string, number>();

  // Sync from each linked Google account
  for (const { token } of accountTokens) {
    const result = await syncAccountIncremental(
      token, userId, syncState.historyId,
      userEmails, contactsByEmail, contactNames, unmatchedCounts,
    );

    if (result.needsFullSync) {
      return initialGmailSync(userId);
    }

    processed += result.processed;
    if (result.historyId) {
      latestHistoryId = result.historyId;
    }
  }

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
  token?: string,
): Promise<GmailMessageDetail | null> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`;

  const res = token ? await googleFetchWithToken(token, url) : await googleFetch(userId, url);
  if (!res.ok) return null;

  return (await res.json()) as GmailMessageDetail;
}

async function processMessage(
  userId: string,
  userEmails: Set<string>,
  detail: GmailMessageDetail,
  contactsByEmail: Map<string, string>,
  contactNames: Map<string, string>,
): Promise<ProcessResult> {
  const fromHeader = getHeader(detail.payload.headers, "From");
  const toHeader = getHeader(detail.payload.headers, "To");
  const subject = getHeader(detail.payload.headers, "Subject");

  if (!fromHeader || !toHeader) return { matched: false, unmatchedEmail: null };

  const fromEmail = extractEmail(fromHeader);
  const toEmail = extractEmail(toHeader);

  if (!fromEmail || !toEmail) return { matched: false, unmatchedEmail: null };

  const isOutbound = userEmails.has(fromEmail);
  const contactEmail = isOutbound ? toEmail : fromEmail;
  const contactId = contactsByEmail.get(contactEmail) ?? null;
  const contactName = contactId ? (contactNames.get(contactId) ?? null) : null;
  const occurredAt = new Date(parseInt(detail.internalDate));

  // Store in EmailMessage for the inbox (dedup by gmailId)
  const fromName = extractDisplayName(fromHeader);
  await prisma.emailMessage.upsert({
    where: { userId_gmailId: { userId, gmailId: detail.id } },
    create: {
      userId,
      gmailId: detail.id,
      threadId: detail.threadId ?? null,
      fromEmail: fromEmail,
      fromName: isOutbound ? null : fromName,
      toEmail: toEmail,
      subject: subject?.slice(0, 255) ?? null,
      snippet: detail.snippet ? decodeHtmlEntities(detail.snippet).slice(0, 500) : null,
      direction: isOutbound ? "OUTBOUND" : "INBOUND",
      occurredAt,
      contactId,
      contactName,
    },
    update: {},
  });

  if (!contactId) {
    return { matched: false, unmatchedEmail: contactEmail };
  }

  // Check for duplicates by sourceId
  const existing = await prisma.interaction.findFirst({
    where: { sourceId: detail.id, userId },
  });
  if (existing) return { matched: false, unmatchedEmail: null };

  const createdIx = await prisma.interaction.create({
    data: {
      userId,
      contactId,
      type: "EMAIL",
      direction: isOutbound ? "OUTBOUND" : "INBOUND",
      channel: "gmail",
      subject: subject?.slice(0, 255) ?? null,
      summary: detail.snippet ? decodeHtmlEntities(detail.snippet).slice(0, 500) : null,
      occurredAt,
      sourceId: detail.id,
      chatId: detail.threadId ? `gmail:${detail.threadId}` : `1:1:${contactId}:email`,
    },
  });

  await prisma.contact.update({
    where: { id: contactId },
    data: { lastInteraction: occurredAt },
  });

  // Feed into persistent inbox system
  if (isOutbound) {
    await autoResolveOnOutbound(userId, contactId, "gmail", occurredAt);
    await onOutboundInteraction(userId, contactId, "gmail", occurredAt);
  } else {
    await onInboundInteraction(userId, contactId, "gmail", {
      id: createdIx.id,
      summary: detail.snippet ? decodeHtmlEntities(detail.snippet).slice(0, 500) : null,
      occurredAt,
      subject: subject?.slice(0, 255) ?? null,
    });
  }

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

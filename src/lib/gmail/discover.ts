import { prisma } from "@/lib/prisma";
import { googleFetchWithToken, getAllGoogleAccessTokens } from "./client";
import { createBatchContext, processOneSighting, type SightingInput } from "@/lib/sightings";

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

interface DiscoveredPerson {
  email: string;
  name: string;
  messageCount: number;
  latestDate: Date;
}

export interface DiscoverResult {
  contactsCreated: number;
  contactsExisted: number;
  contactsCleaned: number;
  interactionsLogged: number;
  interactionsExisted: number;
  totalEmails: number;
  peopleFound: number;
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

/**
 * Parse "Display Name <email@example.com>" into { name, email }.
 * Falls back to using the local part of the email as a name.
 */
function parseEmailHeader(raw: string): { name: string; email: string } | null {
  // Match "Name <email>" pattern
  const namedMatch = raw.match(/^\s*"?([^"<]+?)"?\s*<([^>]+)>\s*$/);
  if (namedMatch) {
    const email = namedMatch[2].trim().toLowerCase();
    const name = namedMatch[1].trim();
    if (email.includes("@")) return { name, email };
  }

  // Match bare email
  const bareMatch = raw.match(/([^\s<,]+@[^\s>,]+)/);
  if (bareMatch) {
    const email = bareMatch[1].toLowerCase();
    // Derive a name from local part: "john.smith" → "John Smith"
    const local = email.split("@")[0];
    const name = local
      .replace(/[._-]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return { name, email };
  }

  return null;
}

/**
 * Extract all email addresses from a header value (handles comma-separated lists).
 */
function parseAllRecipients(
  headerValue: string,
): Array<{ name: string; email: string }> {
  // Split on commas that are not inside angle brackets or quotes
  const parts = headerValue.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const results: Array<{ name: string; email: string }> = [];

  for (const part of parts) {
    const parsed = parseEmailHeader(part);
    if (parsed) results.push(parsed);
  }

  return results;
}

/**
 * Determine if a sender is a real human you'd want as a CRM contact.
 * Checks the email address AND the display name across 6 layers:
 *   1. Email local part patterns (noreply, billing, etc.)
 *   2. Domain blocklist (companies, SaaS, financial, retail, etc.)
 *   3. Display name: digits → not a person
 *   4. Display name: business/commerce/food words
 *   5. Display name: brand names
 *   6. Display name: structural signals (ALL CAPS words, "the ___ team", etc.)
 */
function isHumanSender(email: string, displayName: string): boolean {
  const lower = email.toLowerCase();
  const local = lower.split("@")[0];
  const domain = lower.split("@")[1];

  // ── 1. Email local part patterns ──
  const automatedLocalParts = [
    "noreply", "no-reply", "donotreply", "do-not-reply",
    "notifications", "notification", "mailer-daemon", "postmaster",
    "support", "help", "info", "admin", "system", "automated",
    "updates", "newsletter", "digest", "alert", "alerts",
    "billing", "invoice", "receipt", "order", "shipping",
    "calendar-notification", "drive-shares", "feedback",
    "marketing", "promotions", "unsubscribe", "hello",
    "sales", "careers", "jobs", "recruit", "confirm",
    "verify", "security", "account", "service", "customer",
    "member", "rewards", "offers", "deals", "subscription",
    "bounce", "abuse", "compliance", "legal", "privacy",
    "webmaster",
  ];
  if (automatedLocalParts.some((p) => local.includes(p))) return false;

  // ── 2. Domain blocklist ──
  const blockedDomains = [
    // Dev & productivity
    "googlegroups.com", "github.com", "linkedin.com",
    "facebookmail.com", "slack.com", "notion.so",
    "calendly.com", "figma.com", "canva.com",
    "atlassian.net", "jira.com", "trello.com",
    "asana.com", "monday.com", "clickup.com",
    "airtable.com", "miro.com", "loom.com",
    // Email / marketing infra
    "sendgrid.net", "mailchimp.com", "mailgun.org",
    "amazonses.com", "postmarkapp.com", "sparkpostmail.com",
    "constantcontact.com", "campaign-archive.com",
    "hubspot.com", "salesforce.com", "marketo.com",
    // CRM / support
    "intercom.io", "zendesk.com", "freshdesk.com",
    "helpscout.net", "drift.com",
    // Payments
    "stripe.com", "paypal.com", "square.com",
    "venmo.com", "cashapp.com", "wise.com",
    // Finance / banks / cards / investing
    "americanexpress.com", "aexp.com",
    "chase.com", "jpmorgan.com",
    "bankofamerica.com", "bofa.com",
    "wellsfargo.com", "citibank.com", "citi.com",
    "capitalone.com", "discover.com",
    "goldmansachs.com", "morganstanley.com",
    "schwab.com", "fidelity.com", "vanguard.com",
    "robinhood.com", "coinbase.com",
    "plaid.com", "sofi.com", "chime.com",
    "kalshi.com", "kroll.com", "upgrade.com",
    "carhartt.com", "ubisoft.com", "headroyce.org",
    "flyingblue.com", "klm.com", "airfrance.com",
    // E-commerce / retail
    "amazon.com", "ebay.com", "walmart.com",
    "target.com", "bestbuy.com", "costco.com",
    "shopify.com", "etsy.com",
    "bonobos.com", "vividseats.com",
    // Hosting / infrastructure
    "hostinger.com", "godaddy.com", "bluehost.com",
    "namecheap.com", "squarespace.com", "wix.com",
    // Travel / transport
    "uber.com", "lyft.com", "airbnb.com",
    "booking.com", "expedia.com", "kayak.com",
    "united.com", "delta.com", "aa.com",
    "southwest.com", "jetblue.com",
    "hilton.com", "marriott.com",
    // Food delivery
    "doordash.com", "grubhub.com", "ubereats.com",
    "postmates.com", "instacart.com",
    // Social / media
    "twitter.com", "x.com", "instagram.com",
    "tiktok.com", "pinterest.com", "reddit.com",
    "medium.com", "substack.com", "youtube.com",
    "spotify.com", "apple.com", "netflix.com",
    "hulu.com", "disneyplus.com",
    // Cloud / tech
    "google.com", "microsoft.com", "azure.com",
    "aws.amazon.com", "digitalocean.com",
    "vercel.com", "netlify.com", "heroku.com",
    "cloudflare.com", "datadog.com",
    // Health / telehealth
    "teladoc.com", "teladochealth.com",
    // Legal / docs
    "docusign.net", "hellosign.com",
    // Education platforms
    "coursera.org", "udemy.com", "edx.org",
    // Insurance
    "geico.com", "statefarm.com", "progressive.com",
    "allstate.com",
    // Telecom
    "t-mobile.com", "verizon.com", "att.com",
    "xfinity.com", "comcast.com",
  ];
  if (blockedDomains.some((d) => domain === d || domain.endsWith(`.${d}`)))
    return false;

  // ── 3. Display name: digits → not a person ──
  const nameLower = displayName.toLowerCase().trim();
  if (/\d/.test(displayName)) return false;

  // ── 4. Display name: business / commerce / product / food words ──
  const nameWords = nameLower.split(/\s+/);
  const businessWords = [
    // Corporate
    "inc", "inc.", "llc", "llc.", "ltd", "ltd.", "corp", "corp.",
    "co", "co.", "fund", "funds", "capital", "ventures",
    "partners", "group", "holdings", "foundation",
    "bank", "insurance", "financial", "services",
    "express", "airlines", "airways",
    "administration", "admin", "portal",
    // Product / tech
    "app", "platform", "software", "solutions",
    "profile", "sync", "metasync",
    "channel", "network", "networks",
    "media", "studios",
    // Retail / commerce
    "store", "shop", "market", "marketplace",
    "rewards", "club", "membership",
    "seats", "tickets",
    // Food / hospitality
    "burger", "pizza", "grill", "cafe", "café",
    "restaurant", "kitchen", "bakery", "bar", "bistro",
    "diner", "tavern", "pub", "brewing", "brewery",
    "coffee", "taco", "sushi", "ramen",
    // Health / wellness
    "health", "healthcare", "medical", "clinic",
    "pharmacy", "dental", "wellness", "therapy",
    // Education / org
    "university", "college", "academy", "school",
    "council", "association", "institute", "society",
    "church", "ministry",
    // Team / org references
    "team", "crew", "squad", "staff",
  ];
  if (nameWords.some((w) => businessWords.includes(w))) return false;

  // ── 5. Known brand names ──
  const brandNames = [
    "american express", "amex", "chase", "wells fargo",
    "bank of america", "capital one", "citibank",
    "goldman sachs", "morgan stanley",
    "united airlines", "delta air", "southwest",
    "amazon", "walmart", "target", "costco", "bestbuy",
    "uber", "lyft", "airbnb", "doordash", "grubhub",
    "netflix", "spotify", "apple", "google", "microsoft",
    "facebook", "instagram", "twitter", "linkedin",
    "stripe", "paypal", "venmo", "cashapp",
    "geico", "state farm", "progressive", "allstate",
    "t-mobile", "verizon", "at&t", "comcast", "xfinity",
    // Reported junk
    "bonobos", "bonobus", "hostinger", "kalshi", "kroll",
    "metasync", "teladoc", "vivid seats", "round table",
    "terminus", "upgrade", "plasma", "red foor", "red door",
    "beli", "carhartt", "flying blue", "head-royce",
    "headroyce", "ubisoft", "roundtable",
  ];
  if (brandNames.some((b) => nameLower.includes(b))) return false;

  // ── 6. Structural signals ──

  // "the ___ team", "the ___ group" etc — businesses, not people
  if (nameLower.startsWith("the ")) return false;

  // "Kevin from Dex", "Sarah from HubSpot" — SaaS outreach pattern.
  // Real people never put "from [company]" in their display name.
  if (/\bfrom\s+\S+$/i.test(nameLower) && nameWords.length >= 3) {
    return false;
  }

  // Any word in the name that is ALL CAPS and > 2 chars is likely a
  // business acronym ("UXR", "HQ", etc.) — real names are mixed case
  const rawWords = displayName.trim().split(/\s+/);
  if (rawWords.some((w) => w.length > 2 && w === w.toUpperCase() && /^[A-Z]+$/.test(w))) {
    return false;
  }

  // Entire name is ALL CAPS (> 3 chars) — businesses, not people
  if (displayName.length > 3 && displayName === displayName.toUpperCase()) {
    return false;
  }

  // Single-word display name from a non-personal email domain → company.
  // Real people with single-word names (first name only) email from
  // gmail, yahoo, outlook, etc. — not from carhartt.com or terminus.com.
  const personalDomains = [
    "gmail.com", "googlemail.com",
    "yahoo.com", "ymail.com",
    "hotmail.com", "outlook.com", "live.com", "msn.com",
    "icloud.com", "me.com", "mac.com",
    "aol.com", "mail.com", "email.com",
    "protonmail.com", "proton.me", "pm.me",
    "zoho.com", "fastmail.com",
  ];
  const isPersonalDomain = personalDomains.some((d) => domain === d)
    || domain.endsWith(".edu");
  if (nameWords.length === 1 && nameLower.length > 2 && !isPersonalDomain) {
    return false;
  }

  return true;
}

// ─── Core Discovery ───

async function fetchAllMessageIdsForToken(
  token: string,
  afterDays: number,
  maxMessages: number,
): Promise<GmailMessage[]> {
  const after = Math.floor(
    (Date.now() - afterDays * 24 * 60 * 60 * 1000) / 1000,
  );
  const allMessages: GmailMessage[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    );
    url.searchParams.set("q", `after:${after}`);
    url.searchParams.set("maxResults", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await googleFetchWithToken(token, url.toString());
    if (!res.ok) {
      console.error(`[discover] Gmail list messages error: ${res.status}`);
      break;
    }

    const data = (await res.json()) as GmailListResponse;
    const messages = data.messages ?? [];
    allMessages.push(...messages);
    pageToken = data.nextPageToken;

    if (allMessages.length >= maxMessages) break;
  } while (pageToken);

  return allMessages.slice(0, maxMessages);
}

async function fetchMessageDetailWithToken(
  token: string,
  messageId: string,
): Promise<GmailMessageDetail | null> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`;
  const res = await googleFetchWithToken(token, url);
  if (!res.ok) return null;
  return (await res.json()) as GmailMessageDetail;
}

/**
 * Fetch message details in parallel batches to stay within rate limits.
 */
async function fetchMessagesBatched(
  token: string,
  messageIds: GmailMessage[],
  batchSize: number = 10,
): Promise<GmailMessageDetail[]> {
  const results: GmailMessageDetail[] = [];

  for (let i = 0; i < messageIds.length; i += batchSize) {
    const batch = messageIds.slice(i, i + batchSize);
    const details = await Promise.all(
      batch.map((msg) => fetchMessageDetailWithToken(token, msg.id)),
    );
    for (const d of details) {
      if (d) results.push(d);
    }
  }

  return results;
}

/**
 * Scan Gmail for the last N days, auto-create contacts from real people,
 * and log all email interactions.
 */
export async function discoverContactsFromGmail(
  userId: string,
  days: number = 90,
  maxMessages: number = 500,
): Promise<DiscoverResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const userEmail = user?.email?.toLowerCase();
  if (!userEmail) throw new Error("User has no email address");

  // 0. Clean up previously auto-imported contacts that now fail the filter.
  // Only touches contacts with importedAt set (i.e., created by discover/import,
  // not manually added by the user).
  const autoImported = await prisma.contact.findMany({
    where: { userId, importedAt: { not: null }, email: { not: null } },
    select: { id: true, name: true, email: true },
  });
  const junkContactIds = autoImported
    .filter((c) => !isHumanSender(c.email!, c.name))
    .map((c) => c.id);

  if (junkContactIds.length > 0) {
    // Cascade deletes interactions via schema, so just delete the contacts
    await prisma.contact.deleteMany({
      where: { id: { in: junkContactIds } },
    });
  }

  // 1. Get valid tokens for ALL Google accounts
  const accountTokens = await getAllGoogleAccessTokens(userId);
  if (accountTokens.length === 0) {
    console.error("[discover] No valid Google tokens for user", userId);
    return { contactsCreated: 0, contactsExisted: 0, contactsCleaned: junkContactIds.length, interactionsLogged: 0, interactionsExisted: 0, totalEmails: 0, peopleFound: 0 };
  }

  // 2. Fetch messages from ALL accounts
  const allMessageIds: GmailMessage[] = [];
  for (const { token } of accountTokens) {
    const ids = await fetchAllMessageIdsForToken(token, days, maxMessages);
    allMessageIds.push(...ids);
  }

  // Dedup by message ID (same message could appear in multiple accounts)
  const seenIds = new Set<string>();
  const messageIds = allMessageIds.filter((m) => {
    if (seenIds.has(m.id)) return false;
    seenIds.add(m.id);
    return true;
  });

  if (messageIds.length === 0) {
    return { contactsCreated: 0, contactsExisted: 0, contactsCleaned: junkContactIds.length, interactionsLogged: 0, interactionsExisted: 0, totalEmails: 0, peopleFound: 0 };
  }

  // 3. Fetch message details in batches (use first working token)
  const messages = await fetchMessagesBatched(accountTokens[0].token, messageIds);

  // 3. First pass: discover all unique people and their best display name
  const peopleMap = new Map<
    string,
    { name: string; messageCount: number; latestDate: Date }
  >();

  interface MessagePerson {
    detail: GmailMessageDetail;
    counterparties: Array<{ email: string; direction: "INBOUND" | "OUTBOUND" }>;
  }

  const messagePersons: MessagePerson[] = [];

  for (const detail of messages) {
    const fromHeader = getHeader(detail.payload.headers, "From");
    const toHeader = getHeader(detail.payload.headers, "To");
    const ccHeader = getHeader(detail.payload.headers, "Cc");

    if (!fromHeader) continue;

    const fromParsed = parseEmailHeader(fromHeader);
    if (!fromParsed) continue;

    const isOutbound = fromParsed.email === userEmail;
    const counterparties: Array<{
      email: string;
      direction: "INBOUND" | "OUTBOUND";
    }> = [];

    if (isOutbound) {
      // User sent this — recipients are counterparties
      const toRecipients = toHeader ? parseAllRecipients(toHeader) : [];
      const ccRecipients = ccHeader ? parseAllRecipients(ccHeader) : [];
      const allRecipients = [...toRecipients, ...ccRecipients];

      for (const r of allRecipients) {
        if (r.email === userEmail) continue;
        if (!isHumanSender(r.email, r.name)) continue;
        counterparties.push({ email: r.email, direction: "OUTBOUND" });

        const existing = peopleMap.get(r.email);
        const msgDate = new Date(parseInt(detail.internalDate));
        if (existing) {
          peopleMap.set(r.email, {
            name: r.name.includes("@") ? existing.name : r.name, // prefer real names
            messageCount: existing.messageCount + 1,
            latestDate: msgDate > existing.latestDate ? msgDate : existing.latestDate,
          });
        } else {
          peopleMap.set(r.email, {
            name: r.name,
            messageCount: 1,
            latestDate: msgDate,
          });
        }
      }
    } else {
      // Someone sent to user — sender is the counterparty
      if (!isHumanSender(fromParsed.email, fromParsed.name)) continue;
      counterparties.push({
        email: fromParsed.email,
        direction: "INBOUND",
      });

      const existing = peopleMap.get(fromParsed.email);
      const msgDate = new Date(parseInt(detail.internalDate));
      if (existing) {
        peopleMap.set(fromParsed.email, {
          name: fromParsed.name.includes("@") ? existing.name : fromParsed.name,
          messageCount: existing.messageCount + 1,
          latestDate: msgDate > existing.latestDate ? msgDate : existing.latestDate,
        });
      } else {
        peopleMap.set(fromParsed.email, {
          name: fromParsed.name,
          messageCount: 1,
          latestDate: msgDate,
        });
      }
    }

    if (counterparties.length > 0) {
      messagePersons.push({ detail, counterparties });
    }
  }

  // 4. Load existing contacts for dedup
  const existingContacts = await prisma.contact.findMany({
    where: { userId, email: { not: null } },
    select: { id: true, email: true },
  });
  const contactsByEmail = new Map(
    existingContacts
      .filter((c) => c.email)
      .map((c) => [c.email!.toLowerCase(), c.id]),
  );

  // 5. Create new contacts via identity resolution engine
  let contactsCreated = 0;
  const newPeople = Array.from(peopleMap.entries()).filter(
    ([email]) => !contactsByEmail.has(email),
  );

  const batchCtx = await createBatchContext(userId);

  for (const [email, person] of newPeople) {
    const input: SightingInput = {
      source: "GMAIL_DISCOVER",
      externalId: email,
      name: person.name,
      email,
      phone: null,
      company: null,
      role: null,
      city: null,
      state: null,
      country: null,
      linkedinUrl: null,
    };

    const resolution = await processOneSighting(batchCtx, input);

    if (resolution === "NEW_CONTACT") {
      // Find the newly created contact by email in the batch context
      const newContact = batchCtx.contacts.find(
        (c) => c.email?.toLowerCase() === email.toLowerCase(),
      );
      if (newContact) {
        contactsByEmail.set(email, newContact.id);

        // Set tier based on message frequency
        const tier = person.messageCount >= 10
          ? "INNER_CIRCLE"
          : person.messageCount >= 3
            ? "PROFESSIONAL"
            : "ACQUAINTANCE";

        await prisma.contact.update({
          where: { id: newContact.id },
          data: { tier, lastInteraction: person.latestDate },
        });
      }
      contactsCreated++;
    } else if (resolution === "AUTO_MERGED") {
      // Contact already exists — map email to the merged contact
      const matched = batchCtx.contacts.find(
        (c) => c.email?.toLowerCase() === email.toLowerCase(),
      );
      if (matched) {
        contactsByEmail.set(email, matched.id);
      }
    }
  }

  // 6. Create interaction records for ALL messages
  // Dedup by (sourceId, contactId) pair — NOT just sourceId.
  // The old sync only extracted one recipient per email, so multi-recipient
  // emails only got logged for the first To: address. We need per-pair dedup
  // so discover can fill in the missing recipients.
  const existingInteractionPairs = new Set(
    (
      await prisma.interaction.findMany({
        where: { userId, sourceId: { not: null } },
        select: { sourceId: true, contactId: true },
      })
    ).map((i) => `${i.sourceId}:${i.contactId}`),
  );

  let interactionsLogged = 0;
  let interactionsExisted = 0;

  for (const { detail, counterparties } of messagePersons) {
    const subject = getHeader(detail.payload.headers, "Subject");
    const occurredAt = new Date(parseInt(detail.internalDate));

    for (const cp of counterparties) {
      const contactId = contactsByEmail.get(cp.email);
      if (!contactId) continue;

      const pairKey = `${detail.id}:${contactId}`;
      if (existingInteractionPairs.has(pairKey)) {
        interactionsExisted++;
        continue;
      }

      await prisma.interaction.create({
        data: {
          userId,
          contactId,
          type: "EMAIL",
          direction: cp.direction,
          channel: "gmail",
          subject: subject?.slice(0, 255) ?? null,
          summary: detail.snippet?.slice(0, 500) ?? null,
          occurredAt,
          sourceId: detail.id,
          chatId: detail.threadId ? `gmail:${detail.threadId}` : `1:1:${contactId}:email`,
        },
      });
      existingInteractionPairs.add(pairKey);
      interactionsLogged++;
    }
  }

  // 7. Update lastInteraction timestamps for all contacts that were touched
  const contactLatest = new Map<string, Date>();
  for (const { detail, counterparties } of messagePersons) {
    const occurredAt = new Date(parseInt(detail.internalDate));
    for (const cp of counterparties) {
      const contactId = contactsByEmail.get(cp.email);
      if (!contactId) continue;
      const current = contactLatest.get(contactId);
      if (!current || occurredAt > current) {
        contactLatest.set(contactId, occurredAt);
      }
    }
  }

  for (const [contactId, latestDate] of contactLatest) {
    await prisma.contact.update({
      where: { id: contactId },
      data: { lastInteraction: latestDate },
    });
  }

  // 8. Update sync state
  const profileRes = await googleFetchWithToken(
    accountTokens[0].token,
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
  );
  if (profileRes.ok) {
    const profile = (await profileRes.json()) as { historyId: string };
    await prisma.gmailSyncState.upsert({
      where: { userId },
      create: {
        userId,
        syncEnabled: true,
        historyId: profile.historyId,
        lastSyncAt: new Date(),
      },
      update: {
        syncEnabled: true,
        historyId: profile.historyId,
        lastSyncAt: new Date(),
        unmatchedSenders: [], // clear — we just created contacts for everyone
      },
    });
  }

  const contactsExisted = peopleMap.size - contactsCreated;

  return {
    contactsCreated,
    contactsExisted,
    contactsCleaned: junkContactIds.length,
    interactionsLogged,
    interactionsExisted,
    totalEmails: messages.length,
    peopleFound: peopleMap.size,
  };
}

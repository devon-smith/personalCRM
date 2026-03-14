import { prisma } from "@/lib/prisma";

// ─── Types ───────────────────────────────────────────────────

export interface InboundMessage {
  readonly summary: string;
  readonly subject: string | null;
  readonly occurredAt: string;
}

export interface NeedsResponseItem {
  readonly contactId: string;
  readonly contactName: string;
  readonly company: string | null;
  readonly tier: string;
  readonly channel: string;
  readonly lastInboundSubject: string | null;
  readonly messages: readonly InboundMessage[];
  readonly messageCount: number;
  readonly lastInboundAt: string;
  readonly waitingHours: number;
  readonly urgency: "high" | "medium" | "low";
  readonly urgencyScore: number;
  readonly confidence: "certain" | "likely" | "possible";
  readonly circles: readonly string[];
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly contactLinkedinUrl: string | null;
}

interface ChannelCoverageInfo {
  readonly inbound: boolean;
  readonly outbound: boolean;
}

export interface NeedsResponseResult {
  readonly items: readonly NeedsResponseItem[];
  readonly totalWaiting: number;
  readonly scannedContacts: number;
  readonly channelCoverage: {
    readonly gmail: ChannelCoverageInfo;
    readonly iMessage: ChannelCoverageInfo;
    readonly SMS: ChannelCoverageInfo;
    readonly linkedin: ChannelCoverageInfo;
  };
}

// ─── Urgency scoring ─────────────────────────────────────────

function computeUrgencyScore(
  waitingHours: number,
  tier: string,
  messageCount: number,
  isGroupChat: boolean,
  confidence: "certain" | "likely" | "possible",
): number {
  let score = 0;

  // Time-based scoring
  if (waitingHours < 4) score += 10;
  else if (waitingHours < 24) score += 30;
  else if (waitingHours < 72) score += 50;
  else if (waitingHours < 168) score += 70;
  else score += 90;

  // Tier bonuses
  if (tier === "INNER_CIRCLE") score += 30;
  else if (tier === "PROFESSIONAL") score += 15;

  // Multiple unreplied messages
  if (messageCount >= 3) score += 20;
  else if (messageCount >= 2) score += 10;

  // Group chat penalty
  if (isGroupChat) score -= 20;

  // Low confidence penalty
  if (confidence === "possible") score -= 15;

  return Math.max(0, Math.min(100, score));
}

function scoreToUrgency(score: number): "high" | "medium" | "low" {
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

// ─── Spam / marketing filter ─────────────────────────────────

const SPAM_PATTERNS = [
  /\b(sale|discount|off|promo|coupon|deal|offer|free shipping)\b/i,
  /\b(unsubscribe|opt[- ]?out|stop texting|reply stop)\b/i,
  /\b(order confirm|tracking number|shipped|delivered|your package)\b/i,
  /\b(verify your|confirm your|security code|one[- ]?time|OTP|passcode)\b/i,
  /\b(appointment reminder|reminder:)\b/i,
  /\b(rate your|how was your|survey|feedback)\b/i,
  /\b(autopay|payment due|balance of|billing|invoice)\b/i,
  /\b(rewards? points?|cash ?back|earn \$)\b/i,
  /\b(download the app|get the app|available on)\b/i,
  /\bwww\.[a-z]+\.(com|net|org)\b/i,
  /^(msg:|alert:|notice:)/i,
  // Email-specific patterns
  /\b(noreply|no-reply|donotreply)\b/i,
  /\b(newsletter|digest|weekly update|monthly update)\b/i,
  /\b(subscription|renew|membership|plan expires)\b/i,
  /\b(receipt|transaction|statement|payment received)\b/i,
  /\b(welcome to|thanks for signing up|verify your email)\b/i,
  /\b(2fa|two[- ]?factor|login attempt|sign[- ]?in)\b/i,
  /\b(position alert|job alert|job posting|staff position)\b/i,
  /\b(final call|last chance|act now|limited time)\b/i,
  /\bupdate\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
];

function looksLikeSpam(summary: string | null, subject?: string | null): boolean {
  const text = [summary, subject].filter(Boolean).join(" ");
  if (!text) return false;
  return SPAM_PATTERNS.some((p) => p.test(text));
}

// ─── Conversation-ender detection ────────────────────────────
// Short messages that signal a conversation is finished and don't need a reply.

/** Single-word or very short responses that close a conversation. */
const CONVERSATION_ENDERS = new Set([
  "ok", "okay", "k", "kk",
  "thanks", "thank you", "thx", "ty", "tysm",
  "cool", "nice", "great", "awesome", "perfect", "sweet", "dope", "sick", "fire",
  "totally", "absolutely", "definitely", "exactly", "yep", "yup", "yeah", "ya", "yea", "yes",
  "nope", "nah", "no", "naw",
  "lol", "lmao", "haha", "hahaha", "ha", "😂", "😭", "💀", "🤣",
  "bet", "word", "facts", "true", "same", "mood", "real", "fr", "no cap",
  "sounds good", "sounds great", "all good", "no worries", "np", "no problem",
  "got it", "gotcha", "understood", "copy", "roger",
  "good night", "goodnight", "gn", "night", "nighty night",
  "bye", "later", "peace", "cya", "see ya", "ttyl",
  "love you", "love u", "❤️", "♥️", "🫶", "😘", "💕",
  "will do", "on it", "done", "sent",
  "omg", "wow", "whoa", "damn", "dang", "sheesh",
  "idk", "idc", "nvm", "nevermind",
  "congrats", "congratulations",
]);

/**
 * Returns true if the message looks like a conversation-ender that
 * doesn't need a reply. Only applies to short messages (≤ 6 words).
 */
function isConversationEnder(summary: string | null): boolean {
  if (!summary) return false;
  const cleaned = summary.trim().toLowerCase().replace(/[.!?,]+$/g, "");
  if (!cleaned) return false;

  // Reaction-style messages: "Laughed at" / "Liked" / "Loved" / "Emphasized"
  // These can include the full quoted message so check before word count limit.
  if (/^(laughed at|liked|loved|emphasized|tapback)/i.test(cleaned)) return true;

  // Emoji-only messages (1-4 emoji with optional spaces)
  if (/^[\p{Emoji}\s]{1,12}$/u.test(cleaned) && /\p{Emoji}/u.test(cleaned)) return true;

  // Only consider short messages for the remaining checks
  const wordCount = cleaned.split(/\s+/).length;
  if (wordCount > 6) return false;

  // Direct match
  if (CONVERSATION_ENDERS.has(cleaned)) return true;

  // Laughing / reaction messages: "haha", "HAHAHHAA STOP", "lmaooo dead", etc.
  if (/^(ha){2,}/i.test(cleaned)) return true;
  if (/^l+m+a+o+/i.test(cleaned)) return true;

  // "I'm dead", "im actually dead at this", "dying", pure reactions
  if (/\b(dead|dying|i can'?t|screaming)\b/i.test(cleaned) && wordCount <= 6) return true;

  // "miss u/you" messages
  if (/\bmiss (you|u|y'?all)\b/i.test(cleaned) && wordCount <= 6) return true;

  return false;
}

// ─── Email noise filter ──────────────────────────────────────

/**
 * Skip automated, transactional, and mass emails that shouldn't trigger
 * a "needs response" alert. This supplements the general spam filter
 * with email-specific heuristics.
 */
function shouldSkipEmailForNeedsResponse(
  summary: string | null,
  subject: string | null,
): boolean {
  const text = [summary, subject].filter(Boolean).join(" ").toLowerCase();
  if (!text) return true; // Empty emails don't need response

  // Automated / transactional
  if (/\b(unsubscribe|opt[- ]?out|manage preferences|email preferences)\b/.test(text)) return true;
  if (/\b(receipt|confirmation|order #|tracking|shipped|delivered)\b/.test(text)) return true;
  if (/\b(notification|alert|reminder|automated|auto[- ]?reply|out of office)\b/.test(text)) return true;
  if (/\b(noreply|no-reply|donotreply|do-not-reply)\b/.test(text)) return true;

  // Newsletters and mass emails
  if (/\b(newsletter|digest|weekly|monthly|daily brief|morning brew)\b/.test(text)) return true;
  if (/\b(view in browser|view online|email client)\b/.test(text)) return true;

  // Financial / billing
  if (/\b(statement|invoice|payment (due|received|confirmed)|billing)\b/.test(text)) return true;
  if (/\b(your (account|balance|subscription)|plan (expires|renew))\b/.test(text)) return true;

  // Security / verification
  if (/\b(verify your|confirm your|security code|one[- ]?time|2fa|sign[- ]?in attempt)\b/.test(text)) return true;

  // Marketing
  if (/\b(sale|% off|limited time|act now|exclusive offer|promo code)\b/.test(text)) return true;

  // Very short subject with no body content — likely automated
  if (subject && subject.length < 5 && (!summary || summary.length < 10)) return true;

  return false;
}

// ─── Main detection ──────────────────────────────────────────

export async function detectNeedsResponse(
  userId: string,
  snoozedContactIds: ReadonlySet<string> = new Set(),
): Promise<NeedsResponseResult> {
  // Fetch all interactions from the last 30 days (wider window for context)
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const interactions = await prisma.interaction.findMany({
    where: {
      userId,
      occurredAt: { gte: since },
      type: { not: "NOTE" }, // Notes don't count for response tracking
    },
    orderBy: { occurredAt: "desc" },
    select: {
      contactId: true,
      type: true,
      direction: true,
      channel: true,
      subject: true,
      summary: true,
      occurredAt: true,
    },
  });

  // Fetch user info to skip self-contact
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  const userEmail = user?.email?.toLowerCase();

  // Fetch contact info for all contacts with interactions
  const contactIds = [...new Set(interactions.map((i) => i.contactId))];

  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds }, userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      linkedinUrl: true,
      company: true,
      tier: true,
      circles: {
        select: { circle: { select: { name: true } } },
      },
    },
  });

  const contactMap = new Map(contacts.map((c) => [c.id, c]));

  // Track channel coverage globally
  const channelCoverage = {
    gmail: { inbound: false, outbound: false },
    iMessage: { inbound: false, outbound: false },
    SMS: { inbound: false, outbound: false },
    linkedin: { inbound: false, outbound: false },
  };

  for (const ix of interactions) {
    const ch = ix.channel as keyof typeof channelCoverage | null;
    if (ch && ch in channelCoverage) {
      if (ix.direction === "INBOUND") channelCoverage[ch].inbound = true;
      if (ix.direction === "OUTBOUND") channelCoverage[ch].outbound = true;
    }
  }

  // Group interactions by contactId + channel
  const grouped = new Map<string, typeof interactions>();
  for (const ix of interactions) {
    const channel = ix.channel ?? "unknown";
    const key = `${ix.contactId}::${channel}`;
    const list = grouped.get(key) ?? [];
    list.push(ix);
    grouped.set(key, list);
  }

  // Check for meetings per contact (meetings close conversations on all channels)
  const recentMeetingContacts = new Set<string>();
  for (const ix of interactions) {
    if (ix.type === "MEETING") {
      recentMeetingContacts.add(ix.contactId);
    }
  }

  const items: NeedsResponseItem[] = [];
  const now = Date.now();

  for (const [key, ixList] of grouped) {
    const [contactId, channel] = key.split("::");
    const contact = contactMap.get(contactId);
    if (!contact) continue;

    // Skip snoozed contacts
    if (snoozedContactIds.has(contactId)) continue;

    // Skip self-contact (user's own email/name)
    if (userEmail && contact.email?.toLowerCase() === userEmail) continue;

    // Sort by occurredAt desc (already sorted, but ensure within group)
    const sorted = [...ixList].sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );

    const mostRecent = sorted[0];

    // If the most recent interaction on this channel is outbound, I already replied
    if (mostRecent.direction === "OUTBOUND") continue;

    // If we had a recent meeting with this contact, skip
    if (recentMeetingContacts.has(contactId)) continue;

    // Collect all consecutive inbound messages (since last outbound)
    // Deduplicate by timestamp proximity to handle overlap between
    // Notion sync and Mac chat.db sync (same message from both sources)
    const unrepliedMessages: InboundMessage[] = [];
    let lastCountedTime = 0;
    for (const ix of sorted) {
      if (ix.direction !== "INBOUND") break;
      const t = new Date(ix.occurredAt).getTime();
      // Skip if within 2 minutes of previously counted message (likely duplicate)
      if (lastCountedTime > 0 && Math.abs(t - lastCountedTime) < 120_000) {
        continue;
      }
      unrepliedMessages.push({
        summary: ix.summary ?? "",
        subject: ix.subject,
        occurredAt: ix.occurredAt.toISOString(),
      });
      lastCountedTime = t;
    }

    if (unrepliedMessages.length === 0) continue;

    // Check most recent message for spam/conversation-ender
    const newestMessage = unrepliedMessages[0];
    if (looksLikeSpam(newestMessage.summary, newestMessage.subject)) continue;
    if (isConversationEnder(newestMessage.summary)) continue;

    // Extra email-specific filter: skip automated/transactional emails
    if (channel === "gmail" || channel === "email") {
      if (shouldSkipEmailForNeedsResponse(newestMessage.summary, newestMessage.subject)) continue;
    }

    const messageCount = unrepliedMessages.length;
    const waitingMs = now - new Date(mostRecent.occurredAt).getTime();
    const waitingHours = waitingMs / (1000 * 60 * 60);

    // Determine confidence based on whether we have outbound data for this channel
    const ch = channel as keyof typeof channelCoverage;
    const hasOutboundData = ch in channelCoverage ? channelCoverage[ch].outbound : false;
    let confidence: "certain" | "likely" | "possible";
    if (hasOutboundData) {
      confidence = "certain";
    } else if (ch === "gmail") {
      confidence = "certain";
    } else if (ch === "iMessage" || ch === "SMS") {
      confidence = "likely";
    } else {
      confidence = "possible";
    }

    const isGroupChat = (newestMessage.summary ?? "").startsWith("(in group chat)");

    const urgencyScore = computeUrgencyScore(
      waitingHours,
      contact.tier,
      messageCount,
      isGroupChat,
      confidence,
    );

    items.push({
      contactId,
      contactName: contact.name,
      company: contact.company,
      tier: contact.tier,
      channel,
      lastInboundSubject: newestMessage.subject,
      messages: unrepliedMessages,
      messageCount,
      lastInboundAt: mostRecent.occurredAt.toISOString(),
      waitingHours: Math.round(waitingHours),
      urgency: scoreToUrgency(urgencyScore),
      urgencyScore,
      confidence,
      circles: contact.circles.map((cc) => cc.circle.name),
      contactEmail: contact.email,
      contactPhone: contact.phone,
      contactLinkedinUrl: contact.linkedinUrl,
    });
  }

  // Sort by urgency score descending
  items.sort((a, b) => b.urgencyScore - a.urgencyScore);

  return {
    items,
    totalWaiting: items.length,
    scannedContacts: contactIds.length,
    channelCoverage,
  };
}

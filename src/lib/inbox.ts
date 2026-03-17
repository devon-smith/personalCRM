import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// ─── Channel normalization ──────────────────────────────────

function normalizeChannel(ch: string): string {
  const c = ch.toLowerCase();
  if (["imessage", "sms", "text"].includes(c)) return "text";
  if (["gmail", "email"].includes(c)) return "email";
  if (["linkedin"].includes(c)) return "linkedin";
  return c;
}

// ─── Tapback detection ──────────────────────────────────────

const TAPBACK_VERBS = [
  "Loved", "Liked", "Laughed at", "Emphasized",
  "Disliked", "Questioned",
];

function isTapbackReaction(summary: string): boolean {
  if (!summary) return false;
  const s = summary
    .replace(/^\(in group chat\)\s*/i, "")
    .trim();

  for (const verb of TAPBACK_VERBS) {
    if (s.startsWith(`${verb} \u201C`) || s.startsWith(`${verb} "`)) return true;
    if (new RegExp(`^${verb}\\s+(a |an )`, "i").test(s)) return true;
  }
  if (/^Reacted\s+.+\s+to\s+/i.test(s)) return true;
  return false;
}

// ─── Conversation-ender detection ───────────────────────────

// Exact-match enders (full message matches one of these)
const CONVERSATION_ENDERS = new Set([
  "ok", "okay", "k", "kk",
  "thanks", "thank you", "thx", "ty", "tysm",
  "cool", "nice", "great", "awesome", "perfect", "sweet", "dope", "sick", "fire",
  "totally", "absolutely", "definitely", "exactly", "yep", "yup", "yeah", "ya", "yea", "yes",
  "nope", "nah", "no", "naw",
  "lol", "lmao", "haha", "hahaha", "ha",
  "bet", "word", "facts", "true", "same", "mood", "real", "fr", "no cap",
  "sounds good", "sounds great", "all good", "no worries", "np", "no problem",
  "got it", "gotcha", "understood", "copy", "roger",
  "good night", "goodnight", "gn", "night",
  "bye", "later", "peace", "cya", "see ya", "ttyl",
  "love you", "love u",
  "will do", "on it", "done", "sent",
  "omg", "wow", "whoa", "damn", "dang", "sheesh",
  "idk", "idc", "nvm", "nevermind",
  "congrats", "congratulations",
]);

// Prefix-match enders: message starts with one of these (+ optional trailing words)
// e.g. "thanks beast", "thank you dev", "nah all good thanks though"
const ENDER_PREFIXES = [
  "thanks", "thank you", "thx", "ty",
  "sounds good", "sounds great",
  "all good", "no worries", "no problem",
  "got it", "gotcha",
  "will do", "on it",
  "love you", "love u",
  "congrats", "congratulations",
  "nah", "nope",
  "good night", "goodnight",
  "bye", "later", "peace", "see ya",
];

// Pattern-match enders: short messages that are reactions/acknowledgments
const ENDER_PATTERNS = [
  /^(ha){2,}/i,            // haha, hahaha, etc.
  /^l+m+a+o+/i,            // lmao, lmaooo
  /^huge\b/i,              // "Huge", "Huge stuff"
  /^nice\b/i,              // "Nice one", "Nice stuff"
  /^sick\b/i,              // "Sick dude"
  /^dope\b/i,              // "Dope stuff"
  /^fire\b/i,              // "Fire bro"
  /^damn\b/i,              // "Damn dude"
  /^wow\b/i,               // "Wow that's crazy"
  /^omg\b/i,               // "Omg no way"
  /^sheesh\b/i,            // "Sheesh"
  /^yea(h)?\b/i,           // "Yeah for sure"
  /^for sure\b/i,          // "For sure"
  /^of course\b/i,         // "Of course"
  /^(o?k(ay)?)\b/i,        // "Ok cool", "Okay sounds good"
];

export function isConversationEnder(summary: string | null): boolean {
  if (!summary) return false;
  const cleaned = summary
    .replace(/^\(in group chat\)\s*/i, "")
    .trim()
    .toLowerCase()
    .replace(/[.!?,]+$/g, "");
  if (!cleaned) return false;

  // Emoji-only messages (thumbs up, heart, etc.)
  if (/^[\p{Emoji}\s]{1,12}$/u.test(cleaned) && /\p{Emoji}/u.test(cleaned)) return true;

  const wordCount = cleaned.split(/\s+/).length;
  if (wordCount > 8) return false;

  // Exact match
  if (CONVERSATION_ENDERS.has(cleaned)) return true;

  // Prefix match — message starts with an ender phrase
  // Only for short messages (≤6 words) to avoid filtering real questions
  if (wordCount <= 6) {
    for (const prefix of ENDER_PREFIXES) {
      if (cleaned === prefix || cleaned.startsWith(prefix + " ")) return true;
    }
  }

  // Pattern match — short reactive messages
  if (wordCount <= 4) {
    for (const pattern of ENDER_PATTERNS) {
      if (pattern.test(cleaned)) return true;
    }
  }

  return false;
}

// ─── Spam detection ─────────────────────────────────────────

const SPAM_PATTERNS = [
  /\b(unsubscribe|opt[- ]?out|manage preferences|email preferences)\b/i,
  /\b(receipt|confirmation|order #|tracking|shipped|delivered)\b/i,
  /\b(notification|alert|reminder|automated|auto[- ]?reply|out of office)\b/i,
  /\b(noreply|no-reply|donotreply|do-not-reply)\b/i,
  /\b(newsletter|digest|weekly|monthly|daily brief|morning brew)\b/i,
  /\b(sale|% off|limited time|act now|exclusive offer|promo code)\b/i,
  /\b(verify your|confirm your|security code|one[- ]?time|2fa)\b/i,
];

function isSpamOrAutomated(summary: string | null, subject: string | null): boolean {
  const text = [summary, subject].filter(Boolean).join(" ");
  if (!text) return false;
  return SPAM_PATTERNS.some((p) => p.test(text));
}

// ─── Called when an INBOUND interaction is created ───────────

export async function onInboundInteraction(
  userId: string,
  contactId: string,
  rawChannel: string,
  interaction: {
    id: string;
    summary: string | null;
    occurredAt: Date;
    subject?: string | null;
  },
  options?: {
    threadKey?: string | null;
    isGroupChat?: boolean;
  },
): Promise<void> {
  const channel = normalizeChannel(rawChannel);
  // Always use "" for null/undefined threadKey — matches the DB default
  const threadKey = options?.threadKey ?? "";
  const summary = interaction.summary ?? "";

  // Don't create inbox items for tapback reactions
  if (isTapbackReaction(summary)) {
    await prisma.inboxItem.updateMany({
      where: { userId, contactId, channel, threadKey, status: "OPEN" },
      data: { updatedAt: new Date() },
    });
    return;
  }

  // Don't create inbox items for conversation-enders
  if (isConversationEnder(summary)) return;

  // Don't create inbox items for spam/automated emails
  if (channel === "email" && isSpamOrAutomated(summary, interaction.subject ?? null)) return;

  // Check for existing OPEN item for this contact+channel+thread
  const existing = await prisma.inboxItem.findFirst({
    where: { userId, contactId, channel, threadKey, status: "OPEN" },
  });

  if (existing) {
    const previews = (existing.messagePreview as unknown as Array<Record<string, unknown>>) ?? [];

    // Deduplicate: skip if this exact message is already in previews
    const isDuplicate = previews.some((p) =>
      p.summary === summary &&
      p.occurredAt === interaction.occurredAt.toISOString()
    );
    if (isDuplicate) return;

    const newPreview = {
      summary,
      occurredAt: interaction.occurredAt.toISOString(),
      channel: rawChannel,
    };

    // Sort newest first, cap at 10
    const allPreviews = [newPreview, ...previews];
    allPreviews.sort((a, b) =>
      new Date(b.occurredAt as string).getTime() - new Date(a.occurredAt as string).getTime()
    );
    const trimmed = allPreviews.slice(0, 10) as unknown as Prisma.InputJsonValue;

    // Only advance triggerAt forward, never backward
    const newTriggerAt = interaction.occurredAt > existing.triggerAt
      ? interaction.occurredAt
      : existing.triggerAt;

    await prisma.inboxItem.update({
      where: { id: existing.id },
      data: {
        messagePreview: trimmed,
        messageCount: existing.messageCount + 1,
        triggerAt: newTriggerAt,
      },
    });
    return;
  }

  // Check for active SNOOZE — accumulate messages but don't reopen
  const snoozed = await prisma.inboxItem.findFirst({
    where: {
      userId, contactId, channel, threadKey,
      status: "SNOOZED",
      snoozeUntil: { gt: new Date() },
    },
  });

  if (snoozed) {
    const previews = (snoozed.messagePreview as unknown as Array<Record<string, unknown>>) ?? [];
    const updated = [
      {
        summary,
        occurredAt: interaction.occurredAt.toISOString(),
        channel: rawChannel,
      },
      ...previews,
    ].slice(0, 10) as unknown as Prisma.InputJsonValue;

    await prisma.inboxItem.update({
      where: { id: snoozed.id },
      data: {
        messagePreview: updated,
        messageCount: snoozed.messageCount + 1,
      },
    });
    return;
  }

  // Check if recently resolved — only reopen if this message is AFTER resolution
  const lastResolved = await prisma.inboxItem.findFirst({
    where: { userId, contactId, channel, threadKey, status: "RESOLVED" },
    orderBy: { resolvedAt: "desc" },
  });

  if (lastResolved?.resolvedAt && interaction.occurredAt <= lastResolved.resolvedAt) {
    return; // Old message arriving late — don't reopen
  }

  // Fetch contact for denormalized fields
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      name: true, company: true, tier: true,
      email: true, phone: true, linkedinUrl: true,
    },
  });
  if (!contact) return;

  const messagePreview = [{
    summary,
    occurredAt: interaction.occurredAt.toISOString(),
    channel: rawChannel,
  }];

  // Upsert: create new or reopen resolved/dismissed item
  await prisma.inboxItem.upsert({
    where: {
      userId_contactId_channel_threadKey: {
        userId,
        contactId,
        channel,
        threadKey,
      },
    },
    create: {
      userId,
      contactId,
      channel,
      threadKey,
      status: "OPEN",
      contactName: contact.name,
      company: contact.company,
      tier: contact.tier,
      isGroupChat: options?.isGroupChat ?? false,
      contactEmail: contact.email,
      contactPhone: contact.phone,
      contactLinkedinUrl: contact.linkedinUrl,
      triggerInteractionId: interaction.id,
      triggerAt: interaction.occurredAt,
      messagePreview,
      messageCount: 1,
    },
    update: {
      status: "OPEN",
      resolvedAt: null,
      resolvedBy: null,
      snoozeUntil: null,
      contactName: contact.name,
      company: contact.company,
      tier: contact.tier,
      triggerInteractionId: interaction.id,
      triggerAt: interaction.occurredAt,
      messagePreview,
      messageCount: 1,
    },
  });
}

// ─── Called when an OUTBOUND interaction is created ──────────
// THIS IS THE AUTO-RESOLUTION FUNCTION

export async function onOutboundInteraction(
  userId: string,
  contactId: string,
  rawChannel: string,
  occurredAt: Date,
  options?: {
    threadKey?: string | null;
    isGroupChat?: boolean;
  },
): Promise<void> {
  const channel = normalizeChannel(rawChannel);
  const threadKey = options?.threadKey ?? "";

  // For group chats: resolve ALL contacts in this thread (one reply addresses everyone)
  // For 1:1: resolve only this contact's 1:1 item
  const baseFilter = options?.isGroupChat
    ? { userId, channel, threadKey, isGroupChat: true }   // group: all contacts in thread
    : { userId, contactId, channel, threadKey: "" };      // 1:1: only this contact

  const resolved = await prisma.inboxItem.updateMany({
    where: {
      ...baseFilter,
      status: "OPEN",
      triggerAt: { lte: occurredAt },
    },
    data: {
      status: "RESOLVED",
      resolvedAt: occurredAt,
      resolvedBy: "auto_sync",
    },
  });

  if (resolved.count > 0) {
    console.log(
      `[inbox] Auto-resolved ${resolved.count} item(s) on ${channel} (thread: ${threadKey || "1:1"})`,
    );
  }

  // Also resolve snoozed items
  await prisma.inboxItem.updateMany({
    where: {
      ...baseFilter,
      status: "SNOOZED",
      triggerAt: { lte: occurredAt },
    },
    data: {
      status: "RESOLVED",
      resolvedAt: occurredAt,
      resolvedBy: "auto_sync",
    },
  });
}

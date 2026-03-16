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

function isConversationEnder(summary: string | null): boolean {
  if (!summary) return false;
  const cleaned = summary
    .replace(/^\(in group chat\)\s*/i, "")
    .trim()
    .toLowerCase()
    .replace(/[.!?,]+$/g, "");
  if (!cleaned) return false;

  // Emoji-only
  if (/^[\p{Emoji}\s]{1,12}$/u.test(cleaned) && /\p{Emoji}/u.test(cleaned)) return true;

  const wordCount = cleaned.split(/\s+/).length;
  if (wordCount > 6) return false;

  if (CONVERSATION_ENDERS.has(cleaned)) return true;
  if (/^(ha){2,}/i.test(cleaned)) return true;
  if (/^l+m+a+o+/i.test(cleaned)) return true;

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
): Promise<void> {
  const channel = normalizeChannel(rawChannel);

  // Resolve ALL open inbox items for this contact on this channel
  // that were triggered BEFORE this outbound
  const resolved = await prisma.inboxItem.updateMany({
    where: {
      userId,
      contactId,
      channel,
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
      `[inbox] Auto-resolved ${resolved.count} item(s) for contact ${contactId} on ${channel}`,
    );
  }

  // Also resolve snoozed items (user replied, snooze is moot)
  await prisma.inboxItem.updateMany({
    where: {
      userId,
      contactId,
      channel,
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

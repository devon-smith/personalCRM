import { prisma } from "@/lib/prisma";

// ─── Types ───

export type ReplyPriority = "high" | "medium" | "low" | "skip";

export interface UnrespondedThread {
  readonly contactId: string;
  readonly contactName: string;
  readonly contactCompany: string | null;
  readonly subject: string | null;
  readonly preview: string | null;
  readonly daysWaiting: number;
  readonly lastMessageAt: Date;
  readonly interactionId: string;
  readonly priority: ReplyPriority;
  readonly priorityReason: string;
  readonly threadDepth: number;
}

export interface StaleOutbound {
  readonly contactId: string;
  readonly contactName: string;
  readonly subject: string | null;
  readonly preview: string | null;
  readonly daysSinceSent: number;
  readonly sentAt: Date;
  readonly interactionId: string;
}

export interface ThreadQueryOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly minDays?: number;
}

const DEFAULT_LIMIT = 50;
const DEFAULT_STALE_DAYS = 7;

// ─── Noise detection ───

/** Subjects that are almost never reply-worthy */
const SKIP_SUBJECT_PATTERNS = [
  /^(fwd|fw):/i,
  /newsletter/i,
  /unsubscribe/i,
  /digest/i,
  /\bweekly\b.*\b(update|recap|summary|report)\b/i,
  /\bmonthly\b.*\b(update|recap|summary|report)\b/i,
  /\bdaily\b.*\b(update|recap|summary|report)\b/i,
  /out of office/i,
  /auto.?reply/i,
  /automatic reply/i,
  /invitation:/i,
  /accepted:/i,
  /declined:/i,
  /canceled:/i,
  /updated invitation/i,
  /\breceipt\b/i,
  /\binvoice\b/i,
  /\bconfirmation\b/i,
  /\bverif(y|ication)\b/i,
  /\bpassword\b.*\breset\b/i,
  /\bwelcome to\b/i,
  /\bsign(ed)? up\b/i,
  /\bnotification\b/i,
  /do not reply/i,
];

/** Body patterns that signal no reply needed */
const SKIP_BODY_PATTERNS = [
  /this is an automated/i,
  /do not reply/i,
  /no.?reply/i,
  /unsubscribe/i,
  /you are receiving this/i,
  /this email was sent/i,
  /manage your preferences/i,
  /view in browser/i,
  /email preferences/i,
];

export function isNoiseEmail(
  subject: string | null,
  body: string | null,
): boolean {
  if (subject) {
    for (const pattern of SKIP_SUBJECT_PATTERNS) {
      if (pattern.test(subject)) return true;
    }
  }
  if (body) {
    let matchCount = 0;
    for (const pattern of SKIP_BODY_PATTERNS) {
      if (pattern.test(body)) matchCount++;
    }
    // 2+ signals = almost certainly automated
    if (matchCount >= 2) return true;
  }
  return false;
}

// ─── Priority scoring ───

export function scoreReplyPriority(
  subject: string | null,
  body: string | null,
  daysWaiting: number,
  threadDepth: number,
  contactTier: string | null,
): { priority: ReplyPriority; reason: string } {
  // First check if it's noise
  if (isNoiseEmail(subject, body)) {
    return { priority: "skip", reason: "Automated or newsletter" };
  }

  let score = 0;
  const reasons: string[] = [];

  // Time urgency — older = more urgent
  if (daysWaiting >= 7) {
    score += 3;
    reasons.push(`${daysWaiting}d waiting`);
  } else if (daysWaiting >= 3) {
    score += 2;
    reasons.push(`${daysWaiting}d waiting`);
  } else if (daysWaiting >= 1) {
    score += 1;
  }

  // Thread has back-and-forth = real conversation, higher priority
  if (threadDepth >= 3) {
    score += 2;
    reasons.push("Active thread");
  } else if (threadDepth >= 2) {
    score += 1;
  }

  // Contact importance
  if (contactTier === "INNER_CIRCLE") {
    score += 2;
    reasons.push("Inner circle");
  } else if (contactTier === "PROFESSIONAL") {
    score += 1;
  }

  // Question marks in subject = likely expecting an answer
  const questionInSubject = subject && /\?/.test(subject);
  const questionInBody = body && (body.match(/\?/g)?.length ?? 0) >= 1;
  if (questionInSubject) {
    score += 2;
    reasons.push("Question asked");
  } else if (questionInBody) {
    score += 1;
  }

  // Urgency language
  const urgentPattern = /\b(urgent|asap|time.?sensitive|deadline|due|by (today|tomorrow|monday|tuesday|wednesday|thursday|friday|end of))\b/i;
  const combinedText = [subject, body].filter(Boolean).join(" ");
  if (urgentPattern.test(combinedText)) {
    score += 2;
    reasons.push("Time-sensitive");
  }

  // Action language — they're asking you to do something
  const actionPattern = /\b(can you|could you|please|would you|let me know|send me|share|review|approve|confirm|schedule|call me)\b/i;
  if (actionPattern.test(combinedText)) {
    score += 1;
    if (!reasons.includes("Question asked")) {
      reasons.push("Action requested");
    }
  }

  // Map score to priority
  if (score >= 5) {
    return { priority: "high", reason: reasons.slice(0, 2).join(" · ") || "Needs reply" };
  }
  if (score >= 3) {
    return { priority: "medium", reason: reasons.slice(0, 2).join(" · ") || "Reply suggested" };
  }
  if (score >= 1) {
    return { priority: "low", reason: reasons[0] || "Low priority" };
  }
  return { priority: "low", reason: "No urgency signals" };
}

// ─── Helpers ───

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function truncate(text: string | null, maxLength: number): string | null {
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

// ─── Core Queries ───

/**
 * Find emails where the contact sent the last message and the user
 * hasn't replied. Scores each by reply priority, filtering out noise.
 */
export async function getUnrespondedThreads(
  userId: string,
  options: ThreadQueryOptions = {},
): Promise<readonly UnrespondedThread[]> {
  const { limit = DEFAULT_LIMIT, offset = 0 } = options;

  // Get the latest email per contact
  const latestPerContact = await prisma.$queryRaw<
    Array<{
      id: string;
      contactId: string;
      contactName: string;
      contactCompany: string | null;
      contactTier: string | null;
      subject: string | null;
      summary: string | null;
      occurredAt: Date;
      direction: string;
    }>
  >`
    SELECT DISTINCT ON (i."contactId")
      i."id",
      i."contactId",
      c."name" AS "contactName",
      c."company" AS "contactCompany",
      c."tier" AS "contactTier",
      i."subject",
      i."summary",
      i."occurredAt",
      i."direction"
    FROM "Interaction" i
    JOIN "Contact" c ON c."id" = i."contactId"
    WHERE i."userId" = ${userId}
      AND i."type" = 'EMAIL'
      AND i."dismissedAt" IS NULL
    ORDER BY i."contactId", i."occurredAt" DESC
  `;

  const now = new Date();

  // Only keep INBOUND (contact sent last, user hasn't replied)
  const inboundLatest = latestPerContact.filter(
    (r) => r.direction === "INBOUND",
  );

  if (inboundLatest.length === 0) {
    return [];
  }

  // Get thread depth (total emails exchanged with each contact) for scoring
  const contactIds = inboundLatest.map((r) => r.contactId);
  const threadDepths = await prisma.interaction.groupBy({
    by: ["contactId"],
    where: {
      userId,
      contactId: { in: contactIds },
      type: "EMAIL",
    },
    _count: { _all: true },
  });
  const depthMap = new Map(
    threadDepths.map((r) => [r.contactId, r._count._all]),
  );

  // Score and filter
  const scored = inboundLatest
    .map((row) => {
      const daysWaiting = daysBetween(row.occurredAt, now);
      const threadDepth = depthMap.get(row.contactId) ?? 1;

      const { priority, reason } = scoreReplyPriority(
        row.subject,
        row.summary,
        daysWaiting,
        threadDepth,
        row.contactTier,
      );

      return {
        interactionId: row.id,
        contactId: row.contactId,
        contactName: row.contactName,
        contactCompany: row.contactCompany,
        subject: truncate(row.subject, 120),
        preview: truncate(row.summary, 200),
        daysWaiting,
        lastMessageAt: row.occurredAt,
        priority,
        priorityReason: reason,
        threadDepth,
      };
    })
    .filter((t) => t.priority !== "skip");

  // Sort: high > medium > low, then by days waiting desc
  const priorityOrder: Record<ReplyPriority, number> = {
    high: 0,
    medium: 1,
    low: 2,
    skip: 3,
  };

  scored.sort((a, b) => {
    const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pDiff !== 0) return pDiff;
    return b.daysWaiting - a.daysWaiting;
  });

  return scored.slice(offset, offset + limit);
}

/**
 * Find emails where the user sent the last message but hasn't
 * heard back in `minDays` days.
 */
export async function getStaleOutbound(
  userId: string,
  options: ThreadQueryOptions = {},
): Promise<readonly StaleOutbound[]> {
  const {
    limit = DEFAULT_LIMIT,
    offset = 0,
    minDays = DEFAULT_STALE_DAYS,
  } = options;

  const cutoffDate = new Date(
    Date.now() - minDays * 24 * 60 * 60 * 1000,
  );

  const latestPerContact = await prisma.$queryRaw<
    Array<{
      id: string;
      contactId: string;
      contactName: string;
      subject: string | null;
      summary: string | null;
      occurredAt: Date;
      direction: string;
    }>
  >`
    SELECT DISTINCT ON (i."contactId")
      i."id",
      i."contactId",
      c."name" AS "contactName",
      i."subject",
      i."summary",
      i."occurredAt",
      i."direction"
    FROM "Interaction" i
    JOIN "Contact" c ON c."id" = i."contactId"
    WHERE i."userId" = ${userId}
      AND i."type" = 'EMAIL'
    ORDER BY i."contactId", i."occurredAt" DESC
  `;

  if (latestPerContact.length === 0) {
    return [];
  }

  const now = new Date();

  return latestPerContact
    .filter(
      (r) =>
        r.direction === "OUTBOUND" && r.occurredAt <= cutoffDate,
    )
    .map((row) => ({
      interactionId: row.id,
      contactId: row.contactId,
      contactName: row.contactName,
      subject: truncate(row.subject, 120),
      preview: truncate(row.summary, 200),
      daysSinceSent: daysBetween(row.occurredAt, now),
      sentAt: row.occurredAt,
    }))
    .sort((a, b) => b.daysSinceSent - a.daysSinceSent)
    .slice(offset, offset + limit);
}

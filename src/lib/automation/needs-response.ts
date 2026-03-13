import { prisma } from "@/lib/prisma";
import {
  getUnrespondedThreads,
  type UnrespondedThread,
} from "@/lib/thread-intelligence";

// ─── Types ───

export type NeedsResponseChannel = "email" | "imessage";

export interface NeedsResponseItem {
  readonly id: string; // interaction ID
  readonly contactId: string;
  readonly contactName: string;
  readonly contactCompany: string | null;
  readonly contactTier: string | null;
  readonly contactAvatarUrl: string | null;
  readonly channel: NeedsResponseChannel;
  readonly subject: string | null;
  readonly preview: string | null;
  readonly daysWaiting: number;
  readonly lastMessageAt: string; // ISO string
  readonly priority: "high" | "medium" | "low";
  readonly priorityReason: string;
}

// ─── Priority scoring for iMessage ───

function scoreImessagePriority(
  daysWaiting: number,
  contactTier: string | null,
): { priority: "high" | "medium" | "low"; reason: string } {
  const reasons: string[] = [];

  if (contactTier === "INNER_CIRCLE") {
    if (daysWaiting >= 2) {
      reasons.push("Inner circle", `${daysWaiting}d waiting`);
      return { priority: "high", reason: reasons.join(" · ") };
    }
    reasons.push("Inner circle");
    return { priority: "medium", reason: reasons.join(" · ") };
  }

  if (contactTier === "PROFESSIONAL") {
    if (daysWaiting >= 3) {
      reasons.push("Professional", `${daysWaiting}d waiting`);
      return { priority: "high", reason: reasons.join(" · ") };
    }
    if (daysWaiting >= 1) {
      return { priority: "medium", reason: `${daysWaiting}d waiting` };
    }
    return { priority: "low", reason: "Recent message" };
  }

  // Acquaintance or unknown
  if (daysWaiting >= 5) {
    return { priority: "high", reason: `${daysWaiting}d waiting` };
  }
  if (daysWaiting >= 2) {
    return { priority: "medium", reason: `${daysWaiting}d waiting` };
  }
  return { priority: "low", reason: "Recent message" };
}

// ─── iMessage unresponded detection ───

async function getUnrespondedImessages(
  userId: string,
): Promise<NeedsResponseItem[]> {
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Get the latest MESSAGE interaction per contact
  const latestPerContact = await prisma.$queryRaw<
    Array<{
      id: string;
      contactId: string;
      contactName: string;
      contactCompany: string | null;
      contactTier: string | null;
      contactAvatarUrl: string | null;
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
      c."avatarUrl" AS "contactAvatarUrl",
      i."summary",
      i."occurredAt",
      i."direction"
    FROM "Interaction" i
    JOIN "Contact" c ON c."id" = i."contactId"
    WHERE i."userId" = ${userId}
      AND i."type" = 'MESSAGE'
      AND i."dismissedAt" IS NULL
      AND i."occurredAt" >= ${fourteenDaysAgo}
    ORDER BY i."contactId", i."occurredAt" DESC
  `;

  // Only keep INBOUND (they texted last, we haven't replied)
  return latestPerContact
    .filter((r) => r.direction === "INBOUND")
    .map((row) => {
      const daysWaiting = Math.floor(
        (now.getTime() - row.occurredAt.getTime()) / (1000 * 60 * 60 * 24),
      );
      const { priority, reason } = scoreImessagePriority(
        daysWaiting,
        row.contactTier,
      );

      return {
        id: row.id,
        contactId: row.contactId,
        contactName: row.contactName,
        contactCompany: row.contactCompany,
        contactTier: row.contactTier,
        contactAvatarUrl: row.contactAvatarUrl,
        channel: "imessage" as const,
        subject: null,
        preview: row.summary ? row.summary.slice(0, 200) : null,
        daysWaiting,
        lastMessageAt: row.occurredAt.toISOString(),
        priority,
        priorityReason: reason,
      };
    });
}

// ─── Combined scanner ───

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

export async function scanNeedsResponse(
  userId: string,
): Promise<readonly NeedsResponseItem[]> {
  // Run email and iMessage scans in parallel
  const [emailThreads, imessageItems] = await Promise.all([
    getUnrespondedThreads(userId, { limit: 30 }),
    getUnrespondedImessages(userId),
  ]);

  // Convert email threads to unified format
  const emailItems: NeedsResponseItem[] = await enrichEmailItems(
    userId,
    emailThreads,
  );

  // Merge and sort by priority then days waiting
  const combined = [...emailItems, ...imessageItems];
  combined.sort((a, b) => {
    const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (pDiff !== 0) return pDiff;
    return b.daysWaiting - a.daysWaiting;
  });

  return combined;
}

async function enrichEmailItems(
  userId: string,
  threads: readonly UnrespondedThread[],
): Promise<NeedsResponseItem[]> {
  if (threads.length === 0) return [];

  // Batch-fetch contact details for avatar + tier
  const contactIds = [...new Set(threads.map((t) => t.contactId))];
  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds }, userId },
    select: { id: true, tier: true, avatarUrl: true },
  });
  const contactMap = new Map(contacts.map((c) => [c.id, c]));

  return threads
    .filter((t) => t.priority !== "skip")
    .map((thread) => {
      const contact = contactMap.get(thread.contactId);
      return {
        id: thread.interactionId,
        contactId: thread.contactId,
        contactName: thread.contactName,
        contactCompany: thread.contactCompany,
        contactTier: contact?.tier ?? null,
        contactAvatarUrl: contact?.avatarUrl ?? null,
        channel: "email" as const,
        subject: thread.subject,
        preview: thread.preview,
        daysWaiting: thread.daysWaiting,
        lastMessageAt: thread.lastMessageAt.toISOString(),
        priority: thread.priority as "high" | "medium" | "low",
        priorityReason: thread.priorityReason,
      };
    });
}
